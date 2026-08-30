import crypto from "crypto"
import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import {
  AuthenticationInput,
  AuthenticationResponse,
  AuthIdentityProviderService,
  Logger,
} from "@medusajs/framework/types"
import { createRemoteJWKSet, jwtVerify } from "jose"

/**
 * MAS OIDC auth provider (W2, consolidation D4): customers log in against the
 * Blackout-hosted Matrix Authentication Service — the ecosystem's one IdP.
 *
 * Shape mirrors @medusajs/auth-google (authorization-code redirect via
 * authenticate() + validateCallback(), state parked in the auth module's
 * cache-backed setState/getState), with three deliberate hardenings:
 *   - PKCE (S256) + nonce on the authorization request,
 *   - the id_token is jose-VERIFIED against the issuer's JWKS
 *     (signature/iss/aud/exp + nonce binding) — not merely decoded,
 *   - endpoints come from OIDC discovery with an issuer-echo check, never
 *     hardcoded.
 *
 * Claim semantics (blackout docs/contracts/mas-identity.md, mirrored in
 * docs/contracts/mas-identity-consumer.md): `sub` is the MAS account ULID —
 * stable but NEVER a Matrix localpart; the localpart travels in
 * `preferred_username`; the mxid is assembled with OUR configured server name.
 * entity_id therefore stores `sub`, and the Matrix identity rides in
 * user_metadata for subscribers (customer-created-matrix) to consume.
 */

export type MasOidcOptions = {
  issuer: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  /** Space-separated; defaults to "openid profile" (profile carries preferred_username). */
  scopes?: string
  /** Server name for mxid assembly, e.g. blackout.local (MATRIX_SERVER_NAME). */
  matrixServerName?: string
}

type InjectedDependencies = {
  logger: Logger
}

type DiscoveryDocument = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
  id_token_signing_alg_values_supported?: string[]
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000
const DEFAULT_SCOPES = "openid profile"

const b64url = (buf: Buffer): string => buf.toString("base64url")
const s256 = (verifier: string): string =>
  b64url(crypto.createHash("sha256").update(verifier).digest())
const normalizeIssuer = (raw: string): string => raw.replace(/\/+$/, "")

class MasOidcAuthService extends AbstractAuthModuleProvider {
  static identifier = "mas"
  static DISPLAY_NAME = "Matrix (MAS) Authentication"

  protected config_: MasOidcOptions
  protected logger_: Logger
  private discovery_?: { document: DiscoveryDocument; fetchedAt: number }
  private jwks_?: { uri: string; keySet: ReturnType<typeof createRemoteJWKSet> }

  static validateOptions(options: Record<string, unknown>) {
    for (const key of ["issuer", "clientId", "clientSecret", "callbackUrl"] as const) {
      if (!options[key]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `MAS OIDC ${key} is required in the provider's options`
        )
      }
    }
  }

  constructor({ logger }: InjectedDependencies, options: MasOidcOptions) {
    // The abstract base declares no constructor (auth-google forwards
    // `...arguments` to the same default ctor).
    super()
    this.config_ = options
    this.logger_ = logger
  }

  async register(_: AuthenticationInput): Promise<AuthenticationResponse> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "MAS does not support registration. Use method `authenticate` instead."
    )
  }

  async authenticate(
    req: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const query: Record<string, string> = req.query ?? {}
    const body: Record<string, string> = req.body ?? {}

    if (query.error) {
      return {
        success: false,
        error: `${query.error_description}, read more at: ${query.error_uri}`,
      }
    }

    try {
      const discovery = await this.discover_()
      const stateKey = crypto.randomBytes(32).toString("hex")
      const codeVerifier = b64url(crypto.randomBytes(64))
      const nonce = b64url(crypto.randomBytes(32))
      const state = {
        callback_url: body?.callback_url ?? this.config_.callbackUrl,
        code_verifier: codeVerifier,
        nonce,
      }
      await authIdentityService.setState(stateKey, state)

      const authUrl = new URL(discovery.authorization_endpoint)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("client_id", this.config_.clientId)
      authUrl.searchParams.set("redirect_uri", state.callback_url)
      authUrl.searchParams.set("scope", this.config_.scopes || DEFAULT_SCOPES)
      authUrl.searchParams.set("state", stateKey)
      authUrl.searchParams.set("nonce", nonce)
      authUrl.searchParams.set("code_challenge", s256(codeVerifier))
      authUrl.searchParams.set("code_challenge_method", "S256")
      return { success: true, location: authUrl.toString() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async validateCallback(
    req: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const query: Record<string, string> = req.query ?? {}
    const body: Record<string, string> = req.body ?? {}

    if (query.error) {
      return {
        success: false,
        error: `${query.error_description}, read more at: ${query.error_uri}`,
      }
    }

    const code = query?.code ?? body?.code
    if (!code) {
      return { success: false, error: "No code provided" }
    }

    const state = await authIdentityService.getState(query?.state as string)
    if (!state) {
      return { success: false, error: "No state provided, or session expired" }
    }

    try {
      const discovery = await this.discover_()
      const tokenResponse = await fetch(discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.config_.clientId,
          client_secret: this.config_.clientSecret,
          code,
          redirect_uri: String(state.callback_url),
          code_verifier: String(state.code_verifier),
        }).toString(),
      }).then((r) => {
        if (!r.ok) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `Could not exchange token, ${r.status}, ${r.statusText}`
          )
        }
        return r.json()
      })

      if (!tokenResponse.id_token) {
        return { success: false, error: "Token response did not include an id_token" }
      }

      const claims = await this.verifyIdToken_(
        tokenResponse.id_token,
        String(state.nonce ?? ""),
        discovery
      )
      return await this.upsertIdentity_(claims, authIdentityService)
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Genuine verification — signature against the issuer's JWKS, iss/aud/exp,
   * alg constrained to what discovery advertises, then the transaction nonce.
   */
  private async verifyIdToken_(
    idToken: string,
    expectedNonce: string,
    discovery: DiscoveryDocument
  ) {
    const { payload } = await jwtVerify(idToken, this.jwksFor_(discovery.jwks_uri), {
      issuer: discovery.issuer,
      audience: this.config_.clientId,
      algorithms: discovery.id_token_signing_alg_values_supported,
    })
    if (!expectedNonce || payload.nonce !== expectedNonce) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "id_token nonce does not match this login transaction"
      )
    }
    return payload
  }

  private async upsertIdentity_(
    claims: Record<string, unknown>,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const entityId = typeof claims.sub === "string" ? claims.sub : ""
    if (!entityId) {
      return { success: false, error: "id_token did not include a sub claim" }
    }

    // preferred_username is the Matrix localpart; accept a full mxid shape
    // defensively and reduce it. sub is a ULID — never used for identity display.
    const preferred =
      typeof claims.preferred_username === "string" ? claims.preferred_username : ""
    const localpart = preferred.replace(/^@/, "").split(":")[0] ?? ""
    const serverName = this.config_.matrixServerName
    const userMetadata: Record<string, unknown> = {
      preferred_username: preferred || undefined,
      matrix_localpart: localpart || undefined,
      mxid: localpart && serverName ? `@${localpart}:${serverName}` : undefined,
      email: typeof claims.email === "string" ? claims.email : undefined,
      name: typeof claims.name === "string" ? claims.name : undefined,
    }

    let authIdentity
    try {
      authIdentity = await authIdentityService.retrieve({ entity_id: entityId })
      // Keep the Matrix identity fresh on every login (localpart renames,
      // added email) — update-on-retrieve.
      authIdentity = await authIdentityService.update(entityId, {
        user_metadata: userMetadata,
      })
    } catch (error: any) {
      if (error.type === MedusaError.Types.NOT_FOUND) {
        authIdentity = await authIdentityService.create({
          entity_id: entityId,
          user_metadata: userMetadata,
        })
      } else {
        return { success: false, error: error.message }
      }
    }

    return { success: true, authIdentity }
  }

  /** Lazy + cached (~1 h) OIDC discovery with the issuer-echo check. Never called in the constructor. */
  private async discover_(): Promise<DiscoveryDocument> {
    const issuer = normalizeIssuer(this.config_.issuer)
    if (this.discovery_ && Date.now() - this.discovery_.fetchedAt < DISCOVERY_TTL_MS) {
      return this.discovery_.document
    }
    const res = await fetch(`${issuer}/.well-known/openid-configuration`)
    if (!res.ok) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `MAS OIDC discovery failed: ${res.status}`
      )
    }
    const doc = (await res.json()) as DiscoveryDocument
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "MAS OIDC discovery document incomplete"
      )
    }
    if (normalizeIssuer(String(doc.issuer)) !== issuer) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `MAS OIDC discovery issuer mismatch: expected ${issuer}, got ${doc.issuer}`
      )
    }
    this.discovery_ = { document: doc, fetchedAt: Date.now() }
    return doc
  }

  private jwksFor_(jwksUri: string) {
    if (!this.jwks_ || this.jwks_.uri !== jwksUri) {
      this.jwks_ = { uri: jwksUri, keySet: createRemoteJWKSet(new URL(jwksUri)) }
    }
    return this.jwks_.keySet
  }
}

export default MasOidcAuthService
