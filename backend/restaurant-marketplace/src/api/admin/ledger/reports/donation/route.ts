import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { LEDGER_MODULE } from "../../../../../modules/ledger";
import LedgerModuleService from "../../../../../modules/ledger/service";
import { parseDateRange, parseStorefront } from "../../_utils/ledger-request";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const ledgerService = req.scope.resolve(LEDGER_MODULE) as LedgerModuleService;
  const { startDate, endDate } = parseDateRange(req);
  const storefrontId = parseStorefront(req);

  const csv = await ledgerService.buildCsvReport("donation", {
    storefront_id: storefrontId,
    start_date: startDate,
    end_date: endDate,
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=donation-report.csv");
  return res.status(200).send(csv);
}
