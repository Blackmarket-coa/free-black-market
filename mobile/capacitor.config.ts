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
    // Keep in-webview navigation on FBM properties; anything else (vendor
    // sites, Stripe redirect hosts, …) opens in the system browser.
    allowNavigation: ['freeblackmarket.com', '*.freeblackmarket.com'],
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
