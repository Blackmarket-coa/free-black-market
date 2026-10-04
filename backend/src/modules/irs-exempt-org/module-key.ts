/**
 * The module's registration key, in its own file.
 *
 * `index.ts` calls `Module()` at import time. The weekly ingest job
 * (`jobs/irs-exempt-org-ingest.ts`) and the operator script
 * (`scripts/ingest-irs-exempt-orgs.ts`) are loaded on the boot path and need
 * to name this module without executing its factory while Medusa is still
 * assembling the registry — the same split, for the same reason, as
 * `vendor-usage/module-key.ts` and `channel-connector/module-key.ts`.
 *
 * Never hand-type the string anywhere else (CLAUDE.md rule 2): a test that
 * mocks `container.resolve("irs-exempt-org")` would exercise a fallback and
 * pass while the real code never ran.
 */
export const IRS_EXEMPT_ORG_MODULE = "irsExemptOrg"
