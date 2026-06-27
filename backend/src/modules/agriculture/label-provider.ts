/**
 * Plant Network — provider-agnostic shipping-label seam (Section 6).
 *
 * Buying real postage requires a paid carrier relationship, so there is no OSS
 * drop-in. Rather than hardcode one vendor, fulfillment dispatch talks to this
 * `LabelProvider` interface. The default is a no-op (logs intent, buys nothing);
 * a real EasyPost / Shippo / direct-USPS implementation can be added later and
 * selected via the `PLANT_LABEL_PROVIDER` env var — no change to the fulfillment
 * logic in `node-fulfillment.ts`.
 */

import type { MedusaContainer } from "@medusajs/framework/types"

export interface LabelRequest {
  order_id: string
  seller_id: string
  stock_location_id: string | null
  line_item_ids: string[]
}

export interface LabelResult {
  provider: string
  purchased: boolean
  skipped: boolean
  tracking_number: string | null
  label_url: string | null
  reason?: string
}

export interface LabelProvider {
  readonly name: string
  buyLabel(req: LabelRequest): Promise<LabelResult>
}

/**
 * Default provider: buys nothing, records the intent. Lets the whole dispatch
 * flow run end-to-end in environments without carrier credentials.
 */
export class NoopLabelProvider implements LabelProvider {
  readonly name = "noop"
  async buyLabel(_req: LabelRequest): Promise<LabelResult> {
    return {
      provider: this.name,
      purchased: false,
      skipped: true,
      tracking_number: null,
      label_url: null,
      reason:
        "no label provider configured (set PLANT_LABEL_PROVIDER + carrier credentials)",
    }
  }
}

/**
 * Select the active label provider. Defaults to the no-op. Future real
 * providers register their cases here keyed on PLANT_LABEL_PROVIDER.
 */
export function resolveLabelProvider(_container: MedusaContainer): LabelProvider {
  const which = (process.env.PLANT_LABEL_PROVIDER || "noop").toLowerCase()
  switch (which) {
    // case "easypost": return new EasyPostLabelProvider(_container)
    // case "shippo":   return new ShippoLabelProvider(_container)
    // case "usps":     return new UspsLabelProvider(_container)
    default:
      return new NoopLabelProvider()
  }
}
