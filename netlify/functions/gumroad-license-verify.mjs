/**
 * /api/gumroad-license-verify — Netlify function that proxies Gumroad's
 * OFFICIAL License Verify API (https://api.gumroad.com/v2/licenses/verify).
 *
 * WHY A SERVERLESS PROXY?
 *   • Central point for rate limiting & logging (abuse prevention)
 *   • Lets the storefront keep gumroadURL / product IDs out of client logic
 *     responsibilities, and lets you later add an access-token requirement
 *     without touching the frontend
 *   • Gumroad's verify endpoint itself requires no secret — the proxy adds
 *     the abuse controls and a stable same-origin endpoint.
 *
 * REQUEST (POST, JSON)
 *   { "product_id": "…", "license_key": "…", "increment_uses_count": true }
 *
 * RESPONSE — the unmodified Gumroad payload, e.g.
 *   { "success": true, "uses": 1, "purchase": { "product_name": … },
 *     "message": "…" }
 */

const RATE_PER_MINUTE = 10;

function ipKey(event) {
  return event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

// Simple in-memory sliding-window limiter (resets when the function cold-starts —
// fine for a storefront; do not rely on it for hard security guarantees).
const buckets = new Map();

function rateLimited(event) {
  const now = Date.now();
  const key = ipKey(event);
  const entry = buckets.get(key);
  if (!entry || now - entry.start > 60000) {
    buckets.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_PER_MINUTE;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { 'Access-Control-Allow-Origin': event.headers?.origin || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  if (rateLimited(event)) {
    return { statusCode: 429, body: JSON.stringify({ success: false, message: 'Too many attempts — please wait a moment and try again.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Invalid JSON body.' }) };
  }

  const productId = String(body.product_id || '').trim();
  const licenseKey = String(body.license_key || '').trim();

  if (!productId || productId.length > 200 || !licenseKey || licenseKey.length > 100) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: 'Provide a product_id and license_key (max lengths enforced).' }),
    };
  }

  // Gumroad's official License Verify API takes exactly these form fields.
  const form = new URLSearchParams();
  form.append('product_id', productId);
  form.append('license_key', licenseKey);
  if (body.increment_uses_count !== undefined) {
    form.append('increment_uses_count', String(body.increment_uses_count));
  }

  try {
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { statusCode: 502, body: JSON.stringify({ success: false, message: 'Unexpected response from Gumroad.' }) };
    }
    console.log(`[license-verify] product=${productId.slice(0, 12)}… success=${data.success === true}`);
    return { statusCode: res.status === 404 ? 200 : res.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch {
    return { statusCode: 502, body: JSON.stringify({ success: false, message: 'Could not reach Gumroad’s license service. Please try again shortly.' }) };
  }
}