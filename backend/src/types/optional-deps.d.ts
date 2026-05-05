/**
 * Type declarations for optional dependencies
 * These modules are dynamically imported and may not be installed
 */

// @sentry/node is optional - used for error tracking
declare module "@sentry/node" {
  export function init(options: Record<string, unknown>): void
  export function withScope<T>(callback: (scope: Scope) => T): T
  export function captureException(error: unknown): string
  export function captureMessage(message: string, level?: string): string
  export function setUser(user: Record<string, unknown> | null): void
  export function addBreadcrumb(breadcrumb: Record<string, unknown>): void
  export function startInactiveSpan(options: Record<string, unknown>): { finish: () => void }
  export function flush(timeout: number): Promise<boolean>

  export interface Scope {
    setTag(key: string, value: string): void
    setExtra(key: string, value: unknown): void
    setUser(user: Record<string, unknown>): void
    setLevel(level: string): void
  }
}

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

