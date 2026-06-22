# FBM Connect — commerce on any website

FBM Connect turns Free Black Market into a commerce platform that **any** website
can plug into. There are two ways a vendor can use it, surfaced in the vendor
panel under **My Website**:

- **Mode 1 — Connect (bring your own site):** drop one `<script>` tag on an
  existing site (Squarespace, Webflow, Wix, WordPress, raw HTML, React, …) and
  render the vendor's catalog + checkout right there.
- **Mode 2 — Launch (no site yet):** one click provisions a standardized,
  FBM-hosted site pointed at the vendor's catalog. The launched site is simply
  **Mode 1 pre-configured** — see [`templates/fbm-site-template`](../../templates/fbm-site-template).

Everything is built on one public, website-agnostic contract: the **FBM Store
API**.

---

## 1. FBM Store API

### `GET /store/vendors/:handle`

Public, unauthenticated, read-only. No publishable key required, open CORS
(reflects the request origin) so any third-party site can call it.

**Query parameters** (all optional):

| Param            | Default              | Notes                                  |
| ---------------- | -------------------- | -------------------------------------- |
| `include`        | `vendor,products,events` | CSV of sections to return.         |
| `limit_products` | `24` (max `100`)     | Max products.                          |
| `limit_events`   | `12` (max `50`)      | Max events.                            |
| `currency_code`  | `usd`                | Preferred price currency.              |

**Response:**

```jsonc
{
  "vendor": {
    "id": "sel_…",
    "handle": "shaktiinnergy",
    "name": "Shakti Inner Energy",
    "description": "…",
    "photo": "https://…",
    "vendor_type": "maker",
    "verified": true,
    "rating": 4.8,
    "review_count": 12,
    "website_url": "https://shaktiinnergy.com",
    "social_links": { "instagram": "…" },
    "url": "https://freeblackmarket.com/us/sellers/shaktiinnergy"
  },
  "products": [
    {
      "id": "prod_…",
      "title": "Rose Quartz Roller",
      "handle": "rose-quartz-roller",
      "subtitle": null,
      "description": "…",
      "thumbnail": "https://…",
      "price": { "amount": 24, "currency_code": "usd" },
      "variants": [{ "id": "variant_…", "title": "Default", "price": { "amount": 24, "currency_code": "usd" } }],
      "url": "https://freeblackmarket.com/us/products/rose-quartz-roller"
    }
  ],
  "events": [
    {
      "id": "…",
      "title": "Sound Bath",
      "handle": "sound-bath",
      "thumbnail": null,
      "dates": ["2026-07-04T18:00:00Z"],
      "venue": { "name": "The Studio", "address": "…" },
      "price": { "amount": 30, "currency_code": "usd" },
      "url": "https://freeblackmarket.com/us/products/sound-bath"
    }
  ],
  "_meta": {
    "handle": "shaktiinnergy",
    "currency_code": "usd",
    "storefront_url": "https://freeblackmarket.com",
    "checkout_url": "https://freeblackmarket.com/us/cart",
    "generated_at": "2026-06-20T00:00:00.000Z"
  }
}
```

> Money amounts are **major units** (Medusa v2 convention): `24` means `$24.00`.
> Format with `Intl.NumberFormat(locale, { style: "currency", currency })`.

---

## 2. The Connect SDK (`connect.js`)

Served from `https://freeblackmarket.com/connect.js`. No dependencies, no build
step. Configure it entirely from the script tag:

```html
<script
  src="https://freeblackmarket.com/connect.js"
  data-fbm-handle="shaktiinnergy"
  data-fbm-api="https://api.freeblackmarket.com"
  async
></script>
```

| Attribute            | Required | Default                          |
| -------------------- | -------- | -------------------------------- |
| `data-fbm-handle`    | ✅       | —                                |
| `data-fbm-api`       |          | `https://api.freeblackmarket.com`|
| `data-fbm-storefront`|          | derived from API response        |
| `data-fbm-region`    |          | `us`                             |
| `data-fbm-currency`  |          | `usd`                            |
| `data-fbm-locale`    |          | `en-US`                          |

There are three layers of integration; use whichever fits.

### Layer 1 — Zero JS (HTML attributes)

The element renders itself and stays in sync with the catalog:

```html
<div data-fbm="vendor"></div>
<div data-fbm="products" data-fbm-limit="6"></div>
<div data-fbm="events"></div>
```

Per-element overrides: `data-fbm-handle`, `data-fbm-limit`, `data-fbm-currency`.

### Layer 2 — Widgets (styled UI into your container)

```js
FBM.renderProducts("#shop", { limit: 6 })
FBM.renderEvents("#events", { limit: 3 })
FBM.renderVendor("#profile")
```

Widget markup uses `.fbm-*` classes you can override in your own CSS.

### Layer 3 — Raw API (build your own UI)

```js
const vendor = await FBM.getVendor()
const products = await FBM.getProducts({ limit: 12 })
const events = await FBM.getEvents()

// Every item is enriched with convenience fields:
products[0]._price     // "$24.00"  (formatted for the configured locale)
products[0]._cartUrl   // deep link into FBM checkout for this product
products[0]._meta      // the response _meta block
```

### SDK reference

| Method                                   | Returns                                   |
| ---------------------------------------- | ----------------------------------------- |
| `FBM.configure(opts)`                    | Override config at runtime; returns `FBM` |
| `FBM.getVendor(handle?)`                 | `Promise<vendor>`                         |
| `FBM.getProducts(handle?, { limit, currency })` | `Promise<product[]>` (enriched)    |
| `FBM.getEvents(handle?, { limit })`      | `Promise<event[]>` (enriched)             |
| `FBM.cartUrl(productOrHandle?)`          | URL string (cart, or a product deep link) |
| `FBM.formatPrice({ amount, currency_code })` | formatted currency string             |
| `FBM.renderProducts(sel, opts)`          | renders + `Promise<void>`                 |
| `FBM.renderEvents(sel, opts)`            | renders + `Promise<void>`                 |
| `FBM.renderVendor(sel, opts)`            | renders + `Promise<void>`                 |
| `FBM.mount(root?)`                       | (re)scan `[data-fbm]` elements            |

`getX()` accept `(handle, opts)`, `(opts)`, or `()` — handle falls back to the
configured one. A single network call per handle is cached and shared across all
methods and widgets.

---

## 3. Vendor panel — "My Website"

`GET /vendor/website` returns the vendor's ready-to-paste snippet, whitelisted
domains, and launch status. The panel has two tabs:

- **Connect** — copies the snippet, shows the zero-JS examples + SDK reference,
  and lets the vendor record the domains they've embedded on
  (`POST /vendor/website` → `{ connect_domains: string[] }`).
- **Launch** — `POST /vendor/website/launch` provisions a hosted site. Returns
  `501` when the deployment hasn't configured the GitHub provisioning env (the
  button is disabled with an explanation, Connect still works).

### Backend data

Four columns on `seller_metadata` (migration
`Migration20260620AddWebsiteFields`):

| Column            | Meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `connect_domains` | `string[]` — hostnames the vendor embeds Connect on. |
| `site_status`     | `none \| provisioning \| live \| failed`.            |
| `site_url`        | Public URL of the launched site.                     |
| `site_repo`       | GitHub repo (`org/name`) backing the launched site.  |

### Launch provisioning env

See `.env.production.example` (FBM Sites section): `GITHUB_TOKEN`, `GITHUB_ORG`,
`SITE_TEMPLATE_REPO`, `SITES_DOMAIN`, `STOREFRONT_URL`, `PUBLIC_BACKEND_URL`.

When set, `POST /vendor/website/launch`:

1. `POST /repos/{templateOwner}/{templateRepo}/generate` → new repo in the org.
2. `POST /repos/{org}/{repo}/actions/workflows/configure.yml/dispatches` with the
   vendor handle → the template's
   [`configure`](../../templates/fbm-site-template/.github/workflows/configure.yml)
   workflow bakes the handle in and deploys to GitHub Pages.
3. Records `site_status=provisioning`, `site_url`, `site_repo` on the vendor.

### Status lifecycle: `none → provisioning → live | failed`

A launched site starts at `provisioning`. It is promoted to `live` by **either**
mechanism (both safe, independent):

- **Liveness probe + poll (always on, zero config).** While `provisioning`, the
  vendor panel polls `GET /vendor/website` every 8s. That read fires a bounded,
  server-side `HEAD` probe against the (server-derived) `site_url` and flips the
  row to `live` the moment the site answers. No secret required.
- **Deploy webhook (real-time, opt-in).** `POST /webhooks/site-deploy` —
  unauthenticated but HMAC-verified. The launched site's deploy workflow signs
  `{ repo, url, status }` with `SITE_DEPLOY_SECRET` (header `x-fbm-signature`,
  HMAC-SHA256 over the raw body) and posts it the instant Pages publishes. The
  backend finds the row by `site_repo` and sets `site_status` + `site_url`.

  | Condition                       | Response |
  | ------------------------------- | -------- |
  | `SITE_DEPLOY_SECRET` unset      | `501`    |
  | bad/missing signature           | `401`    |
  | valid (matched or not)          | `200 { ok: true }` |

  Enablement: set `SITE_DEPLOY_SECRET` on the backend **and** the same value as an
  org-level `FBM_DEPLOY_SECRET` Actions secret on the launched-site repos (the
  template's deploy step is inert without it).

A site that never answers is **not** left spinning forever: if it sits in
`provisioning` for longer than 15 minutes (`PROVISIONING_TIMEOUT_MS`) without a
successful probe or webhook, the next `GET /vendor/website` flips it to `failed`
so the vendor can retry. This is the safety net for a misconfigured launch (token
scope, Pages disabled, DNS not pointed).

## 4. Rate limiting & caching (public Store API)

The Store API is unauthenticated and embedded on arbitrary third-party sites, so:

- **Rate limit:** `/store/vendors` and `/store/vendors/:handle` are capped at
  **120 requests/min per IP** (`publicCatalogRateLimiter`). The SDK runs in each
  visitor's browser, so the key is the visitor's IP — generous enough for
  multi-widget pages and SPA navigation, low enough to stop a single scraper.
  Over-limit returns `429` with `Retry-After`.
- **Caching:** successful responses set
  `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`,
  so browsers and any CDN in front of the API absorb embed traffic instead of
  hitting the DB on every page load. `404`/error responses are not cached.

## 5. Production-readiness checklist (Launch / Mode 2)

Connect (Mode 1) needs no infra beyond the backend itself. Launch (Mode 2) stays
disabled (`501`) until **all** of the following are in place — verify each before
enabling the panel button in production:

- [ ] **GitHub token** — `GITHUB_TOKEN` with repo-create scope on `GITHUB_ORG`
      (fine-grained: Administration + Contents + Actions: read/write).
- [ ] **Template repo** — `SITE_TEMPLATE_REPO` points at
      `templates/fbm-site-template` published as a GitHub *template* repository.
- [ ] **DNS wildcard** — `*.sites.freeblackmarket.com` (or your `SITES_DOMAIN`)
      `CNAME` → GitHub Pages, **and** the apex/subdomain verified at the org level
      ("Verified domains") to prevent subdomain takeover of unclaimed names.
- [ ] **Deploy callback (recommended)** — `SITE_DEPLOY_SECRET` on the backend and
      the same value as the org-level `FBM_DEPLOY_SECRET` Actions secret; set the
      `FBM_API` Actions *variable* on the org so the template can call back.
- [ ] **Repo policy** — decide visibility/cleanup for the per-vendor
      `site-<handle>` repos (they are created public; failed launches leave the
      repo behind — re-launch is idempotent via GitHub's `422`).
- [ ] **Smoke test** — run one real `POST /vendor/website/launch`, confirm the
      repo is generated, Pages deploys, and `site_status` flips
      `provisioning → live` via both the probe and the signed webhook.
