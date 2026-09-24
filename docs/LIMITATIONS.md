# Known limitations & the honest model

This document exists because "buy on my site, download without ever leaving" is a **real architectural question**
with Gumroad — and the correct answer is to not fake it. Here's exactly what is and isn't possible, and what the
site does instead.

## 1. Checkout is presented on-site, but payment happens on Gumroad

Gumroad's official **Overlay** opens its hosted checkout in a secure window over the page. The customer never
gets dumped to a new tab in the visible flow — but the payment/checkout **is** Gumroad's page inside that window.
Gumroad does not offer an API to embed its checkout *into your own DOM*, so this is the closest legitimate
experience: stay on the site, complete payment in the Gumroad window.

## 2. The site cannot know whether a payment succeeded (and doesn't pretend to)

Gumroad's checkout is on their origin; a client-side page cannot read the transaction result. Therefore:
- Purchase-success, download and "receipt" states are shown **as guidance** ("check your inbox / Gumroad library"),
  never as verified fact.
- Real verification channels are server-side only:
  - **License Verify API** (proxy implemented → `/api/gumroad-license-verify`) — verifies a license key on demand.
  - **Ping webhook** (receiver implemented → `/api/gumroad-ping`) — Gumroad tells *you* about sales.
  Both are optional, and the widget only appears once real product IDs exist.

## 3. Paid files are never hosted or proxied by the store

The "download without leaving the store" idea would require one of:

| Approach | Why it's rejected |
| --- | --- |
| Put files in `public/` | Files become publicly downloadable by anyone — defeats selling. ❌ |
| Frontend fetches Gumroad's download URL | Gumroad's per-purchase links are expiring, single-use and tied to the buyer's session; exposing or forwarding them client-side is fragile, often broken by expiry, and puts the merchant in the position of publicly leaking paid content. ❌ |
| Server downloads then re-serves the file | Gumroad has no API for creators to hand the paid file to another server for re-hosting; and re-hosting would disable Gumroad's license enforcement, refunds and library access. ❌ |

So delivery is genuinely **Gumroad-owned**: receipt email with secure links + the buyer's Gumroad library.
The storefront's job is discovery, presentation and purchase initiation — not file custody. This is also why the
header's "Access my purchases" link points to the buyer's Gumroad library.

## 4. Client-side "security" that isn't security

Nothing in this site hides or claims to hide files behind client-side code. A static site has no secrets and no
private storage; any client-side "paywall" would be trivially bypassed. The security boundary is Gumroad's, and
the site treats it as such.

## 5. Forms need Netlify (not local dev)

Service-request and contact forms use **Netlify Forms** — they only accept submissions on the deployed site.
In local `astro dev`/`astro preview`, submitting shows the honest "could not reach the submission service" error.

## 6. Scale notes

- 1,100+ subcategory pages build in seconds; the architecture is static, so thousands of products are fine.
- Client search indexes the whole catalog in a small JSON file; for very large catalogs (10k+ products) consider
  switching `/search` to a serverless/edge search — the page's plumbing already separates the index URL.
- Pagination is not implemented; subcategory grids render all products for that collection (1–5 in practice).
  `SHOP.perPage` exists if you later want it.

## 7. What's not implemented (by design, not by accident)

- **Wishlists / carts**: digital single-item checkout makes them UX noise; Gumroad also gains a small cart
  surcharge for multi-item purchases.
- **Reviews & ratings**: no customer data exists to show ratings honestly.
- **Newsletter**: requires a consent/backend story you should add deliberately, not bolt on.
- **Membership/DRM**: Gumroad license keys + the verify proxy are the supported path if you need this later.