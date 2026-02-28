import { MedusaContainer } from "@medusajs/framework/types";
import { LEDGER_MODULE } from "../modules/ledger";
import LedgerModuleService from "../modules/ledger/service";

export default async function ledgerReconciliationJob(container: MedusaContainer) {
  const ledgerService = container.resolve(LEDGER_MODULE) as LedgerModuleService;

  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endDate = new Date();

  const storefronts = process.env.LEDGER_RECONCILIATION_STOREFRONTS
    ? process.env.LEDGER_RECONCILIATION_STOREFRONTS.split(",").map((value) => value.trim())
    : [undefined];

  for (const storefrontId of storefronts) {
    await ledgerService.reconcileRange(
      {
        storefront_id: storefrontId,
        start_date: startDate,
        end_date: endDate,
      },
      container
    );
  }
}

export const config = {
  name: "ledger-reconciliation-job",
  schedule: "0 1 * * *",
};
