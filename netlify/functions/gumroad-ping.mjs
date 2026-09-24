/**
 * /api/gumroad-ping — Netlify function that receives Gumroad "Ping"
 * notifications (Settings → Advanced → Ping) whenever a sale occurs.
 *
 * WHAT IT'S FOR
 *   • Optional order/notification logging (visible in Netlify's function logs)
 *   • A foundation for CRM, thank-you emails, or discount automation later
 *   • Proof-of-integration for the Gumroad → site notification path
 *
 * HONEST LIMITATIONS
 *   • Gumroad's Ping carries sale info but is not HMAC-signed in a way this
 *     function can cryptographically verify without a documented shared
 *     secret; the practical protection is the shared token below.
 *   • We never store or expose paid file URLs / credentials.
 *
 * SETUP
 *   1. Set env var GUMROAD_PING_SECRET (a long random string).
 *   2. In Gumroad → Settings → Advanced → Ping, enter:
 *        https://YOUR-SITE.netlify.app/api/gumroad-ping?token=THE_SAME_SECRET
 *   3. Click "Send test ping to URL" and check the function logs.
 *
 * If GUMROAD_PING_SECRET is not set, the function still accepts pings (helpful
 * during first setup) — set it before production.
 */

const SECRET = process.env.GUMROAD_PING_SECRET;

export async function handler(event) {
  if (SECRET) {
    const token = event.queryStringParameters?.token;
    const headerToken = event.headers?.['x-gumroad-secret'];
    if (token !== SECRET && headerToken !== SECRET) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }
  }

  let params = { ...(event.queryStringParameters || {}) };
  const raw = event.body;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        params = { ...params, ...parsed };
      }
    } catch {
      // body may be form-encoded (application/x-www-form-urlencoded)
      try {
        const url = new URLSearchParams(raw);
        for (const [k, v] of url.entries()) params[k] = v;
      } catch {
        /* ignore unknown body format */
      }
    }
  }

  const mask = (email = '') => {
    const [local, domain] = String(email).split('@');
    if (!domain) return email || '—';
    return `${local.slice(0, 2)}•••@${domain}`;
  };

  const summary = {
    action: params.action || 'sale',
    sale_id: params.sale_id || params.id || null,
    product_name: params.product_name || params.product || null,
    price: params.price || params.product_price || null,
    currency: params.currency || params.product_currency || null,
    email: mask(params.email || params.purchaser_email),
    quantity: params.quantity || null,
    timestamp: params.created_at || new Date().toISOString(),
    received: new Date().toISOString(),
  };

  // Logged to Netlify's function logs (Functions → this function → Logs).
  console.log('[gumroad-ping]', JSON.stringify(summary));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, received: summary.received }),
  };
}