# Vendor Feature Matrix Workplan

This workplan operationalizes the gaps/partials identified in `docs/VENDOR_FEATURE_MATRIX.md`.
It is implementation-first and intended to be executed by stream (Backend, Vendor Panel, Storefront, QA/Docs).

## Scope

Capabilities currently marked partial in the matrix:
- Inventory and reservations
- Delivery zones
- Donations
- Order cycles / subscriptions / seasons
- Reviews and requests
- Messaging / support chat
- Farm profile and harvest workflows
- Invoicing
- POS mode

## Delivery Principles

1. **Code-evidence-driven completion:** a capability only moves to ✅ after route/service/UI/test evidence exists in-repo.
2. **Cross-surface closure:** for vendor capabilities, ensure backend API + vendor panel UI + (where applicable) storefront UX are all addressed.
3. **Flag hygiene:** any feature-flagged capability must include default state, rollout notes, and fallback UX.
4. **Definition of done:** every item includes API contract notes, UI behavior, and validation commands.

---

## Phase 1 — Capability Baseline Hardening (1 sprint)

### 1) Inventory & Reservations

**Goal:** close the gap between vendor inventory operations and storefront stock visibility/error handling.

**Work items**
- Backend: verify `vendor/inventory-sync` covers create/update/reconcile inventory state transitions and emits traceable events.
- Vendor Panel: add explicit inventory sync status view (last sync, errors, retry action) in inventory area.
- Storefront: replace generic stock error handling with structured user-facing messages mapped to backend error codes.

**Done when**
- Inventory update path has deterministic API responses and error codes.
- Vendor UI shows sync health and retry behavior.
- Storefront displays predictable out-of-stock/backorder messaging.

**AI prompt (implementation)**
```text
You are working in /workspace/free-black-market.
Implement Inventory & Reservations closure across backend, vendor-panel, and storefront.
Constraints:
1) Use existing route/module patterns in backend/src/api/vendor and vendor-panel/src/routes/inventory.
2) Add minimal new abstractions; reuse existing helpers/hooks.
3) Add or update tests near touched code.
4) Update docs/VENDOR_FEATURE_MATRIX.md evidence line for this capability.
Output:
- changed files
- exact validation commands and results
- follow-up risks
```

---

### 2) Delivery Zones

**Goal:** ensure vendor delivery zone management reliably drives storefront eligibility/checkout behavior.

**Work items**
- Backend: validate vendor zone CRUD + check endpoint parity (`store/delivery-zones/check`) and response contract.
- Vendor Panel: improve zone UX for edge cases (overlapping polygons/radius conflicts, disabled zones).
- Storefront: wire delivery-eligibility feedback in cart/checkout flow from zone-check endpoint.

**Done when**
- Delivery zone changes are reflected at checkout without ambiguity.
- Users receive clear “deliverable/non-deliverable” status and next actions.

**AI prompt (implementation)**
```text
Implement Delivery Zones end-to-end closure in this repo.
Start from existing backend/src/api/vendor/delivery-zones and storefront checkout/cart flows.
Deliver:
- contract-aligned payload validation
- vendor-panel UX for conflict handling
- storefront eligibility messaging integration
Also add/update tests and docs evidence entries.
```

---

### 3) Donations

**Goal:** connect donation APIs to clear storefront and vendor operational surfaces.

**Work items**
- Backend: confirm donation config, beneficiary listing, and transparency endpoints are consistent and documented.
- Vendor Panel: expose donation settings/metrics where applicable to vendor types.
- Storefront: add/verify discoverable donation UI entry point and amount/beneficiary flow.

**Done when**
- Customer can find and complete donation flow.
- Vendor has visibility/control (as intended) over donation-related settings and reporting.

**AI prompt (implementation)**
```text
Implement Donations capability closure based on existing endpoints under backend/src/api/store/donations and admin/vendor related surfaces.
Add or connect missing vendor-panel and storefront UI pieces.
Maintain existing style/patterns and provide tests plus docs updates.
```

---

## Phase 2 — Workflow Surface Completion (1–2 sprints)

### 4) Order Cycles / Subscriptions / Seasons
- Add storefront discovery + detail UX for order cycles/seasons.
- Ensure vendor panel workflows map to customer purchase windows.
- Add automated tests for active/inactive cycle gating.

**AI prompt**
```text
Close Order Cycles/Subscriptions/Seasons by wiring storefront-facing pages/components to existing store APIs and validating vendor-panel lifecycle controls.
Include gating tests for active windows and fallback states.
```

### 5) Reviews & Requests
- Clarify separate vs linked lifecycle for reviews and vendor requests.
- Ensure vendor action outcomes propagate to storefront-visible states where intended.
- Add moderation/status-state contract tests.

**AI prompt**
```text
Implement Reviews & Requests completion across backend contracts, vendor workflows, and storefront-visible status rendering.
Preserve current route structure; add tests for status transitions and permissions.
```

### 6) Messaging / Support Chat
- Validate Rocket.Chat integration states (connected, degraded, unavailable).
- Add vendor panel fallback UX for chat outages.
- Decide and implement storefront chat entry policy (if in scope).

**AI prompt**
```text
Harden Messaging/Support capability:
- audit current Rocket.Chat integration points
- add fallback UX for downtime
- implement/confirm storefront chat entry if required by current product behavior
Provide tests or smoke checks and doc evidence updates.
```

---

## Phase 3 — Advanced Vendor Operations (1 sprint)

### 7) Farm Profile & Harvest Workflows
- Ensure farm/harvest changes in vendor panel appear in relevant storefront harvest/product contexts.
- Add data consistency checks between farm profile and harvest entities.

### 8) Invoicing
- Connect invoicing nav extension to concrete screens and backend actions.
- Add invoice lifecycle states (draft/sent/paid/void) if absent.

### 9) POS Mode
- Define MVP scope (cart, payment capture method, receipt/export).
- Either add backend POS API support or formally map POS to existing order endpoints.
- Ensure feature flag defaults and rollout strategy are documented.

**Phase 3 rollout notes (implemented):**
- `VITE_FF_INVOICING_V1` default remains disabled; enable per-vendor cohort after invoice lifecycle smoke checks.
- `VITE_FF_POS_V1` default remains disabled; enable internal pilot first, then expand by vendor type once checkout/payment capture telemetry is green for 7 days.
- Backend gates enforce `INVOICING_V1` and `POS_V1` at `/vendor/invoices*` and `/vendor/pos/*` before broad rollout.

**AI prompt (phase batch)**
```text
Execute Phase 3 vendor operations closure for Farm/Harvest, Invoicing, and POS.
For each capability:
1) confirm backend route/service support,
2) implement vendor-panel UI flow,
3) validate interoperability with existing order/product systems,
4) add tests and update docs/VENDOR_FEATURE_MATRIX.md completion status.
Keep commits scoped by capability.
```

---

## QA & Release Checklist (apply each phase)

1. Type/lint/test/build for touched packages.
2. Contract smoke checks for touched APIs.
3. Role/permission validation for vendor vs customer vs admin.
4. Update docs evidence:
   - `docs/VENDOR_FEATURE_MATRIX.md`
   - this workplan file (mark item status)

**AI prompt (QA pass)**
```text
Run a QA closure pass for completed capability work.
Return:
- commands executed
- pass/fail per command
- any environment limitations
- files updated for evidence
If a capability lacks end-to-end evidence, mark it partial and state exact missing artifact.
```


### Phase 3 QA Checklist Status (latest pass)
### Gap closure evidence (automated route-flow tests)
Runtime in-app integration smoke attempt:
- Added `backend/integration-tests/http/phase3-vendor-ops-authz.spec.ts` to validate unauthenticated seller-route protection for farm harvests, invoices, and POS endpoints with feature flags enabled.
- Current environment limitation: Medusa integration runner requires database connectivity for in-app boot; local run failed before request assertions due DB initialization/connect errors.

- Farm/Harvest → Storefront propagation: `backend/src/api/vendor/__tests__/farm-provenance-flow.unit.spec.ts` validates harvest consistency rejection and storefront provenance `consistency_issues` payload.
- Invoicing lifecycle persistence flow: `backend/src/api/vendor/__tests__/invoices-route.unit.spec.ts` validates create → list → patch lifecycle through seller-metadata-backed storage behavior.
- POS checkout receipt flow: `backend/src/api/vendor/__tests__/pos-checkout-route.unit.spec.ts` validates checkout capture response and receipt export payload shape.

- [x] Type/lint/test/build run for touched packages (`backend`, `vendor-panel`).
- [x] Contract smoke checks run for touched APIs (`/vendor/invoices*`, `/vendor/pos/*`, farm/harvest consistency and phase0 invoice schema tests).
- [x] Role/permission validation verified at middleware layer (seller auth + feature gates for invoicing and POS).
- [x] Docs evidence updated in `docs/VENDOR_FEATURE_MATRIX.md` and this workplan file.

## Suggested Execution Order

1. Inventory & Delivery Zones
2. Donations + Messaging
3. Order Cycles + Reviews/Requests
4. Farm/Harvest + Invoicing
5. POS finalization

Rationale: this order prioritizes checkout-impacting and operations-critical flows first, then expands into advanced modules.
