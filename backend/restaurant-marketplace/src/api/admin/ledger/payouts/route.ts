import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LEDGER_MODULE } from "../../../../modules/ledger";
import LedgerModuleService from "../../../../modules/ledger/service";
import { LedgerEventType } from "../../../../modules/ledger/types";

type PayoutBody = {
  storefront_id: string;
  amount: number;
  currency_code?: string;
  payout_id?: string;
  occurred_at?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(req: MedusaRequest<PayoutBody>, res: MedusaResponse) {
  const ledgerService = req.scope.resolve(LEDGER_MODULE) as LedgerModuleService;
  const {
    storefront_id,
    amount,
    currency_code = "usd",
    payout_id,
    occurred_at,
    metadata,
  } = req.validatedBody || req.body;

  const event = await ledgerService.recordEvent({
    storefront_id,
    event_type: LedgerEventType.PAYOUT_RELEASED,
    amount,
    currency_code,
    occurred_at: occurred_at ? new Date(occurred_at) : new Date(),
    reference_id: payout_id,
    metadata,
  });

  res.status(200).json({ payout_event: event });
}
