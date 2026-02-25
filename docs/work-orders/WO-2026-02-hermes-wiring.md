# Work Order: Hermes 4.3 Prompt Runtime Wiring + Conformance Validation

- **Work Order ID:** WO-2026-02-HERMES-WIRING
- **Status:** Implemented (runtime wiring + validation complete; awaiting release-process closure)
- **Priority:** P1 (runtime reliability + safety enforcement)
- **Related WO:** `WO-2026-02-HERMES-PROMPT`
- **Source artifact:** `services/ai-orchestrator/prompts/system.prompt.ts`

## Objective

Wire the finalized Hermes 4.3 master prompt artifact into orchestration runtime entrypoints without transformation, then validate schema-safe tool response behavior and destructive-action confirmation gates in automated tests.

## Scope

### In scope

1. Import `FBM_HERMES_MASTER_SYSTEM_PROMPT` (or `FBM_HERMES_MASTER_SYSTEM_PROMPT_TEXT`) directly in orchestration runtime entrypoint(s).
2. Remove any runtime prompt rewriting/template expansion in the integration path.
3. Add JSON schema-conformance tests for tool invocation mode responses.
4. Add regression tests for destructive-action confirmation gating.
5. Document import path and runtime contract in orchestration module docs.

### Out of scope

1. Rewriting prompt copy content (already finalized in source artifact).
2. Changes to gateway permission enforcement internals.
3. Model provider migration.

## Implementation Tasks

| Task | Owner | Estimate | Dependency | Exit Criteria |
| --- | --- | ---: | --- | --- |
| Wire prompt artifact into runtime entrypoint | AI Platform Eng | 0.5d | Hermes prompt artifact merged | Runtime imports prompt from `services/ai-orchestrator/prompts/system.prompt.ts` directly |
| Remove/disable runtime prompt mutation path | AI Platform Eng | 0.25d | Entry-point wiring complete | No transformation logic remains in prompt load path |
| Add tool-mode schema conformance tests | QA + Platform Eng | 0.75d | Prompt wiring complete | Test suite fails on non-JSON or schema-invalid tool payloads |
| Add destructive-action confirmation regression tests | QA + Platform Eng | 0.5d | Prompt wiring complete | Tests verify explicit confirmation + re-confirm on scope change |
| Publish integration note in runtime docs | AI Platform PM | 0.25d | Tests passing | Docs include import path and contract reference to WO-2026-02-HERMES-PROMPT |

## Acceptance Criteria

1. Runtime consumes prompt artifact without transformation.
2. Tool-invocation responses are validated as strict JSON payloads in tests.
3. Required-parameter and ID-fabrication guardrails are covered by regression tests.
4. Destructive-action confirmation flow is covered by regression tests.
5. Documentation links this WO and the canonical prompt source path.

## Validation Checklist

- [x] Runtime import path points directly to `services/ai-orchestrator/prompts/system.prompt.ts` (via `services/ai-orchestrator/langgraph/supervisor-agent.entrypoint.ts`).
- [x] No runtime wrapper mutates mode/safety/schema prompt semantics (entrypoint injects canonical prompt verbatim).
- [x] Schema-conformance tests added and passing locally (`pnpm -s test:hermes-langgraph`).
- [x] Destructive-confirmation regression tests added and passing locally (`pnpm -s test:hermes-langgraph`).
- [x] Docs updated with integration contract + related WO links (`WO-2026-02-hermes-master-system-prompt.md`, `WO-2026-02-hermes-prompt-validation.md`).

## Definition of Done

- Wiring PR merged to default branch.
- CI green for new conformance/regression tests.
- Runtime docs updated.
- WO-2026-02-HERMES-WIRING linked from WO-2026-02-HERMES-PROMPT and release notes.
