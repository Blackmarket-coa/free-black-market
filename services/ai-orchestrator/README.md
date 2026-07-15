# AI Orchestrator

The LangGraph-based AI agent service for
[Free Black Market](../../README.md) (FBM), internally codenamed **Hermes**.
It provides a supervisor agent and a vendor tool registry for AI-assisted
vendor workflows.

## Layout

- `prompts/system.prompt.ts` — the versioned master system prompt (validated
  by `pnpm validate:hermes-prompt` from the repo root).
- `langgraph/supervisor-agent.entrypoint.ts` — supervisor agent entrypoint,
  including tool-call schema validation and destructive-action confirmation
  gating.
- `langgraph/vendor-tool-registry.ts` — the registry of vendor-facing tools
  the agent may call.

## Testing

From the repo root:

```bash
pnpm validate:hermes-prompt      # prompt contract validation
pnpm test:hermes-vendor-suite    # supervisor entrypoint + vendor runtime contract tests
```
