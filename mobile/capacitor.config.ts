import type { CapacitorConfig } from '@capacitor/cli';

/**
 * FBM storefront Capacitor shell.
 *
 * The storefront (`../storefront`) is a server-rendered Next.js app
 * (`output: "standalone"`), so there is no static dist/ to copy into the
 * shell the way blackout-mobile copies the Vite build. Instead the native
 * WebView loads the deployed storefront directly via `server.url`; the
 * Capacitor runtime injects the native bridge into that remote page, so
 * storefront code can feature-detect `window.Capacitor` and reach the
 * plugins (see storefront/src/lib/native/). `www/` holds only a fallback
 * page shown if the shell ever renders its local content.
 *
 * Point the shell at another environment at sync time:
 *   FBM_MOBILE_SERVER_URL=https://staging.freeblackmarket.com pnpm sync
 */
const serverUrl = process.env.FBM_MOBILE_SERVER_URL ?? 'https://freeblackmarket.com';

const config: CapacitorConfig = {
  appId: 'co.bmc.freeblackmarket',
  appName: 'Free Black Market',
  webDir: 'www',
  server: {
    url: serverUrl,
    androidScheme: 'https',
    iosScheme: 'https',
    // Keep in-webview navigation to the STOREFRONT only. Everything else —
    // vendor sites, Stripe redirect hosts, and notably the vendor panel at
    // vendor.freeblackmarket.com — opens in the system browser.
    //
    // A `*.freeblackmarket.com` wildcard would swallow the vendor panel,
    // loading a desktop-only admin SPA inside a phone WebView with no
    // browser chrome to escape it. Vendors get the in-app surface at
    // /vendor/orders instead, which links out to the full dashboard
    // deliberately (and that link then opens externally, as it should).
    allowNavigation: ['freeblackmarket.com', 'www.freeblackmarket.com'],
  },
  // Lets the storefront (and its middleware/edge code) recognise shell
  // traffic server-side, where window.Capacitor doesn't exist yet — see
  // storefront/src/lib/native/native-app-context.ts.
  appendUserAgent: 'FBMNative/1.0',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
