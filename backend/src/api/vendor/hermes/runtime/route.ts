import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  buildLangGraphSupervisorEntrypoint,
  type DestructiveConfirmationState,
  type ToolCall,
} from "../../../../../../services/ai-orchestrator/langgraph/supervisor-agent.entrypoint";
import { VENDOR_SAFE_TOOL_SCHEMAS } from "../../../../../../services/ai-orchestrator/langgraph/vendor-tool-registry";

interface AuthContext {
  actor_id?: string;
}

const DEFAULT_CONFIRMATION: DestructiveConfirmationState = {
  explicitIntentInCurrentThread: false,
  impactSummarized: false,
  explicitConfirmationTurn: false,
  scopeChangedAfterConfirmation: false,
  reconfirmedAfterScopeChange: false,
};

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const authContext = (req as MedusaRequest & { auth_context?: AuthContext })
    .auth_context;

  if (!authContext?.actor_id) {
    return res.status(401).json({
      message: "Unauthorized - seller authentication required",
      type: "unauthorized",
    });
  }

  const { tool_call: toolCall, confirmation } = req.body as {
    tool_call: ToolCall;
    confirmation?: Partial<DestructiveConfirmationState>;
  };

  const supervisor = buildLangGraphSupervisorEntrypoint(
    VENDOR_SAFE_TOOL_SCHEMAS,
  );
  const validation = supervisor.validateToolCall(toolCall);

  if (!validation.ok) {
    return res.status(400).json({
      mode: "tool",
      ok: false,
      errors: validation.errors,
    });
  }

  const destructive = supervisor.canExecuteDestructiveAction(toolCall.action, {
    ...DEFAULT_CONFIRMATION,
    ...confirmation,
  });

  if (!destructive.ok) {
    return res.status(400).json({
      mode: "tool",
      ok: false,
      errors: destructive.errors,
    });
  }

  return res.status(200).json({
    mode: "tool",
    ok: true,
    tool_call: toolCall,
    assistant_message: `Hermes validated ${toolCall.action} for vendor runtime execution.`,
  });
}
