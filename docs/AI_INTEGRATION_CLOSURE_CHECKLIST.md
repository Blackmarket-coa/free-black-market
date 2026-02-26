# AI Integration Closure Checklist

This checklist tracks closure steps for Hermes AI integration work in this repository, including the remaining vendor end-to-end wiring gap.

## Scope

- Prompt artifact integration and runtime wiring for Hermes 4.3.
- Tool-schema conformance and destructive-action confirmation enforcement.
- Delivery sign-off artifacts (CI evidence + release-note linkage).

## Canonical implementation evidence

- Prompt source of truth: `services/ai-orchestrator/prompts/system.prompt.ts`
- Runtime wiring entrypoint: `services/ai-orchestrator/langgraph/supervisor-agent.entrypoint.ts`
- Regression/conformance tests: `services/ai-orchestrator/langgraph/supervisor-agent.entrypoint.test.ts`
- Work orders:
  - `docs/work-orders/WO-2026-02-hermes-master-system-prompt.md`
  - `docs/work-orders/WO-2026-02-hermes-wiring.md`
  - `docs/work-orders/WO-2026-02-hermes-vendor-runtime-integration.md`

## Closure checklist

| Status | Item | Owner | Evidence / Command |
| --- | --- | --- | --- |
| ✅ | Prompt artifact imported directly by LangGraph runtime entrypoint (no transformation layer in wiring path). | AI Platform Eng | Code evidence in `services/ai-orchestrator/langgraph/supervisor-agent.entrypoint.ts` |
| ✅ | Tool call schema conformance checks implemented (required fields, type checks, additionalProperties behavior). | AI Platform Eng | `pnpm -s test:hermes-langgraph` |
| ✅ | Destructive-action confirmation gate implemented (intent + impact summary + explicit confirmation + re-confirm when scope changes). | AI Platform Eng | `pnpm -s test:hermes-langgraph` |
| ✅ | Local regression suite for Hermes LangGraph wiring passes. | AI Platform Eng / QA | `pnpm -s test:hermes-langgraph` |
| ✅ | Vendor-panel -> backend -> ai-orchestrator end-to-end Hermes path is implemented and verified. | AI Platform Eng + Vendor FE Eng | `pnpm -s test:hermes-vendor-suite` + `docs/work-orders/WO-2026-02-hermes-vendor-runtime-integration.md` |
| ⬜ | CI run on default branch is green with Hermes LangGraph tests included. | QA / Release | CI job link and passing status |
| ✅ | Release notes include `WO-2026-02-HERMES-WIRING` and `WO-2026-02-HERMES-VENDOR-RUNTIME` linkage. | AI Platform PM / Release | `docs/RELEASE_NOTES.md` Hermes AI integration closure entry |
| ⬜ | Post-merge verification on default branch confirms no drift between prompt artifact and runtime import path. | AI Platform Eng | Re-run `pnpm -s test:hermes-langgraph` on default branch |

## What is still left for overall AI-use closure

1. **Default-branch CI proof for Hermes tests**
   - Capture a green default-branch CI run that includes Hermes suites (`test:hermes-langgraph` and vendor runtime coverage).
2. **Post-merge drift check on default branch**
   - Re-run `pnpm -s test:hermes-langgraph` on default branch after merge and attach evidence.
3. **Close this checklist**
   - Mark the remaining unchecked rows complete once evidence links are attached.

## Recommended closure workflow

1. Implement vendor runtime wiring (`WO-2026-02-HERMES-VENDOR-RUNTIME`).
2. Merge the wiring implementation PR(s).
3. Capture CI evidence for the merge commit(s).
4. Add release note entry referencing `WO-2026-02-HERMES-WIRING` and `WO-2026-02-HERMES-VENDOR-RUNTIME`.
5. Run post-merge smoke validation command:
   - `pnpm -s test:hermes-langgraph`
6. Mark all remaining checklist items complete in this file.

## Optional weekly guardrail

- Add `pnpm -s test:hermes-langgraph` to release candidate validation cadence to detect prompt/runtime drift early.
