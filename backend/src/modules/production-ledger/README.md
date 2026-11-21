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

## Routes

All under `/vendor/production-batches`, for a signed-in vendor:

| Route | Does |
|---|---|
| `GET /` | The store's production batches. |
| `POST /` | Record a batch (`item_label` required). |
| `DELETE /:id` | Remove one of the store's batches. |

`seller_id` on a batch is the store's id, read with `getSellerId`
(`api/vendor/quests/_helpers.ts`, SD-145): every member of a store sees and
edits the same batches, and another store's batch answers 404.

## Access

In every vendor plan, the free plan included (PL-1; owner decision of
2026-11-17). Two gates stay registered on `/vendor/production-batches*`, in
this order (`api/middlewares.ts`):

1. **`FF_PRODUCTION_LEDGER_V1`, the kill switch.** Off, which is the default,
   every route answers 404 `feature_disabled`. Only the literal `true` turns
   it on. The flag is read from the environment on each request.
2. **`requirePlanFeature("vendor.production_ledger")`.** The key is in
   `UNIVERSAL_FEATURE_KEYS` (`modules/vendor-plan/catalog.ts`), which every
   plan carries, so it lets every seller through. It is kept so that emptying
   that list puts the paywall back without touching a route.

Two side effects, one from the key and one from the flag:

- **From the key being universal, whatever the flag says.** The vendor panel
  lists "Production Ledger" for every vendor who sells products
  (`vendor-panel/src/hooks/navigation/use-vendor-navigation.tsx` shows it on
  the plan key and `hasProducts`, and does not read the flag). With the flag
  off that page cannot load its batches.
- **From the flag being on.** With `FF_VENDOR_QUESTS_V1` on as well, the quest
  substrate reads a vendor's batch summary
  (`modules/vendor-quest/substrate/build.ts`, `buildProduction`) for any
  seller the quest routes let in (`vendor.quests`: Scale and up, the quest
  pack, or a tenancy tier). That read checks this flag and never checked the
  plan key, so putting the key in every plan does not change who it reaches;
  switching the flag on does.

The costs of a batch live in the
[`production-costing`](../production-costing/README.md) module, behind its own
flag, `FF_PRODUCTION_COSTING_V1`.
