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

type RuntimeTransport =
  | "openai_compatible"
  | "n8n_webhook"
  | "railway_n8n_workers";

const DEFAULT_CONFIRMATION: DestructiveConfirmationState = {
  explicitIntentInCurrentThread: false,
  impactSummarized: false,
  explicitConfirmationTurn: false,
  scopeChangedAfterConfirmation: false,
  reconfirmedAfterScopeChange: false,
};

const HERMES_SYSTEM_MESSAGE =
  "You are Hermes, a pragmatic vendor assistant. Give concise, actionable guidance for marketplace operations, finance, logistics, and business strategy.";

const unwrapN8nEnvelope = (payload: unknown): unknown => {
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0];
    if (first && typeof first === "object" && "json" in first) {
      const json = (first as { json?: unknown }).json;
      if (json) {
        return json;
      }
    }

    return first;
  }

  return payload;
};

const extractAssistantMessage = (payload: unknown): string | undefined => {
  const normalizedPayload = unwrapN8nEnvelope(payload);

  if (!normalizedPayload || typeof normalizedPayload !== "object") {
    return undefined;
  }

  const openAiChoice = (normalizedPayload as {
    choices?: Array<{ message?: { content?: string } }>;
  }).choices?.[0]?.message?.content;

  if (typeof openAiChoice === "string" && openAiChoice.trim()) {
    return openAiChoice.trim();
  }

  const assistantMessage = (normalizedPayload as { assistant_message?: string })
    .assistant_message;
  if (typeof assistantMessage === "string" && assistantMessage.trim()) {
    return assistantMessage.trim();
  }

  const output = (normalizedPayload as { output?: string }).output;
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }

  const message = (normalizedPayload as { message?: string }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  const dataMessage = (normalizedPayload as { data?: { assistant_message?: string } })
    .data?.assistant_message;
  if (typeof dataMessage === "string" && dataMessage.trim()) {
    return dataMessage.trim();
  }

  return undefined;
};

const extractErrorMessage = (payload: unknown): string | undefined => {
  const normalizedPayload = unwrapN8nEnvelope(payload);

  if (!normalizedPayload || typeof normalizedPayload !== "object") {
    return undefined;
  }

  const errorMessage = (normalizedPayload as { error?: { message?: string } }).error
    ?.message;

  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage.trim();
  }

  const message = (normalizedPayload as { message?: string }).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
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
    const runtimeWebhookSecret = process.env.HERMES_CHAT_WEBHOOK_SECRET?.trim();
    const runtimeTransportRaw =
      (process.env.HERMES_CHAT_TRANSPORT?.trim() as RuntimeTransport | undefined) ||
      "openai_compatible";
    const runtimeTransport: RuntimeTransport =
      runtimeTransportRaw === "railway_n8n_workers"
        ? "n8n_webhook"
        : runtimeTransportRaw;

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

    if (runtimeWebhookSecret) {
      headers["X-Hermes-Webhook-Secret"] = runtimeWebhookSecret;
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
            source: "vendor_panel",
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

      const responseText = await response.text();
      let payload: unknown = {};

      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { message: responseText };
      }

      if (!response.ok) {
        return res.status(502).json({
          mode: "chat",
          ok: false,
          errors: [
            extractErrorMessage(payload) ||
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
