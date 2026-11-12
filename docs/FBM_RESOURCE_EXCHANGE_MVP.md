# FBM Minimum Viable Product — Resource Exchange Pilot

> **2026-11-12 experience decision:** [Unified member portal and character-build plan](FBM_UNIFIED_MEMBER_PORTAL_PLAN.md) is canonical for one signed-in buying/selling/trading/auction experience, a character-creation survey that automatically builds a simple working portal, standard game view, functional equipment with one-time purchases, and reuse of Blackout Coalition and Blackstar. This is implementation direction, not a shipped/deployed claim. Existing pricing, privacy and release gates remain in force.

> **AI-first readiness process:** [Full-platform audit, repair and feature visibility plan](FBM_AI_FIRST_AUDIT_AND_REPAIR_PLAN.md) defines how to verify every journey, finish small repairs, hide and preserve incomplete capabilities, and escalate only necessary human decisions. This plan has **not yet been executed**.

**Date:** 2026-11-03; experience revised 2026-11-12  
**Status:** Proposed MVP scope and acceptance contract; **not** an implementation or deployment claim.  
**Authority:** [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) and [Product Strategy](FBM_PRODUCT_STRATEGY.md). Conflicting legacy pricing or feature claims are superseded by the charter.

## 1. Product hypothesis

**A working-class person can describe what they need or have, receive useful matches or next steps within 60 seconds, and complete a real exchange through FBM.**

The MVP is **not** a full federated economy, social network, finance platform, or finished multi-mode commerce suite. It proves that a single composable exchange toolkit can connect people and move real resources. Optimize for **weekly completed exchanges**, not opens, streaks, or vanity signups.

**Initial pilot:** one defined region, 2–3 willing anchor suppliers/organizations, the founder's nursery where operationally ready, and seeded legitimate offers, requests, standing bounties, and pooled buys. Recruit both sides before opening access. Design schemas and rule validation for national and international expansion without pretending to have launched everywhere.

## 2. The first-session experience

1. **Choose direction:** illustrated goals such as getting needs met, making/growing, offering services, trading or organizing. One main goal and optional additional goals; no ideology labels.
2. **Choose starting resources:** adapt the existing ResourceQuiz for all members, using skills, time, kitchen, plants/land, tools, materials, transport and community. “None yet” is valid; owning transport does not enroll the person as an operator.
3. **Choose practical participation:** ask only relevant time/availability, pickup/delivery, solo/group and jurisdiction questions. Keep private drafts and reuse known answers.
4. **Reveal and apply the build:** show an editable character/starter-toolkit/portal preview with reasons. Automatically configure available free/owned tools; optional paid equipment is separately labeled and never charged by accepting the starter build.
5. **Enter the same market:** open the generated member portal in standard game view with one real next action and real matches or honest empty states. Buying/selling/trading/bidding are actions, not separate logins. Keep a complete compact accessible view, shortcuts, resume and rebuild.

Aim for a useful initial result within 60 seconds under measured pilot conditions. This is not a rigid three-question limit or permission to omit automatic portal building. Optional appearance and deeper branches may follow first value.

### Primary screens

- **Character creation:** adaptive goals/resources/participation survey with saved draft and starter-build reveal
- **Match results** with why each result matches, location granularity, availability, and terms
- **Need/offer editor** with privacy controls
- **Exchange detail** with agreement, status, and dispute/help access
- **Unified member portal**: standard game world/panels with Market, My place, My stall, Exchanges, Commons and Toolkit; buying and selling share the same entry
- **Build preview and equipment bench**: actual available tools, optional paid upgrades, safe apply/rebuild and real next action
- **Simple organization profile**: opt-in offers/needs and contact method
- **Admin/operator pilot console**: moderation, reported abuse, failed matches, exchange exceptions, and metrics

Use accessible mobile-first web interfaces first. Capacitor mobile/desktop wrappers are the architectural decision; **native app distribution is not a pilot launch gate**. When wraps are shipped, checkout must remain web-based with synced cart/session state.

## 3. Minimum data and matching contract

**Entities:** verified member identity with linked customer/seller/team contexts; versioned private survey draft; portal-build/loadout references; consent and visibility settings; goal; taxonomy term; need; offer; location region (avoid exact location by default); quantity/unit; timing; acceptable settlement types; match; exchange/agreement; message/contact permission; order/fulfillment event; audit record.

**Match v1:** deterministic, explainable filters on taxonomy compatibility, settlement preference, quantity, availability, and approximate region. Rank by practical fit; do not infer political affiliation or sensitive beliefs. No AI model is necessary to launch. Free text may assist discovery but must not replace controlled taxonomy.

**Privacy defaults:** needs, offers, and sensitive goal details are private until deliberately shared. Public endpoints must exclude private records; verify auth, tenant boundaries, logs, and courier/contact PII. Sharing a public offer must not implicitly expose private needs. Provide user export and deletion/correction workflows subject to record-retention obligations.

## 4. Exchange primitives and MVP release tiers

| Primitive | MVP behavior | Gate / release decision |
| --- | --- | --- |
| **Sale** | List, purchase via existing web checkout, track fulfillment, show itemized fees | Verify real checkout, payment ordering, refunds, payout reconciliation |
| **Gift / mutual aid** | Opt-in gift listing/request, agreement, handoff/completion acknowledgment; no required payment | Consent, fraud prevention, abuse reporting, safe contact and handoff |
| **Barter** | Two parties propose items/services and terms, accept, record fulfillment/dispute; avoid custodial funds | Legal review of organized barter exchange reporting including Form 1099-B **before enabling regulated exchange operation** |
| **Pooled buy** | Join a genuine purchase pool, show target/terms/deadline, record commitments and fulfillment | Verify demand-pool and payment flow; no pooled investment or securities without clearance |
| Goods auction | Target member-market capability; separate delivery package, not yet verified as a working bid/close/payment system | Atomic bids/close/reservations, winner checkout and recovery; reuse existing commerce and inspect Blackstar transport patterns |
| Lending/sharing | **Deferred** | Damage, deposit, dispute, liability review |
| Consignment/patronage | **Deferred** | Flag status and ledger correctness review |
| Financing, cross-border, Stellar/USDC | **Deferred/off** | Legal, compliance, settlement review |

**Release distinction:** The target MVP demonstration includes sale, gift, barter and pooled buy end to end. **Public launch must not bypass legal gates**: a gated primitive stays disabled until cleared. A private demo, mocked flow, or manually operated pilot is not proof that a regulated live flow is ready. Do not call the full MVP complete until all four target exchanges are genuinely usable under applicable rules.

**Composability:** all exchange records share a small common agreement/status model; “shop,” “co-op,” and “nonprofit” are configurations and governance rules, not ideological modes or duplicated code paths.

## 5. Everyday utility: keep it small

**Include in MVP:** the character-builder → automatic useful portal slice, standard game/compact access, free/owned functional starter equipment, and a weekly opt-in digest, simple order/need/offer status, one-tap confirmations, saved suppliers, basic export, and a single next-goal action tied to existing quests **only if enabled and verified**. These are the minimum housekeeping and goal-planning features.

**Defer:** full accounting suite, AI research assistant, equipment booking/deposits, complex cooperative votes and patronage, extensive quest progression, chapter federation, and automated cross-platform integrations. Any later research tool must cite sources and avoid invented numbers.

**Return loop:** notify only for real matches, replies, deadlines, or transaction exceptions. Respect order cycles and seasons; no daily streak requirement, fake scarcity, or notification spam. Mute and export must be easy.

## 6. Seller and organization minimum

An independent seller or organization can create a profile, list an offer, describe terms and availability, respond to matched needs, track the exchange, and export its own records. Reuse vendor archetypes, onboarding goals, product taxonomy, demand pools, and existing checkout where verified. No requirement to adopt a political identity or separate ideological mode.

**Fee and pricing invariant:** 3% Coalition commission **never increases**; deduct processing fees from sale total **before** splitting the remainder between seller and Coalition. KARMA must not affect commission or payouts. **No subscriptions:** one-time purchase of software version, transparent at-cost pass-through for ongoing hosted/metered services, optional upgrades/support. Audit actual code and copy; do not claim compliance until tested. E2EE is never paywalled.

## 7. MVP non-goals and boundaries

- No nationwide chapter rollout or federation implementation in pilot.
- No central chapter membership registry. Pilot chapters may use minimal local records; governance rooms and E2EE must not be claimed live without verification.
- No investment pooling, financial yield promises, or cross-border settlement.
- No proprietary dependencies added without AGPL-3.0 compatibility review.
- No AI-dependent matching, a new social-network backend, forced daily care/streaks or broad feature parity with established marketplaces. Standard game presentation and character-built functional equipment are included; extensive progression and rich rendering are incremental.
- No unlimited lifetime hosted service obligations; use disclosed quotas/prepaid usage or actual at-cost pass-through.

## 8. Implementation sequence and release gates

### Phase 0 — Evidence audit (required before code changes)

- Identify deployed commit, active feature flags, and differences from main; classify each candidate component **built / deployed / enabled / blocked / unknown**.
- Audit archetypes, goals, taxonomy, Vendor Quest Engine, checkout/fee arithmetic, vendor plan/subscription billing, barter, mutual aid, demand pools, bargaining, order cycles, splits, disbursement, and API privacy.
- Inventory all subscription copy, entitlements, renewals and existing-customer migration implications. Do **not** disable live billing without a coordinated approved migration.
- Confirm AGPL-3.0 and dependency license compatibility.
- Document legal/compliance owners and decisions for barter, pooled purchases, donations, refunds, tax reporting, and settlement.

**Output:** evidence table, blockers and the smallest implementation slice from the approved unified-portal plan. This documentation change does not execute migrations or deployments; resolve their concrete operational decisions at the relevant package.

### Phase 1 — First value

Deliver character survey → reasoned build preview → automatically configured unified member portal → one real task. Reuse ResourceQuiz/recommendations, playbooks, saved onboarding, progression and entitlement/install mechanisms. Preserve private structured needs/offers, deterministic matches, honest next steps, source-owned Coalition/Blackstar integrations, and correct customer/seller/team authorization. Seed verified supply; test build/resume/rebuild, game/compact access, first-value timing and privacy.

### Phase 2 — First exchanges

Connect existing sale checkout; add gift agreement and completion tracking; validate barter and pooled-buy end-to-end flows **only after their respective gates**. Provide receipts/status, reconciliation, dispute/help and moderation.

### Phase 3 — Useful return and pilot

Add lightweight housekeeping, saved contacts/suppliers, weekly opt-in digest, export, and goal next-step. Run a limited regional pilot with actual exchanges and observe 4-week return. Consider 2–3 autonomous chapters only after pilot governance/privacy needs are understood.

### Phase 4 — Expand only on evidence

Improve matching and local discovery, chapter kits, research, equipment sharing, and broader settlement options based on measured demand and legal readiness. Do not build federation merely because the architecture allows it.

## 9. Acceptance criteria / definition of done

| Test | Pass condition |
| --- | --- |
| Character build / first value | Goals/resources/preferences produce an editable starter preview, automatically configured useful portal and one real action; measure the 60-second initial-value target without rushing the build flow |
| Unified access | Same session can buy and start selling; seller pending/unavailable does not block shopping or personal records; team scopes remain enforced |
| Functional equipment | Free/owned items open real tools; owned rights survive unequip/re-equip; optional paid suggestions have one-time prices and accepting a starter build never purchases them |
| Standard presentation | Game view is the default; all core actions remain reachable by touch, keyboard, shortcuts and compact accessible view |
| Skip/re-run | Survey can be skipped and repeated without loss of existing records |
| Privacy | Needs private by default; selective sharing works; unauthorized/public API access and logs reveal no private need/contact/courier PII |
| Matching | Deterministic relevant match explanations; no fabricated availability; empty-state next steps usable |
| Sale | Real paid checkout, fulfillment, refund/payout reconciliation and correct 3% fee order |
| Gift | Consensual listing/request through recorded handoff/completion with abuse handling |
| Barter | Agreed terms, both parties' completion and dispute path, **legal clearance** |
| Pooled buy | Real pool terms, participant commitment, fulfillment and financial reconciliation, **legal clearance** |
| Seller operations | Publish/manage offer, respond, see next action, export records |
| Pricing | No active subscriptions or contradictory copy after approved migration; ongoing costs disclosed at cost |
| Safety | Abuse reporting, rate limits, moderation, permission tests, accessible UI, no manipulative notifications |
| Production evidence | Running-stack verification for each enabled primitive, not tests alone |

**Done means** the character-built unified portal and four target pilot exchange journeys work in the pilot region, with privacy and legal gates cleared. Any partially delivered or disabled primitive must be labeled **not yet complete**.

## 10. Metrics and operating cadence

**Primary:** weekly **completed exchanges** (distinct fulfilled agreements, by type). Count real completion, not mere listings or clicks.

**Supporting:** survey completion; median and p90 time to first match or actionable result; time to first transaction or meaningful connection; 4-week return; exchange completion and dispute rates; share of searches with legitimate matches; supply coverage; seller time to first exchange; privacy incidents.

Review weekly by exchange type and by new vs returning participants. Establish baselines before targets; do not invent success percentages. Include qualitative pilot interviews about trust, value, and where participants got stuck.

## 11. Decision log and open audit questions

**Fixed:** mission, exchange composition, commission, processing-fee ordering, no subscriptions, E2EE access, national/international quest rules, AGPL-3.0, Capacitor web checkout, private needs, no dark patterns.

**Verify before coding:** which modules are actually running; legal classification of barter/pools; production payment split arithmetic; subscription migration; consent and location defaults; current match taxonomy; chapter/Blackout integration readiness; pilot staffing and supply commitments.

This specification authorizes **documentation and audit planning**, not an unreviewed code rollout.
