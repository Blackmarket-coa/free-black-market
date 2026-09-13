#!/usr/bin/env node
/**
 * Release gate for the legal pages.
 *
 * `storefront/src/lib/constants/legal.ts` deliberately ships `[[TOKENS]]` for
 * the facts code cannot know — the legal entity, the governing law, the inbox
 * a notice goes to. A guessed jurisdiction in a governing-law clause is worse
 * than a visible blank, because it reads as settled and is wrong.
 *
 * The risk is that the tokens are forgotten and the pages go public reading
 * "governed by the laws of [[GOVERNING_LAW_STATE]]". This script makes that a
 * failure rather than an embarrassment, and it belongs with the other §8
 * release gates rather than in anyone's memory.
 *
 * It also fails if the pages stop importing from the shared constants module,
 * which is how the tokens would otherwise be bypassed — inline the entity name
 * in one page and the check would pass while the pages disagree.
 *
 * Exit 0 clean, 1 on anything unresolved. Run it in CI before a public deploy;
 * it is intentionally not part of `pnpm lint`, since an unfilled token is the
 * correct state during development.
 */

import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const CONSTANTS = "storefront/src/lib/constants/legal.ts"
const PAGES = [
  "storefront/src/app/[locale]/(main)/legal/terms/page.tsx",
  "storefront/src/app/[locale]/(main)/legal/privacy/page.tsx",
  "storefront/src/app/[locale]/(main)/legal/refunds/page.tsx",
]
const SHELL = "storefront/src/components/organisms/LegalPage/LegalPage.tsx"

const TOKEN = /\[\[[A-Z0-9_]+\]\]/g

const problems = []
const note = (m) => problems.push(m)

for (const rel of [CONSTANTS, SHELL, ...PAGES]) {
  if (!existsSync(join(root, rel))) {
    note(`missing: ${rel}`)
  }
}

if (problems.length) {
  console.error("Legal pages are not intact:\n  " + problems.join("\n  "))
  process.exit(1)
}

// 1. Unfilled placeholders anywhere in the legal surface.
for (const rel of [CONSTANTS, ...PAGES]) {
  const src = readFileSync(join(root, rel), "utf8")
  const found = [...new Set(src.match(TOKEN) ?? [])]
  for (const t of found) {
    note(`${rel}: unfilled placeholder ${t}`)
  }
}

// 2. The review banner must be cleared deliberately, not left set.
const constants = readFileSync(join(root, CONSTANTS), "utf8")
if (!/LEGAL_REVIEW_STATUS[^=]*=\s*null/.test(constants)) {
  note(
    `${CONSTANTS}: LEGAL_REVIEW_STATUS is still set — the pages render a ` +
      `"not yet legally reviewed" banner. Set it to null once a lawyer has ` +
      `signed the text off.`
  )
}

// 3. Each page must still source its facts from the shared module, or the
//    tokens above can be bypassed by inlining a value in one page.
for (const rel of PAGES) {
  const src = readFileSync(join(root, rel), "utf8")
  if (!src.includes('from "@/lib/constants/legal"')) {
    note(`${rel}: no longer imports the shared legal constants`)
  }
}

if (problems.length) {
  console.error(
    `\nLegal pages are not ready to publish (${problems.length} item${
      problems.length === 1 ? "" : "s"
    }):\n`
  )
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    `\nThese are operator decisions, not code changes. Fill them in ` +
      `${relative(process.cwd(), join(root, CONSTANTS))} and re-run.\n`
  )
  process.exit(1)
}

console.log("Legal pages: no unfilled placeholders, review sign-off recorded.")
