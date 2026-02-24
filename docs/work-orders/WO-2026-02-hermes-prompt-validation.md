# Validation Notes: WO-2026-02-HERMES-PROMPT

This note records concrete validation evidence for the WO checklist.

## Checklist Evidence

1. **File path and exports compile in TypeScript context**
   - Command:
     - `npx --yes -p typescript tsc --pretty false --noEmit services/ai-orchestrator/prompts/system.prompt.ts`
   - Result: pass (exit code 0).

2. **Prompt text is plain and unambiguous (no contradictory instructions)**
   - Manual pass over `services/ai-orchestrator/prompts/system.prompt.ts` sections confirmed a single two-mode contract and explicit no-mixing rule with no conflicting fallback paths.

3. **JSON-mode examples are syntactically valid JSON snippets**
   - Command:
     - `node` script to parse representative single-action and multi-action JSON example shapes.
   - Result: pass.

4. **No instructions violate gateway permission model**
   - Command:
     - `node` script assertion of required safety/permission clauses:
       - `You may ONLY call tools defined in the registry exposed at runtime.`
       - `You cannot bypass permission validation.`
       - `Never fabricate IDs, foreign keys, or references.`
       - `Destructive-action confirmation requirements:`
   - Result: pass.

5. **Follow-up LangGraph wiring ticket created**
   - Verified file exists and is linked:
     - `docs/work-orders/WO-2026-02-hermes-wiring.md`

## Canonical Prompt Path

- `services/ai-orchestrator/prompts/system.prompt.ts`

## Follow-up Ticket

- `docs/work-orders/WO-2026-02-hermes-wiring.md`
