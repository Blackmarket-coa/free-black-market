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

type RuntimeTransport = "openai_compatible" | "n8n_webhook";

const DEFAULT_CONFIRMATION: DestructiveConfirmationState = {
  explicitIntentInCurrentThread: false,
  impactSummarized: false,
  explicitConfirmationTurn: false,
  scopeChangedAfterConfirmation: false,
  reconfirmedAfterScopeChange: false,
};

const HERMES_SYSTEM_MESSAGE =
  "You are Hermes, a pragmatic vendor assistant. Give concise, actionable guidance for marketplace operations, finance, logistics, and business strategy.";

const extractAssistantMessage = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const openAiChoice = (payload as {
    choices?: Array<{ message?: { content?: string } }>;
  }).choices?.[0]?.message?.content;

  if (typeof openAiChoice === "string" && openAiChoice.trim()) {
    return openAiChoice.trim();
  }

  const n8nMessage = (payload as { assistant_message?: string }).assistant_message;
  if (typeof n8nMessage === "string" && n8nMessage.trim()) {
    return n8nMessage.trim();
  }

  const output = (payload as { output?: string }).output;
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }

  const message = (payload as { message?: string }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  const dataMessage = (payload as { data?: { assistant_message?: string } }).data
    ?.assistant_message;
  if (typeof dataMessage === "string" && dataMessage.trim()) {
    return dataMessage.trim();
  }

  return undefined;
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
    const userContent = chatMessage.trim();
    const runtimeBaseUrl =
      process.env.HERMES_CHAT_BASE_URL?.trim() || "http://127.0.0.1:11434/v1";
    const runtimeModel =
      process.env.HERMES_CHAT_MODEL?.trim() || "NousResearch/Hermes-4.3-36B";
    const runtimeApiKey = process.env.HERMES_CHAT_API_KEY?.trim();
    const runtimeTransport =
      (process.env.HERMES_CHAT_TRANSPORT?.trim() as RuntimeTransport | undefined) ||
      "openai_compatible";

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
        content: HERMES_SYSTEM_MESSAGE,
      },
      ...safeHistory,
      {
        role: "user",
        content: userContent,
      },
    ];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (runtimeApiKey) {
      headers.Authorization = `Bearer ${runtimeApiKey}`;
    }

    const normalizedBaseUrl = runtimeBaseUrl.replace(/\/$/, "");
    const url =
      runtimeTransport === "n8n_webhook"
        ? normalizedBaseUrl
        : `${normalizedBaseUrl}/chat/completions`;

    const body =
      runtimeTransport === "n8n_webhook"
        ? {
            model: runtimeModel,
            system_prompt: HERMES_SYSTEM_MESSAGE,
            chat_message: userContent,
            history: safeHistory,
            messages,
          }
        : {
            model: runtimeModel,
            messages,
            max_tokens: 450,
            temperature: 0.4,
          };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as {
        error?: { message?: string };
      };

      if (!response.ok) {
        return res.status(502).json({
          mode: "chat",
          ok: false,
          errors: [
            payload?.error?.message ||
              "Hermes chat runtime returned an upstream error.",
          ],
        });
      }

      const assistantMessage = extractAssistantMessage(payload);

      if (!assistantMessage) {
        return res.status(502).json({
          mode: "chat",
          ok: false,
          errors: [
            "Hermes chat runtime returned no assistant message in response payload.",
          ],
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
