import { createHash } from "crypto"
import { readFileSync } from "fs"
import path from "path"

import { CONNECT_SRI, CONNECT_VERSION, buildSnippet } from "../website-config"

/**
 * Release-discipline parity for the connect.js SDK, in the same spirit as
 * reference-type-parity: four things must always agree, and nothing else
 * enforced that they do —
 *
 *   1. the `version:` literal inside storefront/public/connect.js,
 *   2. CONNECT_VERSION (which names the frozen release directory),
 *   3. the frozen copy at storefront/public/v<version>/connect.js, which the
 *      immutable cache headers and the SRI hash assume is never edited,
 *   4. CONNECT_SRI, the integrity hash the vendor snippet publishes.
 *
 * The enforced workflow: any change to connect.js bumps the version literal,
 * snapshots a new frozen directory, and updates the two constants. Editing a
 * shipped frozen file is never legal — browsers holding the old bytes under
 * `immutable` caching and embeds pinned to the old hash would disagree with
 * the server forever.
 */
const repoRoot = path.resolve(__dirname, "../../../..")
const mutablePath = path.join(repoRoot, "storefront/public/connect.js")
const frozenPath = path.join(
  repoRoot,
  `storefront/public/v${CONNECT_VERSION}/connect.js`,
)

describe("connect.js release parity", () => {
  const mutable = readFileSync(mutablePath)

  it("declares the released version inside the SDK itself", () => {
    const match = mutable.toString("utf8").match(/version:\s*"([^"]+)"/)
    expect(match?.[1]).toBe(CONNECT_VERSION)
  })

  it("has a frozen copy for the declared version, byte-identical to the mutable channel", () => {
    // If this fails after editing connect.js: bump the version literal, copy
    // the file to public/v<new>/connect.js, and update CONNECT_VERSION +
    // CONNECT_SRI in website-config.ts. Never edit an existing v*/ directory.
    const frozen = readFileSync(frozenPath)
    expect(frozen.equals(mutable)).toBe(true)
  })

  it("publishes the integrity hash of the frozen bytes", () => {
    const digest = createHash("sha384")
      .update(readFileSync(frozenPath))
      .digest("base64")
    expect(`sha384-${digest}`).toBe(CONNECT_SRI)
  })

  it("embeds the pinned URL, integrity and crossorigin in the vendor snippet", () => {
    const snippet = buildSnippet("test-vendor")
    expect(snippet).toContain(`/v${CONNECT_VERSION}/connect.js`)
    expect(snippet).toContain(`integrity="${CONNECT_SRI}"`)
    expect(snippet).toContain('crossorigin="anonymous"')
    expect(snippet).toContain('data-fbm-vendor="test-vendor"')
  })
})
