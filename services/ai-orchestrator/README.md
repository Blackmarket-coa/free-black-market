# AI Orchestrator

Guardrail code for the vendor AI assistant on
[Free Black Market](../../README.md) (FBM), internally codenamed **Hermes**:
the versioned master system prompt, a tool-call schema validator, and a
destructive-action confirmation checker, with tests.

Despite the `langgraph/` directory and function names, it is not a running
agent: there is no `package.json`, no LangGraph (or other agent-framework)
dependency, no model call, and no deployment, and no app imports it. The live
vendor endpoint, `POST /vendor/hermes/runtime` in the backend, uses its own
copy of the validator and tool schemas
(`backend/src/lib/hermes/runtime-supervisor.ts`): it only validates tool calls
(it does not execute them) and forwards `chat_message` requests to the
OpenAI-compatible or n8n endpoint set by `HERMES_CHAT_*` in
`backend/.env.template`.

## Layout

- `prompts/system.prompt.ts` — the versioned master system prompt (validated
  by `pnpm validate:hermes-prompt` from the repo root).
- `langgraph/supervisor-agent.entrypoint.ts` —
  `buildLangGraphSupervisorEntrypoint`, which pairs the prompt with a model
  name string and returns `validateToolCall` (required fields, primitive
  types, `additionalProperties`) and `canExecuteDestructiveAction` (explicit
  intent, impact summary, confirmation turn, re-confirmation after a scope
  change).
- `langgraph/vendor-tool-registry.ts` — the vendor-safe tool schemas
  (`create_vendor`, `create_product`, `delete_product`).

## Testing

From the repo root:

```bash
pnpm validate:hermes-prompt      # prompt contract validation
pnpm test:hermes-vendor-suite    # entrypoint + vendor runtime contract tests
```
