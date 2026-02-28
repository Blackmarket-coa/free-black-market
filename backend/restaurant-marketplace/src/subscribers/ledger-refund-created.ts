import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { LEDGER_MODULE } from "../modules/ledger";
import LedgerModuleService from "../modules/ledger/service";
import { LedgerEventType } from "../modules/ledger/types";
import { firstDefined, toAmount } from "./ledger-utils";

type RefundEvent = {
  id: string;
  amount?: number;
  currency_code?: string;
  order_id?: string;
  metadata?: Record<string, unknown>;
  sales_channel_id?: string;
};

async function handleRefund(data: RefundEvent, container: SubscriberArgs["container"]) {
  const ledgerService = container.resolve(LEDGER_MODULE) as LedgerModuleService;
  const storefrontId = String(
    firstDefined(data.metadata?.storefront_id, data.sales_channel_id, "default")
  );

  await ledgerService.recordEvent({
    storefront_id: storefrontId,
    event_type: LedgerEventType.REFUND_ISSUED,
    amount: toAmount(data.amount, 0),
    currency_code: data.currency_code || "usd",
    reference_id: data.order_id || data.id,
    metadata: {
      source: "refund",
      refund_id: data.id,
    },
  });
}

export default async function ledgerRefundCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<RefundEvent>) {
  await handleRefund(data, container);
}

export const config: SubscriberConfig = {
  event: "payment.refund_created",
};
