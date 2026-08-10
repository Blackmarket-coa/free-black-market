/**
 * Canonical outbound links used across public pages.
 *
 * These were previously inlined as string literals at each call site, which is
 * how the "View GitHub transparency" CTA came to point at `https://github.com`
 * — the GitHub homepage — in five separate files. A transparency link that
 * lands on a generic marketing page is worse than no link, so the URL lives
 * here and every surface reads it from one place.
 *
 * `NEXT_PUBLIC_GITHUB_REPO_URL` allows a fork or a self-hosted node to point at
 * its own source without editing components.
 */

/** The public source repository. Backs every "transparency" / "contribute" CTA. */
export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ||
  "https://github.com/Blackmarket-coa/free-black-market"
