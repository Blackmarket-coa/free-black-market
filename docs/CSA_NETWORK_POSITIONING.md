# CSA-network positioning and pilot checklist

**Status: drafted, not published.** This is Tier A item 5 of
`docs/CDFI_COOP_ROADMAP.md` (§3.7). The roadmap deliberately separates
writing this from publishing it: the copy is drafted now so the pitch is
settled, and it goes on the storefront only after Tier B item 12 — the CSA
share-box wire — lands. §4 below is the gate. Publishing any of §2 before
that gate would repeat the mistake §5 catalogues.

Audience: growers and food hubs who run a CSA today, most of them on Open
Food Network, some on spreadsheets and a payment link.

---

## 1. What we are actually offering them

The honest pitch is not "we are a better OFN". It is narrower and it is
true today:

> Sell your shares and your extras on the same storefront your neighbours
> already shop, keep 97% of what you charge, and stop paying for a second
> checkout.

FBM's strength for a CSA farm right now is the ordinary commerce stack —
listings, checkout, payouts, a storefront, a vendor panel, subscriptions —
plus the co-op and lender readiness work the rest of the roadmap builds.
The scheduling layer that would let FBM *replace* an OFN instance is
partly built and not reachable. §3 says exactly how far it goes.

### The vocabulary an OFN user will recognise

| Their word | What exists in FBM | Reachable today? |
| --- | --- | --- |
| Order cycle | `order_cycle`, with open/closed windows and per-cycle product lists | Yes, in the vendor panel |
| Enterprise fee | `enterprise_fee`, per-cycle fees with eight API handlers | API only — no screen |
| Share box / box scheme | `share_box_template`, `share_box_subscription`, `share_box` | No — service methods with no route |
| Exchange / distribution hub | `order_cycle_exchange`, incoming and outgoing | Yes, in the vendor panel |
| Producer profile | Seller account, storefront, playbooks | Yes |

Two of those five are honest wins. One is API-only. One is not reachable
at all. A pitch that lists all five as features is the thing this document
exists to prevent.

---

## 2. Draft landing copy

*Publish only after the §4 gate. Wording is settled; claims are scoped to
what will be true once item 12 lands.*

### Headline

**Run your season here. Keep 97% of it.**

### Body

You already know how a CSA works. Members commit for a season, you plan
the boxes, you pack and you deliver. What you should not have to do is pay
a marketplace 15% for the privilege, or run two checkouts because your CSA
software cannot sell the extras.

FBM charges **3% on sales it actually processes**, and nothing on a sale
that happened somewhere else and is only recorded here. That rate is
published live at `/transparency`, read from the same constant the code
charges from.

You get order cycles with real open and close windows, per-cycle product
lists and per-cycle pricing, distribution exchanges for your pickup sites,
and a storefront your members can use for the share and the extras
without a second account.

### What we are not

We are not a certifier, not a lender, and not your bookkeeper. We do not
take a cut of a grant, and we do not stand between you and a partner.
Where you need those things, the [lenders and partners
directory](/partners) links out and we are paid nothing for the referral.

### The SNAP paragraph

Say exactly this and nothing more:

> **Can my CSA take SNAP?** At a physical point of sale, very likely yes —
> and not through us. A direct-marketing farmer applies to USDA FNS
> directly; the application is free, takes about 45 days, and farmers
> markets, direct-marketing farmers and non-profit food-buying
> cooperatives qualify for **free EBT equipment and free transaction
> services**. SNAP covers food, and also the seeds and plants that produce
> food — vegetable and herb starts, fruit trees, berry bushes. It does not
> cover ornamentals, soil, tools or hot prepared food.
>
> Online SNAP is a different and much heavier authorisation, stacked on
> top of the first one and requiring an approved processor. FBM does not
> offer it, and we will not imply otherwise.
>
> Whatever you do with SNAP, it stays on cash rails. Benefits are federal
> money: they never buy community credit, never fund a wallet and never
> pay our platform fee.

Sourced from `docs/SNAP_EBT_RESEARCH.md`. Three things that document is
clear about and this copy must keep: FBM implements **nothing**
SNAP-related today (the only mention in the codebase is one aspirational
JSDoc bullet); a May 2026 final rule tightens staple-food stocking
standards with **compliance required from 4 November 2026**, so any
authorisation plan must be checked against the new standards; and whether
a plants-and-produce catalogue satisfies those standards is an open
question for counsel, not a settled fact.

---

## 3. What a pilot can really run today

Established by reading the code on 2026-09-08, **revised 2026-09-09** after
Tier B item 12's wiring landed (PRs #839–#846). Most of what the first version
of this section listed as unreachable now has routes and a storefront. A CSA
pilot should still be scoped to the first list and nothing else — but that list
is much longer than it was, and the reason to hold publication is now narrow
and specific rather than "the feature does not work".

**Works, reachable by a coordinator:**

- Create an order cycle, set its open/close window, move it through
  status; a cron job updates statuses every five minutes, and now emits
  `cycle.open` / `cycle.close` to Blackout per cycle (#845).
- Add products to a cycle with a per-cycle override price, and remove one
  again (#839).
- Create incoming and outgoing exchanges for pickup sites.
- Define a share-box template, edit it, and deactivate it (#840).
- Generate, pack, dispatch and cancel share boxes for a cycle, with the
  lifecycle enforced — a box cannot be dispatched without being packed, or
  cancelled after it has gone out (#842).
- Ordinary commerce: listings, checkout, payouts, subscriptions.

**Works, reachable by a member:**

- Browse open cycles and what is in them at `/order-cycles` (#846).
- Subscribe to a share box, pause, resume and cancel it (#841).
- Order from a cycle. The item carries `order_cycle_id`, so the sale is
  recorded against the cycle product and the order is linked to the cycle
  — which had never happened before, because nothing wrote that key (#846).

**Exists but has no screen — a coordinator would need `curl`:**

- Enterprise fees. Eight handlers under `/vendor/enterprise-fees` and
  `/vendor/order-cycles/:id/fees`, no UI in any panel.

**Does not work. Do not scope a pilot on any of this:**

- **Any share-box money path.** `share_box_subscription` still has no
  price, payment method, cart, order or ledger link. This is the one
  remaining piece of Tier B item 12 and the reason §4's gate is still
  closed. It needs a ruling, not just wiring — see §4.
- **Recurring cycles.** `is_recurring` and `recurrence_rule` are stored
  and read by nothing; `cloneOrderCycle` still has no caller.
- **A cycle's participant list.** Nothing in `api/` calls
  `addSellerToOrderCycle` or `createOrderCycleSellers`, so no reachable
  path creates an `order_cycle_seller` row. Every access check's
  participant branch is empty in practice and only the coordinator passes.

**Works, but not as strongly as the copy might imply:**

- **Cycle enforcement.** `checkProductAvailability` now has a caller —
  `POST /store/order-cycles/:id/availability`, asked before an item enters
  the cart (#846). It enforces the status gate and per-product quantities
  at that moment, but it is a *check, not a reservation*: two members can
  pass it simultaneously and both orders record, and `recordSale`
  increments without re-checking. A cycle can still be oversold under
  concurrency. Recorded as `AUDIT_DEBT.md` D9-1.
- **Sale recording.** It is not idempotent: a retried `order.placed`
  double-increments `sold_quantity` (D9-2), and a cycle that closed
  between add-to-cart and checkout still accepts the sale (D9-3).

The sharp edge a pilot would hit, still unfixed and verified again on
2026-09-09:

- Share-box pricing falls back to **0** when a cycle product has no
  override price (`service.ts:1006-1007`), so a box of un-overridden
  products bills every member nothing. The currency is `usd` in practice
  whatever the template says: `order_cycle_product` carries no
  `currency_code` field, so `product.currency_code ?? "usd"` is always
  `"usd"`, which then wins over the template's own currency at the box
  level. Both must be fixed before any money path is switched on.

---

## 4. Publication gate

Every line must be true before §2 goes on the storefront. Checked
2026-09-09.

- [x] Scheduler routes and screens — share-box templates (#840),
      subscriptions (#841), generate/pack/dispatch/cancel (#842).
- [x] A storefront cycle page that writes `order_cycle_id` (#846). It
      writes it to the **line item**, not to cart metadata: FBM checks out
      through Mercur's split workflow, which never copies `cart.metadata`
      onto the orders (`AUDIT_DEBT.md` D9-5).
- [x] The cycle events — `cycle.open` and `cycle.close`, per cycle, from
      the status job (#845). `sold_out` is deliberately not emitted: FBM
      decides sold-out per product, not per cycle, so there is no trigger
      for it.
- [x] The two dead buttons removed or implemented (#839).
- [x] `checkProductAvailability` is called before add-to-cart (#846), so
      the copy's "real open and close windows" is enforced and not only
      displayed. Note the limit in §3: a check is not a reservation.
- [x] `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` and `docs/LISTING_TYPES.md`
      no longer describe the unwired state as done — corrected 2026-09-08,
      and brought up to date again 2026-09-09 (§5).
- [ ] **One billing owner.** The last piece of item 12, and the only one
      that needs a ruling rather than wiring. See the note below.
- [ ] A member can subscribe to a share box and be charged, end to end,
      on a staging environment.
- [ ] The share-box zero-price and `usd` fallbacks are fixed (§3).
- [ ] The commission sentence has been checked against §6, and against
      whether `/store/fee-schedule` and the charging path still agree.
- [ ] The SNAP paragraph has been re-checked against the 4 November 2026
      stocking standards, and counsel has answered whether a
      plants-and-produce catalogue meets them.

**Why the billing owner is a ruling.** Roadmap §3.7 recommends that a share
box reference a `subscription` id and that each generated box become that
cycle's renewal order, rather than adding a third recurring model. Reading
the code found that this is not mechanical: `renewSubscriptionWorkflow`
clones a *fixed template cart*, while a share box's contents are computed per
cycle from what the coordinator packed. The recommended shape therefore needs
either a change to that workflow, a different owner, or the third model the
roadmap warns against — a decision with consequences beyond this document.

---

## 5. What the docs said, and what they say now

Both were named in roadmap §3.7 as things to correct when the wire landed.
They are tracked here because this document's whole purpose is to stop the
CSA pitch outrunning the code — and that cuts both ways: it also cannot let
the code outrun the document, which is what happened between 2026-09-08 and
2026-09-09.

- `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` listed "Order Cycles share-box
  scheduler" at **100% / Shipped**. Corrected to 25–50% on 2026-09-08 with
  the note that the share-box half was service methods only. That note is
  now itself understated — templates, subscriptions, generation, pack and
  dispatch all have routes — so it was corrected again on 2026-09-09 to
  name the money path as the specific thing missing.
- `docs/LISTING_TYPES.md` described the seasonal `recurring` listing as
  carrying a `share_template_id` link to `order_cycle.share_box_template`,
  and said nothing creates that link. Still true of the link itself, but
  its stated reason — "the share-box half of `order-cycle` has no surface"
  — stopped being true on 2026-09-09 and was corrected.

---

## 6. The commission claim, stated carefully

The landing copy says "3% on sales it actually processes". That is
defensible, with three caveats a reviewer should know before the sentence
ships:

1. **The number lives in code, not in the commitment.**
   `PLATFORM_DEFAULT_FEE_PERCENT = 3` in
   `backend/src/modules/vendor-plan/catalog.ts`.
   `docs/ADDON_COMMITMENTS.md` §3 is titled "The commission never creeps
   upward" and names no rate at all.
2. **The no-rise promise is narrower than it sounds.** §3 promises that
   every paid plan's rate is lower and that an upgrade can never raise
   someone's take rate — a promise about the *plan ladder*. A per-seller
   override is resolved first, is validated only as a percentage between
   0 and 100, and is not capped at the platform default. So "3% and it can
   never go up" would be an overstatement. "3% is the default rate, and
   moving up a plan only ever lowers it" is accurate.
3. **Two sources of the number can drift.** `/store/fee-schedule`
   publishes the compile-time constant, while charging resolves the
   platform default from the `payout_config` row, which is merely *seeded*
   at 3. They are not the same value and nothing keeps them in step.

"Nothing on a sale that happened somewhere else" is on firmer ground:
`docs/ADDON_COMMITMENTS.md` §3a scopes the fee to what "went through FBM
checkout", channel orders are stored as `channel_order` rows and never
converted to Medusa orders, so they never reach the payout path at all.

The playbook `commission_rate: 0.03` on all eleven recipes is **not** the
source of the charged rate — it is display-only, and settlement resolves
seller override → plan → `payout_config`. Do not cite it as evidence.

---

## 7. Outreach note

The audiences this positions for are in `docs/CDFI_COOP_ROADMAP.md` §6:
CSA farms and food hubs, and the co-op developers who advise them. The
approach that follows from §3 is to lead with the commerce stack and the
commission, not with the scheduler — and to say plainly that share-box
scheduling is being built rather than implying it is ready. A grower who
tries it and finds no subscribe button is a grower who never comes back.
