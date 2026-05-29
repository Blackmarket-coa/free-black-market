/**
 * Helpers for building Element Web URLs for the embedded Matrix (Blackout) chat.
 *
 * Element reads a single-use login token from the `loginToken` query param on
 * load and uses hash routing (`/#/room/<alias>`) for navigation. To deep-link
 * into a room while auto-logging-in we combine both:
 *   `${base}/?loginToken=<token>#/room/<encoded-alias>`
 */

export function elementBaseUrlFromEnv(): string | null {
  const url = import.meta.env.VITE_MATRIX_ELEMENT_URL
  return url ? url.replace(/\/$/, "") : null
}

export function matrixServerNameFromEnv(): string {
  return import.meta.env.VITE_MATRIX_SERVER_NAME || ""
}

export function buildRoomAlias(localAlias: string, serverName: string): string {
  return `#${localAlias}:${serverName}`
}

export interface ElementRoomUrlOptions {
  alias: string
  base?: string | null
  serverName?: string
  loginToken?: string | null
}

export function elementRoomUrl(opts: ElementRoomUrlOptions): string | null {
  const base = opts.base ?? elementBaseUrlFromEnv()
  if (!base) return null

  const serverName = opts.serverName || matrixServerNameFromEnv()
  const fullAlias = buildRoomAlias(opts.alias, serverName)
  const hash = `#/room/${encodeURIComponent(fullAlias)}`
  const query = opts.loginToken
    ? `?loginToken=${encodeURIComponent(opts.loginToken)}`
    : ""

  return `${base.replace(/\/$/, "")}/${query}${hash}`
}

export function elementHomeUrl(
  base?: string | null,
  loginToken?: string | null
): string | null {
  const resolved = base ?? elementBaseUrlFromEnv()
  if (!resolved) return null
  const query = loginToken ? `?loginToken=${encodeURIComponent(loginToken)}` : ""
  return `${resolved.replace(/\/$/, "")}/${query}`
}
