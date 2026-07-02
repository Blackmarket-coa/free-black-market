# production-ledger module

Opt-in, **generic** record of production events — "what was made or grown," by
what method, in what quantity, and with what realized yield. A nursery's
propagation batches are the pilot use, but nothing here is nursery-specific.

## Table

- `production_batch` — one production run, scoped by `seller_id`. Vertical
  specifics (pot size, cultivar, greenhouse details) live in `attributes` JSON,
  never as columns.

## Design rules

- **Domain-optional.** This is a *domain* substrate field, not a universal one.
  Service, digital, and practitioner vendors never create batches, and the quest
  engine treats "no production ledger" as an absent field that quests degrade
  around — not an error.
- **Reconcile, don't duplicate.** A batch links to the sellable
  `product_variant_id` / `harvest_batch_id` it produced, so "produced vs. sold"
  reconstructs from real orders. No money is tracked here (that stays in the
  hawala ledger).
- **Opt-in & decoupled.** Creating batches never enrolls a vendor in a quest;
  dropping a quest never deletes batches.

Distinct from `harvest-batches` (which tracks *sellable inventory availability*);
this ledger tracks the *production process* that feeds it.

Gated by the `PRODUCTION_LEDGER_V1` feature flag.
