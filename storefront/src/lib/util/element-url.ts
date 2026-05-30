/**
 * Helpers for building Element Web URLs for the embedded Matrix (Blackout) chat.
 *
 * Element uses hash routing for navigation (`/#/room/<alias>`) and reads a
 * single-use login token from the `loginToken` query param on load
 * (`/?loginToken=<token>`), completing an `m.login.token` flow against its
 * configured homeserver. To deep-link into a room while auto-logging-in we
 * combine both: `${base}/?loginToken=<token>#/room/<encoded-alias>`.
 */

export function elementBaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_MATRIX_ELEMENT_URL
  return url ? url.replace(/\/$/, "") : null
}

export function matrixServerName(): string {
  return process.env.NEXT_PUBLIC_MATRIX_SERVER_NAME || ""
}

/** Build a full room alias `#<localAlias>:<server>`. */
export function buildRoomAlias(localAlias: string, serverName?: string): string {
  return `#${localAlias}:${serverName || matrixServerName()}`
}

export function vendorRoomAlias(vendorHandle: string): string {
  return `vendor-${vendorHandle}`
}

export function orderRoomAlias(orderId: string): string {
  return `order-${orderId.replace("order_", "")}`
}

export interface ElementRoomUrlOptions {
  /** Local alias (without leading `#` or `:server`), e.g. `vendor-acme`. */
  alias: string
  /** Override the Element base URL (e.g. from the backend config). */
  base?: string | null
  /** Override the server name (e.g. from the backend config). */
  serverName?: string
  /** Single-use login token for auto-login. */
  loginToken?: string | null
}

/**
 * Build an Element URL that opens a specific room, optionally auto-logging in.
 * Returns null when no Element base URL is configured.
 */
export function elementRoomUrl(opts: ElementRoomUrlOptions): string | null {
  const base = opts.base ?? elementBaseUrl()
  if (!base) return null

  const fullAlias = buildRoomAlias(opts.alias, opts.serverName)
  const hash = `#/room/${encodeURIComponent(fullAlias)}`
  const query = opts.loginToken
    ? `?loginToken=${encodeURIComponent(opts.loginToken)}`
    : ""

  return `${base.replace(/\/$/, "")}/${query}${hash}`
}

/**
 * Build an Element URL for the home/default view, optionally auto-logging in.
 */
export function elementHomeUrl(
  base?: string | null,
  loginToken?: string | null
): string | null {
  const resolved = base ?? elementBaseUrl()
  if (!resolved) return null
  const query = loginToken ? `?loginToken=${encodeURIComponent(loginToken)}` : ""
  return `${resolved.replace(/\/$/, "")}/${query}`
}
