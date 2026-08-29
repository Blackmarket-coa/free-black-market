/**
 * Auth-module gating for medusa-config.ts, extracted as a pure function so
 * the env combinations are unit-testable (jest can't import medusa-config —
 * loadEnv/defineConfig run at import time).
 *
 * Behavior contract (unchanged from the original inline builder):
 * declare an explicit auth module ONLY when at least one social/OIDC provider
 * is configured via env; otherwise return null so Medusa's framework default
 * (emailpass-only) keeps applying and existing seller logins are unaffected.
 * When declared, emailpass is always included alongside the configured
 * provider(s).
 *
 * Providers:
 *  - google: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Creator Commerce
 *    Slice C; seller actor). TikTok/Discord deferred — see
 *    docs/CREATOR_COMMERCE_ROADMAP.md Phase 2.
 *  - mas (W2, consolidation D4): MAS_OIDC_ISSUER + MAS_OIDC_CLIENT_ID +
 *    MAS_OIDC_CLIENT_SECRET. Customers log in against the Blackout-hosted
 *    MAS IdP — docs/contracts/mas-identity-consumer.md. Customer actor only;
 *    seller OIDC is deferred (it would bypass vendor registration/approval).
 */

type AuthProviderEntry = {
  resolve: string
  id: string
  options?: Record<string, unknown>
}

export const buildAuthModule = (env: NodeJS.ProcessEnv = process.env) => {
  const googleEnabled = !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET
  const masEnabled =
    !!env.MAS_OIDC_ISSUER && !!env.MAS_OIDC_CLIENT_ID && !!env.MAS_OIDC_CLIENT_SECRET
  if (!googleEnabled && !masEnabled) return null

  const callbackBase = (env.BACKEND_URL || "").replace(/\/$/, "")

  const providers: AuthProviderEntry[] = [
    {
      resolve: "@medusajs/medusa/auth-emailpass",
      id: "emailpass",
    },
  ]

  if (googleEnabled) {
    providers.push({
      resolve: "@medusajs/medusa/auth-google",
      id: "google",
      options: {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL:
          env.GOOGLE_CALLBACK_URL ||
          (callbackBase ? `${callbackBase}/auth/seller/google/callback` : undefined),
      },
    })
  }

  if (masEnabled) {
    providers.push({
      resolve: "./src/modules/oidc-auth-provider",
      id: "mas",
      options: {
        issuer: env.MAS_OIDC_ISSUER,
        clientId: env.MAS_OIDC_CLIENT_ID,
        clientSecret: env.MAS_OIDC_CLIENT_SECRET,
        callbackUrl:
          env.MAS_OIDC_CALLBACK_URL ||
          (callbackBase ? `${callbackBase}/auth/customer/mas/callback` : undefined),
        scopes: env.MAS_OIDC_SCOPES,
        matrixServerName: env.MATRIX_SERVER_NAME,
      },
    })
  }

  return {
    resolve: "@medusajs/medusa/auth",
    options: { providers },
  }
}
