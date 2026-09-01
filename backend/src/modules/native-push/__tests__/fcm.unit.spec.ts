import {
  buildFcmMessage,
  isTokenGoneError,
  parseServiceAccount,
} from "../fcm"

describe("parseServiceAccount", () => {
  const valid = {
    project_id: "fbm-test",
    client_email: "sender@fbm-test.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
  }

  it("parses raw JSON", () => {
    expect(parseServiceAccount(JSON.stringify(valid))).toEqual(valid)
  })

  it("parses base64-encoded JSON", () => {
    const encoded = Buffer.from(JSON.stringify(valid)).toString("base64")
    expect(parseServiceAccount(encoded)).toEqual(valid)
  })

  it("returns null for unset, empty, or malformed values", () => {
    expect(parseServiceAccount(undefined)).toBeNull()
    expect(parseServiceAccount(null)).toBeNull()
    expect(parseServiceAccount("")).toBeNull()
    expect(parseServiceAccount("   ")).toBeNull()
    expect(parseServiceAccount("not json")).toBeNull()
    expect(parseServiceAccount("{}")).toBeNull()
  })

  it("rejects service accounts missing any required field", () => {
    const { private_key: _dropped, ...withoutKey } = valid
    expect(parseServiceAccount(JSON.stringify(withoutKey))).toBeNull()
    expect(
      parseServiceAccount(
        JSON.stringify({ ...valid, private_key: "not a pem" })
      )
    ).toBeNull()
  })
})

describe("buildFcmMessage", () => {
  it("wraps token + notification in the v1 envelope", () => {
    expect(
      buildFcmMessage("tok_1", { title: "Order confirmed", body: "Thanks!" })
    ).toEqual({
      message: {
        token: "tok_1",
        notification: { title: "Order confirmed", body: "Thanks!" },
      },
    })
  })

  it("stringifies data values (FCM v1 requires string payloads)", () => {
    const message = buildFcmMessage("tok_1", {
      title: "t",
      body: "b",
      data: { order_id: 42 as unknown as string, path: "/user/orders" },
    })
    expect(
      (message.message as { data: Record<string, string> }).data
    ).toEqual({ order_id: "42", path: "/user/orders" })
  })
})

describe("isTokenGoneError", () => {
  it("treats 404 and UNREGISTERED as a dead token", () => {
    expect(isTokenGoneError(404, "")).toBe(true)
    expect(
      isTokenGoneError(
        410,
        JSON.stringify({ error: { details: [{ errorCode: "UNREGISTERED" }] } })
      )
    ).toBe(true)
    expect(isTokenGoneError(400, '{"error":{"status":"INVALID_ARGUMENT"}}')).toBe(
      true
    )
  })

  it("keeps tokens on transient failures", () => {
    expect(isTokenGoneError(500, "internal")).toBe(false)
    expect(isTokenGoneError(429, "quota")).toBe(false)
    expect(isTokenGoneError(401, "auth")).toBe(false)
  })
})
