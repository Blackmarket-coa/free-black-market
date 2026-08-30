import { decideRecordVersion, pickLatest } from "../versions"

const row = (version: string, over: Record<string, unknown> = {}) => ({
  version,
  code_sha256: null,
  yanked_at: null,
  ...over,
})

describe("pickLatest", () => {
  it("returns the highest semver, prerelease-aware", () => {
    const rows = [row("1.0.0"), row("1.2.0-rc.1"), row("1.1.9"), row("1.2.0")]
    expect(pickLatest(rows)?.version).toBe("1.2.0")
    // Without the release, the rc wins over 1.1.9.
    expect(pickLatest([row("1.2.0-rc.1"), row("1.1.9")])?.version).toBe("1.2.0-rc.1")
  })

  it("excludes yanked versions unless asked", () => {
    const rows = [row("1.0.0"), row("2.0.0", { yanked_at: new Date() })]
    expect(pickLatest(rows)?.version).toBe("1.0.0")
    expect(pickLatest(rows, { includeYanked: true })?.version).toBe("2.0.0")
    expect(pickLatest([row("1.0.0", { yanked_at: new Date() })])).toBeNull()
  })

  it("prefers parseable versions over unparseable ones and survives empty input", () => {
    expect(pickLatest([row("garbage"), row("0.1.0")])?.version).toBe("0.1.0")
    expect(pickLatest([row("0.1.0"), row("garbage")])?.version).toBe("0.1.0")
    expect(pickLatest([])).toBeNull()
  })
})

describe("decideRecordVersion", () => {
  it("creates when no row exists", () => {
    expect(decideRecordVersion(null, { code_sha256: "a".repeat(64) })).toBe("create")
    expect(decideRecordVersion(undefined, {})).toBe("create")
  })

  it("treats a byte-identical retry as already recorded (null hashes included)", () => {
    expect(
      decideRecordVersion(row("1.0.0", { code_sha256: "a".repeat(64) }), {
        code_sha256: "a".repeat(64),
      })
    ).toBe("already-recorded")
    expect(decideRecordVersion(row("1.0.0"), { code_sha256: null })).toBe("already-recorded")
    expect(decideRecordVersion(row("1.0.0"), {})).toBe("already-recorded")
  })

  it("refuses a different artifact under the same version (immutability)", () => {
    expect(
      decideRecordVersion(row("1.0.0", { code_sha256: "a".repeat(64) }), {
        code_sha256: "b".repeat(64),
      })
    ).toBe("conflict")
    expect(decideRecordVersion(row("1.0.0", { code_sha256: null }), { code_sha256: "c".repeat(64) })).toBe(
      "conflict"
    )
  })
})
