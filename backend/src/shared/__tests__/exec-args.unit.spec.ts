import {
  APPLY_OR_DRY_RUN,
  parseScriptArgs,
  scriptArgUsage,
  wordsDroppedAfterSeparator,
} from "../exec-args"

/**
 * The `args` and `process.argv` shapes below are the ones `npx medusa exec`
 * (`@medusajs/cli` 2.14.2) produced on a migrated database, recorded with a
 * probe script that printed both:
 *
 *   exec probe.js apply default-plan=free 123 "two words"
 *     args = ["apply", "default-plan=free", 123, "two words"]
 *   exec probe.js -- --apply apply
 *     args = []   argv tail = ["exec", "probe.js", "--", "--apply", "apply"]
 *   exec probe.js --apply
 *     exit 1, "Unknown argument: apply", script never loaded
 */

const NODE = ["/usr/bin/node", "/app/node_modules/@medusajs/cli/cli.js"]
const execArgv = (...rest: string[]) => [...NODE, "exec", "./src/scripts/x.ts", ...rest]
const JEST_ARGV = ["/usr/bin/node", "/app/node_modules/.bin/jest", "--runInBand", "x.spec.ts"]

describe("parseScriptArgs", () => {
  it("reads bare flags and name=value options, as medusa exec passes them", () => {
    const parsed = parseScriptArgs(
      ["dry-run", "default-plan=free"],
      { flags: ["dry-run"], options: ["default-plan"] },
      execArgv("dry-run", "default-plan=free")
    )
    expect(parsed).toEqual({
      ok: true,
      flags: new Set(["dry-run"]),
      options: new Map([["default-plan", "free"]]),
    })
  })

  it("reads nothing switched on when given no words", () => {
    const parsed = parseScriptArgs([], { flags: ["apply"] }, execArgv())
    expect(parsed.ok && parsed.flags.size).toBe(0)
    expect(parseScriptArgs(undefined, { flags: ["apply"] }, execArgv()).ok).toBe(true)
  })

  it("reads a word the CLI turned into a number as its text", () => {
    // yargs coerces `123` to the number 123 before the script sees it.
    const parsed = parseScriptArgs([123, "limit=5"], { flags: ["123"], options: ["limit"] }, execArgv())
    expect(parsed.ok && parsed.flags.has("123")).toBe(true)
    expect(parsed.ok && parsed.options.get("limit")).toBe("5")
  })

  it("refuses a `--` separator, whose words medusa exec dropped, instead of running as if none were typed", () => {
    // The live case: `exec reencrypt.ts -- --apply` hands the script [] and,
    // without this, it ran a dry run while the operator believed it applied.
    const parsed = parseScriptArgs([], { flags: ["apply"] }, execArgv("--", "--apply"))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toMatch(/drops everything after "--"/)
    expect(parsed.message).toContain('"--apply"')
    // And says what to type instead.
    expect(parsed.message).toContain("`… apply`")
  })

  it("refuses a separator even after words that did arrive, and keeps them in the suggestion", () => {
    const parsed = parseScriptArgs(
      ["default-plan=free"],
      { flags: ["dry-run"], options: ["default-plan"] },
      execArgv("default-plan=free", "--", "dry-run")
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    // Not `… dry-run`, which would then be refused for want of a plan.
    expect(parsed.message).toContain("`… default-plan=free dry-run`")
  })

  it("suggests each intended word once", () => {
    const parsed = parseScriptArgs([], { flags: ["apply"] }, execArgv("--", "--apply", "apply"))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toContain("`… apply`;")
  })

  it("refuses a --flag spelling and names the bare word to use", () => {
    const parsed = parseScriptArgs(["--apply"], { flags: ["apply"] }, execArgv())
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toContain("`apply`, not `--apply`")
    expect(parseScriptArgs(["--default-plan=free"], { options: ["default-plan"] }, execArgv()).ok).toBe(false)
  })

  it("refuses an unknown word rather than ignoring it", () => {
    // `dryrun` ignored would be a live run.
    const parsed = parseScriptArgs(["dryrun"], { flags: ["dry-run"] }, execArgv("dryrun"))
    expect(parsed).toEqual({
      ok: false,
      message: 'unknown argument "dryrun"; this script takes: dry-run',
    })
  })

  it("refuses an option without its value, a flag given a value, and an option given twice", () => {
    const spec = { flags: ["dry-run"], options: ["default-plan"] }
    expect(parseScriptArgs(["default-plan="], spec, execArgv()).ok).toBe(false)
    expect(parseScriptArgs(["default-plan"], spec, execArgv()).ok).toBe(false)
    expect(parseScriptArgs(["dry-run=yes"], spec, execArgv()).ok).toBe(false)
    expect(
      parseScriptArgs(["default-plan=free", "default-plan=pro"], spec, execArgv()).ok
    ).toBe(false)
  })
})

describe("APPLY_OR_DRY_RUN", () => {
  it("reads `apply`, `dry-run` or neither, and refuses both", () => {
    const read = (...words: string[]) => parseScriptArgs(words, APPLY_OR_DRY_RUN, execArgv(...words))
    const none = read()
    expect(none.ok && none.flags.size).toBe(0)
    const apply = read("apply")
    expect(apply.ok && apply.flags.has("apply")).toBe(true)
    const dry = read("dry-run")
    expect(dry.ok && dry.flags.has("dry-run")).toBe(true)
    expect(read("apply", "dry-run")).toEqual({
      ok: false,
      message: '"apply" and "dry-run" contradict each other: give one; this script takes: apply, dry-run',
    })
    expect(read("dry-run", "apply").ok).toBe(false)
  })

  it("keeps the group when spread into a spec with options", () => {
    const spec = { ...APPLY_OR_DRY_RUN, options: ["before"] }
    expect(parseScriptArgs(["apply", "before=x"], spec, execArgv()).ok).toBe(true)
    expect(parseScriptArgs(["apply", "dry-run", "before=x"], spec, execArgv()).ok).toBe(false)
  })
})

describe("wordsDroppedAfterSeparator", () => {
  it("returns the words after a `--` that follows exec", () => {
    expect(wordsDroppedAfterSeparator(execArgv("--", "--apply", "apply"))).toEqual([
      "--apply",
      "apply",
    ])
    expect(wordsDroppedAfterSeparator(execArgv("apply"))).toEqual([])
  })

  it("finds nothing in a process that was not started as medusa exec", () => {
    // Unit tests call the scripts directly; jest's own argv must not trip it.
    expect(wordsDroppedAfterSeparator(JEST_ARGV)).toEqual([])
    expect(wordsDroppedAfterSeparator([...JEST_ARGV, "--", "x"])).toEqual([])
  })
})

describe("scriptArgUsage", () => {
  it("lists flags then options", () => {
    expect(scriptArgUsage({ flags: ["dry-run"], options: ["default-plan"] })).toBe(
      "dry-run, default-plan=<value>"
    )
    expect(scriptArgUsage({})).toBe("no arguments")
  })
})
