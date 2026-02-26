# Release Notes

## 2026-02 Hermes AI integration closure

- Added LangGraph runtime wiring for the canonical Hermes master prompt and supervisor entrypoint contract (`WO-2026-02-HERMES-WIRING`).
- Added vendor-facing Hermes runtime integration from vendor panel through backend runtime endpoint to ai-orchestrator, including integration test coverage (`WO-2026-02-HERMES-VENDOR-RUNTIME`).
- Validation references:
  - `pnpm -s test:hermes-langgraph`
  - `pnpm -s test:hermes-vendor-suite`
