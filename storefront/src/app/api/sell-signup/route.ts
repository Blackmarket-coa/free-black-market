import { NextResponse } from "next/server"

// TD-3 stub: captures sell-signup intents before redirect to the
// vendor-panel registration page. Backend persistence + webhook
// emission are still TBD; this route currently logs server-side and
// returns 202 Accepted so the storefront client can fire-and-forget.
//
// Expected request body (validated below):
//   {
//     email: string,
//     store_name: string,
//     selling: string[]
//   }
//
// When the backend contract lands, replace the console.info call with
// a POST to the backend leads endpoint and propagate its status code.
// See docs/AUDIT_DEBT.md row TD-3 for the open decision.

type SellSignupBody = {
  email?: unknown
  store_name?: unknown
  selling?: unknown
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

export async function POST(request: Request) {
  let body: SellSignupBody
  try {
    body = (await request.json()) as SellSignupBody
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  if (
    typeof body.email !== "string" ||
    typeof body.store_name !== "string" ||
    !isStringArray(body.selling)
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  console.info("[sell-signup] captured", {
    email: body.email,
    store_name: body.store_name,
    selling: body.selling,
    submitted_at: new Date().toISOString(),
  })

  return NextResponse.json({ status: "accepted" }, { status: 202 })
}
