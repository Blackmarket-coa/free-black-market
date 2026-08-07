# Cottage Food Module

Support for people selling food they make at home — bakers, canners, and
especially home cooks selling prepared meals.

## The problem this solves

A home producer's business is governed by a handful of numbers that FBM was
previously blind to:

- **How much of their annual sales cap they've used.** Exceeding it can void a
  permit. The cap year usually doesn't start in January.
- **How many meals they've already committed to today and this week.** Home
  kitchens selling cooked food are typically capped per day and per week on top
  of an annual limit — a completely different shape from shelf-stable cottage
  food.
- **When their permit and food handler card expire.**
- **What their label is required to say**, word for word.

Before this module those lived on a paper calendar. `food-distribution` had
`COTTAGE_FOOD` / `HOME_COOK` producer types and a free-text `cottage_food_state`
field, but nothing was attached to them, and the botanical compliance page
rendered a cottage-food meter hardcoded to zero.

## Two design decisions

**1. The seller declares everything; FBM ships no state-law table.**

Cottage food rules vary by state and frequently by county, they change, and
getting one wrong in a way a seller relies on would be worse than saying
nothing. So the seller enters their own caps, permit details, and the exact
disclosure sentence their jurisdiction requires, and this module tracks
faithfully against what they entered. That works everywhere on day one and
keeps FBM from asserting legal facts it can't stand behind.

Practical consequence: **an undeclared limit is not a limit of zero.** Meters
with a null cap render as nothing at all.

**2. It never blocks a sale.**

No cart validation, no checkout gating, no refusing an order at 100% of a cap.
The seller is the authority on their own compliance; this module counts
accurately and shows them the number. Advisories are prose for a human to read,
not flags for code to branch on.

This is enforced by tests, not just convention — see
`__tests__/non-blocking-contract.unit.spec.ts`, which fails if anything in the
module references a cart workflow, throws a `MedusaError`, exposes a
`can*`/`validate*`/`enforce*` method, or if the cart-validate hooks ever start
mentioning cottage food.

## Models

| Model | What it holds |
|---|---|
| `CottageFoodProfile` | One per seller. Operation type, jurisdiction, permit/cert, declared caps, channel rules, label lines. Every limit nullable. |
| `CottageFoodSalesEntry` | Append-only ledger. Refunds append a compensating negative entry rather than mutating history. Unique on `(source, source_id)` for platform orders. |
| `CottageFoodLabel` | Per-product label. Producer/disclosure lines are **snapshotted** at creation so an already-printed label keeps reading as printed. |

### Why manual sales entry matters

A cottage food seller's farmers-market and cash sales count toward the same cap
their online orders do. A meter fed only by platform orders understates the
number they'd actually report — and an understated compliance meter is worse
than no meter, because it invites someone to sail past a limit believing they
have room. Hence `source: "manual"` and the entry form in the vendor panel, and
hence the snapshot reporting on-platform and self-reported totals separately.

## Period boundaries

`utils/time.ts` computes day, week, and permit-year boundaries in the seller's
timezone via `Intl` (no date library in the backend). This is load-bearing:

- A daily meal counter rolling over at UTC midnight would reset mid-dinner
  service for a cook on the US west coast.
- An annual window anchored to the calendar year would be wrong for most
  sellers, whose permit year starts whenever they registered.

Weeks start Sunday, the convention US food permits use for "meals per week".

## Surfaces

- `GET`/`POST`/`PATCH` `/vendor/cottage-food/profile`
- `GET` `/vendor/cottage-food/compliance` — the snapshot behind every meter
- `GET`/`POST` `/vendor/cottage-food/sales` — ledger + off-platform entry
- `GET`/`POST` `/vendor/cottage-food/labels`, `GET`/`PATCH`/`DELETE` `/labels/[id]`
- `GET`/`POST` `/vendor/cottage-food/onboarding` — setup status + checklist
- `GET` `/store/cottage-food/producers/[handle]/disclosure` — buyer-facing;
  returns nothing unless the seller opted in, and withholds the street address
  (usually a home address) unless they explicitly published it

Sales are recorded by `subscribers/cottage-food-record-sale.ts` on
`order.placed` and backed out by `cottage-food-reverse-sale.ts` on
`order.canceled` / `order.refund_created`. Both are wrapped so a counting
failure can never affect order handling. Per-seller attribution lives in
`utils/order-lines.ts` — on a multi-vendor order, each seller's cap counts only
their own line items.

The botanical compliance center
(`/vendor/botanical/compliance/overview`) reads its cottage-food figures from
this module.
