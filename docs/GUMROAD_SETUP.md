# Gumroad setup & integration guide

This store sells digital products through **Gumroad**. Gumroad hosts the files, processes payment (via Stripe),
and delivers the purchase. The storefront integrates with the mechanisms Gumroad officially supports — and it
does NOT invent any that it doesn't.

## 1. The three integration points

| Mechanism | Used for | Official? |
| --- | --- | --- |
| **Overlay checkout** (`gumroad.com/js/gumroad.js` + links with class `gumroad-button`) | Presenting checkout inside the site in a secure window | ✅ Yes — Gumroad's documented overlay widget |
| **Product URLs** (`https://<you>.gumroad.com/l/<slug>`) | Buy buttons & direct checkout links | ✅ Yes |
| **License Verify API** (`api.gumroad.com/v2/licenses/verify`) | Optional "verify your purchase" widget (serverless proxy) | ✅ Yes |
| **Ping webhook** | Optional sale notifications to a Netlify function | ✅ Yes (Settings → Advanced → Ping) |

There is **no official Gumroad API** to render product listings inside your site or to re-host paid files — so the
store uses its own catalog (the CSV) as the source of listings, and Gumroad only for payment + delivery.

## 2. Dummy values you must replace

In **`src/config/site.mjs` → `GUMROAD`**:

```js
sellerHandle: 'YOUR_GUMROAD_USERNAME',           // ← the handle in your Gumroad URL
storeUrl:    'https://YOUR_GUMROAD_USERNAME.gumroad.com', // ← your store link
overlayScriptUrl: 'https://gumroad.com/js/gumroad.js',     // leave as-is unless Gumroad changes it
```

In **`products.csv`**, every row's `gumroad_url` currently points at
`https://YOUR_GUMROAD_USERNAME.gumroad.com/l/…` — replace each with your real product link.

## 3. Connecting real products

1. Create your product in Gumroad (product page describes the file/contents; upload the actual files there).
2. Copy the product URL from Gumroad (e.g. `https://yourhandle.gumroad.com/l/copywriting-pack`).
3. Paste it into the row's `gumroad_url` column.
4. (Optional) For the **license verification widget**: enable *License keys* on the Gumroad product, then copy the
   **product ID** from the license-key block on the product's content page into `gumroad_product_id`.

## 4. The overlay checkout (buy button)

- Every Buy button is an `<a class="gumroad-button" data-gumroad-single-product="true">` linking to the product URL.
- `src/scripts/buy.ts` lazily injects `gumroad.js` and shows an accessible pre-checkout dialog (product, price,
  "how delivery works"), then hands off to the overlay.
- **No JavaScript / script blocked:** the same link simply navigates to Gumroad's checkout — still 100% functional.
- **Important:** the payment window is Gumroad's own hosted checkout. This site cannot re-style or re-host it,
  and cannot know whether payment succeeded (that's Gumroad's job).
- The dialog's states are honest: *preparing → checkout opened → failed to load (direct Gumroad link offered)*.
  It never claims "payment complete."

## 5. Delivery & access (the honest model)

- Gumroad emails the buyer a receipt with **secure download links** immediately, and the purchase stays in their
  **Gumroad library** (`https://app.gumroad.com/library`).
- Paid files are **never** placed in this site's public assets and **never** proxied by this site.
- The header/footer "Access my purchases" link points to the buyer's Gumroad library (doesn't change this).

**Why not "download inside the store"?** Because that would require the store to host or proxy the paid files —
which would either make them public (insecure) or require Gumroad credentials in the browser (they belong on a
server, and even then Gumroad has no "deliver the file to this server for re-hosting" API for creators).
Full reasoning: `docs/LIMITATIONS.md`.

## 6. Optional: sale notifications (Gumroad Ping → Netlify function)

Stored at `netlify/functions/gumroad-ping.mjs`, exposed at `/api/gumroad-ping`.

1. Generate a secret: `openssl rand -hex 32`.
2. Set it as a Netlify env var `GUMROAD_PING_SECRET`.
3. In Gumroad → **Settings → Advanced → Ping**, enter:
   `https://YOUR-SITE.netlify.app/api/gumroad-ping?token=<THE_SAME_SECRET>`
4. Click "Send test ping to URL", then watch the function logs in Netlify.

The function logs a masked summary of each sale (product, price, currency, masked email, sale id). It returns
`200` unconditionally so Gumroad stops retrying. If the env var is unset, pings are accepted without a token check
(handy during setup) — set it before production.

## 7. Optional: license verification widget

On `/how-it-works`, a form verifies a customer's license key through a serverless proxy
(`netlify/functions/gumroad-license-verify.mjs` → `/api/gumroad-license-verify`).

- The proxy calls Gumroad's official verify endpoint, rate-limits per IP (in-memory), and returns Gumroad's payload.
- It requires **no secrets** (Gumroad's verify endpoint is public by design); the function adds abuse controls.
- The widget appears with real product IDs; with the shipped dummy IDs it shows a "coming soon" note (by design — you
  don't want a fake widget claiming verification).

## 8. Known good-to-know

- Gumroad's overlay script: `https://gumroad.com/js/gumroad.js`. If Gumroad ever changes it, update
  `GUMROAD.overlayScriptUrl` in one place.
- License verification needs the **product ID**, not the permalink, for products created after Jan 9, 2023.
- Every verify call **increments the license's "uses" counter** unless `increment_uses_count=false` is passed.