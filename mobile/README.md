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
- **iOS**: enable the Push Notifications capability in Xcode and upload the
  APNs key to Firebase. `Info.plist` already declares `remote-notification`
  background mode; `AppDelegate.swift` already forwards the APNs token to
  the plugin.
- **Storefront** (`NEXT_PUBLIC_NATIVE_PUSH=true`): `NativeAppBridge`
  requests permission, registers, and forwards the token to the backend
  device registry (`POST /store/native/push-tokens`) with the customer's
  auth cookie so the device attaches to their account.
- **Backend** (`backend/src/modules/native-push`): stores tokens, sends via
  FCM HTTP v1 (`FCM_SERVICE_ACCOUNT_JSON`, fail-closed when unset), and
  disables tokens FCM reports dead. Reference consumer: the
  `order.placed` → "Order confirmed" subscriber; call
  `nativePush.sendToCustomer(...)` from any other subscriber to add more.

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
statement goes live. iOS additionally needs the Associated Domains
capability (`applinks:freeblackmarket.com`) in Xcode.

## iOS on Linux/CI

The Xcode project in `ios/` is generated and committed, but building it
(and `pod install`) requires macOS. Android builds work anywhere with an
Android SDK.
