/**
 * Copy buttons: [data-copy-target="<selector>"] copies the value/text of the
 * target element, [data-copy-text="…"] copies a literal. Uses the async
 * Clipboard API, falls back to a temporary textarea + execCommand, and as a
 * last resort selects the text so the user can copy it manually.
 * Success/failure is shown in the button label and announced (toast).
 */
import { announce, on, el, byLang } from './dom.js';

/**
 * Copy text to the clipboard.
 * @param {string} text
 * @returns {Promise<boolean>} true when copied
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const ta = el('textarea', { readonly: true, 'aria-hidden': 'true', class: 'sr-only', tabindex: '-1' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Select the contents of an element (manual copy fallback). */
function selectContents(target) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    target.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

const timers = new WeakMap();

function flashLabel(button, text) {
  const label = button.querySelector('.button__label') ?? button;
  if (!button.dataset.label) button.dataset.label = label.textContent ?? '';
  label.textContent = text;
  window.clearTimeout(timers.get(button));
  timers.set(
    button,
    window.setTimeout(() => {
      label.textContent = button.dataset.label ?? '';
    }, 2000),
  );
}

export function initCopy() {
  on(document, 'click', '[data-copy-target], [data-copy-text]', async (e, button) => {
    e.preventDefault();
    const selector = button.getAttribute('data-copy-target');
    const target = selector ? document.querySelector(selector) : null;
    const text =
      button.getAttribute('data-copy-text') ??
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : target?.textContent ?? '');
    if (!text) return;
    if (await copyText(text.trim())) {
      flashLabel(button, button.getAttribute('data-copied-label') || byLang('Kopioitu', 'Copied'));
      announce(byLang('Kopioitu leikepöydälle.', 'Copied to the clipboard.'));
    } else {
      if (target) selectContents(target);
      announce(
        byLang(
          'Kopiointi ei onnistunut. Teksti on valittuna – kopioi se näppäinyhdistelmällä Ctrl+C tai ⌘+C.',
          'Copying failed. The text is selected – copy it with Ctrl+C or ⌘+C.',
        ),
        6000,
      );
    }
  });
}
