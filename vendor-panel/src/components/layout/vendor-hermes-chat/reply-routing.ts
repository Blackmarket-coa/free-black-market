interface ChatMessageLike {
  role: "assistant" | "user"
  content: string
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const hasPhrase = (text: string, phrase: string) => {
  const matcher = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i")
  return matcher.test(text)
}

const includesAnyPhrase = (text: string, phrases: string[]) =>
  phrases.some((phrase) => hasPhrase(text, phrase))

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

export const isProductDraftRequest = (question: string) => {
  return includesAnyPhrase(question, PRODUCT_DRAFT_KEYWORDS)
}

export const getGeneralAssistantReply = (
  question: string,
  history: ChatMessageLike[]
) => {
  const previousUserMessage = [...history]
    .reverse()
    .find((message) => message.role === "user")
    ?.content

  if (
    hasPhrase(question, "upload") &&
    (includesAnyPhrase(question, ["photo", "photos", "image", "images"]) ||
      includesAnyPhrase(previousUserMessage ?? "", ["product", "listing"]))
  ) {
    return "You can upload photos from your product form: open Products, create or edit a product, then go to the Media section and select Upload images. You can add multiple photos, reorder them, and mark one as the thumbnail before saving."
  }

  if (hasPhrase(question, "upload")) {
    return "You can upload from the relevant form in vendor panel (for products, use the Media section). If you tell me what you want to upload—images, CSV, or documents—I can give exact steps."
  }

  if (includesAnyPhrase(question, ["hello", "hi", "hey", "how are you"])) {
    return "Hi! I’m doing great and ready to help. Ask me anything about operations, finance, market strategy, or product listings, and I’ll keep the conversation contextual."
  }

  if (includesAnyPhrase(question, ["logistics", "shipping", "fulfillment", "delivery"])) {
    return "Absolutely. I can help with logistics planning, shipping profiles, fulfillment workflows, and delivery operations. Share your current setup and constraints, and I can suggest practical next steps."
  }

  if (includesAnyPhrase(question, ["supply", "demand", "inventory", "stock"])) {
    return "Yes — I can help with supply-and-demand questions, including inventory balancing, stock planning, and demand signals. If you provide your product type and sales patterns, I can recommend an approach."
  }

  if (
    includesAnyPhrase(question, [
      "finance",
      "financial",
      "margin",
      "profit",
      "cash flow",
      "payout",
      "payment",
    ])
  ) {
    return "I can help with business finance topics such as pricing, margin checks, payout and cash-flow planning, and break-even thinking. If you share numbers, I can walk through a structured analysis."
  }

  if (includesAnyPhrase(question, ["market", "competition", "trend", "positioning"])) {
    return "I can support market analysis too: competitor comparisons, trend interpretation, positioning ideas, and opportunity sizing. Tell me your target customer and category for more specific guidance."
  }

  if (includesAnyPhrase(question, ["recommend", "strategy", "business", "growth"])) {
    return "Yes — I can provide practical business recommendations across operations, pricing, product mix, and growth strategy. Share your goals, timeline, and constraints so I can tailor the advice."
  }

  return "Yes — I can answer general questions, continue contextual conversations, and help with logistics, supply and demand, finance, market analysis, business recommendations, plus product draft payload validation."
}
