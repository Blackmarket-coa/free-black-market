/**
 * The module's registration key, in its own file.
 *
 * Deliberately separate from `index.ts`: that barrel calls `Module()` at
 * import time, and this key is needed by code on the **boot path** —
 * `shared/usage-metering.ts` (reached from `api/middlewares.ts`) and
 * `jobs/vendor-usage-billing.ts` (auto-loaded by the job loader). Importing
 * the barrel from either would execute the module factory during middleware
 * and job loading, i.e. while Medusa is still assembling its own module
 * registry.
 *
 * Splitting the constant out lets those callers name the module without
 * pulling the factory in, and keeps the string in one place so it cannot
 * drift from the registration.
 */
export const VENDOR_USAGE_MODULE = "vendorUsage"
