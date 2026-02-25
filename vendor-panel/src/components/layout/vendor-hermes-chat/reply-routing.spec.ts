import { describe, expect, it } from "vitest"

import { getGeneralAssistantReply, isProductDraftRequest } from "./reply-routing"

describe("reply-routing", () => {
  it("does not classify 'this' as greeting via partial 'hi' match", () => {
    const reply = getGeneralAssistantReply("how does this work?", [])

    expect(reply).toBe(
      "Yes — I can answer general questions, continue contextual conversations, and help with logistics, supply and demand, finance, market analysis, business recommendations, plus product draft payload validation."
    )
  })

  it("returns upload guidance for generic upload questions", () => {
    const reply = getGeneralAssistantReply("how do I upload?", [])

    expect(reply).toContain("You can upload from the relevant form in vendor panel")
  })

  it("returns media-specific upload guidance when prior context is product related", () => {
    const reply = getGeneralAssistantReply("how do I upload?", [
      { role: "user", content: "I need help with a product listing" },
    ])

    expect(reply).toContain("You can upload photos from your product form")
  })

  it("matches product draft requests on phrase boundaries", () => {
    expect(isProductDraftRequest("please help with product draft")).toBe(true)
    expect(isProductDraftRequest("improvisedproductionnotes")).toBe(false)
  })
})
