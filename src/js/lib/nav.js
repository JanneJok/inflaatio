/**
 * Navigation: mobile menu (hamburger with aria-expanded, Esc, outside click,
 * closes on link click, when focus leaves it and when the viewport grows to
 * desktop) and scrollspy for in-page tables of contents
 * (nav[data-scrollspy] a[href^="#"]).
 *
 * Keyboard: the <nav> comes before the hamburger in the DOM (desktop order),
 * so opening the menu moves focus to its first link; Tab then walks the
 * links, and leaving the menu (Tab past the last link, Shift+Tab before the
 * first) closes it.
 */

const DESKTOP = '(min-width: 960px)';

function initMenu() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById(toggle?.getAttribute('aria-controls') ?? '');
  if (!toggle || !nav) return;

  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const setOpen = (open, { focus = false } = {}) => {
    toggle.setAttribute('aria-expanded', String(open));
    // Labels come from the server-rendered button (Finnish or English page).
    const label = open ? toggle.dataset.labelClose || 'Sulje valikko' : toggle.dataset.labelOpen || 'Avaa valikko';
    toggle.setAttribute('aria-label', label);
    nav.classList.toggle('is-open', open);
    // preventScroll: the header is sticky, focusing it must not scroll the page.
    if (open && focus) nav.querySelector('a')?.focus({ preventScroll: true });
    if (!open && focus) toggle.focus({ preventScroll: true });
  };

  toggle.addEventListener('click', () => setOpen(!isOpen(), { focus: !isOpen() }));
  // Focus moved outside the open menu (Tab past the last link, a click on a
  // focusable element elsewhere): close it. relatedTarget null = the window
  // or a non-focusable area; outside clicks are handled below.
  nav.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (isOpen() && to instanceof Node && !nav.contains(to) && !toggle.contains(to)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false, { focus: true });
  });
  document.addEventListener('click', (e) => {
    if (!isOpen() || !(e.target instanceof Node)) return;
    if (!nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  nav.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) setOpen(false);
  });
  window.matchMedia?.(DESKTOP).addEventListener?.('change', (e) => {
    if (e.matches) setOpen(false);
  });
}

function initScrollspy() {
  const navs = document.querySelectorAll('nav[data-scrollspy]');
  if (!navs.length || !('IntersectionObserver' in window)) return;
  for (const nav of navs) {
    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const targets = links
      .map((a) => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))))
      .filter(Boolean);
    if (!targets.length) continue;
    const visible = new Set();
    const mark = () => {
      // The first section (in document order) that is on screen wins.
      const current = targets.find((t) => visible.has(t)) ?? null;
      for (const a of links) {
        const on = current && a.getAttribute('href') === `#${current.id}`;
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        mark();
      },
      // A band between 20 % and 35 % of the viewport height decides the current section.
      { rootMargin: '-20% 0px -65% 0px', threshold: 0 },
    );
    targets.forEach((t) => io.observe(t));
  }
}

export function initNav() {
  initMenu();
  initScrollspy();
}
