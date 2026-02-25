# AI Integration Closure Checklist

This checklist tracks the final closure steps for Hermes AI integration work in this repository.

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

## Closure checklist

| Status | Item | Owner | Evidence / Command |
| --- | --- | --- | --- |
| ✅ | Prompt artifact imported directly by LangGraph runtime entrypoint (no transformation layer in wiring path). | AI Platform Eng | Code evidence in `services/ai-orchestrator/langgraph/supervisor-agent.entrypoint.ts` |
| ✅ | Tool call schema conformance checks implemented (required fields, type checks, additionalProperties behavior). | AI Platform Eng | `pnpm -s test:hermes-langgraph` |
| ✅ | Destructive-action confirmation gate implemented (intent + impact summary + explicit confirmation + re-confirm when scope changes). | AI Platform Eng | `pnpm -s test:hermes-langgraph` |
| ✅ | Local regression suite for Hermes LangGraph wiring passes. | AI Platform Eng / QA | `pnpm -s test:hermes-langgraph` |
| ⬜ | CI run on default branch is green with Hermes LangGraph tests included. | QA / Release | CI job link and passing status |
| ⬜ | Release notes include `WO-2026-02-HERMES-WIRING` linkage. | AI Platform PM / Release | Release notes link and entry snippet |
| ⬜ | Post-merge verification on default branch confirms no drift between prompt artifact and runtime import path. | AI Platform Eng | Re-run `pnpm -s test:hermes-langgraph` on default branch |

## Recommended closure workflow

1. Merge the wiring implementation PR.
2. Capture CI evidence for the merge commit.
3. Add release note entry referencing `WO-2026-02-HERMES-WIRING`.
4. Run post-merge smoke validation command:
   - `pnpm -s test:hermes-langgraph`
5. Mark all remaining checklist items complete in this file.

## Optional weekly guardrail

- Add `pnpm -s test:hermes-langgraph` to release candidate validation cadence to detect prompt/runtime drift early.
