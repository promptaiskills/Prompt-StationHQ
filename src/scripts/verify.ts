/**
 * verify.ts — optional "verify your Gumroad license" widget (how-it-works).
 *
 * Calls the serverless function /api/gumroad-license-verify (a thin,
 * rate-limited proxy to Gumroad's official License Verify API). This is a
 * REAL, honest check — the site does not invent purchase state.
 */

const form = document.querySelector<HTMLFormElement>('[data-verify-form]');
if (form) {
  const productSelect = form.querySelector<HTMLSelectElement>('[name="product_id"]');
  const keyInput = form.querySelector<HTMLInputElement>('[name="license_key"]');
  const out = form.querySelector<HTMLElement>('[data-verify-out]');
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submit = btn as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!productSelect || !keyInput || !out) return;
    if (!productSelect.value || !keyInput.value.trim()) {
      out.textContent = 'Choose a product and enter the license key from your purchase email.';
      out.className = 'verify-out mt-4 rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn';
      out.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Checking…';

    try {
      const res = await fetch('/api/gumroad-license-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productSelect.value, license_key: keyInput.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success === true) {
        const name = data.purchase?.product_name || productSelect.options[productSelect.selectedIndex]?.textContent;
        out.className = 'verify-out mt-4 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm text-success';
        out.textContent = `Valid license for “${name}”. Access your files in your Gumroad library — the secure links in your purchase email also remain usable.`;
      } else {
        out.className = 'verify-out mt-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger';
        out.textContent = (data.message as string) || 'That license could not be verified. Double-check the key and product, then try again.';
      }
    } catch {
      out.className = 'verify-out mt-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger';
      out.textContent = 'Verification service unavailable right now — try again shortly, or use your Gumroad library.';
    }
    submit.disabled = false;
    submit.textContent = 'Verify license';
  });
}