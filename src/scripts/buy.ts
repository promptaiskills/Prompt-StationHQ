/**
 * buy.ts — purchase experience for Gumroad-backed products.
 *
 * WHAT IT DOES
 *  1. Lazily injects Gumroad's official overlay library the first time a
 *     "Buy" button is present / clicked (https://gumroad.com/js/gumroad.js).
 *  2. Intercepts a click on a .gumroad-button and opens an accessible
 *     "secure checkout" dialog that confirms product + price, explains how
 *     delivery works, and then hands off to Gumroad's hosted overlay.
 *  3. Communicates honest states: idle → preparing (loading) → checkout
 *     opened (guidance) / error (script failed → direct Gumroad link).
 *
 * WHAT IT DOES NOT DO
 *  • It never claims to verify a purchase (that is impossible client-side).
 *  • It never exposes or proxies paid file URLs — files stay on Gumroad.
 *  • It never touches Gumroad credentials.
 */

import { trapFocus, readJson } from './utils';

interface BuyPayload {
  name: string;
  price: number;
  currency: string;
  compareAt: number | null;
  url: string;
  slug: string;
  format: string;
}

const GUMROAD_SCRIPT = (document.documentElement.dataset.gumroadScript as string) || 'https://gumroad.com/js/gumroad.js';

let scriptState: 'untouched' | 'loading' | 'ok' | 'failed' = 'untouched';
let dialog: HTMLElement | null = null;
let lastAnchor: HTMLAnchorElement | null = null;
let restoreFocus: HTMLElement | null = null;
let cleanupTrap: (() => void) | null = null;

/* ------------------------------------------------------------------ script */

function injectGumroadScript(): Promise<void> {
  if (scriptState === 'ok') return Promise.resolve();
  if (scriptState === 'loading') return new Promise(() => {}); // resolved by loader below
  scriptState = 'loading';
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = GUMROAD_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      scriptState = 'ok';
      resolve();
    };
    s.onerror = () => {
      scriptState = 'failed';
      document.documentElement.dataset.gumroadFailed = 'true';
      resolve();
    };
    document.head.appendChild(s);
    // Hard timeout — if the network is slow/blocked, surface the error state
    window.setTimeout(() => {
      if (scriptState === 'loading') {
        s.remove();
        scriptState = 'failed';
        document.documentElement.dataset.gumroadFailed = 'true';
        resolve();
      }
    }, 6000);
  });
}

/* ------------------------------------------------------------------ dialog */

function currencySymbol(code: string): string {
  const map: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', KES: 'KSh ', JPY: '¥', CAD: 'C$', AUD: 'A$', INR: '₹', NGN: '₦', ZAR: 'R' };
  return map[code] ?? `${code} `;
}

function fmtPrice(value: number, code: string): string {
  const sym = currencySymbol(code);
  const decimals = Number.isInteger(value) ? 0 : 2;
  return `${sym}${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: 2 })}`;
}

function buildDialog(p: BuyPayload): HTMLElement {
  const d = document.createElement('div');
  d.className = 'ps-buy-dialog';
  d.innerHTML = `
    <div class="fixed inset-0 z-[70] overflow-y-auto bg-ink/45 p-4 sm:p-6" data-backdrop>
      <div role="dialog" aria-modal="true" aria-labelledby="ps-buy-title" class="mx-auto mt-8 w-full max-w-md rounded-lg border border-line bg-surface shadow-xl" tabindex="-1">
        <div class="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p class="eyebrow">Secure checkout</p>
            <h2 id="ps-buy-title" class="mt-1 font-display text-lg font-bold leading-snug tracking-tight"></h2>
          </div>
          <button type="button" class="rounded-md p-1.5 text-ink-faint transition hover:bg-ink/5 hover:text-ink" data-close aria-label="Close and return to product">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="px-5 py-5" data-body></div>
        <div class="flex flex-col gap-2 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-footer></div>
      </div>
    </div>`;
  d.querySelector('[data-body]')!.innerHTML = `
    <div class="mb-4 flex items-baseline gap-2">
      <span class="tabular font-display text-2xl font-bold" data-price></span>
      <span class="text-xs text-ink-soft" data-format></span>
    </div>
    <p class="mb-4 text-sm leading-relaxed text-ink-soft" data-note></p>
    <div class="mb-4 rounded-md border border-line bg-paper p-3 text-sm text-ink-soft" data-status role="status">
      <span data-status-label>Preparing secure checkout…</span>
      <span data-status-detail class="block text-ink-faint"></span>
    </div>
    <details class="group text-sm">
      <summary class="flex items-center justify-between rounded-md px-3 py-2.5 font-semibold text-ink transition hover:bg-ink/5">
        How delivery works
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="transition-transform group-open:rotate-180"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </summary>
      <div class="px-3 pb-3 pt-1 leading-relaxed text-ink-soft" data-delivery></div>
    </details>`;
  const footer = d.querySelector('[data-footer]')!;
  footer.innerHTML = `
    <a href="${p.url}" target="_blank" rel="noopener" class="text-xs font-semibold text-brand underline-offset-2 hover:underline" data-direct>Open Gumroad directly →</a>
    <div class="flex gap-2">
      <button type="button" class="btn-outline px-3 py-2 text-sm" data-close>Back to product</button>
      <button type="button" class="btn-primary px-4 py-2 text-sm" data-continue>Continue to secure checkout</button>
    </div>`;
  return d;
}

function openDialog(p: BuyPayload) {
  restoreFocus = document.activeElement as HTMLElement;
  dialog = buildDialog(p);
  const title = dialog.querySelector<HTMLElement>('#ps-buy-title')!;
  const price = dialog.querySelector<HTMLElement>('[data-price]')!;
  const format = dialog.querySelector<HTMLElement>('[data-format]')!;
  const note = dialog.querySelector<HTMLElement>('[data-note]')!;
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const statusLabel = dialog.querySelector<HTMLElement>('[data-status-label]')!;
  const statusDetail = dialog.querySelector<HTMLElement>('[data-status-detail]')!;
  const delivery = dialog.querySelector<HTMLElement>('[data-delivery]')!;
  const continueBtn = dialog.querySelector<HTMLButtonElement>('[data-continue]')!;
  const directLink = dialog.querySelector<HTMLAnchorElement>('[data-direct]')!;
  const closeButtons = dialog.querySelectorAll<HTMLButtonElement>('[data-close]');
  const backdrop = dialog.querySelector<HTMLElement>('[data-backdrop]')!;

  title.textContent = p.name;
  price.textContent = fmtPrice(p.price, p.currency);
  format.textContent = p.format ? `· ${p.format}` : '';
  note.textContent =
    'Payment is processed securely by Gumroad (Stripe). Once payment succeeds, delivery links are sent by Gumroad instantly.';
  delivery.innerHTML =
    '<ol class="list-decimal space-y-1.5 pl-4">' +
    '<li>Complete payment in the Gumroad checkout window.</li>' +
    '<li>Gumroad emails your receipt with secure download links immediately.</li>' +
    '<li>Your purchase stays accessible anytime in your <a class="text-brand underline underline-offset-2" href="https://app.gumroad.com/library" target="_blank" rel="noopener">Gumroad library</a>.</li>' +
    '<li>Return here whenever you need help or a follow-up purchase.</li>' +
    '</ol>';

  document.body.appendChild(dialog);
  document.body.style.overflow = 'hidden';
  cleanupTrap = trapFocus(dialog);
  const panel = dialog.querySelector<HTMLElement>('[role="dialog"]')!;
  // focus first control (continue) after a tick so the dialog is announced last
  requestAnimationFrame(() => continueBtn.focus());

  const setState = (label: string, detail: string, variant: 'busy' | 'ok' | 'error' | 'warn') => {
    statusLabel.textContent = label;
    statusDetail.textContent = detail;
    status.className =
      'mb-4 rounded-md border p-3 text-sm ' +
      (variant === 'busy' ? 'border-line bg-paper text-ink-soft' : variant === 'ok' ? 'border-success/30 bg-success-soft text-success' : variant === 'error' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-line bg-warn-soft text-warn');
  };
  const setStage = (stage: 'preparing' | 'checkout' | 'failed') => {
    if (stage === 'preparing') {
      continueBtn.disabled = true;
      continueBtn.textContent = 'Preparing secure checkout…';
      setState('Loading secure checkout…', 'Connecting to Gumroad’s payment provider. A moment, please.', 'busy');
    } else if (stage === 'checkout') {
      continueBtn.disabled = false;
      continueBtn.textContent = 'Reopen checkout window';
      setState('Checkout opened', 'Complete payment in the Gumroad window. Need it again? Use “Reopen checkout”.', 'ok');
    } else {
      continueBtn.disabled = false;
      continueBtn.textContent = 'Try loading checkout again';
      setState('Checkout failed to load', 'The payment window could not be reached from this network. Use the direct Gumroad link instead — it is equally secure.', 'error');
    }
  };

  directLink.addEventListener('click', () => closeDialog());
  closeButtons.forEach((b) => b.addEventListener('click', closeDialog));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeDialog();
  });
  document.addEventListener('keydown', onKeydown);

  async function launch() {
    setStage('preparing');
    await injectGumroadScript();
    if (scriptState === 'failed') {
      setStage('failed');
      return;
    }
    setStage('checkout');
    if (lastAnchor) {
      // Re-dispatch a real click so Gumroad's overlay library handles it.
      lastAnchor.dataset.psRelaunch = 'true';
      lastAnchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }
  continueBtn.addEventListener('click', launch);

  // kick off after a frame so the click that opened the dialog has finished
  window.setTimeout(launch, 120);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeDialog();
  }

  function closeDialog() {
    document.removeEventListener('keydown', onKeydown);
    cleanupTrap?.();
    dialog?.remove();
    dialog = null;
    document.body.style.overflow = '';
    panel?.focus({ preventScroll: true });
    restoreFocus?.focus({ preventScroll: true });
  }
}

/* ------------------------------------------------------------------ wiring */

document.addEventListener(
  'click',
  (e) => {
    // Only capture clicks on Gumroad buttons we manage
    const target = (e.target as HTMLElement).closest?.('a.gumroad-button') as HTMLAnchorElement | null;
    if (!target) return;

    // Clicks we dispatch ourselves to trigger the overlay must not re-enter.
    if (target.dataset.psRelaunch === 'true') {
      delete target.dataset.psRelaunch;
      return;
    }

    const payload = readJson<BuyPayload>(target, 'data-ps');
    lastAnchor = target;
    if (!payload) return;

    e.preventDefault();
    e.stopPropagation();

    // If the overlay library failed to load and the user already saw the
    // dialog, let plain clicks navigate straight to Gumroad's checkout.
    if (scriptState === 'failed' && dialog === null) return;

    openDialog(payload);
  },
  true
);

// Pre-inject the overlay library on pages that contain buy buttons, so the
// first click has zero extra latency.
if (document.querySelector('.gumroad-button')) {
  window.addEventListener('load', () => {
    void injectGumroadScript();
  });
}