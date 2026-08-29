import { buildAuthModule } from "../build-auth-module"

type AuthModule = NonNullable<ReturnType<typeof buildAuthModule>>

const ids = (mod: AuthModule) => mod.options.providers.map((p) => p.id)
const provider = (mod: AuthModule, id: string) =>
  mod.options.providers.find((p) => p.id === id)!

describe("buildAuthModule", () => {
  it("returns null when no social/OIDC provider is configured (framework default applies)", () => {
    expect(buildAuthModule({})).toBeNull()
    // Partial MAS config stays dark.
    expect(buildAuthModule({ MAS_OIDC_ISSUER: "https://mas.test/" })).toBeNull()
    expect(
      buildAuthModule({ MAS_OIDC_ISSUER: "https://mas.test/", MAS_OIDC_CLIENT_ID: "id" })
    ).toBeNull()
    // Partial Google config stays dark too (pre-W2 behavior preserved).
    expect(buildAuthModule({ GOOGLE_CLIENT_ID: "g" })).toBeNull()
  })

  it("declares emailpass + google when Google env is set (pre-W2 behavior preserved)", () => {
    const mod = buildAuthModule({
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
      BACKEND_URL: "https://api.fbm.test/",
    })!
    expect(mod.resolve).toBe("@medusajs/medusa/auth")
    expect(ids(mod)).toEqual(["emailpass", "google"])
    expect(provider(mod, "google").options).toMatchObject({
      clientID: "g-id",
      clientSecret: "g-secret",
      callbackURL: "https://api.fbm.test/auth/seller/google/callback",
    })
  })

  it("declares emailpass + mas when MAS env is set, with the customer callback default", () => {
    const mod = buildAuthModule({
      MAS_OIDC_ISSUER: "https://matrix.test/",
      MAS_OIDC_CLIENT_ID: "00000000000000000000000FBM",
      MAS_OIDC_CLIENT_SECRET: "s",
      MAS_OIDC_SCOPES: "openid profile email",
      MATRIX_SERVER_NAME: "blackout.test",
      BACKEND_URL: "https://api.fbm.test",
    })!
    expect(ids(mod)).toEqual(["emailpass", "mas"])
    const mas = provider(mod, "mas")
    expect(mas.resolve).toBe("./src/modules/oidc-auth-provider")
    expect(mas.options).toMatchObject({
      issuer: "https://matrix.test/",
      clientId: "00000000000000000000000FBM",
      clientSecret: "s",
      callbackUrl: "https://api.fbm.test/auth/customer/mas/callback",
      scopes: "openid profile email",
      matrixServerName: "blackout.test",
    })
  })

  it("honors an explicit MAS_OIDC_CALLBACK_URL over the derived default", () => {
    const mod = buildAuthModule({
      MAS_OIDC_ISSUER: "i",
      MAS_OIDC_CLIENT_ID: "c",
      MAS_OIDC_CLIENT_SECRET: "s",
      MAS_OIDC_CALLBACK_URL: "https://elsewhere.test/cb",
      BACKEND_URL: "https://api.fbm.test",
    })!
    expect(provider(mod, "mas").options?.callbackUrl).toBe("https://elsewhere.test/cb")
  })

  it("declares all three providers when Google and MAS are both configured", () => {
    const mod = buildAuthModule({
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
      MAS_OIDC_ISSUER: "i",
      MAS_OIDC_CLIENT_ID: "c",
      MAS_OIDC_CLIENT_SECRET: "s",
    })!
    expect(ids(mod)).toEqual(["emailpass", "google", "mas"])
  })
})
