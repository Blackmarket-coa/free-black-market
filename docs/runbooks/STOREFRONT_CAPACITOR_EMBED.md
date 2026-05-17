# Storefront ↔ Capacitor Embed

**Last validated:** _not yet executed; awaits Blackout-side webview test_.

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §1.2 (Blackout owns the primary mobile surface), §2.8 (storefront polish for Capacitor wrapper), and §5.1 (foundation milestone).

This runbook documents the contract between the Blackout Capacitor wrapper and the FBM storefront so commerce flows render correctly when embedded as in-app views in the Blackout mobile app. The contract has three pieces: an allowlisted embed origin, a CSP swap for `frame-ancestors`, and a one-time auth bootstrap.

## Handshake protocol

Every request originating from the Blackout webview MUST carry the `X-FBM-Embed-Origin` header. The value is the origin that hosts the Capacitor webview, e.g.:

- `capacitor://localhost` for iOS native
- `https://blackout.bmc.example` for the production webview if proxied through HTTPS

Set the allowlisted origins in the storefront environment via `BLACKOUT_EMBED_ALLOWED_ORIGINS` (comma-separated). Origins outside this list never receive the relaxed CSP and never gain the embed-bootstrap path; the storefront treats them as ordinary external callers.

Storefront response headers when the request is from an allowlisted origin:

- `Content-Security-Policy: frame-ancestors <origin>` — replaces the default `X-Frame-Options: SAMEORIGIN`.
- `X-FBM-Embed-Origin-Echo: <origin>` — echoes the resolved origin back so wrapper logs can confirm the handshake.

Origins not allowlisted continue to receive the default `X-Frame-Options: SAMEORIGIN` and cannot iframe the storefront.

## Auth bootstrap

After the webview loads, the wrapper POSTs the Blackout-issued JWT to `/api/auth/embed-bootstrap`:

```http
POST /api/auth/embed-bootstrap
Host: storefront.bmc.example
X-FBM-Embed-Origin: capacitor://localhost
Content-Type: application/json

{ "token": "<Blackout JWT>" }
```

Successful response: `200 { "ok": true, "embed_origin": "capacitor://localhost" }` plus a `_medusa_jwt` cookie scoped to the webview session (`SameSite=None; Secure; Max-Age=43200`).

Error responses:

- `400 { "code": "not_embedded" }` — the request did not carry `X-FBM-Embed-Origin`.
- `403 { "code": "origin_not_allowed" }` — the origin is not in the allowlist.
- `400 { "code": "bad_request" }` — JSON body missing or malformed `token`.

The storefront reads `_medusa_jwt` from the cookie jar like any other authenticated session; the rest of the storefront UX needs no Capacitor-specific changes.

## Capacitor wrapper integration sketch

On the Blackout side, after `WebView.create()` resolves and before navigating to the FBM storefront, run something like:

```ts
const FBM_ORIGIN = "https://storefront.bmc.example"
const EMBED_ORIGIN = "capacitor://localhost"
const blackoutToken = await getCurrentBlackoutAccessToken()

await fetch(`${FBM_ORIGIN}/api/auth/embed-bootstrap`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-FBM-Embed-Origin": EMBED_ORIGIN,
  },
  body: JSON.stringify({ token: blackoutToken }),
  credentials: "include",
})

await CapacitorWebview.loadURL(`${FBM_ORIGIN}/products`, {
  customHeaders: { "X-FBM-Embed-Origin": EMBED_ORIGIN },
})
```

Capacitor sends `customHeaders` with every request the webview makes to the matching origin, which is what triggers the storefront middleware's CSP swap on each page navigation.

## Testing

### Backend / storefront-side

```sh
# Confirm bootstrap path exists and validates origin allowlist:
curl -sf https://storefront.bmc.example/api/auth/embed-bootstrap | jq

# Confirm an allowed origin gets a relaxed CSP:
curl -sI https://storefront.bmc.example/products \
  -H "X-FBM-Embed-Origin: capacitor://localhost" | grep -i content-security-policy

# Confirm a disallowed origin does NOT get it:
curl -sI https://storefront.bmc.example/products \
  -H "X-FBM-Embed-Origin: https://evil.example" | grep -i x-frame-options
```

### Blackout-side

Open the Blackout app on a staging build, navigate to the FBM commerce view, and confirm:

1. The webview renders the FBM storefront (no blank screen, no XFO error).
2. The user appears logged in (the Blackout session persisted into FBM via the bootstrap).
3. Cart and order operations succeed end-to-end.

### Automated

`storefront/src/__tests__/embed-context.test.ts` covers the embed-context detector. End-to-end webview testing remains manual until Blackout publishes its Capacitor test harness.

## Known limitations (foundation milestone)

- The bootstrap endpoint accepts the JWT shape but does not yet verify the JWS — Blackout has not published the signing pubkey FBM should pin. When that arrives, swap the body of the route to verify with `jose` (MIT) before setting the cookie.
- Cookies returned by the bootstrap endpoint are not `httpOnly` so the embedded page can refresh them from the runtime; this is the standard webview pattern but operators should note the trade-off.
- Service-worker / offline support remains out of scope (deferred to differentiation milestone). Network failures inside the webview surface as blank pages until then.
- The relaxed CSP only applies to the explicit allowlisted origins. Adding a new wrapper means setting `BLACKOUT_EMBED_ALLOWED_ORIGINS` on the storefront and restarting; there is no dynamic discovery.

## See also

- `storefront/src/lib/runtime/embed-context.ts` — detector + allowlist parser.
- `storefront/src/middleware.ts` — `applyEmbedHeaders` swap.
- `storefront/src/app/api/auth/embed-bootstrap/route.ts` — bootstrap endpoint.
- `STOREFRONT_AUDIT.md` — addendum will be added once Blackout-side webview tests are green.
