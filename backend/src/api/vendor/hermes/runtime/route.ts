import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  buildVendorHermesSupervisor,
  type DestructiveConfirmationState,
  type ToolCall,
} from "../../../../lib/hermes/runtime-supervisor";

interface AuthContext {
  actor_id?: string;
}

interface VendorHermesRuntimeRequestBody {
  tool_call?: ToolCall;
  chat_message?: string;
  history?: Array<{
    role: "assistant" | "user";
    content: string;
  }>;
  confirmation?: Partial<DestructiveConfirmationState>;
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

  const { tool_call: toolCall, chat_message: chatMessage, history, confirmation } =
    (req.body ?? {}) as VendorHermesRuntimeRequestBody;

  if (typeof chatMessage === "string" && chatMessage.trim().length > 0) {
    const token = process.env.HUGGINGFACE_API_TOKEN;

    if (!token) {
      return res.status(503).json({
        mode: "chat",
        ok: false,
        errors: [
          "Hermes chat is not configured. Set HUGGINGFACE_API_TOKEN on the backend runtime.",
        ],
      });
    }

    const userContent = chatMessage.trim();
    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (entry) =>
              entry &&
              (entry.role === "assistant" || entry.role === "user") &&
              typeof entry.content === "string",
          )
          .slice(-6)
      : [];

    const messages = [
      {
        role: "system",
        content:
          "You are Hermes, a pragmatic vendor assistant. Give concise, actionable guidance for marketplace operations, finance, logistics, and business strategy.",
      },
      ...safeHistory,
      {
        role: "user",
        content: userContent,
      },
    ];

    try {
      const response = await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "NousResearch/Hermes-4.3-36B",
            messages,
            max_tokens: 450,
            temperature: 0.4,
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: { message?: string };
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      if (!response.ok) {
        return res.status(502).json({
          mode: "chat",
          ok: false,
          errors: [
            payload?.error?.message ||
              "Hermes upstream chat provider returned an error.",
          ],
        });
      }

      const assistantMessage = payload.choices?.[0]?.message?.content?.trim();

      if (!assistantMessage) {
        return res.status(502).json({
          mode: "chat",
          ok: false,
          errors: ["Hermes chat provider returned an empty response."],
        });
      }

      return res.status(200).json({
        mode: "chat",
        ok: true,
        assistant_message: assistantMessage,
      });
    } catch (error) {
      return res.status(502).json({
        mode: "chat",
        ok: false,
        errors: [
          error instanceof Error
            ? error.message
            : "Hermes chat request failed unexpectedly.",
        ],
      });
    }
  }

  if (!toolCall) {
    return res.status(400).json({
      mode: "tool",
      ok: false,
      errors: ["Either chat_message or tool_call is required."],
    });
  }

  const supervisor = buildVendorHermesSupervisor();
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
