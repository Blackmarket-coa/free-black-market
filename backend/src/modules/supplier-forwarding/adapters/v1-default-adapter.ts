import { SupplierApiForwardingPayload, SupplierForwardingAdapter } from "./types"

export class V1DefaultSupplierForwardingAdapter implements SupplierForwardingAdapter {
  id = "v1-default"

  async forwardOrder(
    payload: SupplierApiForwardingPayload,
    options: { apiBaseUrl: string; apiKey?: string | null }
  ): Promise<{ external_reference?: string | null }> {
    const res = await fetch(`${options.apiBaseUrl.replace(/\/$/, "")}/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Supplier API forwarding failed (${res.status}): ${body}`)
    }

    const body = (await res.json()) as { external_reference?: string }
    return { external_reference: body.external_reference }
  }
}
