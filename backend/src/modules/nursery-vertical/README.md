# nursery-vertical module

Opt-in **product vertical** for a plant nursery. Feeds the FSA loan quest (Q1)
but is fully usable on its own — a vendor can run the nursery purely to sell
plants and never touch a quest.

## What it adds

- **Listing-type extensions** (`NurseryListingSubtype`): live plants by pot size
  (liner / 3–4in / 1-gal / 3-gal), bare-root/dormant, cuttings & pads (bulk),
  divisions/pups/slips (bulk), seed packets, dried/value-added by weight.
- **Per-product attributes** (`nursery_product_attribute`, linked 1:1 to the
  core product): edible/medicinal use, hardiness zone, propagation method,
  channel fit, cost basis, and printable **plant-tag data**.
- **Per-channel wholesale pricing** (`channels.ts`): apothecary / retail-shop /
  food-forest-installer, expressed as `vendor_customer_tier` WHOLESALE tiers with
  a `metadata.channel` key. **No new pricing table** — reuses the existing
  mechanism.
- **Profit-per-sqft analytics** (`analytics/profit-per-sqft.ts`):
  decision-support only, kept SEPARATE from lender-grade exports. Pulls
  price/cost from real data where available, allows overrides, and supports
  vertical stacking (a shelf level = its own sqft).

## Design rules

- **No nursery assumptions in core.** All nursery shapes live here; the product
  schema is untouched (attributes attach via a module link).
- **Independently adoptable.** Enabling the nursery vertical does not enable any
  quest, and vice versa.
- **Profit-per-sqft ≠ lender data.** Its estimate/override inputs must never
  flow into a quest packet's financial exhibits (those trace to the ledger).

Gated by the `NURSERY_VERTICAL_V1` feature flag.
