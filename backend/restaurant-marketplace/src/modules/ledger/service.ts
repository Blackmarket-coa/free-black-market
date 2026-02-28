import { MedusaService, Modules } from "@medusajs/framework/utils";
import { LedgerEvent } from "./models/ledger-event";
import { ReconciliationAlert } from "./models/reconciliation-alert";
import {
  LedgerEventInput,
  LedgerEventType,
  ReconciliationInput,
  ReconciliationResult,
} from "./types";

type EventBusLike = {
  emit: (payload: { name: string; data?: Record<string, unknown> }) => Promise<void>;
};

class LedgerModuleService extends MedusaService({
  LedgerEvent,
  ReconciliationAlert,
}) {
  async recordEvent(input: LedgerEventInput) {
    return this.createLedgerEvents({
      ...input,
      currency_code: input.currency_code.toLowerCase(),
      occurred_at: input.occurred_at ?? new Date(),
    });
  }

  async recordEvents(inputs: LedgerEventInput[]) {
    return this.createLedgerEvents(
      inputs.map((input) => ({
        ...input,
        currency_code: input.currency_code.toLowerCase(),
        occurred_at: input.occurred_at ?? new Date(),
      }))
    );
  }

  async listEventsForRange(input: ReconciliationInput) {
    const events = await this.listLedgerEvents();

    return events.filter((event) => {
      const occurredAt = new Date(event.occurred_at);
      const inDateRange = occurredAt >= input.start_date && occurredAt <= input.end_date;
      const inStorefront = input.storefront_id
        ? event.storefront_id === input.storefront_id
        : true;

      return inDateRange && inStorefront;
    });
  }

  async reconcileRange(
    input: ReconciliationInput,
    container?: { resolve: (key: string) => unknown }
  ): Promise<ReconciliationResult[]> {
    const events = await this.listEventsForRange(input);
    const storefrontIds = [...new Set(events.map((event) => event.storefront_id))];

    const results = storefrontIds.map((storefront_id) => {
      const storefrontEvents = events.filter((event) => event.storefront_id === storefront_id);
      const totals = this.computeTotals(storefrontEvents);

      const expectedAllocationTotal =
        totals.platform_fee_total + totals.vendor_payout_total + totals.donation_total;
      const netVendorObligation = totals.vendor_payout_total - totals.refund_total;
      const allocationDifference = totals.captured_total - expectedAllocationTotal;
      const obligationDifference = netVendorObligation - totals.payout_released_total;

      const discrepancies: string[] = [];

      if (Math.abs(allocationDifference) > 0.0001) {
        discrepancies.push(
          `Captured total (${totals.captured_total}) does not match allocated total (${expectedAllocationTotal}).`
        );
      }

      if (Math.abs(obligationDifference) > 0.0001) {
        discrepancies.push(
          `Net vendor obligation (${netVendorObligation}) does not match released payouts (${totals.payout_released_total}).`
        );
      }

      return {
        storefront_id,
        start_date: input.start_date,
        end_date: input.end_date,
        ...totals,
        expected_allocation_total: expectedAllocationTotal,
        net_vendor_obligation: netVendorObligation,
        allocation_difference: allocationDifference,
        obligation_difference: obligationDifference,
        discrepancies,
      };
    });

    if (container) {
      await this.createAlertsForFailures(results, container);
    }

    return results;
  }

  async buildCsvReport(
    type: "payout" | "fee" | "donation" | "tax",
    input: ReconciliationInput
  ) {
    const events = await this.listEventsForRange(input);

    const allowedTypes: Record<typeof type, LedgerEventType[]> = {
      payout: [LedgerEventType.VENDOR_PAYOUT_ACCRUED, LedgerEventType.PAYOUT_RELEASED],
      fee: [LedgerEventType.PLATFORM_FEE_ASSESSED],
      donation: [LedgerEventType.DONATION_ACCRUED],
      tax: [LedgerEventType.ORDER_CAPTURED],
    };

    const filtered = events.filter((event) => allowedTypes[type].includes(event.event_type));

    const rows = [
      "event_id,storefront_id,event_type,amount,currency_code,occurred_at,reference_id",
      ...filtered.map((event) =>
        [
          event.id,
          event.storefront_id,
          event.event_type,
          event.amount,
          event.currency_code,
          new Date(event.occurred_at).toISOString(),
          event.reference_id ?? "",
        ]
          .map((value) => `\"${String(value).replaceAll('"', '""')}\"`)
          .join(",")
      ),
    ];

    return rows.join("\n");
  }

  private computeTotals(events: Array<Record<string, any>>) {
    const sum = (eventType: LedgerEventType) =>
      events
        .filter((event) => event.event_type === eventType)
        .reduce((acc, event) => acc + Number(event.amount ?? 0), 0);

    return {
      captured_total: sum(LedgerEventType.ORDER_CAPTURED),
      platform_fee_total: sum(LedgerEventType.PLATFORM_FEE_ASSESSED),
      vendor_payout_total: sum(LedgerEventType.VENDOR_PAYOUT_ACCRUED),
      donation_total: sum(LedgerEventType.DONATION_ACCRUED),
      refund_total: sum(LedgerEventType.REFUND_ISSUED),
      payout_released_total: sum(LedgerEventType.PAYOUT_RELEASED),
    };
  }

  private async createAlertsForFailures(
    results: ReconciliationResult[],
    container: { resolve: (key: string) => unknown }
  ) {
    const eventBus = container.resolve(Modules.EVENT_BUS) as EventBusLike;

    const failed = results.filter((result) => result.discrepancies.length > 0);

    if (!failed.length) {
      return;
    }

    for (const result of failed) {
      await this.createReconciliationAlerts({
        storefront_id: result.storefront_id,
        start_date: result.start_date,
        end_date: result.end_date,
        message: "Ledger reconciliation discrepancy detected",
        details: {
          discrepancies: result.discrepancies,
          allocation_difference: result.allocation_difference,
          obligation_difference: result.obligation_difference,
        },
      });

      await eventBus.emit({
        name: "ledger.reconciliation.failed",
        data: {
          storefront_id: result.storefront_id,
          start_date: result.start_date.toISOString(),
          end_date: result.end_date.toISOString(),
          discrepancies: result.discrepancies,
        },
      });
    }
  }
}

export default LedgerModuleService;
