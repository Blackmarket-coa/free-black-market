import { ChatBubble, Sparkles } from "@medusajs/icons"
import { Button, Drawer, Heading, IconButton, Text } from "@medusajs/ui"
import { FormEvent, useMemo, useState } from "react"

import { useVendorHermesRuntime } from "../../../hooks/api/hermes"
import { isProductDraftRequest } from "./reply-routing"

interface ChatMessage {
  id: number
  role: "assistant" | "user"
  content: string
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
      try {
        const result = await mutateAsync({
          chat_message: trimmed,
          history: messages.slice(-6).map((message) => ({
            role: message.role,
            content: message.content,
          })),
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
              "I couldn’t generate a Hermes reply right now. Please try again.",
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
            content: `I couldn’t answer that right now: ${message}`,
          },
        ])
      }

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
