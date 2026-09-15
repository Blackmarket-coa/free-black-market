# connect.js Changelog

Every release is frozen at `https://freeblackmarket.com/v<version>/connect.js`
with an SRI hash published here. A shipped release directory is never edited —
`backend/src/shared/__tests__/connect-sri.unit.spec.ts` fails the build if the
mutable `/connect.js`, the frozen copy of its declared version, and the
published hash ever disagree.

**Release procedure** (enforced by that spec): edit `storefront/public/connect.js`,
bump its `version:` literal, copy it to `storefront/public/v<version>/connect.js`,
update `CONNECT_VERSION` and `CONNECT_SRI` in `backend/src/shared/website-config.ts`,
and add an entry below.

## 2.1.0 — 2026-09-15

Adds the **coalition drive widget**: a vendorless `data-fbm="drive"` surface
that renders a coalition drive (title, progress against goal, contributor
count) with an amount picker, on any site — a member can embed their
coalition's live drive without being an FBM vendor at all.

Donations reuse the hosted Blackout checkout that already exists
(`/v1/integrations/blackout/commerce/checkout/sessions` → `/page?embed=1`),
so the money path, the flat 3% commission and the `fbm-checkout` postMessage
protocol are unchanged; this release adds a surface, not a payment rail. The
SDK now listens for those messages and emits `donation:complete` /
`donation:cancelled`, and records `donate_start` / `donate_complete` analytics.

New API: `FBM.getDrive`, `FBM.donate`, `FBM.renderDrive`.
New attributes: `data-fbm-coalition`, `data-fbm-drive`, `data-fbm-amounts`,
and the script-level `data-fbm-blackout` base URL.

```
https://freeblackmarket.com/v2.1.0/connect.js
integrity: sha384-8qDWdtSLiaBKntMQd3rgIzuYY1R3utwsxaCfFschn8DO4nJJXknTAl14ZrzJtUfK
```

## 2.0.0 — 2026-08-13

First frozen release. The full v2 surface as previously served from the
mutable URL: 11 raw API methods (`getVendor`, `getProducts`, `getDigital`,
`getServices`, `getEvents`, `getReviews`, `getDemandPools`, `getBookingSlots`,
`createBooking`, `startChat`, `getData`), 11 render widgets plus the zero-JS
`data-fbm` declarative layer, cart/checkout helpers, and the `on`/`off`/`track`
event surface.

```
https://freeblackmarket.com/v2.0.0/connect.js
integrity: sha384-g3F0Snh1ELm17qaHBIZPty9TgC1ukcwyugsITFUhc+5JK1u1IP7kVcTyp4Jj1Drv
```

No behavior change relative to the mutable `/connect.js` as of this date —
this release exists so external integrators have a URL that cannot change
underneath them, which is the precondition for building on the SDK at all.
