import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LEDGER_MODULE } from "../../../../modules/ledger";
import LedgerModuleService from "../../../../modules/ledger/service";
import { parseDateRange, parseStorefront } from "../_utils/ledger-request";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const ledgerService = req.scope.resolve(LEDGER_MODULE) as LedgerModuleService;
  const { startDate, endDate } = parseDateRange(req);
  const storefrontId = parseStorefront(req);

  const results = await ledgerService.reconcileRange(
    {
      storefront_id: storefrontId,
      start_date: startDate,
      end_date: endDate,
    },
    req.scope
  );

  return res.status(200).json({
    count: results.length,
    results,
  });
}
