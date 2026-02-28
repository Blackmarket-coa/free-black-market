import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { LEDGER_MODULE } from "../modules/ledger";
import LedgerModuleService from "../modules/ledger/service";
import { LedgerEventType } from "../modules/ledger/types";
import { firstDefined, toAmount } from "./ledger-utils";

type OrderRefundEvent = {
  id: string;
  refund_id?: string;
  refund_amount?: number;
  amount?: number;
  currency_code?: string;
  metadata?: Record<string, unknown>;
  sales_channel_id?: string;
};

export default async function ledgerOrderRefundCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderRefundEvent>) {
  const ledgerService = container.resolve(LEDGER_MODULE) as LedgerModuleService;

  await ledgerService.recordEvent({
    storefront_id: String(firstDefined(data.metadata?.storefront_id, data.sales_channel_id, "default")),
    event_type: LedgerEventType.REFUND_ISSUED,
    amount: toAmount(firstDefined(data.refund_amount, data.amount), 0),
    currency_code: data.currency_code || "usd",
    reference_id: data.id,
    metadata: {
      source: "order_refund",
      refund_id: data.refund_id,
    },
  });
}

export const config: SubscriberConfig = {
  event: "order.refund_created",
};
