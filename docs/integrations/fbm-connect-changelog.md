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
