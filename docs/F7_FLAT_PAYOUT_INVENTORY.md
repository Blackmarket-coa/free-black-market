# F7 flat payouts, step 1: every tier-linked money path

Recorded 2026-10-11 against `main` at `7b106a5b`, for launch-plan F7 step (1)
(`docs/BLACK_MASK_LAUNCH_PLAN.md` §4 and §5 F7; legal checkpoint **L27** in
`docs/legal/checkpoints.md`). This step changes no behaviour: no code, flag or
test is touched. It lists every place where a KARMA tier, or a value derived from
one, changes or displays how much money someone is paid, how each place is
reached, and what flattening would change. It draws no legal conclusion; §11
lists what the L27 review could look at.

**Corrected the same day.** The first version described what two endpoints are
written to do, not what they do. Two independent reviews ran them on a real
database; their results were reproduced before this version was written. As run,
the nursery payouts endpoint shows every seller Seedling, 60% and $0 (§4.1), and
on a database built from the migrations no grower can earn a tier at all (§4.2).
§1, P4, P6, P7, D1 to D5, D8, D9, X1, X2, T6, §8, §10, §11 and §12 changed in
substance; D11, X4, §4.1 and §4.2 are new; D6 and T2b now name their files in
full.

Every `file:line` below was checked by script at this branch's head, whose code is
the same as `7b106a5b` (the branch changes only documents). **Live** means
reachable on any deploy of this code with no flag; it says nothing about whether
what the code returns is right, which each row states. **Dark** means behind an
environment flag that no workflow, compose file, env template or Dockerfile in
this repository sets; production environments are not visible from here. **Dead**
means no code calls it. **Observed** means run on a database that the integration
test harness built from this repository's migrations, with CI's fixture
environment and the repository's MikroORM patch applied as CI's install applies
it (SD-52), in a throwaway probe deleted afterwards; production's schema and data
are not visible from here.

## 1. The finding that changes F7's framing

**No ledger leg, payout or fee reads a KARMA tier today.** The plan's status row
("Tiers still pay 60% to 72%") and the statements listed in §9 say otherwise. The
code does not.

1. `GROWER_TIERS.split_pct` (`backend/src/modules/progression/grower-karma.ts:57-63`)
   is read in two places outside tests: `getGrowerTier()` (`:237`, returned as
   `current_split_pct`) and the public ladder route
   (`backend/src/api/store/karma-ladder/route.ts:65`). `getGrowerTier()` has two
   consumers, D3 and D4, both displays, and both pass it the wrong id (item 4).
   No ledger write, payout, fee or settlement reads either.
2. The only code that moves money by a split is the hub cut in
   `backend/src/modules/payout-breakdown/grower-payout.ts`. It is keyed by the
   grower's **node**, not their tier (`GROWER_SPLIT_CONFIG[item.grower_node]`,
   `:192`; the table is at `:35-44`), and it never runs: `queuePayoutsForOrder`
   (`:248-256`) has no caller anywhere in the repository, so no `grower-split:*`
   ledger leg (`:228`) is ever written. It was added as a stub
   (`PLANT_NETWORK_AUDIT.md` §2, "Stub added"), and the commits that built it
   (`4a9ed7c6`, `b6263fa3`, `9bdfda14`, 2026-06-26 and 27) added no caller. The
   commit that made tiers plan-aware
   (`93bee66f`, 2026-08-03) said so in its message: "Displayed grower tier and
   split percentage become plan-aware; the node-based inter-node disbursement
   split is deliberately unchanged." Wiring it as written would not work either:
   its first read fails on Medusa 2.14.2 for every order (P4; SD-52).
3. A grower selling through a node is paid exactly like any other seller (§3, L2
   and L6): by Mercur's nightly payout (`captured - refunded - Mercur
   commission`, `docs/AUDIT_DEBT.md` SD-41) and, for an order that reaches the
   ledger, by the seller leg of `total - platform fee` (less the processing
   estimate under `FF_FEE_FIRST_SPLIT_V1`). Neither reads a tier or a node.
4. **What growers are shown.** The public `/karma` page publishes the ladder as
   what each tier pays ("What each grower tier pays", "Each rung raises the share
   of a sale they keep"; D1, D2). The vendor endpoint behind the nursery portal's
   Payouts page (D3) is written to multiply a grower's sales by their tier split
   and return the result as "net", "your cut" and year-to-date earnings. That is
   not what it returns. It looks the grower up by the signed-in member's id
   instead of the seller id, and its order read fails on Medusa 2.14.2, so it
   returns tier Seedling, a 60% split and $0 for every money figure to every
   seller, whatever their plan or KARMA (observed; §4.1). The grower dashboard
   API (D4) has the same id fault. Both causes are in code, not data, so
   production should return the same; production was not observed. The endpoint
   was not on the plan's list; it is recorded as **SD-49** in
   `docs/AUDIT_DEBT.md`, with SD-51 and SD-52.
5. **On a database built from the migrations, nobody can earn a tier.**
   `character_sheet` lacks two columns its model writes, so no character sheet
   can be created and no XP or KARMA accrues for anyone (observed; SD-50). And
   the subscriber that awards grower KARMA for a sale fails at its first read on
   Medusa 2.14.2, whatever the schema (observed; SD-52). Whether production's
   `character_sheet` has the two columns is not visible from here (§12).

So flattening the money is not a migration of amounts anyone is being paid. In
money terms F7 is a decision (§10): whether a hub cut should exist at all and, if
so, at what single share of what base. In copy terms it corrects the ladder
published on `/karma` since 2026-08-10, and what the nursery Payouts screen is
written to show; what its endpoint has returned since 2026-07-11 is Seedling, 60%
and $0 for everyone (§4.1, §11).

## 2. Payout math: code that computes an amount from a tier or a tier-mirrored constant

| # | Where | What it computes | Who gains or loses | Reached? | What flattening changes |
|---|---|---|---|---|---|
| P1 | `grower-payout.ts:35-44` `GROWER_SPLIT_CONFIG` | The grower's kept fraction per node: `hub_sc` 1.0, `node_nc_mtn` 0.62, the other six nodes 0.60. Its docblock (`:31-33`) says it "mirrors the tier ladder"; it is a per-node constant and never consults a grower's tier. | Nobody directly (a table) | Read only by P2 | Every node row becomes the flat share S, or the table goes if there is no hub cut (§10.1). |
| P2 | `grower-payout.ts:166-242` `computeEvent` | The hub cut on one line: `(1 - split) x (line gross - platform fee)`, rounded to cents (`:191-197`, through P3). Fallbacks: `?? 0.6` for an unlisted node (`:192`), and a 5% platform fee if the fee lookup throws (`PLATFORM_FEE`, `:47`, used at `:137-148`), not the 3% default. Skips `hub_sc` lines and lines with no node or seller (`:186-189`); returns "pending" without posting when the grower's balance is short (`:209-217`). | The grower's SELLER_EARNINGS loses the hub cut. A SYSTEM-owned `PRODUCER_POOL` account with owner `hub_sc` gains it (`:151-164`); no code in the repository pays out of that account. | **Dead.** Reached only through P4. | The hub cut on every node line becomes `(1 - S) x base`. |
| P3 | `grower-payout.ts:64-75` `computeNodeSplit` | The pure arithmetic of P2. | Nobody directly | Called by P2 and by tests | Nothing in itself; tests pin its outputs (T3). |
| P4 | `grower-payout.ts:248-256` `queuePayoutsForOrder` | Runs P2 over every node line of an order. | As P2 | **Dead: no caller.** `GrowerPayoutService` is constructed only by the grower dashboard route (to read history, D4) and by its unit spec; it is not part of the `payoutBreakdown` module (`payout-breakdown/index.ts`). If it were called, its first statement, `loadOrderNodeContext` (`grower-payout.ts:249`), would throw: that read selects `items.quantity`, which Medusa 2.14.2 refuses for every order (observed; SD-52). | Nothing until something calls it, and its order read is fixed. |
| P5 | `grower-payout.ts:314-396` `processMonthlyPayouts`, `:402-419` `generate1099Report` | A grower's monthly net and annual 1099 total, from ledger credits minus debits. No split of their own. | The grower (a payout request) | **Dead: no caller.** `processMonthlyPayouts` calls `requestPayout`, which sends nothing unless SD-41's dark Connect rail is on. | Nothing directly; they would net out hub cuts if P4 ever ran. |
| P6 | `grower-karma.ts:57-63` `GROWER_TIERS.split_pct`; `:204-240` `getGrowerTier`, which returns `current_split_pct` (`:237`) | The tier fraction: 0.60, 0.62, 0.65, 0.68, 0.72. Its docblock calls it "the source of truth for what growers are actually paid" (`:37-43`); no money path reads it. | Nobody (it only feeds displays) | The table is live: D1 publishes it. `getGrowerTier` is called only by D3 and D4, both with the member id, so for them it always returns Seedling and 0.60: it finds no seller (`:156-167`), so reads no KARMA, and the plan lookup finds no plan (observed; §4.1). Called with a seller id on a migrations-built database it throws at the character sheet (`:212-217`; observed; SD-50); no route passes one. | Every tier returns S, or the column is removed (then D1, D3 and E1 change with it). |
| P7 | `grower-karma.ts:113-123` `effectiveGrowerTier`, with `backend/src/modules/vendor-plan/limits.ts:66-78` `grower_tier_floor`: pro "Root" (`:126`), scale "Canopy" (`:137`); free, starter, all_access and internal make no claim (`:100`, `:115`, `:168`, `:182`) | A paid plan raises the tier, so it raises the displayed split to 65% or 68%. | Nobody (display) | Applied by no route. It runs inside `getGrowerTier` (`grower-karma.ts:219-223`): D3 and D4 pass the member id, whose plan lookup creates a free-plan assignment and floors nothing (§4.1, SD-51); with a seller id on a migrations-built database the character-sheet read throws first (SD-50). With the two missing columns added by hand, a scale-plan seller read Canopy, 68%, floored by plan (observed). The floors are still published (D1 `plan_floors`, D2). Operator answer OI-6 (`vendor-plan/catalog.ts:250-256`): no vendor is on starter, pro or scale today. | A floor would still buy a tier and its unlocks, but no number. The "Tiers you can buy" disclosure (D2) stops being about money. |

## 3. Ledger legs

| # | Leg | Reads a tier? | Notes for F7 |
|---|---|---|---|
| L1 | The hub cut, `grower-payout.ts:219-238`: COMMISSION, `reference_type` ORDER, key `grower-split:<order>:<line>` (`:228`), `metadata.split_pct` (`:235`), from the grower's SELLER_EARNINGS to the `hub_sc` PRODUCER_POOL account | The node, not the tier | **Never written** (P4 is dead). If it ran with `FF_NONPROFIT_PARITY_V1` on, the ledger would refuse it: `hub_sc` is a PRODUCER_POOL account that no pool row owns (`backend/src/modules/hawala-ledger/service.ts:3098-3108`, `no_carrier`). |
| L2 | The seller leg, `hawala-ledger/service.ts:2259-2269` (TRANSFER), amount `total - platform fee`, less processing when F6 is on (`:2180-2186`) | No | What a grower's earnings are credited with, for an order that reaches the ledger (a card order only with `FF_CARD_ORDER_LEDGER_V1`, SD-36). The platform fee resolves per-seller override, then plan, then default (`backend/src/shared/platform-fee.ts`, `backend/src/modules/payout-breakdown/fee-resolution.ts`), with no KARMA input. The plan ladder is F8's subject. |
| L3 | Consignment, `hawala-ledger/service.ts:1265` `processConsignmentSplit` (two TRANSFER legs) | No | Dark (`FBM_CONSIGNMENT_SPLIT_LIVE`, `backend/src/lib/consignment.ts:20-29`). The consignor's basis points come from product metadata (`:10-14`) and apply to the seller-side amount after fee and processing (`backend/src/subscribers/hawala-order-payment.ts:779`). P2's base ignores the consignor's share. |
| L4 | Patronage, `backend/src/jobs/patronage-refund.ts:62-85` | No | Allocated by commission paid: entries with `reference_type` COMMISSION, keyed by `metadata.seller_id` or `vendor_id` (`:66`, `:75-79`). L1 is `reference_type` ORDER with `metadata.grower_seller_id`, so a hub cut would not enter patronage even if posted. |
| L5 | Escrow: the order escrow (`hawala-ledger/service.ts:2202-2213`), the demand-pool escrow (`backend/src/services/collective-hawala.ts:77-86`), the campaign escrow | No | Purchase legs credit ESCROW. None reads a tier. Campaign backings award XP (money to reputation), not the reverse. |
| L6 | Vendor payout: Mercur's `daily-payouts` (SD-41), and FBM's ledger-driven Connect payouts (dark, `FF_LEDGER_CONNECT_PAYOUTS_V1`) | No | Mercur pays `captured - refunded - Mercur commission`. Mercur's commission rules are data: the seed creates one site-wide percentage rule (`backend/src/scripts/seed/seed-functions.ts:494-508`) and nothing in the repository writes a rule from a tier. Whether production has hand-made per-seller rules is not visible here. |
| L7 | Payout speed fees, `hawala-ledger/service.ts:3978-3983` | No | INSTANT, SAME_DAY, NEXT_DAY and WEEKLY rates are the vendor's choice, not KARMA. |

## 4. Displays and copy that show a tier-linked money figure

| # | Where | What a user sees | Reached? | After flattening |
|---|---|---|---|---|
| D1 | `GET /store/karma-ladder`, `backend/src/api/store/karma-ladder/route.ts:58-94`: `split_pct` per tier (`:65`), `plan_floors` (`:77-81`), sent with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (`:83`) | The ladder as data: each tier's split and the plans that floor a tier. Its docblock: "what each tier pays" (`:18`). | Live, public, no sign-in | Every tier returns S; the docblock and the plan-floor rationale need rewriting. A cache that honours those headers may serve the old ladder for an hour and then, while it revalidates, for up to a day more; the storefront's own fetch of it is cached for an hour (D2). A dated cut-over has to allow for that window or purge the caches. |
| D2 | Storefront `/karma`, `storefront/src/app/[locale]/(main)/karma/page.tsx` | The page description "What each grower tier pays, ..." (`:9`); "Each rung raises the share of a sale they keep" (`:36-41`); "{n}% split" on every tier (`:59-61`); "Tiers you can buy rather than earn" (`:109-134`). Linked from the footer (`storefront/src/data/footerLinks.ts:20`) and the mobile nav (`storefront/src/components/cells/MobileNavbar/MobileNavbar.tsx:30`); the mobile app is a shell around this storefront (`mobile/capacitor.config.ts:18`). Added in `8a05b613` (2026-08-10). Its ladder comes from D1 through a fetch revalidated hourly (`storefront/src/lib/data/progression.ts:249-253`). | Live, public | The description, the hero sentence and every tier's split become false. They need rewriting, not renumbering. The numbers can lag a backend change by D1's cache window. |
| D3 | `GET /vendor/plant-nursery/payouts/current-period`, `backend/src/api/vendor/plant-nursery/payouts/current-period/route.ts` | **As written:** `split_pct`, the tier split, or 60 if the tier read fails (`:90`); `your_cut_cents = gross x split` per product (`:115`); monthly `net_cents` (`:158-159`); `earnings_ytd_cents` (`:168`); the current period's `net_cents` (`:176-177`). No platform fee is subtracted, which is a third definition of the share (§10.3). **As run:** tier `seedling`, a 60% split and 0 for every money figure, with no sales listed, for every seller (observed; §4.1). The route dates from 2026-07-11 (`f5c66071`). | Live for any signed-in seller: `/vendor/**` needs only a seller context (`backend/src/api/middlewares.ts:808-811`), and the `NURSERY_VERTICAL_V1` matcher is `/vendor/nursery*` (`:1338-1343`), which does not cover `/vendor/plant-nursery`; a free-plan seller got 200 (observed). The first GET by each member writes a plan row (§4.1). **SD-49.** | Fixed as written, every grower's displayed net would become `gross x S`. If there is no hub cut, the figure should be the seller leg, so the arithmetic changes, not just the constant. |
| D4 | `GET /vendor/farm/grower-dashboard`, `backend/src/api/vendor/farm/grower-dashboard/route.ts` | **As written:** `karma: getGrowerTier()`, including `current_split_pct` (`:38`, `:111`), and `hub_cuts`, which sums every debit on the grower's earnings account (`:49-51`, `:115`): payouts, refunds and recoveries, since no hub cut is ever posted. **As run:** it takes the grower id from `auth_context.actor_id` (`:17-19`), the member id, so `karma` is Seedling at 0.60 for everyone, the earnings figures read an empty account owned by the member id, and `grower.seller_id` echoes the member id (`:110`) (observed; §4.1). Its sales block selects `items.quantity` (`:80-84`), so with a seller id it would fail too (SD-52); with the member id it finds no products and reports `source: "unavailable"`. Its first GET by each member writes (§4.1). | Live API; no consumer in the repository | `current_split_pct` becomes S. `hub_cuts` is mislabelled either way. |
| D5 | Nursery portal, fed by D3 (`nursery-portal/src/hooks/usePayouts.ts:12`) | On Payouts: "Your split" (`nursery-portal/src/pages/PayoutsPage.tsx:24`), "Net (est.)" (`:25-29`), the tier grid with each tier's split (`:41-54`, split at `:52`), "2026 earnings to date" (`:76-77`), the history's Split and Net columns (`:109-111`), "Your cut" by product (`:127`, `:136`), with each history row drawn by `nursery-portal/src/components/payouts/PayoutRow.tsx:10-11`. On the dashboard: "{n}% split" under This month (`nursery-portal/src/pages/DashboardPage.tsx:71`). Against a live backend these carry D3's output (60% and zeros); in mock mode, T6's numbers. | The UI is not deployed by this repository (D10) | Everything shows S, and the grid's split row stops saying anything. |
| D6 | `packages/bmc-ui/src/KarmaBar.tsx:27` | "{remaining} to {next tier} ({next tier's split}% split)" | Used by the nursery portal (`nursery-portal/src/pages/PayoutsPage.tsx:38`, `nursery-portal/src/pages/QuestsPage.tsx:208`), botanical (`botanical-portal/src/pages/PayoutsPage.tsx:40`), creator (`creator-portal/src/pages/PayoutsPage.tsx:48`, `creator-portal/src/pages/QuestsPage.tsx:28`) and wellness (`wellness-portal/src/pages/PayoutsPage.tsx:48`, `wellness-portal/src/pages/QuestsPage.tsx:40`) | The next rung no longer pays more; the percentage should go. |
| D7 | `packages/bmc-portal-kit/src/tiers.ts:41-87`, `TIERS.split_pct` (60 to 72) | The source of D5's grid and D6's text. Its header says the numbers are display only and follow the backend (`:4-9`). | As D5 and D6 | Mirrors P6; E1 enforces the mirror. |
| D8 | Botanical portal Payouts page, `botanical-portal/src/pages/PayoutsPage.tsx`: split and hub cut (`:22-26`), net (`:27-31`), tier grid (`:42-59`), hub cut and "Your cut" by pathway (`:77-106`), history (`:108-133`); and the Pool Splits page, which tells a solo maker "Solo makers keep the full maker split — see Payouts" (`botanical-portal/src/pages/CollectiveSplitsPage.tsx:29`) | As listed | Its endpoint, `/vendor/botanical/payouts/current-period`, does not exist (`botanical-portal/src/hooks/usePayouts.ts:6-9`); mock data only | The mock still shows the retired 70/73/76 ladder (T6). The Pool Splits sentence points at a split that would no longer vary. |
| D9 | Wellness and creator portals | KarmaBar (D6) on their Payouts and Quests pages, and the creator Quests page's subtitle: "climb the tier ladder for a better revenue split" (`creator-portal/src/pages/QuestsPage.tsx:16`). Wellness calls `/vendor/wellness/payouts/current-period`, which does not exist (`wellness-portal/src/hooks/useWellness.ts:59`). Creator calls `/vendor/hawala/payouts` (`creator-portal/src/hooks/useCreatorData.ts:75`), which returns only `payout_options` (`backend/src/api/vendor/hawala/payouts/route.ts:24`), not the tier or the period figures its Payouts page reads (`creator-portal/src/pages/PayoutsPage.tsx:30-48`). | Not deployed; only mock data reaches them | As D6; the creator subtitle needs rewriting. |
| D10 | Portal deployment | Nothing | `docker-build.yml` builds backend, storefront, admin-panel and vendor-panel only (`.github/workflows/docker-build.yml:30-42`); no portal has a Dockerfile, compose service or deploy config. Whether they are hosted elsewhere is not visible here. | Nothing |
| D11 | Nursery portal pages with no backend route | Network page: "Grower pool", captioned "Paid out to nodes by tier split", and "Hub net", captioned "After grower splits" (`nursery-portal/src/pages/NetworkPage.tsx:89-100`). Analytics page: "Net to you (YTD)" with the rest of gross captioned "platform fees", and a monthly chart of net against fees (`nursery-portal/src/pages/AnalyticsPage.tsx:55-59`, `:72-114`). | Their endpoints, `/vendor/plant-nursery/network` and `/vendor/plant-nursery/analytics`, are not built (`nursery-portal/src/hooks/useNetwork.ts:6-7`, `nursery-portal/src/hooks/useAnalytics.ts:6-7`); mock data only (T6) | The pool caption describes a payout by tier that does not exist. The mock nets are tier splits shown as net of "platform fees" of 38% to 40% of gross. Recompute or remove. |

The vendor panel, the admin panel (and `backend/src/admin`), the mobile shell's own
code and `services/` carry no tier split: searching them for `split_pct`, `karma`,
`grower tier` and `% split` finds nothing.

### 4.1 What D3 and D4 return, and what they write

Observed (see the definition above), with a seller made by Mercur's own
`createSellerWorkflow` and put on the scale plan, which floors the grower tier to
Canopy (68%); a product linked to that seller; and an order for it this month:

- D3 returned `tier: "seedling"`, `karma_total: 0`, `split_pct: 60`,
  `gross_cents: 0`, `net_cents: 0`, an empty `split_breakdown` and
  `earnings_ytd_cents: 0`. A token whose actor is the seller id (the shape
  `backend/src/scripts/backfill-seller-auth.ts` writes) gave the same, and so did
  a free-plan seller. With the two missing `character_sheet` columns added by hand
  (§4.2), `getGrowerTier(seller id)` returned Canopy at 0.68, floored by the plan,
  and D3 still returned Seedling and 60.
- D4 returned `karma` Seedling at 0.6, every earnings figure 0, and
  `grower.seller_id` set to the member id.

Three faults. The first alone explains everything observed. The second and third
each zero a different part of the money figures even for the right id: the order
read gives the units sold and the per-product "your cut"
(`current-period/route.ts:94-118`), and the ledger read gives the gross, the net,
the monthly history and the year-to-date earnings (`:93`, `:132-168`, `:177`).
Neither touches the tier or the split, which come only from `getGrowerTier`
(`:44`, `:90`, `:180`). Called directly with the seller id, the route's handler
returned Seedling and 60 on the schema as migrated, where the tier read throws
(SD-50) and the route falls back, and Canopy and 68 once the two missing
`character_sheet` columns were added; either way every money figure was 0 and no
sale was listed (observed).

1. **The member id is used as the seller id.** D3 takes its id from `getSellerId`
   (`current-period/route.ts:36`), which returns `auth_context.actor_id` ahead of
   the seller id (`backend/src/api/vendor/quests/_helpers.ts:6-9`); D4 reads
   `auth_context.actor_id` itself (`grower-dashboard/route.ts:17-19`). A seller's
   token carries its member id: Mercur's `createSellerWorkflow` links the auth
   identity to the member (`backend/integration-tests/http/helpers/seller-auth.ts:147-148`),
   and `ensureSellerContext` rewrites a seller-id actor to the member id
   (`backend/src/api/vendor/_middlewares.ts:113-133`). Looked up as a seller, a
   member id finds nothing: no member to read KARMA for (`grower-karma.ts:156-167`),
   no plan, no products, no earnings account. Other vendor routes resolve the
   member id to its seller first (for example
   `backend/src/api/vendor/affiliate-links/route.ts:7-20`).
2. **The order read fails.** `getSellerOrders` selects `items.quantity`
   (`backend/src/shared/seller-orders.ts:52-68`), which `query.graph` refuses on
   Medusa 2.14.2 ("Entity 'OrderLineItem' does not have property 'quantity'"), and
   its catch returns `[]` (`:97-99`). Observed with the seller id, for a seller
   with a linked product and an order for it: no sale and no "your cut" is listed
   whichever id is used (SD-52).
3. **The ledger figures read a credit no settlement writes.** They read only
   PURCHASE credits on SELLER_EARNINGS (`backend/src/shared/vendor-earnings.ts:58-72`);
   the purchase leg credits ESCROW (`hawala-ledger/service.ts:2204-2208`) and the
   seller and consignment legs are TRANSFER (`:2264`, `:1265`). So they would read
   0 for the right account too. This one is a reading of the code, not a database
   run.

Both also write on a read, once for each member who opens them (SD-51):

- `getGrowerTier(member id)` looks up the member id's plan, and `ensureAssignment`
  creates a free-plan `vendor_plan_assignment` keyed by the member id, with an
  ASSIGNED event (`backend/src/shared/seller-plan.ts:67`,
  `backend/src/modules/vendor-plan/service.ts:131-161`). Observed after the first
  D3 GET: the member id held a `free` row beside the seller's `scale` row; later
  GETs wrote nothing more. The rows are per member, not per seller: a second
  member of the same seller, made the way Mercur's member invite makes one, got a
  `free` row of its own on its first GET (observed).
- D4's first GET by each member also creates a SELLER_EARNINGS ledger account
  owned by that member's id (`grower-payout.ts:276`,
  `hawala-ledger/service.ts:723-740`); later GETs reuse it. Observed: none before,
  one after the first GET, still one after the second and third; none owned by the
  seller id.

### 4.2 Whether the tier machinery can run at all

Observed:

- **No character sheet can be created** (SD-50). `character_sheet` declares
  `food_produced_cents` and `capital_deployed_cents` as `model.bigNumber()`
  (`backend/src/modules/progression/models/character-sheet.ts:49`, `:53`), and a
  `bigNumber` field is written with a `raw_*` JSONB companion column. The
  migration that creates the table makes only the NUMERIC halves
  (`backend/src/modules/progression/migrations/Migration20260601CreateProgression.ts:31`,
  `:33`), and no migration adds the companions. Creating a sheet fails with
  `column "raw_food_produced_cents" of relation "character_sheet" does not exist`.
  `recordXpEvent` writes its `xp_event` row and then fails creating the sheet
  (`backend/src/modules/progression/service.ts:114-125`), so the event never
  reaches a total. `getGrowerTier(seller id)` throws.
- **No sale awards grower KARMA** (SD-52). The `order.placed` subscriber
  (`backend/src/subscribers/grower-karma-on-order-placed.ts:16-34`) first calls
  `loadOrderNodeContext`, which selects `items.quantity`
  (`backend/src/modules/agriculture/plant-order-helpers.ts:50-65`) and fails for
  every order. The subscriber logs the error and returns; no `xp_event` was
  written, with or without the two columns.

So on such a database nobody can hold an earned grower tier. Plan floors would
raise a displayed tier, but no route applies one (P7). Production's schema is not
visible.

The grower tier counts every PRODUCER-track XP point, whatever its source
(`backend/src/modules/progression/grower-karma.ts:212-216`). With the two columns
added by hand, for a scale-plan seller (observed):

- **Vendor verification accrues it.** The `vendor.verified` event carries the
  seller id (`backend/src/api/admin/seller-metadata/[seller_id]/route.ts:116-122`),
  and its subscriber credits 250 to the member the grower tier reads
  (`backend/src/subscribers/progression-vendor-verified.ts:33-50`).
- **So do wellness bookings.** Marking a booking completed through the vendor
  route, which is live and resolves the seller id
  (`backend/src/api/vendor/wellness/bookings/[id]/status/route.ts:36`), credited 1
  and a first-session bonus of 20 (`:75-87`); wellness KARMA is PRODUCER-track XP
  (`backend/src/modules/wellness/karma.ts:110-113`).
- **Vendor-quest XP does not.** The quest routes are dark: without
  `FF_VENDOR_QUESTS_V1` they answer 404 (`backend/src/api/middlewares.ts:1291-1295`).
  They also key enrollments by the member id that `getSellerId` returns
  (`backend/src/api/vendor/quests/enrollments/route.ts:52`, `:60`), and a stage's
  XP goes to that id (`backend/src/modules/vendor-quest/service.ts:159`), where the
  callback finds no seller and records nothing
  (`backend/src/api/vendor/quests/_helpers.ts:38-52`). Handed the seller id, the
  same callback recorded the XP. So quest XP would accrue only with the flag set,
  on a plan that includes quests, and with the routes keyed by the seller id
  (SD-49).
- **Sales do not** (SD-52). Both subscribers that award KARMA for a sale start
  with an order read that selects `items.quantity`, and it fails whatever the
  schema: the grower KARMA subscriber above, and the wellness one
  (`backend/src/subscribers/wellness-order-placed.ts:27-31`). With the columns
  present, neither wrote an `xp_event`.

`getGrowerTier` then read 321 for that seller: 250 for verification, 21 for the
booking and 50 from the quest callback handed the seller id.

## 5. KARMA-linked value that is not tier-linked

| # | Where | What | Reached? | F7 question |
|---|---|---|---|---|
| X1 | `POST /vendor/creator/credits/convert-xp`; `backend/src/lib/creator-credits.ts:13`, `:22`, `:29-31` | A seller's owner member converts spendable XP into Coalition Credits at 1,000 XP to 50 credits. Grower KARMA is PRODUCER-track XP and accrues to `spendable_xp` like any XP (`backend/src/modules/progression/service.ts:135-145`), so it converts too. Credits buy goods once `FBM_CCR_CHECKOUT_LIVE=1` and `FBM_CCR_CENTS_PER_CREDIT` are set (`backend/src/lib/ccr-checkout.ts:52`, `:71-74`). | Dark (`FBM_CREATOR_CREDITS_LIVE`; the route answers 404 without it, `convert-xp/route.ts:43-45`). On a migrations-built database no XP accrues to convert (§4.2). | Does "KARMA carries no money" cover this (§10.6)? |
| X2 | `backend/src/modules/progression/rewards.ts:33-85` | XP buys one theme, one emoji pack, an access pass and two PDFs (`:35`, `:45`, `:55`, `:66`, `:76`) | Live. On a migrations-built database no XP accrues to spend (§4.2). | Entitlements, not money. |
| X3 | `backend/src/modules/progression/thresholds.ts:47-63` | `producer.reduced-commission` was removed so that XP cannot buy a lower fee | Nothing to reach | Nothing to do. |
| X4 | `backend/src/modules/progression/thresholds.ts:65-72`, `producer.featured-listing` | Producer level 3 unlocks a "Featured Listing Slot" ("feature a listing on the market home"). FBM sells something close to it: featured placement in the vendor directory for 7, 30 or 90 days (`backend/src/shared/promoted-listing.ts:42-66`). | Not enforced: no code outside the file reads it (`thresholds.ts:40-44`); only its unit spec names it | Latent: if enforced, XP would earn what is otherwise bought. Does "KARMA carries no money" cover it (§10.6)? |

## 6. Tests that pin current values

| # | Test | Pins | Under one flat share (read from the assertions, not run) |
|---|---|---|---|
| T1 | `backend/src/modules/progression/__tests__/grower-karma.unit.spec.ts:28-35` | The split rises strictly with each tier | Fails (`toBeGreaterThan`) |
| T2 | `backend/src/api/store/karma-ladder/__tests__/karma-ladder.unit.spec.ts:43-56` and `:58-65` | The published ladder starts at 60 and ends at 72; the split rises strictly | Fails |
| T2b | The same file, `karma-ladder.unit.spec.ts:67-79` and `:104-117` | Plan floors exist; pro to Root and scale to Canopy are published with F8 off, none with it on | Passes unless the floors change |
| T3 | `backend/src/modules/payout-breakdown/__tests__/grower-payout.unit.spec.ts:4-41` | `computeNodeSplit` at 0.6, 1.0 and 0.62; `hub_sc` at 1.0; `node_nc_mtn` at 0.62; every node within 0.6 to 1.0; `PLATFORM_FEE` at 0.05 | Fails if `node_nc_mtn` moves off 0.62 or any node goes below 0.6 |
| T4 | `backend/src/modules/vendor-plan/__tests__/limits.unit.spec.ts:97-121` and `:168-170` | Floors name real tiers and never fall as plans rise; all_access floors nothing | Unaffected by the split |
| T5 | `backend/src/modules/progression/__tests__/coalition-tiers.unit.spec.ts:54-62` | Grower thresholds differ from coalition thresholds | Unaffected; thresholds stay |
| T6 | Mock fixtures: `nursery-portal/src/lib/mock/data.ts:162-185` (62% and 60%, with nets and cuts at those rates), `:295-303` (Analytics, D11: net at 60% of gross for January to April and 62% for May and June, the rest labelled fees) and `:358-364` (Network, D11: a grower pool of 719,780 on gross of 986,000, 73%, a rate no current tier pays); `botanical-portal/src/lib/mock/data.ts:910-966` (tier root at 76%, history at 76, 73, 73 and 70, the ladder retired on 2026-08-10) | Dev-mode numbers | Not tests, but they teach the numbers; recompute or remove them |

Baseline at `7b106a5b`: `pnpm test:unit -- <the five T1 to T5 files> --coverage=false`
in `backend/` passes 5 suites, 61 tests; `pnpm --filter @bmc/portal-kit test`
passes 4 files, 25 tests.

## 7. Parity specs

| # | Spec | What it guards | F7 note |
|---|---|---|---|
| E1 | `packages/bmc-portal-kit/src/tiers.parity.spec.ts` | It reads `GROWER_TIERS` out of the backend source (`:45-47`), requires a `split_pct` on every row (`:56-60`), and fails when a portal split differs (`:94-103`). | It passes if both sides flatten to the same S. Removing `split_pct` from `GROWER_TIERS` makes it throw "no tier rows parsed" (`:62-64`), so the spec has to change in the same commit. **CI never runs it:** the Portal Checks job runs only `portals:typecheck` and `portals:lint` (`.github/workflows/ci.yml:211-241`), and `pnpm portals:test` (`package.json:36`) is run by hand. |
| E2 | `packages/bmc-portal-kit/src/tiers.spec.ts:14-19` | Thresholds rise; the split never falls | Passes under a flat share (`toBeGreaterThanOrEqual`). Also not run by CI. |

## 8. Checked and found not KARMA-linked

Several of these are tiered, by plan, price, customer or speed, but none reads a
KARMA tier, an XP level or `split_pct` into an amount: the plan
commission ladder (`vendor-plan/catalog.ts`, F8); plan overage billing
(`vendor-plan/overage.ts`, `jobs/vendor-usage-billing.ts`), which is the money
`limits.ts` carries besides the tier floor, and is plan-linked; sliding-scale price
tiers (`lib/sliding-scale.ts`); wholesale and customer tiers and their payment terms
(`modules/vendor-rules`, `shared/ar-tiers.ts`); order-cycle and playbook commission
rates; tenancy tiers (`modules/tenancy/gates.ts`); wellness and creator membership
tiers; Blackout subscription tiers; multi-level referral levels
(`modules/creator-attribution`); payout speed tiers (L7); admin fee reductions
(`payout-breakdown/fee-resolution.ts`); vendor advances and investment pools; the
botanical portal's collective splits (contribution shares, mock only); the
coalition ladder (`progression/coalition-tiers.ts:22-26`, read only by Blackout's
join gate); the hawala KARMA rail (reputation events that the Posture A guard
refuses to transfer); asset-graph KARMA settlement; and vendor quests (XP gates, no
money).

## 9. Statements elsewhere that this inventory contradicts (left as they are)

This step edits only the plan's F7 status row. These say that a tier sets real
payout shares, or that the split is paid:

- `docs/BLACK_MASK_LAUNCH_PLAN.md:109` (§4) and `:128` (§5 F7, which asks for
  this inventory).
- `docs/BMC_SURVIVAL_PROGRAMS.md:95` ("It **does** set real payout shares") and
  `:137` ("Live, sets `split_pct`").
- `docs/reuse/00-internal-inventory.md:45-49`.
- `docs/TRUST_LANDSCAPE_AUDIT.md:286` and `:293-297`.
- Code comments: `grower-karma.ts:37-43`, `packages/bmc-portal-kit/src/tiers.ts:4-9`,
  `packages/bmc-portal-kit/src/tiers.parity.spec.ts:8-16`,
  `backend/src/api/store/karma-ladder/route.ts:18-25`,
  `storefront/src/app/[locale]/(main)/karma/page.tsx:17-19`,
  `backend/src/modules/progression/coalition-tiers.ts:5-7`,
  `backend/src/modules/vendor-plan/limits.ts:155-157` and `:180-182`.

On the other side, `docs/COMMERCE_ROADMAP.md:47` already records that the code
implements the flat 3% and calls a tier split "superseded legacy-archetype
framing", and commit `93bee66f` said the node split was left unchanged.

## 10. What the operator must decide

1. **Whether a hub cut exists at all.** Nothing takes one today. If none, the flat
   share is in effect 100% of the post-fee amount: F7 becomes copy and code
   removal (P1 to P6, D1 to D9 and D11, T1 to T3, E1; P7 as item 4 decides), and
   no grower's pay changes. If one
   does, it is a new deduction from what node growers are paid now, wired for the
   first time (P4 has no caller, and its order read has to be fixed first), and
   the L27 questions apply to it as new terms.
2. **The single flat share S**, if there is a hub cut: one number for every node
   and every tier. Confirm that `hub_sc` stays at 100% ("it IS the hub",
   `grower-payout.ts:32`).
3. **How "the 60-72% share" is defined.** The spec asks for exactly this
   confirmation, and the code holds three definitions:
   - `grower-payout.ts` (header `:4-9`, docblock `:31-33`, arithmetic `:64-75`):
     the grower's share of the line's post-platform-fee amount,
     `S x (unit price x quantity - platform fee at the seller's plan-resolved rate)`.
     So yes: as coded, it is the grower's share of post-platform-fee node net. On
     a $100 node sale at 3%, the net is $97, the grower keeps $58.20 at 60% and
     the hub takes $38.80. That base does not subtract the processing estimate
     (F6, `FF_FEE_FIRST_SPLIT_V1`) or a consignor's share (L3); it uses line gross
     where the ledger's fee base is the order subtotal (`toCents(order.subtotal)`
     in the card-ledger view, `hawala-order-payment.ts:144-151`); and its fee falls
     back to 5%, not 3% (`grower-payout.ts:47`).
   - The nursery payouts endpoint (D3), as written: `S x gross`, with no fee at
     all; on that code the same sale would show a "your cut" of $60.00. As run it
     lists no sale and shows 60% to everyone (§4.1), so this definition lives in
     the code and in the portal's mock data (T6), not in a figure the API has
     returned.
   - The `/karma` page (D2): "the share of a sale they keep", which reads as
     `S x gross`.

   Pick one base for S, and say whether it is taken before or after processing
   and before or after a consignor's share.
4. **Plan floors** (`limits.ts:126`, `:137`): keep them, so that a plan still buys
   a tier and its unlocks but no number, or retire them with the money. Per OI-6
   nobody is on those plans, and no route applies a floor today (P7).
5. **Copy:** what `/karma` and the nursery Payouts screen say after F7, and whether
   KarmaBar shows a percentage at all.
6. **XP to credits** (X1): does "KARMA carries no money" cover converting
   KARMA-earned XP into Coalition Credits? It is dark today. The same question
   applies to X4's featured-listing slot, which is not enforced.
7. **Fallbacks that encode the old ladder:** 60 in D3
   (`current-period/route.ts:90`), `?? 0.6` (`grower-payout.ts:192`) and the 5%
   fee (`:47`).
8. **When to fix SD-49 to SD-52.** Each fix changes what growers see or earn
   before F7 has decided what they should see. Keyed by the seller id, and with
   SD-50 fixed, D3 and D4 would start showing each grower a split that follows
   their KARMA and plan. With SD-50 fixed, PRODUCER KARMA would start accruing
   from vendor verification and from wellness bookings, but not from vendor
   quests, which are dark and give their XP to the member id (§4.2); with SD-52
   fixed too, from sales.
   Decide whether they land before, with or after F7's copy change.

## 11. What the L27 review could look at

Facts only; no conclusion is drawn here.

- **Existing balances.** No ledger row carries a tier share. The only rows a split
  could have produced are L1's (`grower-split:*` keys, COMMISSION into the SYSTEM
  PRODUCER_POOL account `hub_sc`); no code writes them, and nothing pays out of
  that account. Production is not visible from here; the operator can confirm with:

  ```sql
  SELECT count(*), coalesce(sum(amount), 0)
    FROM hawala_ledger_entry WHERE idempotency_key LIKE 'grower-split:%';
  SELECT id, balance
    FROM hawala_ledger_account
   WHERE account_type = 'PRODUCER_POOL' AND owner_type = 'SYSTEM' AND owner_id = 'hub_sc';
  ```

  Seller earnings are credited at the plan's rate (L2), and Mercur pays captured
  orders nightly (L6); neither by tier.
- **Pending orders.** Nothing pending carries a tier share. If a hub cut is
  introduced, the transitional set is the orders placed before the cut-over and
  paid out after it (Mercur pays per order, nightly).
- **What growers were shown, and since when.** The public `/karma` page and
  `GET /store/karma-ladder`, added 2026-08-10 (`8a05b613`): "What each grower tier
  pays", "the share of a sale they keep", and paid plans as "Tiers you can buy".
  The nursery payouts endpoint has existed since 2026-07-11 (`f5c66071`) and is
  written to show each grower their tier split, a net and "your cut". What it
  returns is tier Seedling, a 60% split and $0 for every money figure, to every
  seller, with no sales listed (§4.1). That was observed on a migrations-built
  database. Its causes are in the code (a member id used as a seller id, and an
  order read Medusa 2.14.2 refuses), so production should behave the same, but
  production was not observed. The route, `getSellerId` and `getSellerOrders` have
  not changed since 2026-07-11; the seller-context guard that rewrites the actor
  was already registered on `/vendor/**`, and Medusa was pinned at 2.14.2 then as
  now (GitHub history, not run on the July code). So, as far as this repository
  shows, the API has never shown a grower a tier-scaled amount of their own sales.
  A grower who
  opened the nursery Payouts screen against a live backend would have seen "Your
  split" at 60%, zeros, and the ladder from D7 (D5); the portals are not deployed
  by this repository (D10). Until 2026-08-10 the portal ladder showed 70% to 85%
  (`393063c2`); `docs/TRUST_LANDSCAPE_AUDIT.md:307-309` records the product view
  that nothing is owed to growers who saw it, which is a product statement, not
  counsel's. Meanwhile site-wide copy tells vendors they keep 97% of every sale
  (`storefront/src/lib/helpers/processing-copy.ts:102`, `:125`, `:154`). Who has
  actually seen these screens is for the operator: the plan counts 2 live vendors
  (`docs/BLACK_MASK_LAUNCH_PLAN.md:172`).
- **Which tier anyone holds.** On a migrations-built database nobody can hold an
  earned tier: no character sheet can be created (SD-50), and no sale awards
  grower KARMA (SD-52). Plan floors would raise a displayed tier, but no route
  applies one (P7), and per OI-6 no vendor is on those plans. Production's schema
  is not visible (§12). If it has the two columns, vendor verification and
  completed wellness bookings accrue PRODUCER KARMA there (§4.2), and
  verification alone (250) reaches Root
  (`backend/src/modules/progression/grower-karma.ts:57-63`). No endpoint would
  show that tier: only D3 and D4 compute a grower's tier, and both look growers
  up by the member id.
- **The seller terms.** The Terms say sellers agree to "a separate seller
  agreement" (`storefront/src/app/[locale]/(main)/legal/terms/page.tsx:115`); no
  seller agreement is in this repository, and `PRE_LAUNCH_AUDIT.md:294` (LEG-1,
  "add a seller agreement") is unchecked. The clause that authorises deductions
  reads: "You authorise us to accept payment on your behalf and to deduct our fees
  and any refunds or claim outcomes before disbursing the remainder to you."
  (`storefront/src/app/[locale]/(main)/legal/terms/page.tsx:123`). It is the
  clause a new hub cut paid to a hub account (§10.1) would be checked against.
  Whether any grower has a contractual claim to the tiered share is the L27
  question.
- **Consignment.** Dark; the split is product-metadata basis points of the
  seller-side amount (L3). If a hub cut and consignment both ran, P2's base would
  include the consignor's portion.
- **Patronage.** Proportional to commission paid (L4), with no tier input; L1
  would not count toward it.
- **Escrow.** No escrow leg has a tier input (L5).
- **Plan floors.** Plans have been advertised as buying a higher tier, and so a
  higher displayed split (D2, P7); no route has applied one (P7).
- **Where a hub cut's money would sit.** In a SYSTEM account that no code pays out
  of (P2). That bears on `docs/POSTURE_A_COMPLIANCE.md`'s third condition if a hub
  cut is designed; it is not assessed here.
- **XP to credits** (X1), dark; and the unenforced featured-listing slot (X4).

## 12. Not verified here

- Production data, schema and environment: which products carry `grower_node`,
  any `grower-split:*` rows, which flags are set, which sellers have an ACTIVE
  Mercur payout account, what Mercur commission rules exist, and whether
  `character_sheet` has the two `raw_*` columns (SD-50).
- Whether the four portals are hosted outside this repository.
- The test outcomes under a flattened ladder (§6, §7) are read from the
  assertions; this step did not run them against a flattened ladder. (One of the
  two reviews ran scratch mutation checks outside the repository and reported that
  every prediction held.)
- D3's third fault (PURCHASE credits, §4.1) is a reading of the code, not a
  database run. Its first two faults, the writes on read, and SD-50 and SD-52 were
  observed, in throwaway probes run on the integration harness's database (built
  from this repository's migrations, CI's fixture environment, the MikroORM patch
  applied); not on production.
- Whether the other 49 route files that import `getSellerId` cope with a member id
  (SD-49), beyond the vendor-quest XP award (§4.2), and whether the other order
  reads that select `items.quantity` fail (SD-52), was not checked.
- Commit history before 2026-09-07 comes from the GitHub commits API; this clone
  is shallow.
