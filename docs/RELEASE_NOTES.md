# Release Notes

## 2026-02 Hermes AI integration closure

- Added LangGraph runtime wiring for the canonical Hermes master prompt and supervisor entrypoint contract (`WO-2026-02-HERMES-WIRING`).
- Added vendor-facing Hermes runtime integration from vendor panel through backend runtime endpoint to ai-orchestrator, including integration test coverage (`WO-2026-02-HERMES-VENDOR-RUNTIME`).
  - Correction (2026-09-25): the backend endpoint uses its own copy of the validator (`backend/src/lib/hermes/runtime-supervisor.ts`) and does not import `services/ai-orchestrator`, which has no LangGraph dependency and makes no model calls.
- Validation references:
  - `pnpm -s test:hermes-langgraph`
  - `pnpm -s test:hermes-vendor-suite`
