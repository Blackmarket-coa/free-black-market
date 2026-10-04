import { model } from "@medusajs/framework/utils"

/**
 * Pool carrier distribution — a RECORD of a distribution the pool's nonprofit
 * carrier paid out of the funds it holds on its own accounts
 * (docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b; legal checkpoint L26).
 *
 * This is not a payment and moves nothing on BMC's books: a carried pool has
 * no ledger leg (`createTransfer` refuses them), so `distributeDividends` is
 * refused for it and the carrier's own payout is written here instead, by
 * `recordCarrierDistribution`, idempotent on the carrier's reference under a
 * partial unique index on (pool_id, carrier_reference). BMC computes no
 * per-investor allocation — the carrier allocates on its own books. The
 * pool's `total_distributed` is DERIVED from these rows, never incremented.
 *
 * `amount` is in the pool tables' own unit (major units), like
 * `hawala_investment.amount`; one column, one unit. No balance column, no
 * `customer_id` (so no customer-data-registry row).
 */
export const PoolCarrierDistribution = model
  .define("hawala_pool_carrier_distribution", {
    id: model.id().primaryKey(),
    pool_id: model.text(),
    carrier_org_key: model.text(),
    /** The carrier's own reference for this payout (its ledger / bank id). The idempotency key. */
    carrier_reference: model.text(),
    amount: model.bigNumber(),
    distributed_at: model.dateTime(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["pool_id"],
      name: "IDX_hawala_pool_carrier_distribution_pool",
      where: "deleted_at IS NULL",
    },
    {
      on: ["pool_id", "carrier_reference"],
      name: "UQ_hawala_pool_carrier_distribution_reference",
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])
