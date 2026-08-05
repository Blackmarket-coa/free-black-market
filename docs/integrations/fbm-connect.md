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

The SDK is versioned; this doc tracks **connect.js v2**.

Everything is built on one public, website-agnostic contract: the **FBM Store
API**, plus a small set of key-authenticated write/runtime endpoints for
bookings, chat, and analytics.

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

**Response** (fields added since v1 are marked ⭑):

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
    "featured": false,
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
      "url": "https://freeblackmarket.com/us/products/rose-quartz-roller",
      "type": "physical"            // ⭑ physical | digital | service | event
    }
  ],
  "product_groups": {              // ⭑ additive; the flat `products` list stays the back-compat contract
    "physical": [ /* … */ ],
    "digital":  [ /* … */ ],
    "services": [ /* … */ ],       // service products carry a `booking_config`
    "events":   [ /* … */ ]
  },
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
  "capabilities": {                // ⭑ each flag = the vendor's toggle AND-ed with data availability
    "vendor_enabled": true,
    "products_enabled": true,
    "digital_enabled": true,
    "services_enabled": true,
    "events_enabled": true,
    "reviews_enabled": true,
    "chat_enabled": false,
    "booking_enabled": true
  },
  "reviews_summary": { "average": 4.8, "count": 12 },  // ⭑
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

**Surface gating.** Vendors choose which surfaces render via `embed_features`
(see §3). A disabled surface is filtered out server-side — its `*_enabled`
capability is `false` and its data is emptied — so turning a surface off removes
it even if a host page still has the markup.

### Other read endpoints

| Endpoint                                 | Auth   | Purpose                                  |
| ---------------------------------------- | ------ | ---------------------------------------- |
| `GET /store/vendors/:handle/reviews`     | public | Paginated product/vendor reviews.        |
| `GET /store/vendors/:handle/availability`| public | Bookable-service slots for a date range. |

### Key-authenticated write/runtime endpoints — `/store/embed/*`

These accept a publishable key (see §4) and are the runtime actions the SDK
performs on the visitor's behalf:

| Endpoint                     | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `POST /store/embed/bookings` | Create a booking for a bookable service.       |
| `POST /store/embed/chat/start` | Open a Blackout chat session with the vendor. |
| `POST /store/embed/events`   | Ingest embed analytics events (views, clicks…).|

---

## 2. The Connect SDK (`connect.js`)

Served from `https://freeblackmarket.com/connect.js`. No dependencies, no build
step. Configure it entirely from the script tag:

```html
<script
  src="https://freeblackmarket.com/connect.js"
  data-fbm-vendor="shaktiinnergy"
  data-fbm-api="https://api.freeblackmarket.com"
  data-fbm-key="pk_live_…"
  data-fbm-theme="warm"
  async
></script>
```

| Attribute           | Required | Default                           | Notes                                                    |
| ------------------- | -------- | --------------------------------- | -------------------------------------------------------- |
| `data-fbm-vendor`   | ✅       | —                                 | Vendor handle. `data-fbm-handle` is a back-compat alias. |
| `data-fbm-api`      |          | `https://api.freeblackmarket.com` | Store API base.                                          |
| `data-fbm-key`      |          | —                                 | Publishable key. Required for booking / chat / analytics. |
| `data-fbm-theme`    |          | `light`                           | `light \| dark \| minimal \| warm \| forest`.            |
| `data-fbm-currency` |          | `usd`                             | Preferred price currency.                                |

Per-element overrides on any `[data-fbm]` node: `data-fbm-vendor`,
`data-fbm-limit`, `data-fbm-currency`. Buy buttons use `data-fbm-buy` with
`data-fbm-product` / `data-fbm-pid` / `data-fbm-label`.

There are three layers of integration; use whichever fits.

### Layer 1 — Zero JS (HTML attributes)

The element renders itself and stays in sync with the catalog:

```html
<div data-fbm="vendor"></div>
<div data-fbm="products" data-fbm-limit="6"></div>
<div data-fbm="digital"></div>
<div data-fbm="services"></div>
<div data-fbm="events"></div>
<div data-fbm="reviews"></div>
<div data-fbm="booking" data-fbm-product="prod_…"></div>
<div data-fbm="chat"></div>

<!-- buyer hub: open demand pools people are trying to fill -->
<div data-fbm="demand-pools"
     data-fbm-category="grain"
     data-fbm-region="midwest"
     data-fbm-limit="6"></div>

<!-- inline buy button -->
<button data-fbm-buy data-fbm-product="prod_…">Buy now</button>
```

`booking`, `chat`, and analytics require a publishable key (`data-fbm-key`).

**`demand-pools` is the one vendorless surface.** Every other kind resolves through
`GET /store/vendors/:handle` and needs `data-fbm-vendor`. Demand is posted by buyers, not
sellers, so the buyer hub reads the public `GET /store/collective/demand-pools` instead and
renders on any page — including one with no vendor configured at all. It has no entry in
`CAP_FOR_KIND` for the same reason: there is no vendor whose capability could gate it.

Filters map straight onto that endpoint: `data-fbm-category`, `data-fbm-region`,
`data-fbm-min-bounty`, `data-fbm-sort` (`attractiveness` | `deadline` | `quantity` |
`bounty`). Only PUBLIC pools in an OPEN or THRESHOLD_MET state are ever returned.

Copy note: the card's call to action is "Join this request". A demand pool is a best-effort
pledge backed by escrow, not a guaranteed order, so this surface must never use language
implying the goods are reserved or secured.

### Layer 2 — Widgets (styled UI into your container)

```js
FBM.renderProducts("#shop", { limit: 6 })
FBM.renderDigital("#downloads")
FBM.renderServices("#services")
FBM.renderEvents("#events", { limit: 3 })
FBM.renderReviews("#reviews")
FBM.renderDemandPools("#hub", { category: "grain", limit: 6 })
FBM.renderVendor("#profile")
FBM.renderBooking("#book", { product: "prod_…" })   // alias: FBM.openBooking
FBM.renderChat("#chat")                               // alias: FBM.openChat
```

Widget markup uses `.fbm-*` classes you can override in your own CSS; the theme
sets CSS variables (`--fbm-bg`, `--fbm-accent`, …).

### Layer 3 — Raw API (build your own UI)

```js
const vendor   = await FBM.getVendor()
const products = await FBM.getProducts({ limit: 12 })
const digital  = await FBM.getDigital()
const services = await FBM.getServices()
const events   = await FBM.getEvents()
const reviews  = await FBM.getReviews()
const slots    = await FBM.getBookingSlots("prod_…", { date: "2026-07-04" })

await FBM.createBooking({ product_id: "prod_…", starts_at: "…", customer_email: "…" })
await FBM.startChat({ email: "…", message: "…" })
```

### SDK reference

| Method                                          | Returns                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `FBM.configure(opts)`                           | Override config at runtime; returns `FBM` |
| `FBM.getVendor(handle?)`                        | `Promise<vendor>`                         |
| `FBM.getProducts(handle?, opts)`                | `Promise<product[]>` (enriched)           |
| `FBM.getDigital(handle?, opts)`                 | `Promise<product[]>`                      |
| `FBM.getServices(handle?, opts)`               | `Promise<product[]>`                      |
| `FBM.getEvents(handle?, opts)`                  | `Promise<event[]>`                        |
| `FBM.getReviews(handle?, opts)`                 | `Promise<review[]>`                       |
| `FBM.getBookingSlots(product, { date })`        | `Promise<slot[]>`                         |
| `FBM.createBooking(payload)`                    | `Promise<booking>` *(key required)*       |
| `FBM.startChat(payload)`                        | `Promise<{ widget_url }>` *(key required)*|
| `FBM.cartUrl(productOrHandle?)`                 | URL string (cart, or product deep link)   |
| `FBM.openCart(target?)` / `FBM.openModal(url)`  | open checkout (new tab or modal iframe)   |
| `FBM.formatPrice({ amount, currency_code })`    | formatted currency string                 |
| `FBM.render{Products,Digital,Services,Events,Reviews,Vendor,Booking,Chat}(sel, opts)` | renders + `Promise<void>` |
| `FBM.mount(root?)`                              | (re)scan `[data-fbm]` elements            |
| `FBM.on(event, fn)` / `FBM.off(event, fn)`      | subscribe to SDK events (`cart:open`, `booking:confirmed`, …) |
| `FBM.track(name, data)`                         | send an analytics event *(key required)*  |

`getX()` accept `(handle, opts)`, `(opts)`, or `()` — handle falls back to the
configured one. A single network call per handle is cached and shared across all
methods and widgets. Only `https://` URLs are ever framed / opened.

---

## 3. Vendor panel — "My Website"

`GET /vendor/website` returns the vendor's ready-to-paste snippet, whitelisted
domains, enabled surfaces, and launch status. The panel has two tabs:

- **Connect** — copies the snippet, shows the zero-JS examples + SDK reference,
  lets the vendor pick which surfaces to expose
  (`POST /vendor/website` → `{ embed_features: string[] | null }`, `null` = all
  on), and record the domains they've embedded on
  (`POST /vendor/website` → `{ connect_domains: string[] }`).
- **Launch** — `POST /vendor/website/launch` provisions a hosted site. Returns
  `501` when the deployment hasn't configured the GitHub provisioning env (the
  button is disabled with an explanation, Connect still works).

### Backend data

Columns on `seller_metadata`:

| Column                    | Migration                          | Meaning                                              |
| ------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `connect_domains`         | `Migration20260620AddWebsiteFields`| `string[]` — hostnames the vendor embeds Connect on. |
| `site_status`             | `Migration20260620AddWebsiteFields`| `none \| provisioning \| live \| failed`.            |
| `site_url`                | `Migration20260620AddWebsiteFields`| Public URL of the launched site.                     |
| `site_repo`               | `Migration20260620AddWebsiteFields`| GitHub repo (`org/name`) backing the launched site.  |
| `embed_features`          | `Migration20260629AddEmbedFeatures`| `string[] \| null` — enabled surfaces (`null` = all).|
| `provisioning_started_at` | `Migration20260710010000…`         | When the current Launch attempt began (staleness clock). |

### Launch provisioning env

See `.env.production.example` (FBM Sites section): `GITHUB_TOKEN`, `GITHUB_ORG`,
`SITE_TEMPLATE_REPO`, `SITES_DOMAIN`, `STOREFRONT_URL`, `PUBLIC_BACKEND_URL`,
`SITE_DEPLOY_SECRET`, and the optional `PROVISIONING_TIMEOUT_MS`.

When set, `POST /vendor/website/launch`:

1. `POST /repos/{templateOwner}/{templateRepo}/generate` → new repo in the org.
2. `POST /repos/{org}/{repo}/actions/workflows/configure.yml/dispatches` with the
   vendor handle → the template's
   [`configure`](../../templates/fbm-site-template/.github/workflows/configure.yml)
   workflow bakes the handle in and deploys to GitHub Pages.
3. Records `site_status=provisioning`, `provisioning_started_at`, `site_url`,
   `site_repo` on the vendor. Re-launching an already `live`/`provisioning` site
   is a no-op unless `{ reprovision: true }` is passed.

### Status lifecycle: `none → provisioning → live | failed`

A launched site starts at `provisioning`. It is promoted to `live` by **either**
mechanism (both safe, independent):

- **Liveness probe + poll (always on, zero config).** While `provisioning`, the
  vendor panel polls `GET /vendor/website`. That read fires a bounded,
  server-side `GET` probe against the (server-derived) `site_url` and flips the
  row to `live` the moment the site answers **with the FBM site marker**
  (`<meta name="fbm-site">`, emitted by the template). Requiring the marker stops
  a wildcard/parking page from being mistaken for a live site. No secret required.
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
`provisioning` longer than 15 minutes (`PROVISIONING_TIMEOUT_MS`, measured from
`provisioning_started_at`) without a successful probe or webhook, the next
`GET /vendor/website` flips it to `failed` so the vendor can retry.

---

## 4. Embed keys, authentication & analytics

### Publishable keys (`embed-keys` module)

The booking, chat, and analytics endpoints require a **publishable key**
(`pk_live_…`) sent as `Authorization: PublishableKey pk_live_…`. Keys are:

- **Per-vendor, hashed (SHA-256) at rest**, shown once on creation, revocable.
- Managed at `GET/POST /vendor/embed-keys` and `DELETE /vendor/embed-keys/:id`;
  the panel shows a masked `pk_live_…{last4}`.

Because the key is embedded in the public HTML of every vendor site, it is
**not a secret**. On each keyed request the middleware also checks the request
`Origin`/`Referer` against the vendor's `connect_domains`. Treat that origin
allow-list as an **advisory convenience filter, not authentication** — Origin is
spoofable by a non-browser client. Real abuse protection comes from rate limits
(§5): per-key **and** per-IP.

### Embed analytics (`embed-analytics` module)

`connect.js` emits events (`view`, `product_view`, `add_to_cart`,
`checkout_start`, `order_complete`, `booking_open`, `booking_confirm`,
`chat_open`) to `POST /store/embed/events`. The vendor sees the funnel at
`GET /vendor/analytics/embed` (and the panel's Embed Analytics page):
views → add-to-cart → checkout → orders, plus by-origin / by-day / top-products.

---

## 5. Rate limiting & caching

The public catalog is unauthenticated and embedded on arbitrary third-party
sites, and the keyed endpoints carry a public key, so:

- **Public catalog** — `/store/vendors` and `/store/vendors/:handle` are capped at
  **120 req/min per IP** (`publicCatalogRateLimiter`). Keyed off the visitor's IP
  (`req.ip`; set `TRUST_PROXY` when behind a proxy so `X-Forwarded-For` is honored
  safely). Over-limit returns `429` with `Retry-After`.
- **Keyed embed endpoints** — `/store/embed/*` are capped **per publishable key**
  (`embedKeyRateLimiter`, 100/min) **and per IP** (`embedIpRateLimiter`, 40/min),
  so a single source can't abuse a public key regardless of forged `Origin`.
- **Caching:** successful catalog responses set
  `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`,
  so browsers/CDNs absorb embed traffic. `404`/error responses are not cached.

---

## 6. Production-readiness checklist (Launch / Mode 2)

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
      `provisioning → live` via both the marker probe and the signed webhook.
