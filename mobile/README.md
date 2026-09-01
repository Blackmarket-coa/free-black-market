# FBM Mobile

Capacitor shell that packages the FBM storefront (`../storefront`) as an
installable iOS and Android app.

## How it works

The storefront is a server-rendered Next.js app (`output: "standalone"`),
so there is no static build to copy into the shell. Instead the native
WebView loads the deployed storefront via `server.url`
(`capacitor.config.ts`), and Capacitor injects the native bridge into that
remote page:

```
https://freeblackmarket.com  ──loaded by──▶  native WebView (iOS / Android)
        ▲                                          │
        │        window.Capacitor bridge           │
        └── storefront/src/lib/native/* ◀──────────┘
            (feature-detects the bridge; no npm dep in the web app)
```

- The shell appends `FBMNative/1.0` to the WebView user agent so the
  storefront can recognise shell traffic server-side
  (`storefront/src/lib/native/native-app-context.ts`).
- Storefront-side integration (deep links, push registration, the gated
  buy-on-web button, the checkout cookie handoff) lives in
  `storefront/src/lib/native/` and `storefront/src/components/providers/NativeAppBridge.tsx`.
- Note `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` §2.8 ("Mobile as Blackout"):
  the Blackout Capacitor wrapper remains the canonical coalition mobile
  surface, with FBM embedded in it. This shell is the additive,
  FBM-standalone distribution channel; it reuses the same embed
  conventions (`X-FBM-Embed-Origin`, `/api/auth/embed-bootstrap`) rather
  than replacing them.

## Quick start

```bash
cd mobile
pnpm install
pnpm sync              # cap sync (both platforms)
pnpm open:android      # Android Studio → Run
pnpm open:ios          # Xcode → Run (Mac only; run `pod install` in ios/App first)
```

Point the shell at another environment at sync time:

```bash
FBM_MOBILE_SERVER_URL=https://staging.freeblackmarket.com pnpm sync
```

## Native plugins

| Plugin | Used for |
| --- | --- |
| `@capacitor/app` | deep links (`fbm://`), app-state resume |
| `@capacitor/browser` | external checkout in the system browser (session/cart handoff) |
| `@capacitor/device` | device region for the external-purchase policy |
| `@capacitor/push-notifications` | order/marketplace alerts (FCM + APNs) |

## External purchase policy (Apple / US storefront)

Apple's no-entitlement external purchase link rule is **US-storefront
only**, so the storefront gates its "Complete purchase on web" button
(`storefront/src/lib/native/external-purchase.ts`):

- iOS shell → button only on the US storefront (device region as v1
  proxy; fails closed when unknown). Other regions wait on the EU/other
  entitlement addendum.
- Android shell → always allowed, opens the system browser.
- Plain web → not applicable (already the web).

The button hands the Medusa cart to the external browser through a
short-lived signed token minted by `POST /api/native/checkout-handoff`
(requires `NATIVE_HANDOFF_SECRET` in the storefront env; the flow
degrades to opening checkout without cart transfer when unset).

## Push notifications

End-to-end path: shell → storefront → backend registry → FCM.

- **Android**: drop `google-services.json` into `android/app/` (gitignored)
  and apply the Firebase Gradle plugin per the Capacitor docs.
- **iOS**: upload the APNs key to Firebase and enable Push Notifications on
  the App ID (see **Signing and capabilities**). The app side is already in
  place: `App.entitlements` declares `aps-environment`, `Info.plist` declares
  the `remote-notification` background mode, and `AppDelegate.swift` forwards
  the APNs token to the plugin.
- **Storefront** (`NEXT_PUBLIC_NATIVE_PUSH=true`): `NativeAppBridge`
  requests permission, registers, and forwards the token to the backend
  device registry (`POST /store/native/push-tokens`) with the customer's
  auth cookie so the device attaches to their account.
- **Backend** (`backend/src/modules/native-push`): stores tokens, sends via
  FCM HTTP v1 (`FCM_SERVICE_ACCOUNT_JSON`, fail-closed when unset), and
  disables tokens FCM reports dead. Reference consumer: the
  `order.placed` → "Order confirmed" subscriber; call
  `nativePush.sendToCustomer(...)` from any other subscriber to add more.

## Vendor surface (in-app)

A vendor who installs the app gets a small, deliberately incomplete
seller surface at `/vendor/orders` — an order inbox plus the two
fulfillment actions that are genuinely phone-shaped:

| Stage | Phone action |
| --- | --- |
| Needs packing | none — links to the full dashboard (packing needs a stock location and per-line quantities backed by inventory reservations) |
| Ready to ship | enter a tracking number → mark shipped |
| In transit | mark delivered |
| Complete | none |

Everything else — products, payouts, returns, order changes, POS,
anything that moves money — stays in the full vendor panel on desktop.
That is a boundary, not a backlog: those flows need desktop-grade input
or carry refund/payout side effects that do not belong behind a one-tap
button on a phone.

**Sign-out.** The vendor surface has its own sign-out (it detaches this
device from seller pushes as it clears the cookie), independent of the
shopper session on the same phone.

**Auth.** Sellers are a different Medusa actor type from shoppers, and
the storefront's shopper login deliberately bounces seller accounts
(they have no shopper profile). So the vendor surface adds a *parallel,
opt-in* sign-in that stores a seller JWT in its own httpOnly cookie
(`_fbm_seller_jwt`), separate from the shopper `_medusa_jwt` on the same
device. Every seller call is made from a Next.js server action, never the
browser, for two reasons: the MercurJS plugin fronts `/vendor/*` with a
CORS allowlist that excludes the storefront origin, and a seller bearer
authorizes payout-capable endpoints, so it must never sit in page JS on a
remotely-loaded WebView page. Tokens are refreshed from a client-invoked
server action (Medusa issues them with a 1-day life and nothing else
renews them; cookies are sealed during a Server Component render, so the
refresh cannot happen where the session is read).

**Strategic note.** `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` §2.8 makes
Blackout the canonical coalition mobile app and the full vendor panel the
canonical seller tool. This surface does not change either claim — it is
an additive convenience on the FBM standalone channel, scoped to the two
things a vendor cannot do from a desk: find out an order arrived, and
move it along while away from the shop.

## Deep links

`fbm://` opens the app on both platforms (scheme registered in
`AndroidManifest.xml` / `Info.plist`); `NativeAppBridge` routes
`fbm://open?path=/us/products/x` (or any `fbm://` URL with a path) to the
matching storefront route.

For `https://freeblackmarket.com` links: the storefront already serves
env-gated `/.well-known/assetlinks.json` (set
`NATIVE_ANDROID_CERT_SHA256` to the release-cert fingerprint) and
`/.well-known/apple-app-site-association` (set `NATIVE_APPLE_APP_ID` to
`TEAMID.co.bmc.freeblackmarket`), and the Android manifest already carries
the `autoVerify` intent filter — it stays inert until the assetlinks
statement goes live. On iOS the Associated Domains entitlement is declared
in `ios/App/App/App.entitlements`; it still has to be enabled on the App ID
in the developer portal (see **Signing and capabilities** below).

## Signing and capabilities

### iOS capabilities (must be enabled on the App ID)

`ios/App/App/App.entitlements` is committed and wired into both build
configurations, declaring:

| Entitlement | Value |
| --- | --- |
| `aps-environment` | `$(APS_ENVIRONMENT)` — `development` in Debug, `production` in Release, so a debug build talks to the APNs sandbox and an archive talks to production without editing the file |
| `com.apple.developer.associated-domains` | `applinks:freeblackmarket.com`, `applinks:www.freeblackmarket.com` |

Both capabilities must also be enabled for `co.bmc.freeblackmarket` in the
Apple Developer portal (Certificates, Identifiers & Profiles → the App ID →
**Push Notifications** and **Associated Domains**). If they are not, signing
fails with a provisioning-profile error that does not name the entitlement —
that error almost always means this step was skipped.

The entitlements file has no `PBXFileReference`, so it will not appear in
Xcode's navigator until Xcode adds one (it does this automatically the first
time someone opens the Signing & Capabilities tab). The build reads it from
the `CODE_SIGN_ENTITLEMENTS` build setting either way.

### Android release signing

Signing is opt-in and activates only when `android/keystore.properties`
exists, so `assembleRelease` still succeeds unsigned locally and in PR CI:

```bash
cp android/keystore.properties.example android/keystore.properties
# fill in storeFile / storePassword / keyAlias / keyPassword
pnpm build:android          # cap sync android && gradlew assembleRelease
```

`keystore.properties`, `*.jks` and `*.keystore` are gitignored. In CI, write
the file from secrets immediately before the release build and delete it
after; never bake it into an image. Rotation policy, key inventory and the
release evidence package live in Blackout's shared runbook,
`docs/operations/runbooks/mobile_release_hardening_checklist.md`.

The `Mobile Android Build` workflow assembles **both** a debug and an
unsigned release APK on every PR, so a broken signing block is caught there
rather than at release time.

### Versioning

Android `versionCode` and iOS `CFBundleVersion` must increase monotonically
for every store upload, and the marketing version must match across both
projects. Set them together:

```bash
pnpm version:set 1.1.0 2          # version, build number
pnpm version:set 1.1.0 2 --allow-same-build   # only if that build never shipped
```

The script refuses a malformed version, a non-increasing build number, and a
project file whose shape it no longer recognises (which is how a Capacitor
regeneration would be caught). `pnpm test` asserts the two platforms have not
drifted apart; CI runs it on every PR.

## iOS on Linux/CI

The Xcode project in `ios/` is generated and committed, but building it
(and `pod install`) requires macOS. Android builds work anywhere with an
Android SDK.
