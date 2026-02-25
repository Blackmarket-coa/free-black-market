# Work Order: Hermes Vendor Runtime Integration (End-to-End)

- **Work Order ID:** WO-2026-02-HERMES-VENDOR-RUNTIME
- **Status:** Proposed
- **Priority:** P1 (vendor-facing capability enablement)
- **Related WOs:** `WO-2026-02-HERMES-PROMPT`, `WO-2026-02-HERMES-WIRING`

## Objective

Connect the existing Hermes prompt/runtime validation layer to an actual vendor-facing runtime path (vendor-panel -> backend endpoint -> AI orchestrator), then validate end-to-end behavior for vendor onboarding and product-draft flows.

## Current state summary

Implemented:
- Canonical prompt artifact and LangGraph supervisor entrypoint wiring exist.
- Schema and destructive-action safeguards are covered by tests.

Gap:
- No concrete vendor runtime route wiring found for Hermes invocation in backend/vendor-panel source during repository scan.

## Scope

### In scope

1. Define and implement backend vendor AI endpoint(s) that invoke ai-orchestrator LangGraph supervisor runtime.
2. Wire vendor-panel UI action(s) to the backend vendor AI endpoint(s).
3. Register vendor-safe tools/schemas exposed to Hermes for onboarding/product workflows.
4. Add integration tests for request/response contracts and safety regressions.
5. Add release validation step covering vendor Hermes path.

### Out of scope

1. Rewriting Hermes prompt copy.
2. Changing unrelated vendor messaging systems (e.g., Rocket.Chat pathways).

## Implementation tasks

| Task | Owner | Exit Criteria |
| --- | --- | --- |
| Add vendor AI backend route and orchestration call | AI Platform Eng + Backend Eng | Vendor-authenticated endpoint invokes supervisor entrypoint with tool registry |
| Wire vendor-panel UI to backend route | Vendor FE Eng | Vendor action can trigger AI assist and render conversational/tool responses |
| Define vendor tool registry contract | AI Platform Eng | `create_vendor`/`create_product` and related safe tools mapped with schema |
| Add integration tests (backend + contract) | QA + Platform Eng | Tests cover happy path + missing-required params + destructive confirmation failures |
| Add release validation command for vendor path | Release Eng | CI gate runs vendor Hermes integration checks |

## Acceptance criteria

1. Vendor can initiate Hermes-assisted onboarding and product-draft workflows from vendor panel.
2. Backend route enforces schema validation and destructive confirmation rules via supervisor entrypoint.
3. Integration tests confirm behavior for valid and invalid payload paths.
4. Release playbook includes vendor Hermes validation command(s).

## Validation checklist

- [ ] Backend vendor AI endpoint exists and is authenticated.
- [ ] Endpoint calls ai-orchestrator runtime entrypoint.
- [ ] Vendor-panel initiates calls to endpoint and handles response modes correctly.
- [ ] Integration tests pass in CI for vendor Hermes flows.
- [ ] Release docs include this WO and validation command.
