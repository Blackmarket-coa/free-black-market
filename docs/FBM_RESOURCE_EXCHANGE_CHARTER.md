# FBM Resource Exchange Mission and Implementation Charter

> **2026-11-12 experience decision:** [Unified member portal and character-build plan](FBM_UNIFIED_MEMBER_PORTAL_PLAN.md) is canonical for one signed-in buying/selling/trading/auction experience, a character-creation survey that automatically builds a simple working portal, standard game view, functional equipment with one-time purchases, and reuse of Blackout Coalition and Blackstar. This is implementation direction, not a shipped/deployed claim. Existing pricing, privacy and release gates remain in force.

> **AI-first readiness process:** [Full-platform audit, repair and feature visibility plan](FBM_AI_FIRST_AUDIT_AND_REPAIR_PLAN.md) defines how to verify every journey, finish small repairs, hide and preserve incomplete capabilities, and escalate only necessary human decisions. This plan has **not yet been executed**.

> **MVP scope (2026-11-03):** [FBM Resource Exchange MVP](FBM_RESOURCE_EXCHANGE_MVP.md) defines the first-session journey, four target exchange primitives, regional pilot, privacy and legal gates, release criteria, and metrics. This is a proposed acceptance contract, **not a claim of deployed functionality**.

**Decision dates:** 2026-11-03 (resource exchange/economics); 2026-11-12 (unified member experience)  
**Status:** Approved product direction; implementation status unverified.  
**Authority:** This charter supersedes conflicting earlier product/pricing direction. If implementation contradicts a decision, report the conflict; do not silently revise the decision. See [FBM Product Strategy](FBM_PRODUCT_STRATEGY.md).

## Mission

Free Black Market is evolving from a marketplace into a platform for **resource allocation, sharing and trading, built for working-class people**. Merchants and customers choose how to exchange: sale, barter, gift and mutual aid, pooled buying, lending, consignment, cooperative and nonprofit structures. There are **no ideological modes**. There is one composable set of exchange tools; people assemble the toolkit that meets their goals.

The character-creation survey learns goals, available resources and practical constraints, previews a starter build, and automatically configures one member portal. Buying, selling, trading and auctions are activities in that portal rather than separate buyer/vendor identities. Game view is standard, with a complete compact accessible view. The long-term vision is independent local working-class cells, organized and federated through cooperative structures.

## Fixed decisions

1. **Commission:** flat **3%, never increased**. KARMA tiers never change commission or payouts.
2. **Fee ordering:** subtract payment-processing fees from the sale total first; split the remainder between seller and the 3% Coalition commission. Verify actual settlement arithmetic before publishing examples.
3. **Pricing:** remove all subscriptions. Software is a **one-time purchase**, owning that version; this replaces the former $10/month all-access plan and any vendor monthly tiers. Ongoing third-party/hosted costs are transparent at-cost pass-through; optional paid upgrades and support may be offered.
4. **Privacy:** E2EE is never paywalled.
5. **Geographic scope:** cooperative quests and validation rules cover all US states and international jurisdictions, not just South Carolina. Applicable local laws still require jurisdiction-specific compliance.
6. **License:** FBM is **AGPL-3.0**; verify outside-component license compatibility before incorporation.
7. **Apps:** mobile and desktop use **Capacitor wrappers**, sending purchases to web checkout with synchronized cart and session state.
8. **Unified experience:** one signed-in member portal and character; keep underlying customer/seller/team permissions, records and licensed equipment scopes distinct. Pending seller setup must not prevent buying or access to personal records.
9. **First delivery:** character creation → automatically configured useful portal → one real next action. Reuse ResourceQuiz, resource recommendations, playbooks, active saved onboarding and existing modules before new abstractions.
10. **Standard game view:** market/world navigation is the default, with direct shortcuts and a complete accessible compact view. Rich art is incremental; a decorative world does not replace working tools.
11. **Functional equipment:** free/earned/one-time purchased enhancements, plugins, settings kits, modules and portal builds configure real capabilities. Ownership, installation, configuration and equipping are distinct. Paid recommendations never cause an automatic charge; equipment never changes commission or grants transport eligibility.
12. **Reuse boundaries:** Blackout Coalition supplies the real-world map and its coordination records; Blackstar supplies existing transport operations; FBM retains commerce/agreements/inventory/entitlements. Link authoritative records instead of duplicating their domains. OSS fills verified gaps.

These are product decisions, not evidence of deployed behavior. Flag any contradictory code, copy, pricing, or architecture.

## Workstream 1 — Character creation and automatic portal building

**Audit before building:** vendor archetypes, onboarding goals layer, product taxonomy, and Vendor Quest Engine (reported feature flag off; verify). Reuse rather than duplicate.

- Ask **what the user has, needs, wants to do with others, and preferred settlement terms**; never ask for ideology or assign political labels.
- Store offers and needs in a **controlled taxonomy** plus optional free text, so they can be matched.
- First-value path: a short adaptive character builder covering goals, resources and practical participation → reasoned portal preview → idempotent application → one real next action. Reuse known answers and support resume/rebuild. A useful initial result within 60 seconds is a measured target, not a mandate to skip the important build flow.
- Choose a simple primary playbook plus compatible additional roles/tools; classes are changeable starter configurations. Buying-only and receiving-support builds are valid. Do not require a store name, paid tool or logistics enrollment to enter the market.
- Offer optional paid equipment with a concrete benefit, preview and one-time price. The starter portal works with free/owned tools, and accepting it never purchases an upgrade.
- Always end with **two or three concrete next steps** (e.g., list an item, join a pooled buy, contact a nearby organization); never an empty dashboard.
- Reveal tools progressively based on goals and quests; permit skip and re-run.
- Needs are **private by default**, selectively shared with explicit user control. Food, money, and other resource needs may expose sensitive circumstances.

**Acceptance:** survey completion, time to first relevant match, and useful next-step activation. Match results must never imply nonexistent supply.

## Workstream 2 — Composable exchange primitives

A shop, co-op, or nonprofit is a **preset of exchange primitives plus governance rules**, not a separate implementation path.

| Primitive | Starting point to verify in repository | Launch gate |
| --- | --- | --- |
| Sale | Medusa/MercurJS checkout | Correct processing-fee and commission ordering |
| Barter | Generic barter module; adapters reportedly planned | Organized barter exchange reporting, including Form 1099-B, legal review |
| Gift / mutual aid | Nonprofit and mutual-aid organization tooling | Fraud, abuse, privacy controls |
| Pooled buy | Demand pools, bargaining groups, order cycles | Securities review if pooled money is investment |
| Lend / share | New | Damage, deposits, disputes, liability |
| Consignment | Splits reportedly built but flagged off | Ledger correctness |
| Patronage | Disbursement reportedly built but flagged off | Ledger correctness |
| Goods auction | Newly prioritized; auction enum/doc placeholders are not a bid engine. Reuse catalog, inventory and checkout; evaluate Blackstar transport bid patterns separately | Atomic bids/close, reservation, winner payment, nonpayment/cancellation and scope checks |

**First regional end-to-end pilot:** character-built unified portal plus sale, gift, barter and pooled buy. Goods auctions are part of the target member market and a separately verified delivery package; they are not advertised as live before the bid-to-payment path works. Only expand to lending, consignment, patronage, and broader geographies after real transactions and operational controls work. Keep legal-gated features off until cleared.

## Workstream 3 — First session and useful return loop

Use the Hook Model only for **real-world utility**, never manufactured compulsion.

- **External trigger:** a real compatible nearby need, offer, bounty, or pooled buy approaching a genuine milestone. **Internal trigger:** “I need X and don't know who has it.”
- **Action:** under-60-second goal → questions → matching or concrete next steps.
- **Reward:** relevant people and responses (**tribe**), new needs/offers/bounties (**hunt**), and meaningful quest progress (**self**). Prioritize the first two.
- **Investment:** refined offers and needs, listings, chapter membership, reputation, saved suppliers, and **easy export**.
- Reflect real commerce rhythms: order windows, planting/harvest seasons, weekly batches; **do not force daily usage**.
- Seed the initial region with the founder's nursery, willing nonprofit partners, standing bounties, and pooled buys; verify consent and availability. Never show fake inventory or fake matches.
- **No streak guilt, artificial scarcity, spam, or coercive notifications.** Provide easy mute controls.

## Workstream 3b — Everyday utility

| Feature | Recurring trigger | Core action | Useful reward | Durable record |
| --- | --- | --- | --- | --- |
| **Housekeeping** | Weekly digest, order/filing deadlines | One-tap confirm/log | Nothing missed; records current | Private, exportable history and suppliers |
| **Goal planning** | Next milestone/quest | Choose next step | Progress and relevant matches | Goal and quest history |
| **Business research** | Sourcing or regulatory question | Search/ask | Sourced suppliers, grants, rules, peers | Research notes, optional chapter sharing |
| **Equipment sharing** | Nearby request/booking | Request, approve, return | Access, income, goodwill | Equipment and lending history |
| **Cooperative tools** | Proposal/vote deadline, pooled buy | Vote or pledge | Collective result/patronage when authorized | Governance records and shared ledger |

**Build order:** housekeeping and goal planning → cooperative features → equipment sharing → business research. Reuse AGPL-compatible accounting/records components where appropriate. Records remain private and exportable. Research must cite sources and explicitly say when reliable information is unavailable. Equipment sharing needs damage/deposit/dispute terms and liability review. Every utility feature should produce a matchable goal, need, or offer where the user consents; avoid isolated silos.

## Workstream 4 — Independent local chapters

Inspired by **CoopCycle's shared-software/local-autonomy model**. A chapter runs its own affairs using federated infrastructure. Build a small chapter kit: one or two legal entity templates, bylaws template, chapter ledger, and Blackout governance rooms.

- Chapters establish their own local rules, subject to minimal network-wide floors against **fraud and coercion** and any mandatory legal/safety requirements.
- No central membership list. Minimize chapter data and protect E2EE; distinguish public governance records from private membership and communications.
- Pilot **2–3 chapters in one region** before federation infrastructure expands.
- Do not imply Blackout integration or federation is shipped without evidence.

## Workstream 5 — One-time pricing migration

Audit **all** vendor plans (reported up to $249/month), billing code, subscription entitlements, checkout, storefront copy, emails, and documentation. Remove subscriptions **as one coordinated, tested migration**, including treatment of existing customers, renewals, refunds, and entitlements.

- One-time software purchase grants that **version**, not unlimited hosted services forever.
- Recurring hosting, SMS, shipping labels, and other metered services: disclose **actual at-cost pass-through**, with usage caps or prepaid limits where appropriate.
- Optional future upgrades and support: separately priced, not a subscription disguised as a mandatory fee.
- The fixed 3% commission remains the platform's primary recurring revenue.

**Sustainability risk:** lifetime hosted access with unlimited usage can produce unbounded cost and liabilities. Set explicit hosting quotas, prepaid usage or at-cost pass-through; cap SMS by prepaid credits, shipping by actual label charges, and storage/compute by published quotas. Review payment-provider rules and consumer disclosures before release.

## Non-negotiable safeguards

- **Off by default pending legal review:** organized barter reporting (Form 1099-B), pooled investment/securities, KARMA-linked pricing, cross-border settlement, Stellar/USDC settlement.
- Needs/offers **private by default**, including public API reads. Privacy-check every new endpoint, especially unauthenticated community data and courier PII; test authorization and tenant boundaries.
- E2EE is never a paid entitlement.
- Do not claim flagged-off capabilities are live; do not claim payout or fee behavior until verified.
- No dark patterns; no fabricated research, matches, prices, delivery or savings.
- Never expose or log secrets; put environment keys in private host configuration and document key names without values.
- Check AGPL-3.0 compatibility and other applicable license obligations before importing dependencies.

## Execution protocol and definition of done

1. **Audit first:** compare repository main, deployment revision, runtime flags, active pricing, actual fee arithmetic, APIs and privacy exposure. Record **built / deployed / enabled / blocked / unknown** separately. Earlier docs and starting-point references are hypotheses until checked.
2. Use the approved [unified member portal plan](FBM_UNIFIED_MEMBER_PORTAL_PLAN.md) to deliver the smallest Workstream 1 + 2 slice. The product direction is decided; record unresolved migration, policy and deployment decisions at the relevant package rather than reopening the approved interface requirements.
3. Build small deployable steps; verify behavior in the **running stack**, not tests alone.
4. Report changes, evidence, unverified assumptions, legal blocks, and deployment gaps.

**Done:** character creation generates a useful unified portal, the member sees real matches or honest next steps and can complete a first **sale, gift, barter or pooled buy** in the pilot region. Verify game/compact access, saved build state, correct equipment rights and no unintended charge. Track auctions and transport as separate capability-specific gates; do not imply they shipped because the portal shell exists.

**Primary metrics:** survey completion; time to first match; time to first transaction or connection; four-week return; **weekly completed exchanges**. Optimize for real exchanges, not opens or engagement alone.

## Reconciliation with older documents

This charter supersedes previous monthly vendor plans, subscription-based entitlement assumptions, KARMA-based fee variation, daily-streak engagement assumptions, ideological mode concepts, and any state-only quest rules. Existing implementation inventories and compliance gates remain useful as **historical evidence**, not permission to override these decisions. Contradictions must be logged and fixed in a separately approved code workstream.
