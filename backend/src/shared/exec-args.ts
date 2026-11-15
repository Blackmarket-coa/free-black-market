/**
 * Arguments for the scripts run with `npx medusa exec <file> [args..]`.
 *
 * What the CLI actually hands a script (checked against `@medusajs/cli` 2.14.2
 * on a migrated database, not inferred):
 *
 *   - Bare words arrive, in order: `exec x.ts apply default-plan=free` gives
 *     `args` = `["apply", "default-plan=free"]`. A word that looks like a
 *     number arrives as a number (`123` → `123`), so every word is read with
 *     `String()` here.
 *   - `--apply`, `--dry-run`, `--default-plan=…` never arrive. The CLI parses
 *     with yargs in strict mode and exits 1 with "Unknown argument" before the
 *     script is loaded.
 *   - Everything after a `--` separator is dropped: `exec x.ts -- apply` gives
 *     `args` = `[]`, and the script runs as if nothing had been typed. The words
 *     are still in `process.argv` (the script runs in the CLI's own process),
 *     which is how {@link parseScriptArgs} notices and refuses instead.
 *
 * So a script reads bare words (`apply`, `dry-run`, `name=value`), and anything
 * it does not recognise is refused rather than ignored: a misspelt `dryrun`
 * must not turn into a live run.
 */

export type ScriptArgSpec = {
  /** Bare words that switch something on, e.g. `apply`, `dry-run`. */
  flags?: readonly string[]
  /** `name=value` words, e.g. `default-plan` for `default-plan=free`. */
  options?: readonly string[]
}

export type ScriptArgs = {
  flags: ReadonlySet<string>
  options: ReadonlyMap<string, string>
}

export type ParsedScriptArgs =
  | ({ ok: true } & ScriptArgs)
  | { ok: false; message: string }

/** How a script with this spec is called, for refusal messages. */
export function scriptArgUsage(spec: ScriptArgSpec): string {
  const words = [
    ...(spec.flags ?? []),
    ...(spec.options ?? []).map((name) => `${name}=<value>`),
  ]
  return words.length ? words.join(", ") : "no arguments"
}

/**
 * The words typed after a `--` separator that follows `exec`, which `medusa
 * exec` drops before calling the script. Empty when there is no separator, or
 * when this process was not started as `medusa exec` (a unit test, say).
 */
export function wordsDroppedAfterSeparator(
  argv: readonly string[] = process.argv
): string[] {
  const exec = argv.indexOf("exec")
  if (exec < 0) return []
  const separator = argv.indexOf("--", exec + 1)
  if (separator < 0) return []
  return argv.slice(separator + 1).map(String)
}

/**
 * Read a script's `medusa exec` arguments against what it accepts.
 *
 * Refuses (never guesses at) anything outside the spec: a `--` separator whose
 * words were dropped, a `--flag` spelling the CLI would not have passed, an
 * unknown word, an option with no value or given twice.
 */
export function parseScriptArgs(
  args: readonly unknown[] | undefined,
  spec: ScriptArgSpec,
  argv: readonly string[] = process.argv
): ParsedScriptArgs {
  const flagNames = new Set(spec.flags ?? [])
  const optionNames = new Set(spec.options ?? [])
  const usage = `this script takes: ${scriptArgUsage(spec)}`

  const dropped = wordsDroppedAfterSeparator(argv)
  if (dropped.length) {
    const intended = dropped.map((w) => w.replace(/^-+/, "")).filter(Boolean)
    return {
      ok: false,
      message:
        `medusa exec drops everything after "--", so ${dropped
          .map((w) => `"${w}"`)
          .join(" ")} never reached the script. ` +
        `Pass the words without "--"` +
        (intended.length ? `, e.g. \`… ${intended.join(" ")}\`` : "") +
        `; ${usage}`,
    }
  }

  const flags = new Set<string>()
  const options = new Map<string, string>()

  for (const raw of args ?? []) {
    const word = String(raw)

    if (word.startsWith("-")) {
      const bare = word.replace(/^-+/, "")
      return {
        ok: false,
        message:
          `"${word}" is not read: medusa exec refuses "--" options, so arguments are bare words` +
          (bare ? ` (\`${bare}\`, not \`${word}\`)` : "") +
          `; ${usage}`,
      }
    }

    const eq = word.indexOf("=")
    if (eq > 0 && optionNames.has(word.slice(0, eq))) {
      const name = word.slice(0, eq)
      const value = word.slice(eq + 1).trim()
      if (!value) {
        return { ok: false, message: `"${name}=" needs a value; ${usage}` }
      }
      if (options.has(name)) {
        return { ok: false, message: `"${name}" was given twice; ${usage}` }
      }
      options.set(name, value)
      continue
    }

    if (flagNames.has(word)) {
      flags.add(word)
      continue
    }

    return { ok: false, message: `unknown argument "${word}"; ${usage}` }
  }

  return { ok: true, flags, options }
}
