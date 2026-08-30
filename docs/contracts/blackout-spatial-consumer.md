# Blackout Spatial — Consumer Contract (W5)

Decision D5 (`docs/REPO_CONSOLIDATION_REVIEW.md`): **Blackout is the
ecosystem's single spatial home** — MapLibre client, PostGIS + martin tiles,
and the privacy-conscious geocoder proxy live there. FBM consumes Blackout's
spatial surface instead of carrying its own geo code. This doc is FBM's side
of that contract; Blackout's surface lives in
`blackout packages/api/src/routes/spatial.ts`.

## The surface (Blackout side)

Mount: `/v1/spatial/*`. Service-to-service only — authenticated by a static
token in the **`x-spatial-token`** header (NOT `Authorization`: Blackout's
global `/v1` middleware treats bearer tokens as user JWTs). Tokens come from
Blackout's `SPATIAL_SERVICE_TOKENS` (comma-separated; rotation = add new,
deploy callers, drop old). Unset ⇒ every route answers `503 spatial_disabled`
— the surface is dark by default. Rate limit: per service token,
`SPATIAL_RATE_LIMIT_MAX`/min (default 120) — a service bucket, deliberately
not Blackout's per-user 20/min geocode bucket.

- `GET /v1/spatial/geocode?q=<text>` — forward geocoding, the same wire
  contract as Blackout's user route: `400` (q under 3 / over 300 chars),
  `503 geocoder_disabled` (Blackout's `GEOCODER_URL` unset), `502
  upstream_error`, else `{ results: [{ label, latitude, longitude }] }`
  (max 8). A postal code is just a query string (`q=48201`).
- `GET /v1/spatial/health` — `{ configured }`: whether Blackout's geocoder
  has an upstream. Behind the token like everything else.

There is **no reverse geocoding**, **no nearby search**, and **no zone
containment** on the surface — see deferrals.

## The consumer (this repo)

- `backend/src/lib/blackout-spatial-env.ts` — pure env gate. OFF by default;
  enabling needs all three: `FBM_BLACKOUT_SPATIAL=1`, `BLACKOUT_API_BASE`
  (reused from the Blackout block), `BLACKOUT_SPATIAL_TOKEN`.
  `scripts/assert-env.mjs` pairs them in production.
- `backend/src/lib/blackout-spatial.ts` — `geocodePostalCode(postal)`:
  4s timeout, 64KB response cap, one-hour in-process cache for answers
  (including the empty "no match" answer; failures are never cached so a
  blip recovers), and **strictly fail-soft** — disabled, timeout, non-200,
  and malformed bodies all resolve to `null`.
- Callers fall back to the local ZIP3 prefix table (`backend/src/lib/zip3.ts`)
  on `null`. Wired into `GET /store/geocode` (which the storefront's
  `/api/geocode` proxies) and the `GET /store/vendors` zip path. Enabling the
  flag upgrades prefix centroids to real geocoding with zero contract change;
  a Blackout outage degrades to exactly the pre-W5 behavior.

**Fail-soft is normative.** Postal geocoding sits on the public search path
(debounced per keystroke) and the checkout delivery-zone path. A remote
spatial dependency must never turn either into a 500.

## Deliberately NOT consumed remotely

- **Pairwise distance** (`lib/geo-distance.ts`) — 8 lines of arithmetic with
  no data dependency; a network hop would add latency and a failure mode and
  remove nothing.
- **Mutual-aid distances** (`lib/aid-location.ts`) — a privacy boundary, not
  a math library: requester coordinates never leave this server (see its
  header and `docs/FBM_BUYER_HUB.md`). Permanent exclusion, not debt.
- **Nearby-within-radius and zone containment** — only viable if Blackout
  held/mirrored FBM's vendor coordinates and zone geometries (per-row remote
  calls on hot paths are non-viable). That is a data-ownership decision, not
  a client change — AUDIT_DEBT W5-1/W5-2.

## Operator enablement

1. Blackout: set `GEOCODER_URL` (+ Nominatim etiquette vars) and mint a token
   into `SPATIAL_SERVICE_TOKENS`.
2. FBM: `FBM_BLACKOUT_SPATIAL=1`, `BLACKOUT_API_BASE`,
   `BLACKOUT_SPATIAL_TOKEN=<that token>`.
3. Verify: `curl -H "x-spatial-token: $TOKEN" $BLACKOUT/v1/spatial/health` →
   `{"configured":true}`; then `GET /store/geocode?postal_code=48201` on FBM
   should answer `"source":"blackout-spatial"`.
