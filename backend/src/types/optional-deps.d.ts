/**
 * Type declarations for optional dependencies
 * These modules are dynamically imported and may not be installed
 */

// @sentry/node now ships as a real dependency (see backend/package.json); its
// bundled types are authoritative, so no ambient shim is declared here.

declare module "jsonwebtoken" {
  export class TokenExpiredError extends Error {}
  export class JsonWebTokenError extends Error {}

  export interface SignOptions {
    expiresIn?: number | string
    notBefore?: number | string
    audience?: string | string[]
    issuer?: string
    subject?: string
    jwtid?: string
    algorithm?: string
    keyid?: string
    noTimestamp?: boolean
    header?: Record<string, unknown>
    encoding?: string
    mutatePayload?: boolean
  }

  export interface VerifyOptions {
    audience?: string | RegExp | (string | RegExp)[]
    issuer?: string | string[]
    subject?: string
    algorithms?: string[]
    clockTolerance?: number
    maxAge?: string | number
    ignoreExpiration?: boolean
    ignoreNotBefore?: boolean
    nonce?: string
    complete?: boolean
  }

  export function decode(token: string): Record<string, unknown> | null
  export function verify(
    token: string,
    secretOrPublicKey: string,
    options?: VerifyOptions
  ): Record<string, unknown> | string
  export function sign(
    payload: string | Buffer | Record<string, unknown>,
    secretOrPrivateKey: string | Buffer,
    options?: SignOptions
  ): string

  const jwt: {
    decode: typeof decode
    verify: typeof verify
    sign: typeof sign
    TokenExpiredError: typeof TokenExpiredError
    JsonWebTokenError: typeof JsonWebTokenError
  }

  export default jwt
}

