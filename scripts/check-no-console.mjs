#!/usr/bin/env node
/**
 * Guard against bare `console.*` creeping back into application runtime code.
 *
 * Logging hygiene (audit-debt LG-1/LG-2/LG-3) routes all runtime logging through
 * each app's gated/structured logger:
 *   - backend:      backend/src/shared/logger.ts   (`createLogger`)
 *   - storefront:   storefront/src/lib/logger.ts   (`logger`)
 *   - admin-panel:  admin-panel/src/lib/logger.ts  (`logger`)
 *
 * This check fails CI if a raw `console.<level>(` appears outside of:
 *   - the sanctioned logger files themselves (the console sink lives there),
 *   - `backend/src/scripts/**` (one-off CLI/seed scripts where console output IS the UX),
 *   - test files (`**​/__tests__/**`, `*.spec.*`, `*.test.*`) — diagnostic output.
 *
 * Run: `node scripts/check-no-console.mjs`
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const TARGETS = [
  { dir: "backend/src", excludeDirs: ["scripts"], loggerFile: "backend/src/shared/logger.ts" },
  { dir: "storefront/src", excludeDirs: [], loggerFile: "storefront/src/lib/logger.ts" },
  { dir: "admin-panel/src", excludeDirs: [], loggerFile: "admin-panel/src/lib/logger.ts" },
]

const CONSOLE_RE = /\bconsole\.(log|info|warn|error|debug)\b/
const SRC_EXT = /\.(tsx?|jsx?|mjs|cjs)$/
const TEST_FILE = /\.(spec|test)\.(tsx?|jsx?)$/

function walk(absDir, excludeTop, files = []) {
  if (!fs.existsSync(absDir)) return files
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    if (entry.name === "__tests__") continue
    const full = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      if (excludeTop && excludeTop.includes(entry.name)) continue
      walk(full, null, files) // excludeDirs only apply at the target root
    } else if (SRC_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

const violations = []
for (const target of TARGETS) {
  const absDir = path.join(ROOT, target.dir)
  const loggerAbs = path.join(ROOT, target.loggerFile)
  for (const file of walk(absDir, target.excludeDirs)) {
    if (file === loggerAbs) continue
    const lines = fs.readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      if (CONSOLE_RE.test(line)) {
        violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
      }
    })
  }
}

if (violations.length) {
  console.error(
    `Found ${violations.length} bare console.* call(s) in runtime code. ` +
      `Use the app logger instead (see scripts/check-no-console.mjs header):`
  )
  for (const v of violations) console.error(` - ${v}`)
  process.exit(1)
}

console.log("No bare console.* in runtime code — logging hygiene check passed.")
