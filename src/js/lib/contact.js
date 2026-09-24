/**
 * Contact dialog (markup in layout.js): opened by any [data-open-contact]
 * element (footer, /tietoa/, /kayttoehdot/ …), sent with EmailJS, which is
 * imported lazily (own chunk) when the dialog opens and awaited before sending.
 *
 * - Native <dialog> + showModal(): focus trap, Esc and backdrop are native;
 *   focus goes to the first field and returns to the opener on close (dom.js).
 * - Spam protection: a honeypot field (bots fill it: we pretend success and
 *   send nothing), a minimum fill time of 3 s, maxlength limits (also checked
 *   here, pasted text can exceed them) and one message per minute per page.
 *   No storage is used (EmailJS' own localStorage rate limiter is not used).
 * - Errors are shown inline: per field (#<id>-virhe, aria-invalid) and a
 *   form-level role="alert" message – never alert(). On a send failure the
 *   text stays in the form and the message tells another way to reach us
 *   (the postal address from data-fallback, rendered by layout.js).
 *
 * validateContact() is pure and unit-tested in test/trust.test.js.
 */
import { EMAILJS } from '../../site.config.js';
import { on, openDialog, isEnglishPage } from './dom.js';
import { track } from './analytics.js';

/** Field limits (the same numbers are rendered as maxlength in layout.js). */
export const CONTACT_LIMITS = Object.freeze({ name: 100, email: 254, message: 3000, messageMin: 5 });
/** A human needs at least this long to fill in the form. */
export const MIN_FILL_MS = 3000;
/** One successful message per page load and minute. */
export const RESEND_MS = 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Form texts by page language (the dialog markup is rendered in the same language by layout.js). */
const TEXTS = {
  fi: {
    nameLong: (max) => `Nimi on liian pitkä (enintään ${max} merkkiä).`,
    emailMissing: 'Anna sähköpostiosoite, johon voimme vastata.',
    emailInvalid: 'Tarkista sähköpostiosoite (muoto nimi@esimerkki.fi).',
    messageMissing: 'Kirjoita viesti.',
    messageLong: (n, max) => `Viesti on liian pitkä (${n} merkkiä, enintään ${max}).`,
    checkMany: 'Tarkista merkityt kentät.',
    checkOne: 'Tarkista merkitty kenttä.',
    tooFast: 'Viestiä ei lähetetty, koska lomake lähetettiin hyvin nopeasti. Odota hetki ja yritä uudelleen.',
    tooSoon: 'Lähetit juuri viestin. Odota hetki ennen seuraavaa viestiä.',
    sending: 'Lähetetään…',
    anonymous: 'Nimetön',
    failed: 'Viestiä ei saatu lähetettyä. Tekstisi on yhä lomakkeella – yritä hetken päästä uudelleen.',
  },
  en: {
    nameLong: (max) => `The name is too long (at most ${max} characters).`,
    emailMissing: 'Enter an email address we can reply to.',
    emailInvalid: 'Check the email address (format name@example.com).',
    messageMissing: 'Write a message.',
    messageLong: (n, max) => `The message is too long (${n} characters, at most ${max}).`,
    checkMany: 'Check the marked fields.',
    checkOne: 'Check the marked field.',
    tooFast: 'The message was not sent because the form was submitted very quickly. Wait a moment and try again.',
    tooSoon: 'You just sent a message. Wait a moment before sending another one.',
    sending: 'Sending…',
    anonymous: 'Anonymous',
    failed: 'The message could not be sent. Your text is still in the form – please try again in a moment.',
  },
};

/**
 * Validate the visible fields. Returns trimmed values and error messages per
 * field (empty object = valid), Finnish unless `lang` is 'en'.
 * @param {{name?: string, email?: string, message?: string}} input
 * @param {'fi'|'en'} [lang='fi']
 * @returns {{values: {name: string, email: string, message: string}, errors: Partial<Record<'name'|'email'|'message', string>>}}
 */
export function validateContact({ name = '', email = '', message = '' }, lang = 'fi') {
  const t = TEXTS[lang] ?? TEXTS.fi;
  const values = { name: String(name).trim(), email: String(email).trim(), message: String(message).trim() };
  const errors = {};
  if (values.name.length > CONTACT_LIMITS.name) errors.name = t.nameLong(CONTACT_LIMITS.name);
  if (!values.email) errors.email = t.emailMissing;
  else if (values.email.length > CONTACT_LIMITS.email || !EMAIL_RE.test(values.email)) {
    errors.email = t.emailInvalid;
  }
  if (values.message.length < CONTACT_LIMITS.messageMin) errors.message = t.messageMissing;
  else if (values.message.length > CONTACT_LIMITS.message) {
    errors.message = t.messageLong(values.message.length, CONTACT_LIMITS.message);
  }
  return { values, errors };
}

let emailjsPromise = null;
const loadEmailjs = () => {
  emailjsPromise ??= import('@emailjs/browser').catch((err) => {
    emailjsPromise = null; // allow a retry (e.g. back online)
    throw err;
  });
  return emailjsPromise;
};

export function initContact() {
  const dialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('yhteydenotto'));
  const form = /** @type {HTMLFormElement|null} */ (dialog?.querySelector('[data-contact-form]'));
  if (!dialog || !form) return;
  const success = dialog.querySelector('[data-contact-success]');
  const successEmail = dialog.querySelector('[data-contact-email]');
  const formError = form.querySelector('.form__error');
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  const submitLabel = submit.querySelector('.button__label') ?? submit;
  const idleLabel = submitLabel.textContent;
  const fallback = form.dataset.fallback ?? '';
  const lang = isEnglishPage() ? 'en' : 'fi';
  const t = TEXTS[lang];
  const fields = {
    name: /** @type {HTMLInputElement|null} */ (form.elements.namedItem('name')),
    email: /** @type {HTMLInputElement} */ (form.elements.namedItem('email')),
    message: /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('message')),
    website: /** @type {HTMLInputElement|null} */ (form.elements.namedItem('website')),
  };
  let openedAt = 0;
  let lastSentAt = 0;
  let sending = false;

  const setFieldError = (input, text) => {
    if (!input) return;
    const box = document.getElementById(`${input.id}-virhe`);
    if (box) box.textContent = text;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const setFormError = (text) => {
    if (formError) formError.textContent = text;
  };
  const clearErrors = () => {
    for (const key of ['name', 'email', 'message']) setFieldError(fields[key], '');
    setFormError('');
  };
  const showSuccess = (email) => {
    if (successEmail) successEmail.textContent = email;
    form.hidden = true;
    if (success) {
      success.hidden = false;
      // Focus the message itself so screen readers read it (then Tab → Sulje).
      const msg = /** @type {HTMLElement|null} */ (success.querySelector('[data-contact-success-message]') ?? success.querySelector('button'));
      msg?.focus();
    }
  };
  const reset = () => {
    if (form.hidden) {
      form.reset();
      form.hidden = false;
      if (success) success.hidden = true;
    }
    clearErrors();
  };

  on(document, 'click', '[data-open-contact]', (e, opener) => {
    e.preventDefault();
    reset();
    openedAt = Date.now();
    openDialog(dialog, opener);
    (fields.name ?? fields.email)?.focus();
    loadEmailjs().catch(() => {});
  });

  // Clear a field's error as soon as it is corrected.
  form.addEventListener('input', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLElement) || input.getAttribute('aria-invalid') !== 'true') return;
    const key = /** @type {'name'|'email'|'message'} */ (input.getAttribute('name'));
    const { errors } = validateContact({ name: fields.name?.value, email: fields.email.value, message: fields.message.value }, lang);
    if (!errors[key]) setFieldError(input, '');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    clearErrors();

    const { values, errors } = validateContact({ name: fields.name?.value, email: fields.email.value, message: fields.message.value }, lang);

    // Honeypot filled → a bot. Pretend success without sending anything.
    if (fields.website?.value) {
      showSuccess(values.email);
      return;
    }

    const invalid = /** @type {const} */ (['name', 'email', 'message']).filter((k) => errors[k]);
    if (invalid.length) {
      invalid.forEach((k) => setFieldError(fields[k], errors[k] ?? ''));
      setFormError(invalid.length > 1 ? t.checkMany : t.checkOne);
      fields[invalid[0]]?.focus();
      return;
    }
    const now = Date.now();
    if (now - openedAt < MIN_FILL_MS) {
      setFormError(t.tooFast);
      return;
    }
    if (lastSentAt && now - lastSentAt < RESEND_MS) {
      setFormError(t.tooSoon);
      return;
    }

    sending = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submitLabel.textContent = t.sending;
    try {
      const emailjs = await loadEmailjs();
      await emailjs.send(
        EMAILJS.serviceId,
        EMAILJS.templateId,
        { from_name: values.name || t.anonymous, from_email: values.email, reply_to: values.email, message: values.message },
        { publicKey: EMAILJS.publicKey, blockHeadless: true },
      );
      lastSentAt = Date.now();
      showSuccess(values.email);
      track('contact_form_sent');
    } catch {
      setFormError(
        `${t.failed}${fallback ? ` ${fallback}` : ''}`,
      );
    } finally {
      sending = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
      submitLabel.textContent = idleLabel;
    }
  });
}
