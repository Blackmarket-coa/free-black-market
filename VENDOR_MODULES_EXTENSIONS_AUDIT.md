# Vendor Modules & Extensions Completeness Audit

**Date:** 2026-02-18  
**Scope:**
- Backend module implementations under `backend/src/modules/*`
- Vendor dashboard extension and feature-flag wiring under `vendor-panel/src/*`

> **Superseded module counts (2026-07-15).** This audit reviewed the 40
> modules that existed on 2026-02-18. The module surface has since grown to
> 79 directories; the "40/40" completeness figures below describe that
> earlier snapshot only. For the current module inventory, see
> `docs/MODULE_CATALOG.md`.

---

## Executive Summary

The backend vendor module surface is structurally complete at the module-entry level (`index.ts` + `service.ts` present for every module directory reviewed).

**Historical note:** At audit time, the vendor dashboard extension system was only partially complete.
**Current status (follow-up):** the previously flagged extension keys are now wired into navigation/dashboard behavior and covered by guard checks.

### Overall Status

| Area | Status | Notes |
|---|---|---|
| Backend modules scaffold completeness | ✅ Complete | 40/40 modules include both `index.ts` and `service.ts`. |
| Vendor extension key declarations | ✅ Complete | 14 extension keys are declared in `VendorFeatures`. |
| Vendor extension runtime usage completeness | ✅ Complete (updated) | Follow-up implementation wires `hasSeasons`, `hasSupport`, and `hasHarvests` into navigation/onboarding behavior and guard checks. |

---

## Audit Method

### 1) Backend module scaffold check

Each directory in `backend/src/modules/*` was checked for the expected minimal module contract:
- `index.ts`
- `service.ts`

**Result:** All 40 discovered modules include both files.

### 2) Vendor extension key completeness check

The audit started from the authoritative extension-key declaration list in `VendorFeatures`/`ALL_EXTENSION_OPTIONS`, then checked whether each key is referenced anywhere outside the provider declaration file.

**Declared extension keys:**
- `hasProducts`
- `hasInventory`
- `hasSeasons`
- `hasVolunteers`
- `hasMenu`
- `hasDeliveryZones`
- `hasDonations`
- `hasSubscriptions`
- `hasSupport`
- `hasHarvests`
- `hasPlots`
- `hasRequests`
- `hasFarm`
- `hasShows`

---

## Findings

## A) Backend vendor module completeness

All module directories in `backend/src/modules` currently satisfy minimum implementation scaffolding (`index.ts` + `service.ts`). This includes vendor-critical modules such as:
- `seller-extension`
- `vendor-rules`
- `vendor-verification`
- vendor-type related domains (`producer`, `garden`, `kitchen`, `restaurant`, `volunteer`, etc.)

**Conclusion:** No missing module entrypoints were found in backend module directories.

## B) Vendor extension completeness status

### Fully/partially wired extension keys

The following keys are actively used in navigation and/or dashboard flow logic:
- `hasProducts`
- `hasInventory`
- `hasVolunteers`
- `hasMenu`
- `hasDeliveryZones`
- `hasDonations`
- `hasSubscriptions`
- `hasPlots`
- `hasRequests`
- `hasFarm`
- `hasShows`

### Follow-up status update (implemented)

A follow-up implementation has wired previously flagged keys into runtime behavior and tests:
1. `hasSeasons`
2. `hasSupport`
3. `hasHarvests`

These keys now gate navigation and/or dashboard onboarding behavior, and are enforced by the completeness guard.

---

## Risk Assessment

- **Product/UX risk (Low after follow-up):** The previously dead toggles are now wired, reducing user confusion from no-op settings.
- **Maintenance risk (Low):** Guard checks and tests now reduce the chance of reintroducing declared-but-unused flags.
- **Backend risk (Low):** Module entrypoint completeness is healthy; no immediate structural backend risk identified in this audit scope.

---

## Recommendations


> **Status note (2026-02-18 follow-up):** Priority 1 and Priority 2 recommendations are now implemented in-repo. Priority 3 remains ongoing process guidance for future extension keys.

### Priority 1 (Complete extension wiring)

For each of `hasSeasons`, `hasSupport`, and `hasHarvests`, choose one of:
- Implement route/navigation/dashboard behavior, **or**
- Remove/soft-hide the option from `ALL_EXTENSION_OPTIONS` until implemented.

### Priority 2 (Automated completeness guard)

Add a lightweight CI audit check that fails if:
- a key in `ALL_EXTENSION_OPTIONS` has no references outside `vendor-type-context.tsx`, or
- new backend module dirs omit `index.ts`/`service.ts`.

### Priority 3 (Definition of Done for new extensions)

For each new extension key, require all of:
- key declaration
- default mappings by vendor type
- nav or route behavior
- settings copy/toggle wiring
- tests or static assertion coverage

---

## Files Reviewed

- `backend/src/modules/*` (directory-level scaffold check)
- `vendor-panel/src/providers/vendor-type-provider/vendor-type-context.tsx`
- `vendor-panel/src/hooks/navigation/use-vendor-navigation.tsx`
- `vendor-panel/src/routes/dashboard/config/dashboard-config.ts`

---

*Generated as part of a repository-level vendor modules/extensions completeness audit.*
