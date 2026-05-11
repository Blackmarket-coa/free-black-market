# listing-type module

Listing-type registry. Each product on FBM carries exactly one
listing-type that describes the shape of the offering (physical product,
event, digital, recurring subscription, wholesale, consignment, unique
inventory, bookable slot, campaign).

See `docs/LISTING_TYPES.md` for the v1 ship list and v2/v3 deferrals.

## Table

- `listing_type` — registry of the v1 catalog (denormalized read cache).

## Source of truth

Catalog data lives in `catalog/index.ts`. The DB table is seeded from
this catalog via `backend/src/scripts/seed-playbooks.ts` (which seeds
both registries together).

## Workflow integration

- `validateListingTypeAllowed` hook — enforces the
  playbook × listing-type matrix on `createProductsWorkflow.validate`
  (see `backend/src/workflows/hooks/validate-listing-type-allowed.ts`).

## Links

- `listing-type-product` — Product ↔ ListingType (n:1). See
  `backend/src/links/listing-type-product.ts`.
