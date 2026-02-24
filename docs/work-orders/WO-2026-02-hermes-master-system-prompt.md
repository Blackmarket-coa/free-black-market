# Work Order: Hermes 4.3 Master System Prompt Integration

- **Work Order ID:** WO-2026-02-HERMES-PROMPT
- **Status:** Implemented (prompt artifact complete; wiring follow-up ticket prepared)
- **Priority:** P1 (platform capability + safety hardening)
- **Requested by:** Product/AI Operations
- **Target component:** `services/ai-orchestrator/prompts/system.prompt.ts`

## 1) Objective

Operationalize a production-grade master system prompt for Hermes 4.3 in the Free Black Market orchestration layer so that agent behavior is deterministic, schema-safe, and aligned with marketplace operations.

## 2) Scope

### In scope

1. Add a canonical master prompt export in `services/ai-orchestrator/prompts/system.prompt.ts`.
2. Enforce dual response-mode instructions (conversational vs strict JSON tool mode).
3. Encode permission boundaries and destructive-action confirmation rules.
4. Encode domain behaviors for onboarding, product creation, finance, localization, imports, and error translation.
5. Add deterministic hidden-layer constraints for Hermes 4.3 structured outputs.

### Out of scope

1. Implementing runtime tool registry itself.
2. Modifying AI gateway validator.
3. LangGraph node code wiring (handled by follow-up execution ticket).

## 3) Implementation Plan (Improved)

### Phase A — Prompt source of truth

- Create `system.prompt.ts` as typed prompt artifact with named + default exports.
- Keep text copy explicit and diff-friendly (no runtime string builders).

### Phase B — Safety and schema reliability

- Add strict mode switching language to prevent mixed text + JSON outputs.
- Add mandatory pre-tool checks for required params and ID fabrication prevention.
- Add explicit confirmation requirements for destructive operations.

### Phase C — Domain-operational behavior

- Include concrete behavior blocks for:
  - Vendor onboarding completion flow
  - Product draft generation and confirmation gates
  - Financial computations and missing-data questioning
  - Localization + cooperative trade recommendations
  - CSV import validation and confirmation handling
  - Error translation with safe disclosure boundaries

### Phase D — Integration readiness

- Ensure prompt can be imported by orchestration runtime without transformation.
- Ensure content clearly states deterministic/schema-safe behavior for Hermes 4.3.

## 4) Task Breakdown

| Task                                          | Owner                 | Estimate | Dependency              | Exit Criteria                                  |
| --------------------------------------------- | --------------------- | -------: | ----------------------- | ---------------------------------------------- |
| Create prompt module path and exports         | AI Platform Eng       |     0.5d | None                    | File exists, TS export valid                   |
| Encode final prompt content                   | AI Ops + Platform Eng |       1d | Prompt module created   | Prompt includes all required behavior sections |
| Verify formatting and lint viability          | Platform Eng          |    0.25d | Prompt content complete | No syntax or formatting errors                 |
| Prepare orchestration wiring follow-up ticket | AI Platform PM        |    0.25d | Prompt finalized        | Ticket references this WO and import path      |

## 5) Acceptance Criteria

1. `services/ai-orchestrator/prompts/system.prompt.ts` exists and exports the complete prompt text.
2. Prompt includes strict two-mode response contract and explicit no-mixing rule.
3. Prompt includes tool-calling constraints and destructive action confirmation requirements.
4. Prompt includes domain behaviors for onboarding, products, image input, finance, localization, import, and error handling.
5. Prompt includes hidden deterministic layer instructions for Hermes 4.3 JSON compliance.

## 6) Validation Checklist

- [x] File path and exports compile in TypeScript context (validated via `npx -p typescript tsc --noEmit services/ai-orchestrator/prompts/system.prompt.ts`).
- [x] Prompt text is plain and unambiguous (no contradictory instructions).
- [x] JSON-mode examples are syntactically valid JSON snippets (validated in `docs/work-orders/WO-2026-02-hermes-prompt-validation.md`).
- [x] No instructions violate gateway permission model (validated in `docs/work-orders/WO-2026-02-hermes-prompt-validation.md`).
- [x] Follow-up LangGraph wiring ticket created: `docs/work-orders/WO-2026-02-hermes-wiring.md`.

## 7) Risks and Mitigations

1. **Risk:** Prompt drift between docs and runtime.
   - **Mitigation:** Treat this file as canonical source; reference it directly in orchestration nodes.
2. **Risk:** Model mixes text and JSON in edge cases.
   - **Mitigation:** Strong no-mix rule + gateway-side schema enforcement.
3. **Risk:** Overly broad tool assumptions.
   - **Mitigation:** Prompt limits actions to runtime registry-defined tools only.

## 8) Follow-up Work Order (Recommended)

Created `WO-2026-02-HERMES-WIRING` (see `docs/work-orders/WO-2026-02-hermes-wiring.md`) to:

1. Inject this prompt into LangGraph supervisor/agent entrypoint.
2. Add JSON-schema conformance tests for tool-call responses.
3. Add regression tests for destructive-action confirmation flow.

## 9) Definition of Done

- Prompt artifact merged to default branch.
- Work order accepted by AI Platform owner.
- Follow-up wiring ticket created and linked: `docs/work-orders/WO-2026-02-hermes-wiring.md`.
