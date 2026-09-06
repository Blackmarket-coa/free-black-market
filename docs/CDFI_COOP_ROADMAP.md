# CDFI, Co-op and Solidarity-Economy Roadmap — market connections reconciled against the code

Status: **code-verified 2026-09-05** against `free-black-market` `6585024`,
`blackout` `aee4837` and `Blackstar` `c86b335`; all ten features were
re-swept independently on 2026-09-06, four of the sweeps were then
adversarially verified, and the corrections are folded in. No code rides
with this document.

This document takes the ten features that came out of the market-connections
brainstorm — CDFI lending, co-op formation, farmers-market compliance, mutual
aid, co-op delivery and time banking — and reconciles each against what is
actually in `backend/src/modules/`, `backend/src/api/`, the storefront, the
vendor panel, and the two sibling repositories, in the same way
`docs/COMMERCE_ROADMAP.md` did for the B2B/community pivot. It is canonical
for the ordering of this cluster of work.

It does **not** supersede `docs/REPO_CONSOLIDATION_REVIEW.md` (decisions
D1–D8, the legal gates in its §8) or `docs/POSTURE_A_COMPLIANCE.md` (the
money-movement frame). Where this document and either of those could
conflict, they win and this one is wrong. Where a feature here overlaps a
tier in `docs/COMMERCE_ROADMAP.md` (barter adapters, micro-depot listings,
seed library, market-day mode), that roadmap keeps the item and this one
points at it rather than re-scheduling it.

**The headline finding: the brainstorm was more built than it knew.** Of the
ten features, three are already a quest definition in the Vendor Quest Engine
(the CDFI quest is Q3, the certification assistant is Q8, co-op formation is
Q11), one is a settlement rail that is specified and guarded but not lit (time
bank hours), one is a template library that already ships — in Blackout, not
FBM — and one is a CSA primitive the operations guide already calls a wedge
product, half of which (the share-box season) is a service nothing calls.
The two items the brainstorm ranked "highest value, lowest build cost" —
the CDFI quest and the bylaws library — are both definition and wiring
changes, not builds. Two items were framed in a way the code and the
compliance posture cannot support (a time-bank *payment* rail; an *existing*
set of barter adapters), and one (insurance pooling) needs a ruling before a
line of it is designed. Checking the tree this closely also turned up a
dozen defects on the surfaces these features would build on; they are
recorded in §1a and go first.

---

## 1. Corrections — the brainstorm against the code

Each row was checked by opening the cited files, not by matching module
names — `docs/COMMERCE_ROADMAP.md` §3.3 records what module-name matching
missed. Rows are ordered by how much the correction changes the plan.

| Claim in the brainstorm | What the code says | Consequence |
| --- | --- | --- |
| **Add a CDFI loan-readiness quest to the Vendor Quest Engine's capital/funding family** | It is already there. Q3 `microlender-readiness` (`backend/src/modules/vendor-quest/definitions/microlender-readiness.ts`) is titled "Microlender / CDFI Readiness", sits in "Capital & Funding" beside Q1 `fsa-farm-loan`, Q2 `grant-readiness` and Q4 `crowdfunding-traction`, and runs three stage gates (Operating → Documented → Lender-Ready, the last at 6 months and $500 lifetime revenue) into a "Lender Summary" packet. Its four requirements read the universal substrate — recorded income, tenure, three months of cash-flow buckets — plus one vendor-supplied checklist item (character references). Its single gatekeeper link is Kiva — and an enrolled vendor never sees it: the vendor catalog serializer (`vendor-quest/service.ts` `toCatalogEntry`) drops `gatekeeper.links`, the vendor-panel `QuestCatalogEntry` type carries `gatekeeper: string`, and the packet export carries name and disclaimer but no links; only the public `/quests` page (via `GET /store/quest-catalog`) renders them. The engine is generic by construction: adding a requirement, a link or a packet section is a definition change, and the engine test fails if a quest key leaks into `engine.ts`. Q1 `fsa-farm-loan` is the fuller lender template in the same family (nine requirements, a seven-section packet with `business_plan_draft` and `vault_documents` sections). Quests are a plan feature: `/vendor/quests*` requires `FF_VENDOR_QUESTS_V1` **and** `vendor.quests`, which the `scale` and `internal` plans, the `quest_pack` add-on ("Readiness Quests", $49 for 30 days) or an aligned-org tenancy tier grant; `starter` and `pro` do not. | **Extend Q3, do not add a quest — and make the links reach the vendor.** What is missing is CDFI-specific: the document items a CDFI underwriter asks for beyond what the ledger proves (a business plan — the vault already has a `business_plan` type nothing in Q3 reads — a use-of-funds statement, entity documents), gatekeeper links to real CDFI locators rather than one crowdfunder, and the two-line serializer change that lets the panel and the packet show them. Whether capital-access quests belong behind a paid add-on is a pricing question for the operator, recorded in §4. §3.1. |
| **CDFI/credit-union directory + referral layer, searchable by location and type** | Nothing exists — no module, route, seed or page (`referral` is seller-refers-seller affiliate attribution paying a `REFERRAL_FEE` share, not lender referral). The only refer-out primitive in the tree is `gatekeeper.links` on a quest definition, and four of thirteen definitions carry any. Three code-config registry patterns exist to copy: `donation/fiscal-sponsors.ts` (a keyed registry of external partners with display fields, a `live` flag and an env-selected default), `opportunity-engine/startup-guides/index.ts` (a code catalog seeded into a table and served at `GET /store/startup-guides` → storefront `/start-business`), and `channel-connector/catalog.ts`, whose docblock rule — never list an entry that cannot work — should govern a directory too. Storefront directory shapes exist to mirror: `/directory` (server-rendered filter form over `GET /store/directory`), `/vendors` (ZIP → coordinates → `radius_miles` over `GET /store/vendors`), and the static `/community-resources` card hub. Location search has W5's `lib/zip3` + `lib/geo-distance` behind `GET /store/geocode`; Blackout's `/v1/spatial/*` is geocode-only ("no nearby search"). `docs/POSTURE_A_COMPLIANCE.md` records the banking-partner choice itself as an open, non-blocking question that "affects vendor onboarding copy" — no copy or code implements it today. | **Build, small, as refer-out.** Posture A rule 6 already refers unbanked vendors to named banking partners and says FBM "does not stand between the vendor and that partner". A directory is that rule made into a table: link out, never hand off an application, never take a fee (§5 records why the fee is a gate) — and it closes the open onboarding-copy question. It must sit apart from `hawala-ledger`'s quiescent `VendorAdvance` / `VendorCreditLine` models: a directory exists precisely because FBM cannot lend, and nothing may read as "FBM financing". §3.2. |
| **Fiscal sponsorship pathway for co-op-structured vendors** | `docs/FISCAL_SPONSOR_DECISION.md` and `fiscal-sponsors.ts` are about **FBM's own** sponsor for routing checkout donations (Allied Media Projects recommended, agreement not signed, disbursement job held — and, as §1a records, the widget already tells donors otherwise). The only vendor-facing mention is two plain-text prerequisites on the Harvest→Grove and Service→Grove progression edges ("A fiscal sponsor if you intend to take donations"), rendered with no link. Q11 `coop-formation.ts` marks incorporation "outside-fbm — FBM never generates legal filings". The bookkeeping a sponsored project is actually audited on — restricted funds, award vs. receipt vs. spend, spend inside the period — shipped last week as `modules/fund-accounting` behind `FF_FUND_ACCOUNTING_V1`, and nothing in the quest substrate reads it yet. | **Split the ask.** Fiscal sponsorship fits charitable-purpose projects (a mutual-aid pod, a community fridge, a garden — the Grove and Harvest shapes), not a for-profit worker co-op, whose path is incorporation (Q11, §3.4). The vendor-facing pathway is a new *definition* — fiscal-sponsorship readiness — reading `fund-accounting` as a domain-optional substrate field and linking out to the sponsors already in the registry. It moves no money. §3.3. |
| **Bylaws/incorporation template library, borrowing Fairmondo's model of sharing co-op docs** | It ships today — in Blackout. `apps/blackout-client/src/app/features/documents/templates/index.ts` seeds four founding documents (bylaws, mission, decision rules, mutual-aid agreement) adapted from SELC, USFWC and Center for Family Life sources with licence attribution, stored as Matrix state events per den (`co.bmc.den.documents`, `packages/blackout-protocol/src/documents/contracts.ts`) and edited in the Documents tool of the Coalition tool sheet on route `/coalition` — per-den, not feature-flagged, and with no export, download, print or HTTP API: a vendor gets text out of it by copying from a textarea. The seeds are ~30-line scaffolds that "point cooperatives at the canonical source material rather than reproducing it"; the licence `attribution` field is never rendered, and the mutual-aid seed is CC BY-NC. The docblock records that legal review of production text is "a parallel content task". On the FBM side Q11 asks for "Governance / bylaws" as a vendor-supplied vault upload, its packet lists bylaws, articles and a member-equity agreement as remaining items, and the vault's `doc_type` enum (`lease, contract, license, insurance, credential, business_plan, other`) has no governing-document type. FBM's `knowledge-base` is DIY and gardening content, not legal. | **Wire, do not build a second library.** Under the two-layer model (FBM substrate, Blackout governance interface) the templates are in the right repo. FBM's part is a vault document type and a link from Q11 to the Blackout surface; Blackout's part is a way to get a finished document *out* as a file the vendor can upload to the vault. The Fairmondo angle has a gap the code cannot close: `docs/MEMBER_GOVERNANCE.md` records that platform-level member governance "does not exist", so there are no coalition bylaws to publish yet. "Removes the single biggest barrier" overclaims what six one-line headings can do; the honest framing is scaffolds plus referral to SELC, USFWC and the vendor's state. §3.4. |
| **Shared back-office service marketplace (insurance pooling, payroll, legal referrals) as a connect.js add-on tier** | `connect.js` is the buyer-facing storefront embed, frozen at v2.0.0 under SRI pinning and a changelog (`docs/integrations/fbm-connect-changelog.md`); it has no vendor-facing tier concept. Vendor monetization lives in `vendor-plan` (plans + 30-day add-on windows, `docs/ADDON_COMMITMENTS.md`); `plugin-registry` (W3) lists installable *software* only (`MARKETPLACE_EXTENSION | ANALYTICS | AUTOMATION`, signed bundles with a manifest), so it can host a bookkeeping-sync plugin but not a payroll company; `service-program` is a vendor-to-vendor marketplace for *physical* production services (press, packaging, co-packing…). Payroll is already outside FBM in code: Q7 `ready-to-hire` names "your payroll provider" as gatekeeper and lists payroll/tax registration and workers' comp as remaining items. No repo scopes insurance pooling, a captive, payroll or a PEO as a product — but `hawala-ledger` carries a **dormant chargeback-insurance pool schema** (`ChargebackProtection`, `ChargebackClaim`: 0.2% contributions, capped coverage, claim adjudication states; tables migrated, zero readers or writers, absent from Posture A's quiescent list). | **Wrong surface, and three different features.** Legal and back-office *referrals* are directory entries (§3.2, same registry, a `legal`/`back_office` category). Payroll is a banking-as-a-service shape Posture A rule 6 forbids FBM to offer — refer out. Insurance *pooling* means FBM holding pooled premiums and paying claims: a regulated, custodial product with no recorded gate, in the same class as the custodial-deposit question `docs/COMMERCE_ROADMAP.md` §4 already flags. Gate-first; recommended disposition is "not on the roadmap, deliberately". The "recurring revenue line" does not survive: a refer-out directory earns nothing, and a compensated referral is itself a gate. §3.5. |
| **Certification/compliance assistant (organic cert, scale certification paperwork)** | Q8 `compliance-tracker` exists (`definitions/compliance-tracker.ts`) — but organic, Certified Naturally Grown, cottage-food, food-handler and practitioner credentials appear only in its docblock. Its coded requirements are four generic items (`doc_checklist`, `production_records`, `sourcing`, `inspection_forms`), its gatekeeper links are empty, its gates test only the `license`/`credential` vault types, and `sourcing` is `assisted` with no predicate, so it auto-satisfies (§1a). It is a generic document tracker with a certification title. Certification truth is also kept in two other stores that never read the vault: `vendor-verification` badges (`ORGANIC_CERTIFIED`, `REGENERATIVE`, `FAIR_TRADE`…, with certifying body, expiry, a daily expiry job and storefront trust indicators) and `producer.certifications` JSON with its own admin verify route and 30-day recertification notices. The vault gained real verification and expiry on 2026-09-03: `PATCH /admin/vault/:id` is `markVerified`'s first caller and `document-status.ts` derives `effective_status` so an expired certificate stops reading as verified. `modules/cottage-food` already tracks permit and food-handler expiry as **self-declared** facts and refuses to ship a state-law table. `docs/COMMERCE_ROADMAP.md` records the organic/regenerative document type as blocked on the `doc_type` enum conversion (its §4 decision 5) — but the repo already adds enum values in their own idempotent migration (`ALTER TYPE … ADD VALUE IF NOT EXISTS`, `demand-pool/migrations/Migration20260604AddBountyObjectiveTypes.ts`), so the type is a one-line migration and the conversion stays a hygiene ruling. The expiry-reminder rail is unbuilt (`ar.invoice.overdue` has no subscriber; the vendor in-app feed reader has no producer). Neither panel shows the 2026-09-03 expiry work: the vendor vault table renders the raw `verified` flag, so a lapsed certificate still reads "Verified", and there is no admin screen for the `/admin/vault` queue. "Scale certification" (weights-and-measures device certificates for selling by weight) appears nowhere, and neither do the sell-by-weight pricing fields it would accompany. | **Extend Q8; no new module — and choose the vault as the evidence store.** Give Q8 real requirements and links, add the document types now, make the two panels show derived status, and build the one shared reminder rail that vault expiry and AR overdue both need. Nursery-side learnings become checklist content, under the cottage-food rule: the seller declares, FBM ships no regulatory table. §3.6. |
| **CSA/Order Cycles is scoped; market it to CSA networks** | Half of it is shipped. `modules/order-cycle` carries nine models; the cycle half — cycles, incoming/outgoing exchanges, per-cycle products, seller roles, enterprise fees — has vendor routes (`/vendor/order-cycles/**`, `/vendor/enterprise-fees`), public reads (`/store/order-cycles`, `/[id]`), a five-minute status job and complete vendor-panel screens. The share-box half — template, subscription, box, and the whole scheduler in `service.ts` — is model + service + unit spec only: no route, job, workflow or screen calls any of it, and `share_box_subscription` carries no price, payment method, cart, order or link to the `subscription` module (which has Stripe renewal, dark behind `FBM_SUBSCRIPTION_RENEWAL_LIVE`). Nothing in the storefront calls `/store/order-cycles`; no cart or order path writes `order.metadata.order_cycle_id`, so the order-placed subscriber never fires and `sold_quantity` never moves; per-cycle caps and enterprise fees are configurable and never enforced or settled. Blackout already has the *consumer* side — a per-vendor "order cycles" announcement room and `cycle.open / cycle.close / sold_out` formatting — and FBM emits none of those events. The Cycle playbook, the `CSA` cooperative type, the vendor-types card and `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` §1.3 ("wedge product"; "share-box scheduler 100% shipped") all describe the feature as complete. | **Wire, then reposition.** §3.7's own end-to-end check was run and fails at step one: a coordinator cannot create a share template. Pitching CSA networks today would advertise a dead end. The wiring is M and mostly routes and one storefront page; the positioning follows it. |
| **A mutual-aid network adapter alongside the existing Craigslist/TrashNothing/hOurworld barter adapters** | The barter adapters do not exist. `docs/COMMERCE_ROADMAP.md` §3.7 and `docs/FBM_BUYER_HUB.md` §1 both say so; `modules/barter` is one `barter_proposal` model with two routes under `/store/collective/demand-pools/[id]/barter`. The **internal** side is better built than barter's, but unevenly: `mutual-aid` itself is two models and four routes (`/store/mutual-aid/requests`, `/offers`, `/[id]/match`, `/[id]/confirm`) with a privacy-split location and **no screen anywhere** — no storefront page, no panel, no `connect.js` kind — and no writer for its `WITHDRAWN`/`EXPIRED` states; the Grove playbook's `hasRequests` toggles the generic `request` module, not this one. What reaches a screen is the hub side: `aid-network` (hubs, lot-level stock, in-kind intake, transfers, an allocation planner and an 899-line panel, behind `FF_AID_NETWORK_V1`), `donation`, `fund-accounting`, `volunteer`. The ask path that *does* have UI is `demand_post` with its `MUTUAL_AID` buyer archetype (storefront demand-pool pages, the vendorless `data-fbm="demand-pools"` embed, the `/store/cooperatives/[handle]/needs` board). Blackout has three mutual-aid surfaces, not one: server-backed coalition aid posts (`/v1/coalition/mutual-aid`, `coalition_aid_posts`, precise coordinates required), deaddrop aid threads (protocol and client, no server route), and aid pools whose money is FBM tips. No document in either repo names an external mutual-aid network with an API. hOurworld is a time-bank network, so it belongs with §3.10, not here. | **Correct the premise, then wire before adapting — and the wire is not pure.** FBM publishes locality and a distance band only (the W5-3 privacy exclusion); Blackout's aid-post table requires coordinates, so a mirrored ask either lands without a map pin or Blackout admits coordinate-less posts. An external adapter follows the channel-connector rule: no catalogue entry without a working adapter against a named target. §3.8. |
| **Co-op delivery pooling — micro-depot relay points — activates Blackstar's mesh routing** | Blackstar has the relay half: `ShipmentLeg` (sequence, from/to node, handoff proof, settlement ref, a guarded state machine) with list/create/update routes and `api/docs/shipment-leg-relay-protocol.md`'s multi-leg completion rules. It does not have depots, pooling or mesh routing — `CONSOLIDATION.md` records that "mesh routing, batch aggregation, micro-depots, reverse-auction" exist as design docs only (`api/docs/network-advantage-engine.md`), and its `Node` model is a legal entity with attestations and a service radius that has no centre — the table carries no coordinates, no kind, no hours, no capacity — while listings hold origin and destination as free strings. The relay is API-only (the console has no board or leg screen), and FBM cannot see it: the receiver's event map holds the five listing-level events, so `shipment.leg.updated` and `shipment.leg.handoff_proof` are accepted and ignored, and contract v1 has no per-parcel key. Blackstar was unfrozen on 2026-09-03; the bridge is dark by default and per-shipment sequence numbers are an open bilateral change. On the FBM side the *batch* noun already exists — `food-distribution`'s `food_delivery_batch` is one courier run carrying many producers' deliveries, with `/store/delivery-batches` routes — and `order-cycle` already aggregates many producers to one scheduled pickup; what FBM lacks is a depot noun and a planner. `docs/COMMERCE_ROADMAP.md` Tier 3.8 plans micro-depot *listings* on whichever of `rental`/`kitchen` survives (its §4 decision 2); `aid-network`'s `network_node` is the closest "place that holds stock" but is single-seller (transfers refuse another seller's node). Blackout carries a consumer for `blackstar.driver_assigned / pickup_confirmed / delivered / failed` logistics events that FBM never emits, in a vocabulary that differs from the FBM↔Blackstar contract. | **Sequence it; it is not near-term.** A depot is first an FBM listing (Tier 3.8, waiting on a ruling), then a Blackstar node kind a leg can hand off to plus the contract change that lets FBM see legs, and only then a pooling problem (design only). §3.9. |
| **Time bank as an alt payment rail alongside Stellar/USDC** | The rail exists and the framing is wrong. `hawala-ledger/rails.ts` defines HRS as closed-loop, member-to-member, `account_type: TIME_BANK`, `cash_convertible: false`; `posture-a-guard.ts` enforces the time-bank rules (no self-transfer; a `TIMEBANK_*` reference type on every entry); `dual-rail-selector.ts` **throws** `NonCashRailError` if anyone tries to settle HRS the way USDC settles. Hours are not, and under Posture A cannot be, checkout tender for goods — they settle labour between members of a collective (the courier-collective, childcare and tool-library manifests declare `hours` for exactly that). And the rail is not lit: no dedicated provisioning path creates a `TIME_BANK` account (the unvalidated `POST /admin/hawala/accounts` could, by accident), and nothing can fund one — `createTransfer` refuses overdraft and no `ISSUE` or `HOURS_OPEN_BALANCE` writer exists, so an opening balance cannot be posted from an empty reserve; the `HOURS_*`/`TIMEBANK_*` entry types the guard and reconciler use are absent from the `ledger_entry.entry_type` enum; and the guard cites a "§ hours rail" section of `docs/POSTURE_A_COMPLIANCE.md` that does not exist. The `modules/volunteer` hours stack is dead rather than parallel: `garden_time_credit`'s only writer has no callers and writes fields the model lacks, and the storefront character sheet's "Time Credits" stat reads a non-existent entity, so it is always 0. Blackout's Grove den playbook seeds "4 FBM-HOUR" and its reveal screen tells the user their den "starts with 4 FBM-HOUR in its kitty" — a live promise with no ledger behind it and a unit name (`FBM-HOUR`) that is not FBM's (`HRS`). | **Reframe, then ignite.** Position hours as a labour-settlement rail inside collectives, never as a way to pay for goods. The build is `docs/CCR_HRS_IGNITION.md` §5 steps 4–5, which cannot run ahead of its step 1 (issuance), gated on the policy answers only the operator can give — including one that document does not list: issued hours from a reserve, or mutual credit that lets balances go negative, which the ledger's non-negative invariant forbids today. Retire the dead volunteer hours model the way channel points were decided in W1b. §3.10. |
| **KARMA tiers are an existing system the quests build on** | Confirmed, with one precision: the ladder is `progression/grower-karma.ts` (`GROWER_TIERS`, published at `GET /store/karma-ladder`) and the canonical reputation write path is `karma_event` (D7). The quest substrate reads `reputation.tier` from it. | No change. Cite `karma_event`, not "KARMA tiers", when positioning. |
| **The time bank belongs with Blackout and connect.js** | Neither. The rail and its guards are FBM (`hawala-ledger`); Blackout carries vocabulary (`FBM-HOUR`) and templates; `connect.js` carries nothing about hours. | The cross-repo contract, when written, is FBM-canonical with a Blackout consumer mirror, following `docs/contracts/mas-identity-consumer.md`. |

### 1a. Found along the way — the quest substrate under-reports, and three quests cannot finish

Not in the brainstorm, but every extension in §3 leans on the quest engine,
so it is recorded here rather than left for the next audit.

`substrate/build.ts` initialises five substrate fields and never assigns
them again: `operating.orders_fulfilled` (0), `operating.fulfillment_reliability`
(`null`), `customers.wholesale_relationships` (0), `reputation.total_xp`
(0) and `reputation.dispute_count` (0). Every quest reads the same
substrate, so the effect is catalogue-wide:

- **Q5 `wholesale-account` cannot pass its second gate** — it needs five
  fulfilled orders, then 90% proven reliability and twenty orders; both
  figures are constant. **Q7 `ready-to-hire`** needs fifty, then a hundred.
  **Q13 `commons-contribution`** needs `total_xp > 0` at its "Established"
  gate. None of the three can reach its final stage for any vendor.
- **Q10 `trust-tier` and Q13's "clean dispute record" cannot fail** —
  `dispute_count` is never read from `order-dispute`, so the check is
  always true. A quest that says "resolve open disputes" and never notices
  one is the honest-UI constraint inverted.
- Packets for Q1, Q5, Q7, Q11 and Q12 print `orders_fulfilled: 0` as if it
  were a fact about the vendor.
- One engine rule compounds it: an `assisted` or `platform` requirement
  with no `satisfied` predicate and no missing `needs` evaluates
  **satisfied** unconditionally (`engine.ts`). Q1's `business_plan`
  requirement is `assisted` with no predicate, so it reads as met before
  any plan exists. Q3's extension in §3.1 must give its `business_plan` a
  real predicate; Q1's should get the same one.

The fix is substrate work the authoring guide already sanctions ("map any
missing substrate field in `substrate/build.ts`"): fulfilled orders and
reliability from the orders the customers builder already queries; disputes
from `order-dispute`, which has been keyed by `(order_id, seller_id)` since
2026-09-03; wholesale relationships from `vendor-rules` customer tiers. XP
is the one field without an obvious seller-scoped source — `progression`'s
`xp_event` is member-keyed — so either the vendor-side projection of
`karma_event` (D7) feeds it, or Q13's gate stops reading it; a constant is
the one option that is wrong. S–M, no ruling needed, and it belongs before
any new lender is shown a packet.

The re-sweep of 2026-09-06 found four more, each outside the brainstorm and
each on a surface this roadmap would otherwise build on:

- **The donation rail over-claims, and one of its routes is mis-scoped.**
  Every entry in `FISCAL_SPONSORS` is `live: false`, yet
  `deriveDonationSettingsFields` always emits the sponsor's name, so the
  checkout widget (`CartReview/DonationPreferences.tsx`) tells donors their
  gift is "Routed through Allied Media Projects, our 501(c)(3) fiscal
  sponsor"; the "pending fiscal sponsor — routing held" copy that
  `docs/FISCAL_SPONSOR_DECISION.md` describes does not exist, and the home
  and `/why-we-exist` pages promise "fiscally-sponsored giving". The
  disbursement job creates `pending` rows from beneficiary metadata and
  never posts to `hawala-ledger`; nothing reads `fiscal_sponsor_account_id`.
  Separately, `POST /vendor/donations/settings` upserts the **single
  platform-default** settings row behind seller-only auth, so any seller can
  change platform-wide donation percentage and settlement mode; and its
  schema accepts `settlement_mode: "direct"`, a value the model enum
  (`split_processor | ledger_batch`) does not have. Fix the copy and the
  route before §3.3 ships anything that inherits them. *Closed 2026-09-06
  (route):* the vendor route now answers `POST` with 403 and the panel block
  is read-only; only `/admin/donations/settings` writes the row, and the
  `direct` value left with the vendor schema. The copy fix stays open.
- **A dormant insurance pool is already in the money core.**
  `hawala-ledger/models/payout-config.ts` defines `ChargebackProtection`
  ("Pool for vendor chargeback insurance": 0.2% of each sale, capped
  coverage, `BUILDING → ACTIVE → SUSPENDED`) and `ChargebackClaim`. The
  tables are migrated; no service method, route, job or Stripe dispute
  handler touches them; `lib/blackout-stub-emitters.ts` calls the shape
  dormant; `docs/POSTURE_A_COMPLIANCE.md`'s quiescent-models list omits it.
  It overlaps the `order-dispute` engine that `docs/COMMERCE_ROADMAP.md`
  §3.3 made the single dispute engine. Quiesce it in that list or drop the
  tables (§3.5). *Listed 2026-09-06* in Posture A's quiescent models; the
  keep-or-drop ruling is still decision 8.
- **Q8 is a certification quest without certification content**, and its
  `sourcing` requirement auto-satisfies for the same engine reason as Q1's
  business plan. Certification truth is held three ways — vault documents,
  `vendor-verification` badges, `producer.certifications` — with three
  separate admin verify paths that never update each other, and three
  expiry calculators with three day-count conventions (§3.6).
- **The vault's verification and expiry work is invisible in both
  panels.** `GET /vendor/vault` returns `effective_status` and
  `days_until_expiry`; the vendor-panel table ignores both and renders the
  stored `verified` boolean. `PATCH /admin/vault/:id` — `markVerified`'s
  only caller — has no admin-panel screen, so a document can be verified
  only by calling the API. Both are S.

The adversarial verification of 2026-09-06 added four more:

- **`GET /vendor/order-cycles` returns every vendor's cycles.** The list
  filters on status only and the `/vendor/**` middleware authenticates
  without scoping, so any seller reads every coordinator's draft and closed
  cycles; the `?seller_id=` filter on the store read maps the wrong column
  and always comes back empty. Two dead buttons sit on the panel screens
  ("Import OFN" posts to a route that does not exist; "remove product"
  calls a `DELETE` that does not exist). S each, and the first is a
  data-exposure fix before anything else in §3.7. *Closed 2026-09-06:* the
  list is scoped to the cycles the caller coordinates or takes part in, and
  the store filter — plus the service's two seller lookups that shared the
  wrong-column bug — now map `order_cycle_id`. The two dead buttons stay
  open.
- **A cash-advance surface is live against a model Posture A calls
  quiescent.** The vendor-panel Finances screen renders an "unlock cash
  advances" section with a request button against `GET/POST
  /vendor/hawala/advances`, which sit behind no flag, plan feature or
  middleware matcher, while `docs/POSTURE_A_COMPLIANCE.md` records
  `VendorAdvance` as "quiescent under Posture A — activate only after legal
  review". Gate or hide it (S); no lender directory may sit beside it.
  *Closed 2026-09-06:* the routes sit behind `FF_VENDOR_ADVANCES_V1` and the
  panel section behind `VITE_FF_VENDOR_ADVANCES_V1`, both default off;
  flipping them is the activation Posture A gates.
- **The donation rail's documents disagree with its code twice more.**
  `docs/FISCAL_SPONSOR_DECISION.md` says a non-live sponsor forces
  `settlement_mode` to `ledger_batch`; the service never touches
  `settlement_mode`. `docs/POSTURE_A_COMPLIANCE.md`'s CI invariant for the
  donation job cites a spec file name that does not exist, and the spec
  that does exist has no donation assertion. And the admin settings route
  refuses `ledger_batch` unless the tenancy grants it while the vendor
  route applies no such check on the same row.
- **The volunteer hours stack is broken end to end.** `garden_time_credit`'s
  only writer (`verifyVolunteerHoursWorkflow`) has no callers and writes
  columns the model does not have; `POST /store/gardens/[id]/members`
  writes three fields `garden_membership` lacks; `progression`'s aggregate
  recompute queries an entity and field that do not exist and swallows the
  error, so the storefront character sheet's "⏱ Time Credits" stat is
  always 0. Retire or repair before any time-bank copy points at it (§3.10).

---

## 2. What these features already stand on

For planning, the substrate that exists today:

- **Quest engine** — `vendor-quest` (engine, substrate, packet, five owned tables)
  with thirteen definitions, of which six are directly relevant here: Q1
  `fsa-farm-loan`, Q2 `grant-readiness`, Q3 `microlender-readiness`, Q6
  `market-vendor` (farmers-market stall / co-op membership bundle), Q8
  `compliance-tracker`, Q11 `coop-formation` (collective) and Q12
  `land-pooling` (collective — "shared land, equipment, or cold storage").
  Behind `FF_VENDOR_QUESTS_V1` plus the `vendor.quests` plan feature; routes
  `GET /vendor/quests` (catalog), `/vendor/quests/enrollments` (+ `/[id]`,
  `/[id]/packet`), `/vendor/quests/collective/*`, and the public
  `GET /store/quest-catalog`; vendor-panel screens `/quests` and
  `/quests/:id`; storefront page `/quests`.
- **Documents and verification** — `document-vault` (typed uploads, admin
  `markVerified`, derived expiry status, `/admin/vault?expiring_within=`),
  `vendor-verification` (buyer-facing certification badges with certifying
  body and expiry, daily expiry job, storefront trust indicators),
  `producer.certifications` (farm-profile JSON with its own verify route),
  `cottage-food` (self-declared permits, caps and labels; never blocks a
  sale), and `agriculture`'s phytosanitary-certificate classifier (no route
  or UI yet).
- **Cooperative forms** — the eleven playbooks (`playbook/recipes/*`: Grove,
  Workshop, Commons, Cycle, Harvest, Hub, Service among them), the 23-edge
  progression map (`playbook/progressions.ts`, `docs/VENDOR_PROGRESSIONS.md`)
  that already names `coop-formation` as the quest on the Atelier→Workshop,
  Atelier→Commons, Workshop→Commons and Grove→Commons edges, `cooperative`
  (with `FARM_COOP`, `FOOD_HUB`, `CSA`, `BUYING_CLUB`, `INDIGENOUS`,
  `WORKER_OWNED` types), and `governance` (garden-scoped proposals, votes,
  delegation).
- **Mutual aid** — `mutual-aid` (routes only, no screen), `aid-network`
  (routes and a panel), `donation` (+ the fiscal-sponsor registry),
  `volunteer`, `fund-accounting`, `demand-pool`'s `MUTUAL_AID` archetype
  (the ask path that has UI), the Threshold surface
  (`docs/COMPOSITION_LAYER.md`), and Blackout's coalition aid posts, aid
  pools and Grove den playbook.
- **Recurring and cyclical supply** — `order-cycle` (the cycle half
  surfaced; the share-box half service-only), `subscription` (Stripe
  renewal, dark), `season` (crop planning, not a selling season),
  `agriculture`, `harvest`.
- **Money and rails** — `hawala-ledger` with the six-rail registry
  (`rails.ts`), the Posture A guard, the dual-rail selector, escrow with
  arbitration, external reconciliation, monitors and lineage (W1a);
  `payout-breakdown`; the asset-graph settlement reconciler as the HRS and
  KARMA writer.
- **Partner registries to copy** — `donation/fiscal-sponsors.ts`,
  `channel-connector/catalog.ts`, `vendor-quest/definitions/index.ts`.
- **Logistics** — FBM `blackstar-fulfillment` (+ provider, receiver,
  `/admin/blackstar/deliveries`), `delivery`, `local-delivery-fulfillment`,
  `food-distribution`; Blackstar shipment board, claims, `ShipmentLeg`
  relay, node attestation; the `courier-collective` manifest.
- **Reach** — `docs/WEBSITE_POSITIONING_ALIGNMENT_PLAN.md`, the storefront
  vendor-types page (eleven playbook cards including "Mutual-Aid Co-op",
  "CSA & Order-Cycle Farm" and "Time-Bank & Sliding-Scale Services"),
  `docs/SNAP_EBT_RESEARCH.md`.

---

## 3. The verified gaps

Sizes follow `docs/AUDIT_DEBT.md`: **S** ≤ 1 day · **M** 2–5 days · **L** >
1 week.

### 3.1 Q3 is generic; a CDFI application is not — **extend, S**

Q3 proves what the ledger can prove (income, tenure, cash-flow) and stops.
A CDFI or credit-union small-business application typically also asks for a
business plan and use-of-funds statement, personal financial statements and
tax returns, entity documents, collateral or a co-signer, and references —
none of which FBM may generate (hard constraint 1, "assemble, never
fabricate"), all of which it can *checklist* and, for documents, store in
the vault.

The definition change is confined to `definitions/microlender-readiness.ts`,
modelled on Q1's document handling:

- Requirements: `business_plan` (`assisted`, `needs: ["documents"]`,
  satisfied by `hasVerifiedDocType("business_plan")` — the type already
  exists, the vendor-panel vault screen already offers it, and nothing
  reads it; the predicate matters because of the auto-satisfy rule in §1a),
  `use_of_funds` (vendor-supplied), `entity_documents` (vendor-supplied;
  for a co-op, points at Q11), `personal_financials_tax_returns`
  (outside-fbm), `collateral_or_cosigner` (outside-fbm).
- Gatekeeper links: the CDFI Fund's certified-CDFI list and the Opportunity
  Finance Network locator as the generic entry points, plus whatever named
  lenders the §3.2 registry carries. Kiva stays as the crowdfunding option.
- Packet: a third section, "Documents (verified state shown)", identical in
  shape to Q8's and Q1's `vault_documents`, and `remainingItems` extended
  with the outside-FBM items.

Two small changes outside the definition, because a link the vendor cannot
see is not a referral:

- `toCatalogEntry` in `vendor-quest/service.ts` returns `gatekeeper_links`
  (the public serializer in `api/store/quest-catalog/route.ts` already
  does), the panel's `QuestCatalogEntry` type and quest-detail screen render
  them, and `packet.ts` prints them under the disclaimer.
- The vault is its own gate (`FF_DOCUMENT_VAULT_V1` + `vendor.document_vault`,
  which `starter`, `pro`, `scale` and the embed pack carry and the free
  plan does not); the quest copy should say a document requirement needs
  the vault enabled rather than showing it as "unavailable" without
  explanation. A third serializer of the definitions, `GET
  /vendor/creator/quests`, is gated by the feature flag alone with no plan
  check; either align it or record it as a deliberately different gate.

Stage-gate thresholds stay as they are until a real lender says otherwise;
the disclaimer already says the lender decides. Whole-catalog coverage is
automatic (`__tests__/catalog.unit.spec.ts`).

### 3.2 No lender directory — **build, S–M, refer-out only**

A code-config registry in a new `lender-directory` (or `partner-directory`)
module, shaped like `FISCAL_SPONSORS`: `key`, `name`, `url`, `tagline`,
`kind` (`cdfi | credit_union | community_bank | microlender | crowdfunder |
legal | back_office`), `states` served (or `national`), `serves`
(`sole_proprietor | cooperative | nonprofit | farm`), and `products` (free
text). Seeded the way `startup-guides` is (code catalog → idempotent seed
script → optional table), read through `GET /store/partners?kind=&state=&serves=`,
and rendered on a storefront page built like `/directory` (a server-rendered
filter form) or, for a first cut, the static `/community-resources` hub;
consumed by Q1/Q3/Q11/Q12 as gatekeeper links so the quests stop
hard-coding URLs. It also resolves the open Posture A question about which
banking partners the unbanked-vendor onboarding copy names.

Three rules, all already written down elsewhere and restated here so the
directory cannot drift:

1. **Link out; never intermediate.** No application handoff, no lead form,
   no vendor data leaves FBM (Posture A rule 6 — FBM "does not stand
   between the vendor and that partner").
2. **List only what works.** An entry is a page a vendor can act on today
   (the `channel-connector/catalog.ts` rule). Curate; do not scrape.
3. **No compensation.** A referral fee or lead payment from a lender is a
   loan-brokering shape that is licensed state by state and is not in
   `docs/REPO_CONSOLIDATION_REVIEW.md` §8. Until an operator records a ruling
   there, the directory is unpaid by construction (§5).

Location search reuses `GET /store/geocode` and `lib/zip3` the way
`GET /store/vendors` already does; a state filter is enough for a first cut,
and D5 says any richer spatial query comes from Blackout's API, not a new
FBM table — Blackout's spatial contract is geocode-only today.

Keep the directory visibly separate from `hawala-ledger`'s `VendorAdvance`
(cash advances, recorded as quiescent under Posture A pending legal review —
and, per §1a, already offered on the vendor-panel Finances screen against
ungated routes) and `VendorCreditLine` (vendor-to-vendor trade credit). A
lender directory exists because FBM does not lend; no page may present the
two side by side as "financing on FBM".

Hygiene found alongside: the `referral` module has no row in
`docs/MODULE_CATALOG.md`, and that catalogue's `creator-attribution` row
appears twice.

### 3.3 No vendor-facing fiscal-sponsorship pathway — **extend, S–M**

A new definition, `fiscal-sponsorship-readiness`, in "Cooperative &
Mission", for a project that is charitable in purpose and not (yet) a
501(c)(3): a mutual-aid pod, a community fridge, a garden, a free store.
Requirements: project purpose statement (vendor-supplied), a governing
document (vendor-supplied, `needs: ["documents"]` — the Blackout scaffolds
of §3.4), a **budget and fund ledger** (platform, `needs: ["funds"]`, from
`fund-accounting` when enabled), a fiscal sponsor's application
(outside-fbm). The sponsorship *agreement* is the sponsor's own instrument;
neither FBM nor Blackout should draft one (hard constraint 1), so the
"template" half of the brainstorm resolves to referral.

Gatekeeper links come from the §3.2 registry (`kind: fiscal_sponsor`),
seeded from `FISCAL_SPONSORS`' display fields — not from that registry
directly, because its `live` flag means FBM's own agreement status, not
whether a sponsor takes applicants, and its `selc_local` entry is a
placeholder. The two progression edges that already tell vendors "A fiscal
sponsor if you intend to take donations" (`playbook/progressions.ts`,
Harvest→Grove and Service→Grove) should read the same rows, or two lists
will drift.

The substrate change is the authoring guide's step 3, not an engine edit:
`funds` joins `DomainFieldKey` and `VendorSubstrate` in `types.ts`, a
`buildFunds` in `substrate/build.ts` follows the `buildProduction` pattern
(flag check, resolve, null on absence) and snapshots `fund-accounting`'s
derived portfolio — never re-summed — and `substrate/aggregate.ts` unions it
for collectives.
Q2's `matching_funds` line gets a real source for free.

Three things the copy and the definition must get right:

- **Paywall stacking.** `vendor.quests` and `vendor.fund_accounting`
  (`fund_pack`, $39 for 30 days) are separate plan features; a Grove vendor
  without the fund pack sees a `needs: ["funds"]` requirement as
  "unavailable". Keep the fund-ledger line degrading gracefully rather than
  letting a mutual-aid quest acquire a second paywall.
- **Which sponsorship model fits.** `fund-accounting` refuses any non-zero
  expenditure that does not cite a completed `hawala-ledger` entry from the
  vendor's own account. Under comprehensive sponsorship the sponsor holds
  and spends the money, so only award, receipt, release and return can be
  recorded on FBM; a pre-approved-grant relationship, where the project
  spends, fits fully. Say which the ledger supports.
- **Whose sponsor.** FBM's own AMP relationship (not yet signed) covers
  FBM's checkout donations, not vendors; a vendor's sponsor is the vendor's
  own relationship. A worker co-op is directed to Q11, because fiscal
  sponsorship is not the instrument for a for-profit enterprise. The Grove
  recipe's `hasDonations` key has no vendor-scoped donation surface behind
  it — donations are one platform-level beneficiary rail — so a sponsored
  project's only in-FBM receipt path today is as a verified
  `donation_beneficiary`, and the copy must not imply more. And the
  donation-rail copy defects in §1a are fixed in the same change, so the new
  quest does not inherit an over-claim it sits beside.

### 3.4 Bylaws live in Blackout; FBM cannot store them as what they are — **wire, S + S**

FBM side:

- A `governing_document` value on `vault_document.doc_type`. This does
  **not** wait on the enum→TEXT+CHECK conversion in
  `docs/COMMERCE_ROADMAP.md` §4 decision 5: the repo adds enum values in
  their own idempotent migration (`ALTER TYPE … ADD VALUE IF NOT EXISTS`,
  the idiom in `demand-pool/migrations/Migration20260604AddBountyObjectiveTypes.ts`
  and `product-archetype`), so it is S and buildable now, and lands in one
  migration with §3.6's certification types. The vocabulary is
  hand-duplicated in three places that all change together — the model
  enum, the vendor `POST /vendor/vault` body union, and the vendor-panel
  `VaultDocType` + `DOC_TYPES` list — and the route itself casts an unknown
  `doc_type` to `other` without validating, so the new value needs a
  400-path too. Until then a bylaws upload is `contract`.
- Q11's `governance_bylaws` requirement is retagged `assisted` and gains
  `satisfied: hasVerifiedDocType("governing_document")` (checked and in
  date, like every other vault predicate since 2026-09-03). The retag is
  not optional: the engine returns `checklist` for any `vendor-supplied` or
  `outside-fbm` requirement and never calls its predicate, so a predicate on
  the current tag is a dead step. It only means anything once the admin
  vault screen from §1a exists, because today verification is an API call
  nobody has a button for. Its note changes from "upload to the shared
  vault" to "upload to your vault and consent to the documents scope": the
  vault is seller-scoped and collective quests flat-map consenting members'
  own documents; there is no collective-owned vault.
- Q11's gatekeeper links point at the Blackout Coalition tools and at the
  SELC and USFWC libraries directly (from the §3.2 registry, `kind:
  legal`), so a vendor who is not on Blackout still has the source
  material; the six progression edges whose prose prerequisites say
  "bylaws" read the same rows. Blackout's `/coalition` route takes no den
  or tool parameter, so the link lands on Coalition, not on a den's
  Documents tool.

Blackout side (recorded here; built there):

- An export of a den document as a file (Markdown or PDF). The editor is a
  textarea with Revert and Save-version; there is no export, download,
  print, copy or HTTP API for den documents, so today the finished bylaws
  reach the FBM vault by hand-copying. Because the handoff is a person
  moving a file, not a call, it needs no integration contract — until
  Blackout exposes documents over HTTP.
- Render the `attribution` field (it is never displayed; only the italic
  trailer inside each body credits the source), and note that the
  mutual-aid seed is CC BY-NC.
- A "new document" affordance. The Documents tool only lists what the
  playbook reveal seeded at den creation; a den seeded without bylaws (a
  Circle or Grove, whose seeds are mission, decision rules and the
  mutual-aid agreement) has no way to add them, although the reveal copy
  says the user can author documents from scratch.
- The legal review of the four seed texts, already recorded as "a parallel
  content task" in `templates/index.ts`, gets an owner. Seeds are
  scaffolds; nothing in either repo carries articles of incorporation or a
  member-equity agreement, and FBM must never generate them. The copy must
  say so — Q11 already does ("Filed with your state; FBM never generates
  legal filings").

The Fairmondo model — publish our own cooperative's documents — waits on the
coalition having cooperative documents to publish. `docs/MEMBER_GOVERNANCE.md`
is explicit that platform-level member governance does not exist yet and
lists "a published constitution" among what it would need; the repository
also still has no `LICENSE` file (`docs/TRUST_LANDSCAPE_AUDIT.md` Finding
D). When both exist, the coalition's bylaws become the fifth seed.

### 3.5 "Back-office marketplace" is three features, one of them gated — **refer-out / drop**

- **Legal, accounting, insurance-brokerage and payroll *referrals*** — rows
  in the §3.2 registry with `kind: legal | back_office`, and links on the
  quests that already list these as checklist items: Q7 `ready-to-hire`
  (payroll registration, workers' comp), Q9 `wellness-insurance`
  (liability quote), Q11 (bylaws). Refer-out; S once the registry exists.
  "Via co-op federations" has no code counterpart — `cooperative` has no
  umbrella or federation concept, and "federation" in this repo means the
  D3 marketplace protocol — so a federation's member programme is simply a
  registry row.
- **Payroll as an FBM service** — Posture A rule 6 (no banking-as-a-service,
  FBM does not stand between the vendor and the banking partner). Q7 already
  treats payroll as outside FBM. Drop as an FBM product; refer out.
- **Insurance pooling** — FBM holding pooled premiums and paying claims is
  a regulated risk-bearing product and a custodial balance with no
  purchase context. There is no gate for it in §8 and, per that document,
  an unrecorded gate blocks nothing — and a pool schema already sits
  unwired in the ledger (`ChargebackProtection`, §1a). **Gate-first**:
  recommended ruling is to add pooling to "Not on the roadmap,
  deliberately", add the dormant models to Posture A's quiescent list or
  drop their tables, and point vendors at the cooperative federations'
  existing member programmes through the directory. "Vendor holds
  insurance" is meanwhile recorded five separate ways (vault `insurance`
  document, `kitchen_membership.liability_insurance`,
  `food-distribution` courier `insurance_verified`, Blackstar
  `Node.insurance_attestation_hash`, Q9's packet) — a D8 candidate if any
  insurance feature is ever pursued.
- **Vendor-to-vendor professional services** — the one legitimate build in
  this item: a `professional_services` category on `service-program` (its
  `ServiceCategory` is entirely physical today) would let a bookkeeper on
  FBM sell to other vendors as an ordinary native sale at 3%. Honest
  commerce, but not a "shared back office" and not FBM as purchasing agent;
  the category column is a `model.enum`, so it shares the migration idiom
  of §3.4. S, if wanted.
- If the operator wants a *paid* vendor bundle around any of this, the
  surface is a `vendor-plan` add-on pack (a 30-day window,
  `docs/ADDON_COMMITMENTS.md` §1) under the existing `vendor.*` feature-key
  namespace; it must not gate selling, verification or privacy (§4); it
  cannot be "recurring revenue" (add-ons have no renewal by design); and it
  is not a `connect.js` change.

### 3.6 Q8 lacks the certification vocabulary and the reminder — **extend, S + M**

- **Real requirements on Q8.** Today's four are generic and one
  (`sourcing`) auto-satisfies; give it a predicate or make it
  vendor-supplied. Add, all vendor-supplied or outside-fbm with links from
  the §3.2 registry: USDA Organic certificate (INTEGRITY database),
  Certified Naturally Grown, GAP/GHP audit, state weights-and-measures
  device certificate ("scale certification" — the thing a vendor selling by
  weight is inspected on; note that sell-by-weight pricing itself is only
  scoped in `FEATURE_BUILD_PLAN.md` §2 and none of its fields exist, so
  this is checklist content independent of that build), and the
  nursery-side items: state nursery or plant-dealer licence, annual nursery
  inspection certificate, phytosanitary certificate for interstate
  live-plant shipping (`agriculture`'s `checkPhytoCertRequirement` already
  classifies restricted items and mints an upload URL, with no route or UI
  calling it), and seed-lot germination labelling (`botanical`'s
  `GerminationLog`).
- **Read the permit store that exists.** `cottage-food` already computes
  permit and food-handler expiry as self-declared facts; Q8 reads none of
  it. Add `permits` as a domain-optional substrate field snapshotted from
  `getComplianceSnapshot()` — the same step-3 pattern as `funds` in §3.3 —
  never a second permit model.
- **Document types now, not after a ruling.** `organic_certification` and
  `device_certificate` join `governing_document` in the one enum migration
  §3.4 describes; S. Until then they are `credential`.
- **Make the panels show what the API already says.** The vendor vault
  table renders `effective_status` and `days_until_expiry` instead of the
  raw `verified` flag; the admin panel gets a screen for the `/admin/vault`
  queue and its `PATCH`. Both S, and without them the rest of this section
  is invisible.
- **One evidence store, linked.** The vault is the store the quest engine
  reads; `vendor-verification` badges are what buyers see; the farm profile
  keeps a third copy. Do not add a fourth. The design rule to record: a
  vault document verified by an admin may *grant or refresh* the matching
  badge (`ORGANIC_CERTIFIED`, `REGENERATIVE`), never the reverse, and the
  farm-profile JSON is retired into the vault when decision D8 reaches it.
  Four organic vocabularies (`BadgeType`, `GrowingPractice`, botanical
  `COMPLIANCE_FRAMEWORK_IDS`, food-distribution `LicenseType`) need one
  shared key before any of that can be mechanical. M, and not this
  roadmap's to build — recorded so it is not rediscovered.
- **The shared reminder rail.** `/admin/vault?expiring_within=` can list
  what lapses; nothing tells the vendor. `ar.invoice.overdue` has no
  subscriber, `resend` ships a fixed template list, and the vendor in-app
  feed reader (`GET /vendor/notifications/buckets`, channel `seller_feed`)
  has no producer. Expiry *logic* already exists four times (vault
  `document-status.ts`, cottage-food, the farm profile's recertification
  notices, `vendor-verification`'s write-side expiry) with three day-count
  conventions. Build delivery once — one subscriber, two producers (vault
  expiry, AR overdue), one day-count convention, dry-run until a real
  subscriber exists, following `FBM_AR_DUNNING_LIVE` — and let the
  in-app half be `seller_feed`'s first producer. M.

What the nursery experience contributes is content — which certificates,
which agencies, which renewal cadences — as checklist items and links;
`nursery-vertical` itself carries no compliance vocabulary. The
`cottage-food` README's first design decision governs: the seller declares
everything, FBM ships no state-law table. This is the same work item as
`docs/COMMERCE_ROADMAP.md` Tier 2.4; it is tracked there and detailed here.

### 3.7 The CSA cycle is built; the share-box season is not surfaced — **wire, M, then reposition**

The end-to-end check this section originally asked for was run against the
tree on 2026-09-06: template → cycle → subscription → allocation → dispatch
→ renewal. It fails at the first arrow. What a CSA network would be buying
exists as service methods with no caller:

- **The share-box half has no surface.** `createShareBoxTemplate`,
  `createShareBoxSubscriptionRecord`, pause/resume/cancel,
  `generateBoxesForCycle`, packed/dispatched, and the list methods are
  called from no route, job, workflow, subscriber or screen. A coordinator
  cannot define a template; a member cannot subscribe; boxes are never
  generated.
- **No money path.** `share_box_subscription` has no price, payment
  method, cart, order or ledger link and is not connected to the
  `subscription` module (whose Stripe off-session renewal exists behind
  `FBM_SUBSCRIPTION_RENEWAL_LIVE`, undocumented in
  `docs/ENV_CONFIGURATION.md`); `share_box.total_price` uses 0 as the unit
  price whenever no per-cycle override is set.
- **No buyer surface.** Nothing in the storefront calls
  `/store/order-cycles`; no cart or order path writes
  `order.metadata.order_cycle_id`, so the order-placed subscriber never
  matches a real order, `sold_quantity` never moves, and the order↔cycle
  link is never created. Every CSA sentence on the storefront is marketing
  copy.
- **Configured, never enforced.** `checkProductAvailability()` and
  `calculateFeesForProduct()` have no callers; checkout ignores per-cycle
  caps and enterprise fees. `is_recurring`/`recurrence_rule` are stored and
  never read; `cloneOrderCycle` has no callers; nothing moves a cycle from
  `closed` to `dispatched`.
- **Two bugs and two dead buttons** on the surfaced half (§1a): the
  unscoped vendor list, the wrong-column `seller_id` filter, "Import OFN"
  and "remove product".
- **Blackout is ahead.** It already has a per-vendor "order cycles"
  announcement room, `cycle.open / cycle.close / sold_out` formatting and a
  client card; FBM's only candidate emitter (`plant-ship-window.ts`,
  `order_cycle.closed`, an aggregate count) has the wrong name and shape
  and no callers.

The wire, in order: scope the vendor list and fix the filter (S); expose
the scheduler — template CRUD for coordinators, subscribe/pause/cancel for
members, generate/pack/dispatch for the cycle (M); pick one billing owner —
recommended: a share box references a `subscription` id and each generated
box becomes that cycle's renewal order — rather than adding a third
recurring model (M); one storefront cycle page that writes
`order_cycle_id` into the cart (S–M); emit the three cycle events from the
status job in the shape Blackout consumes (S); remove or implement the two
dead buttons (S). `docs/AGGRESSIVE_OPERATIONS_GUIDE.md`'s "share-box
scheduler 100% shipped" and `docs/LISTING_TYPES.md`'s seasonal `recurring`
listing with a `share_template_id` describe this state as done; correct
both when the wire lands. Six modules carry a "CSA" label with no shared
key; only `subscription.type` and `share_box_subscription` mean "a member's
standing share".

Then the reach work, none of it code:

- A CSA-network landing (the positioning plan's "CSA / Subscriptions"
  destination) that says what Open Food Network users will recognise —
  order cycles, enterprise fees, share boxes — and the 3% native-sale
  commission, unchanged and unchanged-able upward (`docs/ADDON_COMMITMENTS.md`
  §3).
- The SNAP position, stated honestly from `docs/SNAP_EBT_RESEARCH.md`: a
  CSA farm can accept EBT at physical point of sale as an authorised
  direct-marketing retailer with free federal equipment; online SNAP is a
  separate, heavier authorisation; nothing about SNAP touches CCR.

### 3.8 Mutual aid: the internal half is built, the external half has no target — **wire, then build only against a name**

- **Give the ask board a surface (M).** `/store/mutual-aid/*` has none;
  the Grove recipe's `hasRequests` is the generic `request` module, not
  this one. The cheapest honest surface is a Grove storefront section, or a
  vendorless `data-fbm="mutual-aid"` embed kind beside `demand-pools` —
  which is a `connect.js` v2.x change with a changelog entry, not a copy
  edit. Add the missing lifecycle writers (`WITHDRAWN`/`EXPIRED` on
  requests and offers, an expiry job on `needed_by`/`available_until`) so
  stale asks do not sit open on a public board forever; barter's
  `DECLINED`/`WITHDRAWN` have the same gap.
- **The FBM→Blackout seam (S + M).** The event catalogue
  (`docs/contracts/blackout-integration.md`) carries no mutual-aid event and
  Blackout's receiver accepts none. Add `aid.request.opened` /
  `aid.request.fulfilled` carrying only what `toPublicAid` publishes —
  locality and a distance band; FBM never sends coordinates (AUDIT_DEBT
  W5-3) — and a Blackout handler onto `coalition_aid_posts`, whose
  coordinates are `NOT NULL`: either that schema admits coordinate-less
  mirrored posts or FBM asks are listed without map pins. Blackout's
  `/v1/coalition/nearby`, which already returns no coordinates, is the
  payload model. The deaddrop aid threads are not the target — they have no
  server route.
- **Record the overlap.** Four "ask" stores across two repos
  (`mutual_aid_request`; `demand_post` with the `MUTUAL_AID` archetype;
  Blackout coalition aid posts; Blackout deaddrop threads) and three
  in-kind intake vocabularies (`aid-network` intake sources,
  `food-distribution` order types, `harvest` allocation destinations) go
  into `docs/AUDIT_DEBT.md` as D8 items; today its only mutual-aid entry is
  the W5-3 privacy exclusion. Also record that a completed barter is posted
  as a zero-amount `TRANSFER` with `reference_type: "ORDER"` on the
  parties' USD wallets and merely tagged `intended_rail: "GIFT"` — GIFT has
  no account type, so no entry can be on it.
- **External adapter (L, deferred).** Only against a named source with an
  API, a working adapter, and the consent agreement `docs/FBM_BUYER_HUB.md`
  §5 requires before any inbound aggregation. No document names one.
  hOurworld is §3.10's external half; Craigslist/TrashNothing remain
  `docs/COMMERCE_ROADMAP.md` Tier 5.14.

### 3.9 Depot relay is three builds in two repos — **sequence, L, not near-term**

1. **A depot is a listing** (FBM). `docs/COMMERCE_ROADMAP.md` §4 Tier 3
   item 8 on the `rental`/`kitchen` survivor — waiting on its decision 2 —
   with a storage fee whose refundable deposit is the custodial-money
   question its decision 3 raises. `kitchen` already has `storage_cold` /
   `storage_dry` space types, a rate ladder, capacity and operating hours,
   and two deposit fields nothing writes; `rental` has none of that.
   `aid-network`'s `network_node` is the "place that holds stock" to learn
   from, but it is single-seller — nothing lets vendor B leave stock at, or
   route through, vendor A's node — and it landed with its own
   `haversineKm` after W5 retired six copies (a D8 regression to fold into
   `lib/geo-distance`). `blackstar_shipment.pickup_point_id` is already a
   placeholder a depot could ride, and five unshared pickup-location fields
   (`order_cycle`, exchanges, `vendor-rules` windows, `food_delivery`,
   `blackstar_shipment`) are the sixth thing a depot must not become.
2. **A depot is a node a leg can hand off to** (Blackstar + contract).
   `Node` has no kind, hours, capacity or coordinates, and eligibility is
   jurisdiction + attestation + transport class, so a depot with no
   vehicles can never be eligible; `ShipmentLeg` has `from_node_id`/
   `to_node_id` but the console has no board or leg screen. On the FBM
   side the receiver ignores leg events and contract v1 has no per-parcel
   key — order-scoped events are applied to every parcel on the order — so
   a depot leg is one wire-format change together with the open sequence
   numbers (contract §9.3), not a Laravel-only change. `Node` coordinates,
   if added, are data only: D5 keeps routing and nearby search in Blackout.
3. **Pooling** (Blackstar). `api/docs/network-advantage-engine.md` §2
   ("milk runs") is the design; nothing implements it, and its §1 OSRM
   engine as written conflicts with D5. FBM's `food_delivery_batch` (one
   courier run, many producers' parcels, client-written route) and
   `order-cycle`'s hub role are the batch nouns to build a planner on.
   Design only until 1 and 2 exist and a real farmers-market cluster asks.

Two dead seams to resolve before adding any event: Blackout's
`fbmMatrixBridge/logisticsRooms.ts` consumes `blackstar.driver_assigned /
pickup_confirmed / delivered / failed` and says FBM emits them — no FBM
producer exists, and the vocabulary differs from the FBM↔Blackstar
`shipment.*` contract; and `docs/contracts/marketplace-layer.md` still
documents the retired static-key `POST /v1/integrations/blackstar/shipments`.
Pick one lifecycle vocabulary. The `courier-collective` manifest is a
schema fixture, not a running co-op — its own notes say the settlement
chain is unwired — so it is not evidence that a delivery co-op exists.

Gates that hold throughout: FBM's fulfillment modules stay the live
implementation (D2's absorption half is unchanged by the unfreeze);
`NonCustodialPaymentGuard` — no pooled custody of shipment principal;
spatial queries come from Blackout (D5); the integration stays dark until
two deployments are paired (contract §4).

### 3.10 Hours: the rail is guarded, unlit and mis-framed — **gate-first, then S + S**

The ignition sequence is `docs/CCR_HRS_IGNITION.md` §5 and is not
re-planned here. What this roadmap adds:

- **Framing.** Every surface that mentions time banking — the Service
  playbook card ("Time banks" is one of its examples today), the Grove
  card's "internal scrip", any CSA or mutual-aid pitch — must say hours
  settle labour between members and are never tender for goods. That is
  what `rails.ts`, the guard and `NonCashRailError` enforce; the copy should
  not promise what the ledger refuses.
- **What ignition actually needs.** `docs/CCR_HRS_IGNITION.md` §5 step 4
  (provisioning + the open-balance writer) cannot run ahead of its step 1:
  `createTransfer` refuses overdraft, so an opening balance cannot be
  posted from an empty reserve without `ISSUE` or an HRS-specific issuance
  script. Three smaller prerequisites ride with it: a validated
  provisioning path (today only the unvalidated `POST /admin/hawala/accounts`
  could make a `TIME_BANK` account — tighten it); the `HOURS_OPEN_BALANCE`
  / `HOURS_ARCHIVE_BALANCE` / `TIMEBANK_*` entry types added to the
  `ledger_entry.entry_type` enum with the parity spec extended past
  `reference_type`; and one opening-balance vocabulary chosen between the
  issuer entry type and the bilateral reference type, both declared and
  neither written. Then the first settlement-record emitter on a manifest
  that declares `hours` (childcare, tool-library, courier-collective) —
  step 5 — lights the reconciler.
- **The policy answer §5 does not list.** Issued hours (a starter grant
  from a reserve — the model Blackout's "4 FBM-HOUR" grant and its "we
  begin in trust, not debt" seed imply) or classic mutual credit, where
  members may go negative. The ledger's balance-never-negative invariant
  forbids the second without a ledger change. Record it as (d) beside (a)
  and (b).
- **The Blackout grant.** Grove dens seed `onboardingCreditGrant: { amount:
  '4', currency: 'FBM-HOUR' }` (`packages/blackout-protocol/src/playbook/contracts.ts`),
  and the reveal screen renders "Your new den starts with 4 FBM-HOUR in its
  kitty" — a live promise held in client den state with no server code and
  no ledger behind it. Its FBM counterpart is a `HOURS_OPEN_BALANCE` entry
  on a member's `TIME_BANK` account. Write the contract as FBM-canonical
  with a Blackout consumer mirror once step 4 exists, settling the name
  (`FBM-HOUR` is not FBM's unit, `HRS`) and an hours balance on the
  entitlements read; until then soften the reveal copy.
- **The dead hours stack.** `volunteer`'s `garden_time_credit` is not a
  second ledger but a broken one (§1a): an uncalled writer, wrong field
  names, a character-sheet stat that is always 0, plus `volunteer_log`'s
  informational `credits_earned` at a hard-coded $15/hour and a third
  `TimeCredit` interface in `garden/services/garden-ledger.ts` with no callers. Retire it
  the way channel points were decided in W1b, or migrate its intent onto
  HRS. An operator decision; record it as (c) with the policy answers.
- **The doc gate.** `posture-a-guard.ts` cites `docs/POSTURE_A_COMPLIANCE.md`
  "§ hours rail"; no such section exists, and that document's rules 7–8 (no
  buyer-to-buyer or vendor-to-buyer transfers) carry no carve-out for a
  user-to-user-transferable non-money rail. Write the section before the
  first hour moves.
- **hOurworld** is the external time-bank network — a `Tier 5.14` adapter,
  and the same target the brainstorm listed under barter.
  `docs/manifests/tool-library.md` already records the decision not to
  adopt Cyclos or hOurworld as the ledger, so any adapter is a bridge to an
  external network, never a rail.

---

## 4. Build priority

Ordered by dependency and by how much each unblocks. Each tier is
independently shippable; nothing here requires an engine change.

**Tier A — definition and content changes, buildable now, no ruling
needed.** The §1a hygiene goes first, because everything below shows a
packet or a promise to an outsider: populate the five never-assigned
substrate fields (S–M); return `gatekeeper_links` from the vendor catalog
serializer so the panel and packet can render them (S); render
`effective_status` in the vendor vault table and add the admin vault screen
(S + S); fix the donation widget and marketing copy to say "pending" until a
sponsor is live, scope `POST /vendor/donations/settings` correctly and
align its `settlement_mode` values (S — route done 2026-09-06, copy open);
list `ChargebackProtection` / `ChargebackClaim` in
`docs/POSTURE_A_COMPLIANCE.md`'s quiescent models (S — done 2026-09-06)
pending the ruling in decision 8; scope `GET /vendor/order-cycles` to the
caller and fix the store `seller_id` filter (S — done 2026-09-06); gate or
hide the vendor-panel cash-advance section until the legal review Posture A
already requires (S — done 2026-09-06, flag-gated default off); and make
the character-sheet "Time Credits" stat honest (S).
1. Extend Q3 with CDFI requirements, links and a documents section (§3.1).
2. The partner directory registry, `/store/partners`, its storefront page,
   and the quests reading it for gatekeeper links (§3.2), with legal and
   back-office referral rows (§3.5).
3. Q8 certification vocabulary as checklist items and links (§3.6, first
   half).
4. Q11 gatekeeper links to the Blackout founding-documents surface and the
   SELC/USFWC libraries (§3.4, first half).
5. The CSA-network positioning and pilot checklist (§3.7) — written now,
   published only after item 12 lands.
6. Honest time-bank copy on the Service and Grove cards, the vendor-panel
   "bank your hours" pathway, and Blackout's "4 FBM-HOUR" reveal line
   (§3.10, framing).

**Tier B — wiring across modules and repos, no ruling needed.**
7. `fiscal-sponsorship-readiness` definition + the `funds` domain-optional
   substrate field (§3.3).
8. The shared expiry/overdue reminder rail (§3.6, second half).
9. Mutual-aid asks on Grove storefronts and the FBM→Blackout mutual-aid
   events (§3.8, wire half).
10. Blackout: den-document export as a file, and the `attribution` render
    (§3.4, Blackout half).
11. `governing_document`, `organic_certification` and `device_certificate`
    vault types in one `ADD VALUE IF NOT EXISTS` migration, with the three
    duplicated vocabulary sites (§3.4, §3.6); then Q11's and Q8's
    `satisfied` predicates read them, and Q8 gains the `permits` substrate
    field. The TEXT+CHECK conversion in `docs/COMMERCE_ROADMAP.md` §4
    decision 5 remains a hygiene ruling, no longer a blocker.
12. The CSA share-box wire (§3.7): scheduler routes and screens, one
    billing owner, a storefront cycle page that writes `order_cycle_id`,
    the three cycle events Blackout already consumes, the two dead buttons.
    M; no ruling needed, and the one item here a CSA network would notice
    first.

**Tier C — waiting on a recorded operator decision.**
13. HRS ignition — `docs/CCR_HRS_IGNITION.md` §5 step 1 (issuance) then
    steps 4–5, the entry-type parity, the Posture A hours section, and the
    Blackout `FBM-HOUR` contract — on that document's policy answers (a)
    and (b), plus (c) the dead volunteer hours stack and (d) issued hours
    versus mutual credit (§3.10).
14. Micro-depot listings — on the `rental`/`kitchen` ruling and the
    custodial-deposit ruling (§3.9 step 1).

**Tier D — only against a real counterpart.**
15. Blackstar depot node kind, leg events and a per-parcel key on the
    contract, and relay through a depot (§3.9 step 2) — when a
    farmers-market cluster and a logistics node both exist.
16. External adapters: hOurworld (time bank, §3.10), mutual-aid data
    sources (§3.8) — each only with a working adapter against a named API
    and a consent agreement.
17. Batched aggregation / "milk runs" (§3.9 step 3) — design only.

**Not on this roadmap, deliberately (recommended rulings for §8):**
FBM-run insurance pooling; FBM-run payroll; any compensated lender or
service referral. TigerBeetle (D1) and federation protocol work (D3) remain
excluded as before.

### Decisions the operator must take before Tier C can start

None is a planning change; each is a ruling this document cannot make.

1. **Referral compensation** — confirm the directory is unpaid, and record
   in §8 that any lender or service-provider fee is a licensing question
   before it is a revenue line.
2. **Insurance pooling** — rule it out of scope (recommended) or commission
   the regulatory work; either way, write it into §8.
3. **`doc_type` enum conversion** — `docs/COMMERCE_ROADMAP.md` §4 decision
   5. This roadmap's three document types no longer wait on it (Tier B item
   11 uses the repo's `ADD VALUE` idiom); the conversion is now purely the
   house-convention question, and that roadmap's row should be corrected to
   match.
4. **HRS policy** — `docs/CCR_HRS_IGNITION.md` §5 (a) who holds wallets,
   (b) what governs issuance; plus (c) whether the dead `garden_time_credit`
   stack is retired or migrated, and (d) issued hours from a reserve or
   mutual credit with negative balances — the ledger supports only the
   first today.
5. **`rental` vs `kitchen`** and **custodial deposits** —
   `docs/COMMERCE_ROADMAP.md` §4 decisions 2 and 3; micro-depots wait on
   both.
6. **Seed-template legal review owner** (Blackout) — the four texts are
   scaffolds until someone with standing has read them.
7. **Pricing of capital-access quests** — today Q3 and Q8 sit behind the
   `scale` plan or the $49/30-day `quest_pack` add-on. `docs/ADDON_COMMITMENTS.md`
   §4 permits this (quests gate neither selling nor verification), but a
   readiness packet is most valuable to the vendors least able to pay for
   it. Whether the capital family moves into the free tier is a pricing
   decision; the public `/quests` page must keep stating whichever gate
   applies.
8. **`ChargebackProtection` / `ChargebackClaim`** — quiesce under Posture A
   (recommended: add to the quiescent-models list, no readers or writers
   until a ruling on FBM bearing chargeback risk) or drop the two tables as
   D8 hygiene. Either is a ruling on whether FBM may ever run a risk pool.
   The quiescent listing was done 2026-09-06; the keep-or-drop ruling is
   still open.

---

## 5. Gates

The standing gates are `docs/REPO_CONSOLIDATION_REVIEW.md` §8 and are
unchanged: ACH payouts disabled pending money-transmitter sign-off;
Coalition investing and revenue-share gated on Reg CF and CSA-style claim
work; Coliseum betting shelved. Anything money-touching reads
`docs/POSTURE_A_COMPLIANCE.md` first.

The rules from that document this cluster runs closest to:

- **Rule 6 — no banking-as-a-service; FBM does not stand between the vendor
  and a banking partner.** It shapes the directory (§3.2), rules out
  payroll (§3.5), and is why "CDFI readiness" ends at a packet the vendor
  carries to the lender.
- **Rule 10 — donations route through a 501(c)(3) fiscal sponsor.** It is
  FBM's own posture, not a vendor's; §3.3 must not blur the two.
- **Closed-loop rails.** HRS is `cash_convertible: false`, `closed_loop:
  true`, and refused by the cash-settlement selector; no hours-for-goods
  promise may be made (§3.10).
- **The quest engine's hard constraints** (`docs/VENDOR_QUEST_ENGINE.md`):
  assemble, never fabricate; opt-in, never a prerequisite for selling;
  honest UI; "FBM never generates legal filings". Every extension in §3
  adds checklist items and links, never a generated document.

Gates this roadmap surfaces that are **not** in §8 — recorded so the
discrepancy is visible, because an unrecorded gate blocks nothing:

- Compensated lender or service referrals (loan-brokering, state-licensed).
- FBM-run insurance pooling (risk-bearing, custodial) — including the
  chargeback pool whose schema is already migrated and unlisted (§1a).
- Refundable depot storage deposits (already flagged as
  `docs/COMMERCE_ROADMAP.md` §4 decision 3).
- The hours rail itself: `posture-a-guard.ts` cites a Posture A "§ hours
  rail" that has never been written, and the document's transfer rules
  carry no carve-out for a user-to-user non-money rail (§3.10).
- Vendor cash advances: `VendorAdvance` is recorded as quiescent pending
  legal review; the vendor-panel surface that offered it anyway has been
  flag-gated, default off, since 2026-09-06 (§1a). The review itself is
  still the gate.

---

## 6. Who this is for — the outreach list mapped to what exists

The brainstorm's second half listed communities to reach. Each maps to
something in the tree; where it does not, this says so, so outreach does
not promise a feature that is not there.

| Community | What exists | What this roadmap adds | Honest gap |
| --- | --- | --- | --- |
| CSA networks, buying clubs, bulk-food co-ops | `order-cycle` (cycle half), Cycle playbook, `cooperative` (`CSA`, `BUYING_CLUB`), `demand-pool`, `bargaining` | §3.7 wire, then the pitch and pilot checklist | The share-box season has no surface and no billing yet; do not pitch it before Tier B item 12 lands |
| CDFIs, credit unions | Q3 `microlender-readiness`, Q1 `fsa-farm-loan`, Q12 `land-pooling` | §3.1, §3.2 | No lender partnership exists; the directory is unpaid and link-out |
| Community land trusts, freedom farms, Black land reclamation | Q12 `land-pooling` (pooled loan-readiness toward shared land), `garden` + `governance`, Q1 | §3.1 links; Q12 gains the §3.2 registry as gatekeeper links | Land tenure itself is outside FBM; Q12 assembles the joint financing packet, the lender or seller decides |
| Seed libraries, seed-saving networks | `knowledge-base` seed-starting article; `barter_proposal`; `garden` | — | Seed library is `docs/COMMERCE_ROADMAP.md` Tier 4.11, unbuilt |
| Mutual-aid networks, community fridges, tool libraries, free stores | Grove playbook, `aid-network` (with a panel), `donation`, `fund-accounting`, `demand-pool`'s `MUTUAL_AID` archetype (with storefront pages); `mutual-aid` routes; tool-library and repair-cafe manifests; Blackout coalition aid posts and aid pools | §3.3, §3.8 | FBM's own ask board has no screen; external network adapters have no named target |
| Time banks | HRS rail (guarded), Service playbook, manifests declaring `hours`, Blackout Grove grant | §3.10 | Rail not lit and cannot be funded before issuance exists; hours never buy goods; the "Time Credits" stat and the "4 FBM-HOUR" reveal are promises with nothing behind them |
| Worker co-ops (cleaning, construction, delivery) | Workshop/Commons playbooks, Q11 `coop-formation`, progressions map, `courier-collective` manifest | §3.4, §3.5 referrals, §3.9 | Bylaws templates are in Blackout; delivery relay is Tier D |
| Farmers markets and their vendors | Q6 `market-vendor` (application bundle), Q8, `cottage-food`, `season`, `ticket-booking` venues | §3.6 | Market-day mode is `docs/COMMERCE_ROADMAP.md` Tier 4.12 |
| Bail funds, reentry networks | `fund-accounting`, `donation` via fiscal sponsor | §3.3 | Posture A rule 9: no third-party fund routing outside a registered beneficiary |
| Black business associations, chambers, HBCU programmes | Q5 `wholesale-account`, Q2 `grant-readiness`, `knowledge-base` contributions | positioning only | No association or campus feature exists; do not imply one |
| Church gardens, intentional communities, ecovillages | Harvest playbook, `garden`, `governance`, `kitchen` | §3.3 | — |
| Homesteaders, right-to-repair, maker spaces, privacy communities, Fediverse | repair-cafe / tool-library manifests; Blackout (D4 identity, E2EE) | — | Outside this roadmap's scope; Blackout's roadmap covers reach |

---

## 7. Maintenance

- When a gap in §3 closes, move it to §2 and cite the module or definition.
- When a claim here is contradicted by code, the code wins — correct this
  document rather than working around it.
- A new quest definition gets a row in `docs/VENDOR_QUEST_ENGINE.md`'s
  catalogue table and, if it ships a module, `docs/MODULE_CATALOG.md`.
- Items shared with `docs/COMMERCE_ROADMAP.md` (Tier 3.8 micro-depots, Tier
  4.11 seed library, Tier 4.12 market-day mode, Tier 5.14 barter adapters)
  are tracked there; this document only points.
- Gates and consolidation decisions stay in
  `docs/REPO_CONSOLIDATION_REVIEW.md`; the "Decisions the operator must
  take" list in §4 is a request for rulings, not a record of them.
