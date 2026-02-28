import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { LEDGER_MODULE } from "../modules/ledger";
import LedgerModuleService from "../modules/ledger/service";
import { LedgerEventType } from "../modules/ledger/types";
import { firstDefined, toAmount } from "./ledger-utils";

type OrderPlacedEvent = {
  id: string;
  currency_code?: string;
  total?: number;
  summary?: {
    current_order_total?: number;
  };
  metadata?: Record<string, unknown>;
  sales_channel_id?: string;
  region_id?: string;
};

export default async function ledgerOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedEvent>) {
  const ledgerService = container.resolve(LEDGER_MODULE) as LedgerModuleService;

  const total = toAmount(firstDefined(data.total, data.summary?.current_order_total), 0);
  const platformFee = toAmount(data.metadata?.platform_fee_total, total * 0.1);
  const donationAmount = toAmount(data.metadata?.donation_total, 0);
  const vendorPayout = toAmount(
    data.metadata?.vendor_payout_total,
    Math.max(total - platformFee - donationAmount, 0)
  );

  const storefrontId = String(
    firstDefined(data.metadata?.storefront_id, data.sales_channel_id, data.region_id, "default")
  );

  await ledgerService.recordEvents([
    {
      storefront_id: storefrontId,
      event_type: LedgerEventType.ORDER_CAPTURED,
      amount: total,
      currency_code: data.currency_code || "usd",
      reference_id: data.id,
      metadata: {
        source: "checkout",
      },
    },
    {
      storefront_id: storefrontId,
      event_type: LedgerEventType.PLATFORM_FEE_ASSESSED,
      amount: platformFee,
      currency_code: data.currency_code || "usd",
      reference_id: data.id,
      metadata: {
        source: "checkout",
      },
    },
    {
      storefront_id: storefrontId,
      event_type: LedgerEventType.VENDOR_PAYOUT_ACCRUED,
      amount: vendorPayout,
      currency_code: data.currency_code || "usd",
      reference_id: data.id,
      metadata: {
        source: "checkout",
      },
    },
    {
      storefront_id: storefrontId,
      event_type: LedgerEventType.DONATION_ACCRUED,
      amount: donationAmount,
      currency_code: data.currency_code || "usd",
      reference_id: data.id,
      metadata: {
        source: "checkout",
      },
    },
  ]);
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
