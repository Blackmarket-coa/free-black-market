import { ChatBubble, Sparkles } from "@medusajs/icons"
import { Button, Drawer, Heading, IconButton, Text } from "@medusajs/ui"
import { FormEvent, useMemo, useState } from "react"

import { useVendorHermesRuntime } from "../../../hooks/api/hermes"

interface ChatMessage {
  id: number
  role: "assistant" | "user"
  content: string
}

const PRODUCT_DRAFT_KEYWORDS = [
  "product",
  "draft",
  "listing",
  "catalog",
  "price",
  "inventory",
  "sku",
  "title",
  "description",
]

const isProductDraftRequest = (question: string) => {
  const normalized = question.toLowerCase()
  return PRODUCT_DRAFT_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

const getGeneralAssistantReply = (question: string, history: ChatMessage[]) => {
  const normalized = question.toLowerCase()
  const previousUserMessage = [...history]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.toLowerCase()

  if (
    normalized.includes("upload") &&
    (normalized.includes("photo") ||
      normalized.includes("photos") ||
      normalized.includes("image") ||
      normalized.includes("images") ||
      previousUserMessage?.includes("product") ||
      previousUserMessage?.includes("listing"))
  ) {
    return "You can upload photos from your product form: open Products, create or edit a product, then go to the Media section and select Upload images. You can add multiple photos, reorder them, and mark one as the thumbnail before saving."
  }

  if (
    normalized.includes("hello") ||
    normalized.includes("hi") ||
    normalized.includes("hey") ||
    normalized.includes("how are you")
  ) {
    return "Hi! I’m doing great and ready to help. Ask me anything about operations, finance, market strategy, or product listings, and I’ll keep the conversation contextual."
  }

  if (
    normalized.includes("logistics") ||
    normalized.includes("shipping") ||
    normalized.includes("fulfillment") ||
    normalized.includes("delivery")
  ) {
    return "Absolutely. I can help with logistics planning, shipping profiles, fulfillment workflows, and delivery operations. Share your current setup and constraints, and I can suggest practical next steps."
  }

  if (
    normalized.includes("supply") ||
    normalized.includes("demand") ||
    normalized.includes("inventory") ||
    normalized.includes("stock")
  ) {
    return "Yes — I can help with supply-and-demand questions, including inventory balancing, stock planning, and demand signals. If you provide your product type and sales patterns, I can recommend an approach."
  }

  if (
    normalized.includes("finance") ||
    normalized.includes("financial") ||
    normalized.includes("margin") ||
    normalized.includes("profit") ||
    normalized.includes("cash flow") ||
    normalized.includes("payout") ||
    normalized.includes("payment")
  ) {
    return "I can help with business finance topics such as pricing, margin checks, payout and cash-flow planning, and break-even thinking. If you share numbers, I can walk through a structured analysis."
  }

  if (
    normalized.includes("market") ||
    normalized.includes("competition") ||
    normalized.includes("trend") ||
    normalized.includes("positioning")
  ) {
    return "I can support market analysis too: competitor comparisons, trend interpretation, positioning ideas, and opportunity sizing. Tell me your target customer and category for more specific guidance."
  }

  if (
    normalized.includes("recommend") ||
    normalized.includes("strategy") ||
    normalized.includes("business") ||
    normalized.includes("growth")
  ) {
    return "Yes — I can provide practical business recommendations across operations, pricing, product mix, and growth strategy. Share your goals, timeline, and constraints so I can tailor the advice."
  }

  return "Yes — I can answer general questions, continue contextual conversations, and help with logistics, supply and demand, finance, market analysis, business recommendations, plus product draft payload validation."
}

export const VendorHermesChat = () => {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "Hi! I’m Hermes. I can have general conversation, respond to context, and help with logistics, supply and demand, finance, market analysis, and business strategy — or validate a vendor-safe product draft payload.",
    },
  ])

  const { mutateAsync, isPending } = useVendorHermesRuntime()

  const nextId = useMemo(() => {
    return messages.length
      ? Math.max(...messages.map((message) => message.id)) + 1
      : 1
  }, [messages])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    const trimmed = prompt.trim()

    if (!trimmed || isPending) {
      return
    }

    const userMessage: ChatMessage = {
      id: nextId,
      role: "user",
      content: trimmed,
    }

    setMessages((current) => [...current, userMessage])
    setPrompt("")

    if (!isProductDraftRequest(trimmed)) {
      setMessages((current) => [
        ...current,
        {
          id: userMessage.id + 1,
          role: "assistant",
          content: getGeneralAssistantReply(trimmed, messages),
        },
      ])

      return
    }

    try {
      const result = await mutateAsync({
        tool_call: {
          action: "create_product",
          parameters: {
            title: trimmed.slice(0, 64),
            description: trimmed,
            price: 19.99,
            currency_code: "usd",
            category: "draft",
            inventory_quantity: 10,
          },
        },
      })

      const assistantReply =
        typeof result === "object" && result && "assistant_message" in result
          ? String((result as { assistant_message?: string }).assistant_message ?? "")
          : ""

      setMessages((current) => [
        ...current,
        {
          id: userMessage.id + 1,
          role: "assistant",
          content:
            assistantReply ||
            "Draft payload validated. Share more details if you want a better product draft.",
        },
      ])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Hermes runtime request failed"

      setMessages((current) => [
        ...current,
        {
          id: userMessage.id + 1,
          role: "assistant",
          content: `I couldn’t validate that request: ${message}`,
        },
      ])
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <IconButton
          variant="secondary"
          size="large"
          className="fixed bottom-6 right-6 z-50 rounded-full shadow-elevation-flyout"
          aria-label="Open Hermes assistant"
        >
          <ChatBubble />
        </IconButton>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading>Hermes Assistant</Heading>
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex h-full flex-col gap-y-4 overflow-hidden px-4">
          <Text className="text-ui-fg-subtle">
            Ask general business questions or request product draft validation.
          </Text>

          <div className="bg-ui-bg-subtle border-ui-border-base flex flex-1 flex-col gap-y-2 overflow-y-auto rounded-lg border p-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "bg-ui-bg-component text-ui-fg-base self-end max-w-[85%] rounded-lg px-3 py-2"
                    : "bg-ui-bg-field text-ui-fg-subtle self-start max-w-[85%] rounded-lg px-3 py-2"
                }
              >
                <Text size="small">{message.content}</Text>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-x-2">
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask about logistics, demand, finance, market strategy, or describe a product draft..."
              className="bg-ui-bg-field border-ui-border-base text-ui-fg-base flex-1 rounded-lg border px-3 py-2"
            />
            <Button type="submit" isLoading={isPending}>
              <Sparkles />
              Send
            </Button>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}
