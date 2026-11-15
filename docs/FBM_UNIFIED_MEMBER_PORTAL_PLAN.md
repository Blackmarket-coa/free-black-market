# FBM unified farmers market: character creation, equipment, and portal plan

**Decision date:** November 12, 2026  
**Status:** Approved product direction; proposed implementation and release plan grounded in source inspection. This documentation update does not change application code, billing, production flags, deployment or permissions.  
**Latest direction:** One signed-in portal combines buying, selling, trading, and auctions in an online farmers market. Character creation is the primary survey and automatic portal-building journey. Game view is standard. Reuse existing FBM code first; OSS fills verified gaps. Paid enhancements, plugins, settings, modules, and portal builds are functional equipment, one-time purchases; no subscriptions.

**Revision:** Incorporates the November 12 decisions to merge vendor/customer experiences, make real-life resources/goals drive character creation and automatic portal setup, and reuse Blackstar transport operations and Blackout Coalition map/coordination. A targeted Blackstar source audit is now included. Earlier source findings remain historical evidence; the target architecture below supersedes the previous three-portal delivery approach.

**Authority:** This plan is canonical for the unified member experience, character creation, automatic portal building, functional equipment and cross-repository reuse. The [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) retains the economic/privacy invariants; the [Resource Exchange MVP](FBM_RESOURCE_EXCHANGE_MVP.md) retains the staged pilot and operational gates. Historical portal separation, optional-game assumptions and auction deferrals are superseded as product direction, not silently marked implemented.

## 1. Product contract

**FBM — The social safety net built with the community, for the community.**

The main journey is: meet an immediate need → form useful relationships → build skills and productive capacity → create reliable surplus → exchange for diversity and greater independence.

People can participate as individuals, producers, traders, service providers, customers, organizers, organizations, and coalition leaders. These are overlapping activities, not permanent account classes. A person can seek help today and supply someone else tomorrow. Food, needs, friendships, useful labor, and completed exchanges are the substance of the experience.

The default interface is an explorable community world with one signed-in member portal. Every member can move among buying, selling, trading, and auctions as supported capabilities become available. Their character-creation survey automatically builds a home/base, goals, starter toolkit, contacts area, and market access around what they can do in real life. Buildings, characters, stalls, and objects open working FBM capabilities. A compact accessible view provides the same functions; game view remains standard.

The character represents the user's chosen goals and growing toolkit. It is an expression of progress, not a rating of the person's worth. Equipment is functional: equipping an invoicing module opens invoicing; equipping a portal build composes the workspace; equipping a plugin installs or activates the corresponding supported capability.

**Preserved decisions:** flat 3% Coalition commission on the applicable sale base after processing fees; KARMA does not change commission or payouts; one-time enhancement purchases; E2EE remains available without payment; nationwide architecture with jurisdiction-specific coverage; open source and AGPL-compatible integration; mobile wrappers retain synchronized web checkout.

**Working visual direction:** warm, playful solarpunk with recognizable objects, short labels, calm motion and clear feedback. Character creation uses class/starter/evolution inspiration from WoW/Pokémon with original names and artwork. Exploration, dialogue and trading are functional ways to navigate the market.

## 2. Audit scope and confidence

Inspected the full file trees of:

- **FBM main:** a449f457aa1102eeb4278f1696455a9a1af584ca.
- **Blackout develop:** 66523abd9f066a96508832f4731ec387e06846d6.
- **Blackstar main:** ade2ac27135c992d344a50f40bee2d79fb05ff4c (added in this revision).

Read selected implementation files across storefront, customer account, vendor routes/onboarding, progression, XP rewards, entitlement, plugin registry/install, playbooks, cottage food, demand pools, mutual aid, opportunity scoring, production costing, shared UI, Matrix chat, and Blackout map/bridge code. The appendix provides pinned source links.

This is a targeted source audit, not an exhaustive review of every line or a running-stack validation. “Exists” means inspected source exists. It does not establish deployment, enabled flags, working infrastructure, populated data, or successful transactions. Repository tests were not run because this task produced a plan without application changes. Production commits, configuration, and operational readiness remain release-stage verification.

### Code-grounded findings

| Area | Verified source finding | Implementation consequence |
| --- | --- | --- |
| Customer portal | Customer portal is currently inside the Next.js storefront under /user. Its home displays a welcome message and navigation. [S01] | Use this existing application as the proposed unified member host; migrate seller tools into it progressively rather than building another customer app. |
| Storefront discovery | ProductFeed already offers grid/list/masonry. ProductFeedServer passes hasMore but no onLoadMore; the client displays Load More only when both exist. Local category buttons update activeFilter while rendering the unfiltered products array. [S02–S04] | Repair pagination/filter wiring and make masonry a working market board within the default world. |
| Feed ranking | Recent, trending, featured, personalized, and following map to newest-created ordering in the reviewed data function. [S05] | Use truthful labels until distinct ranking/curation/following logic exists. |
| First session | /start has role cards and an onboarding checklist based on account/XP/order signals. Its first-exchange step uses order completion. [S06] | Reuse the checklist but support useful non-purchase outcomes: gift, help, partner connection, and verified goal steps. |
| Vendor onboarding | Routed onboarding uses LaunchWizard, or QuickPath when its flag is enabled. LaunchWizard autosaves and includes a home-kitchen step. VendorOnboardingFlow contains the safety/possibility/commitment/belonging concept, but its definition/export alone does not show it is the routed flow. [S07–S10] | Refactor the active route instead of polishing an unconnected component. Preserve drafts and quick publication. |
| Vendor home | / redirects to /dashboard; dashboard reads orders/onboarding/reviews. [S11–S12] | Bring these tools into the unified member workspace; preserve current vendor URLs during migration. |
| Character/progression | Character sheet, role XP, levels, titles, lifetime/spendable balances, and /character already exist. The inspected model has no defined equipment/loadout fields. [S13–S15] | Extend progression with a small equipment projection and configuration layer; do not build another XP economy. |
| Rewards | A static catalog and XP-to-entitlement redemption route exist. Catalog names themes, emoji packs, an access pass, and PDFs. [S16–S17] | Verify assets and real consumers before advertising them; extend to verified native tools and portal builds. |
| Reward correctness | Service debits XP, creates a pending redemption, then the API grants an entitlement and marks completion. Those operations span steps/modules. [S15,S17] | Review retries, crash recovery, duplicate requests, and compensation before equipment depends on this path. Source review alone does not prove every failure mode is handled. |
| Motivation | Current order.placed subscriber awards consumer XP based on order value. An accepted ADR and job implement spendable-XP decay; lifetime status is separate. [S18–S19] | Revise rewards toward useful verified outcomes, including non-spending participation. Resolve decay policy explicitly for the new care metaphor. |
| Equipment foundation | Entitlements support customer and seller scopes; plugin registry, manifests, versions, and seller install APIs exist. [S20–S23] | Reuse ownership/install/version mechanisms; add equipment semantics around them. |
| Equipment authority conflict | Seller plugin install authority currently remains enabled_extensions; entitlement grants are documented as best-effort. The same column mixes UI keys and plugin slugs. [S21,S24] | Reconcile authority before paid equipment; do not assume a generic entitlement check already governs every seller plugin. |
| Portal composition | Playbook recipes and vendor feature defaults exist, as do route/settings extension hooks and shared portal packages. My Website has embed and standardized hosted-site launch paths. [S25–S29] | Reuse these as starting points for portal builds. They are not proof of a general-purpose portal builder. |
| CMS blueprint | Reviewed CMS service manages taxonomy/types/categories/tags/attributes. [S30] | Do not describe it as a working layout or portal generation engine. |
| Cottage food | Profile, labels, sales, optional declared limits, and setup checklist exist. The service is explicitly advisory and never blocks a sale. [S31–S33] | Add a sourced jurisdiction/product suggestion service alongside this module. Legal eligibility enforcement would be a distinct reviewed change. |
| Forecasting | Opportunity engine has prices, startup guides, and demand/competition signals. Signals can degrade to zero; some reads have fixed take limits; null delivery regions can count across regions. [S34–S35] | Add coverage/error provenance and geographic correctness before presenting local demand or sales forecasts. |
| Costs | Production costing distinguishes full economic cost, cash cost, in-kind inputs, labor, packaging, freight, and overhead. [S36] | Reuse this arithmetic for starter suggestions and fair-price planning. |
| Coalitions and needs | Demand pools already model quantities, targets, terms, deadlines, and visibility. Mutual-aid API publishes a reduced public projection. [S37–S38] | Reuse the modules; add private goal/draft handling rather than assuming public board posts are private. |
| Peer conversation | Vendor messages already uses a configured Matrix/Element iframe. Shared MessageFeed is a display shell; its optional Send button is not wired to a send callback in that component. [S39–S40] | Connect actual room membership, send, replies, and unread state; a visible feed is not a finished collaboration tool. |
| Blackout map/integration | MapLibre map, consent-aware map tab, commerce client, aid mirror, logistics bridge, and live-interaction definitions exist. [S41–S45] | Reuse Blackout for community/map/media services. A complete transactional live market or demographic research layer was not established by these reads. |
| Pricing contradiction | Vendor catalog still defines recurring plans and fee discounts; fee resolver can use plan/override rates. [S46–S47] | Migrate pricing and enforcement before launching the equipment store. |
| Feature visibility | Central backend and storefront feature flags exist with many defaults off. [S48–S49] | Respect actual runtime capability status in every world, portal, item card, and direct API. |
| Unified identity starting point | Seller-registration code preserves existing auth metadata when adding seller_id and explicitly recognizes a customer_id may coexist. Seller middleware still resolves a seller actor, and quote acceptance explicitly checks a customer actor. [S57–S61] | Build one member session and capability-aware UI while retaining correct server-side actor/context authorization. |
| Existing seller access gate | Vendor ProtectedRoute checks seller session/approval for the whole app. [S60] | Do not reuse this as the unified portal's outer gate: pending selling setup must not block purchases, messages, or personal records. |
| Direct trade gap | Barter model and acceptance route are bound to demand posts/bounties; acceptance records agreement immediately, not a new general two-party handoff workflow. [S62–S63] | Extend the existing barter domain to direct member listing trades and separate agreement from fulfillment. |
| Auction gap | Availability pricing includes AUCTION with a future-feature comment; listing-type docs defer auction bidding/close behavior. [S64–S65] | Auction is newly planned work, not an implemented bid/settlement engine. |
| Resource-based character creation | ResourceQuiz already asks about resources, reveals a recommendation, supports multiple role selections and a primary recipe, allows overrides/re-runs, and makes delivery operation an explicit opt-in. Server-side recommendation functions also exist. [S67–S69] | Reuse this as the character-builder foundation and connect it to automatic portal composition for all members. Audit persistence before claiming multi-role builds are fully configured. |

NFC business cards, a general equipment loadout, and a full explorable trading world were **not verified in the inspected implementation**. This is a scoped finding, not proof of absence across all repositories or branches.

## 3. One member portal: an online farmers market

**One account experience, one character, one portal, many activities.** The public storefront is the market before login; the same market gains the member's home, stall, equipment, messages and activity after login. Buying and selling are actions in one place. There is no mandatory buyer-versus-vendor mode switch.

### Shared destinations

| Destination | What every member can do | Tools added through their build |
| --- | --- | --- |
| Market | Discover goods, food, services, offers, requests and people | Buy, offer a trade, bid when auctions are enabled, compare pickup/delivery |
| My place | See character, current goal, contacts and next action | A simple personal base or a configured producer/organizer workshop |
| My stall | Draft offers and manage what they can provide | Listings, stock, sales, services, quotes and auction lots |
| Exchanges | Track both sides of their activity | Buying, selling, trades, bids/wins, handoffs, refunds and disputes |
| Commons | Meet colleagues and community groups | Supplier rooms, process discussions, shared resources and project coordination |
| Toolkit | See starter gear, owned equipment, rewards and useful upgrades | Native enhancements, plugins, settings, modules and portal builds |
| Map/research | Explore supported public area/resource information | Production opportunities, local input research and Coalition projects |

A member might buy seeds, sell seedlings, trade surplus plants, and bid on a used tool during the same visit. Their portal reflects these real activities without asking them to become a different kind of user.

**Standard interaction:** tap/click or walk to a stall or destination → interact with a real person/organization character → open a dialogue or task panel → perform the action → see server-confirmed outcome and progress. Global search, messages, help, checkout, and urgent tasks remain directly reachable without mandatory walking. Touch, keyboard and the complete compact view share the same actions.

The fictional world is navigation, not a public map of private homes or people. The real Coalition map retains separate location and consent rules.

### Identity, permissions, and progressive setup

- Use a single verified sign-in identity as the member entry point. Resolve linked customer, seller/member, and organization/team contexts on the server. Existing code shows a useful linking foundation, not a finished universal session.
- Preserve the existing customer and seller domain records and IDs. A shared interface does not require merging financial histories, actor IDs, entitlements or permissions into one database row.
- Extend the existing session plumbing with a member capability summary: shopping access, seller setup status, permitted workspaces, available tools, and actionable setup steps. Choose the exact API shape during implementation.
- A customer can draft an offer and start the appropriate seller setup from My stall. Where publication, payment collection or payouts require existing approvals, apply those checks to that action. Keep buying and personal records usable while selling is pending or unavailable.
- Obtain the correct actor-scoped authorization for each existing API through a server-controlled session/context adapter. Do not make a customer token a seller token by changing a UI flag or trusting a submitted seller ID.
- Reuse existing identity links and verified account recovery/linking. Never auto-merge historical accounts only because their email strings match.
- A personal versus organization selector changes who the member is acting for, not whether they are a buyer or seller. Check team permissions for each action and show that context before committing.
- Purchases and sales share an activity screen but retain separate totals, receipts, payout records and refund obligations. Do not invent a combined spendable balance.
- One member character can show multiple skill tracks. Organization and seller equipment retains its licensed scope; one portal does not automatically duplicate ownership.

### Commerce methods inside the same stall

| Method | Member experience | Reuse and missing work |
| --- | --- | --- |
| Buy/sell | Browse a stall, agree price/quantity, purchase, fulfill | Reuse catalog, checkout, orders, stock and payouts; expose existing seller tools within the shared portal |
| Trade | Offer goods/services for another listing, negotiate, accept, complete handoffs | Extend the existing barter domain beyond demand pools; record both parties and separate acceptance from completion |
| Auction | List a lot, bid, see current status, win and complete purchase | New auction lifecycle/bid handling required; reuse inventory, catalog, identity, checkout and fulfillment |
| Gift/mutual aid | Offer/request help, agree, confirm handoff | Reuse permission-safe mutual aid and community primitives; preserve private needs |

Listing quantity, owner, fulfillment terms and supported exchange methods must be explicit. A unit cannot be simultaneously sold, committed to an accepted trade, and awarded at auction. Reserve/release inventory atomically across these paths and reconcile cancellation or timeout.

The same Exchanges page groups records by what needs attention. Buying, Selling, Trades and Bids are filters, not separate portals.

### Host and migration proposal

Use the existing Next.js storefront/account application as the unified host. Bring portable components, forms and typed API logic from vendor-panel into shared packages and this host progressively. Vendor React Router pages cannot simply be imported as Next.js pages; adapt routing, auth hooks, client boundaries and styles while retaining the working backend APIs.

Keep the existing vendor panel operational during the transition and preserve/bookmark-map its URLs. Temporary deep links are migration aids, not the finished unified experience. Retire a legacy route only after equivalent tools, permissions, saved state and error handling are validated. Admin/operator controls remain separate from ordinary member access.

### First-session example

The participant chooses a food goal, says they have a home kitchen and some ingredients, chooses an approximate area/state, and indicates available time and pickup preference. The character builder proposes a simple kitchen starter configuration, shows what it enables, and opens a real next step. The same member can then buy ingredients, draft bread listings, trade surplus and join a local conversation from that portal.

A person who only wants to buy or receive support gets a useful lightweight build; they are not forced through business setup. Their character and portal can evolve later.

## 4. Equipment is the capability system

### Equipment types

| Item type | What the user sees | What it actually controls |
| --- | --- | --- |
| Native enhancement | A useful tool with clear benefits | An existing supported feature key and its UI entry |
| Plugin | A specialist instrument | A compatible registry version, install state, permissions, and route/widget |
| Settings pack | A configuration kit | A previewable set of permitted settings; user can inspect and undo changes |
| Module | A workstation such as costing or invoicing | A domain module's enabled UI, user rights, and supported workflows |
| Portal build | A complete workshop/base layout | Versioned composition of modules, routes, widgets, theme, settings, and permissions |
| Earned digital product | A book, recipe set, theme, or tool choice | A real download or entitlement with working delivery/consumer |
| Cosmetic appearance | An optional visual expression | Appearance only; distinguish it from operational equipment |

Purchases, rewards, free starter tools, and approved manual grants are acquisition paths. **Owning**, **installed**, **configured**, and **equipped** are distinct states. Unequipping a purchased item does not erase ownership or delete its data. Re-equipping must work without another purchase.

**Portal build** means a functional workspace composition, not only a skin. A kitchen build might assemble costing, cottage-food records, labels, pickup scheduling, a supplier room, and a public stall. A service-provider build might assemble booking, quoting, invoicing, and customer communication. A nonprofit build might assemble needs, volunteers, resource allocation, and appropriate fund reporting. These are configurations of existing domains wherever verified.

### Implementation contract

1. Preserve existing entitlement, seller-extension, plugin registry/version, and playbook records.
2. Introduce a thin **equipment catalog/projection** that maps existing records to item presentation, feature keys, supported scopes, version compatibility, dependencies, permission requests, and activation targets.
3. Persist only genuinely new facts: loadout, equipped slots/placements, portal-build version, and reversible settings application. Do not duplicate orders, plugin versions, entitlements, XP ledgers, or production records.
4. Member, seller-workspace, and organization-owned equipment must carry explicit scope inside the same portal. Existing customer/seller grants keep their lineage; merging the interface does not transfer paid rights automatically. An organization can allocate access according to its license and team roles.
5. Resolve plugin-install authority explicitly. Existing seller installs must keep working while the entitlement/install stores are reconciled. Use a backfill and shadow comparisons before changing authority.
6. Separate mixed UI feature keys/plugin slugs safely, preserving null/archetype defaults and all writers. A migration that silently disables current vendor tools is unacceptable.
7. Equipment activation must pass ownership/install checks, runtime flags, supported version, permissions, and dependency checks on the server. A glowing item is not authorization.
8. Purchase grants ownership of the disclosed software/build version. Upgrades can be separate one-time purchases. Display compatibility and support policy. Hosted/metered costs, if any, must be disclosed separately from software ownership.
9. A reward and purchase for the same capability resolve to the same usable capability. Avoid duplicate charges and duplicate grants.
10. Refund, revocation, incompatibility, failed install, and retired plugin states need honest recovery screens. Preserve data and export access where appropriate.
11. A settings kit changes only permitted preferences after a visible preview. It cannot disable consent, grant admin rights, or bypass checks.
12. Core help, essential communication/privacy, and access to one's own records must not become paid equipment barriers.

**Proposed new models, subject to migration design:** equipment definition/reference; scoped loadout; equipped item/placement; portal build/version; settings application history. Reuse existing manifests where they fit; do not overload plugin manifests with unrelated game state.

### Pricing migration

Audit all vendor-plan, billing, fee resolution, order entitlement, subscription renewal, public fee schedule, Blackout consumption, and portal copy paths. Determine whether legacy recurring records are live before changing them.

Create a coordinated migration to one-time equipment products and versioned ownership, reconcile existing rights, retire renewal behavior, and preserve financial history. Assert one sale-fee rule across the public market, unified member portal, checkout, refunds, payouts, and game dialogue. Existing donations and other transaction-kind behavior require an explicit policy mapping; do not accidentally apply a sale fee to a gift or rewrite separate accounting semantics.

No reward, level, equipped item, or purchased portal build changes the fixed sale commission.

## 5. Goals, visual onboarding, care, and rewards

### Character creation is the portal builder

This is a central product capability, not a profile form after signup. **Create your character → automatically build your portal → do one useful thing** is the first delivery milestone.

Use the appeal of World of Warcraft class creation and Pokémon starter choices: a visual reveal, recognizable strengths, a small starting toolkit and an evolving path. Use original names/art and everyday-language explanations. Classes are starter configurations, not permanent restrictions. A grower can buy, sell, trade, bid and later offer services.

Reuse the active LaunchWizard's saved state, ResourceQuiz's question/reveal/override phases and multi-role selection, existing resource recommendation functions, playbook assignments/progressions, and equipment manifests. The existing resource quiz is materially closer to this requirement than a new questionnaire written from scratch.

### Short, adaptive character-build flow

| Screen | Visual interaction | Real-life information | Portal consequence |
| --- | --- | --- | --- |
| Your direction | Choose illustrated goals; one main goal with optional secondary goals | Need food/goods, grow/make, offer a service, trade, organize, or help | Prioritize the first task and keep every core market activity reachable |
| Your starting resources | Select cards showing kitchen, land/plants, tools, transport, materials, skills, time, audience or community | What the member actually has available; “none yet” and “not sure” are valid | Recommend supported tools and pathways without assuming assets or money |
| Your way to participate | Short availability, pickup/delivery, solo/group and optional budget controls | Practical time, access, fulfillment preferences and constraints | Suggest manageable tasks, appropriate setup and relevant interactions |
| Your starting build | Reveal character and a simple starter toolkit with “why this fits” | Confirm or change the proposed combination | Preview the functional portal; free/owned tools and optional paid additions are clearly separated |
| Enter the market | Name/appearance if desired, then accept the build | Only details needed to save and use it | Persist setup, open the portal and highlight one real useful action |

Ask state/locality when a branch needs it, such as food production or local matching. Exact location, payout verification and team/governance details are requested at the action that needs them. A resource does not imply consent: owning transportation does not enroll someone as a delivery operator, and having a kitchen does not certify food eligibility.

Use short labels, illustrated examples, optional narration and visible progress. Maintain readable text for prices, agreements, allergies, permissions and errors. Reuse known answers; support back, save/resume and later rebuild. People may enter a basic starter build quickly and finish optional branches later. The earlier 60-second first-value target remains a measured goal for a useful initial result, not a requirement to rush or flatten this important build flow.

### Automatic build pipeline

1. Save a versioned private draft of declared goals, resources and practical preferences. Clearly distinguish declared facts from suggestions.
2. Run existing deterministic resource/playbook recommendations first, extended for members seeking needs as well as supplying them. Reuse multi-role selections; verify end-to-end persistence and feature consumption.
3. Choose a simple primary configuration and compatible secondary tools. Avoid exposing internal governance terminology unless the member is setting up an organization.
4. Resolve free starter capabilities, existing ownership, enabled runtime features, permissions, dependencies and device/accessibility needs. Do not provision an unavailable feature because a quiz recommended it.
5. Assemble a portal build manifest with destinations, module placements, settings defaults, starter equipment and one next goal. Reuse the existing playbook/feature/extension system; add only missing composition facts.
6. Show a preview with a short reason for each selected tool and any unmet requirement. Allow changes without forcing the user to design a dashboard.
7. Apply the build idempotently and save its version. Progress is based on actual saved/configured state, with retry and rollback if one component fails.
8. Populate real next actions and honest empty states from actual matches/data. Do not fabricate customers, demand, replies, legal eligibility or completed tasks.
9. Present later tool recommendations when a relevant need appears; allow manual Toolkit access and rebuilding at any time.

The existing server/client recommendation copies must produce the same result. Prefer a shared pure decision library or contract checks over maintaining more copied logic. Current resource recommendation reasons include social-form assumptions and legacy subscription wording; rewrite explanations around the answers actually given and the fixed pricing decisions.

### Illustrative starter builds

These are proposed configurations of existing tools, subject to verified availability.

| Real-life answers | Starter configuration | First useful action |
| --- | --- | --- |
| “I need affordable food and have little time” | Lightweight market, saved needs, messages and relevant pooled-buy/help entries | Find an actual offer or save a private need |
| “I have a kitchen and bake” | Kitchen/stall configuration, draft listing, costing and cottage-food setup where available | Compare a sourced suggestion or cost a batch |
| “I have plants or growing space” | Grower configuration, listings, harvest/inventory and pickup tools | Draft an available plant/produce offer |
| “I repair things and have tools” | Service/workshop configuration, quotes and scheduling where available | Draft a service or answer a real request |
| “I organize people and share resources” | Commons/hub configuration, needs, contacts, volunteers and coordination | Create an appropriately scoped resource request |
| “I have items to exchange” | Simple stall, offers, direct trade and auction tools as each is completed | Draft an offer with supported exchange methods |
| “I have transport and want to carry deliveries” | Reuse explicit node-operator opt-in and Blackstar eligibility setup; add an operator board to the same portal | Complete operator setup, then review and voluntarily claim eligible work |
| “We organize food/resource distribution” | Coalition needs/projects/tasks/resources/map plus FBM stock/order-cycle and Blackstar delivery tools | Coordinate a real drive, then connect the appropriate physical fulfillment |

### Contextual paid-feature discovery

Members may see paid enhancements in their build preview and while using related tools. Show a concrete outcome, preview, one-time price, compatibility, dependencies and any separately disclosed hosted usage. Label suggestions as optional paid equipment. Never auto-add an item to checkout or charge as part of accepting the free starter build.

Keep the first portal useful with free/owned capabilities. If a recommended paid tool is not owned, offer a usable starter route, an earned reward path where actually available, or an explicit optional purchase. Basic buying/selling/trading/bidding are marketplace activities; enhanced automation and specialized tools are equipment products. Do not invent a separate mandatory subscription or paid buyer/seller identity.

Examples: recommend batch-label tooling when a producer starts packaging; offer an invoicing enhancement when a service provider needs repeat billing documents; show a portal build when someone wants a richer workspace. These are proposed recommendations, not claims that every named tool/reward is shipped.

Paid advertising must never masquerade as required character creation, verified demand or the only way to make progress. Keep discovery useful and easy to dismiss.

### Character care

Completing a chosen goal feeds/energizes the character; acquiring a capability equips it; maintaining real commitments improves the base. The user's program can change direction and the character changes with it.

**Proposed revision:** absence does not starve, injure, or erase the character or earned tools. Prefer a rested/paused state and a friendly return action. Current spendable-XP demurrage is an explicit existing policy; assess and revise it in a recorded decision rather than pretending it does not exist. Permanent levels/ownership stay distinct from spendable rewards and optional activity effects.

Reward verified practical actions: completing a learning task, fulfilling an exchange, helping a collaborator, contributing an accepted process improvement, or reaching a real project milestone. Verify event semantics before reuse: current buyer XP is awarded at order placement and scales with spending. A placed order is not proof of a fulfilled need; cancellations/refunds and duplicate delivery need reconciliation.

### Variable rewards and choice

Use variety in which useful choices appear, while keeping eligibility and earning terms predictable. At an earned milestone, offer a choice among deliverable digital products, a native tool, or a permitted equipment upgrade. Show what each does and allow “choose later.” No purchase-dependent random reward is needed.

The repository catalog is a starting point, not proof the theme/emoji/PDF has a real consumer or file. Hide nonfunctional rewards. Connect every catalog entry to a tested entitlement consumer or download. Extend redemption with stable request/event identifiers, durable pending state, failure recovery, and reconciliation. Sharing, browsing, and chat volume alone should not produce farmable rewards.

## 6. Cottage-food suggestions, cost, and local research

### State-first production suggestions

Reuse cottage-food profiles, labels, sales meters, launch-wizard drafts, production costing, opportunity engine, and startup guides. Add a **versioned jurisdiction/rule and product-suggestion layer**; the existing self-declared compliance tracker does not provide this.

State selection initiates recommendations. Ask locality, product/process, sales channel, fulfillment method, and destination only when required to make a useful distinction. Do not require every visitor to complete a legal questionnaire before browsing.

Each suggestion must show:

- Food/product and eligible recipe/process assumptions.
- Jurisdiction, official source link, effective/review date, and coverage status.
- Ingredients available from opted-in local inventory, user inputs, or cited data; availability and seasonality as of a date.
- Batch yield, labor, packaging, energy/overhead, spoilage, fulfillment, processing and Coalition fee assumptions.
- Cash required, full economic cost, estimated sustainable sale-price range, and editable assumptions.
- Demand evidence separately: current requests/commitments, prior actual sales, expressed interest, or a modeled estimate. Never label interest as guaranteed sales.
- “Insufficient data” when price/demand/ingredient coverage is inadequate.

South Carolina's official guidance distinguishes home-based eligible foods from other food operations; SCDA says it does not issue cottage-food permits/licenses/certificates/registrations. Therefore generic required-permit setup cannot serve as a universal jurisdiction rule. Use the state's official guidance as one source adapter, not a nationwide template. [W01]

Do not insert a new automatic compliance blocker into the existing advisory service silently. Recommendation eligibility, seller declarations, and any future listing/sale restrictions are separate policies with separate acceptance tests.

### Research desk and Coalition map

**Blackout Coalition is the shared real-world map and coordination surface.** Reuse its MapLibre map, place/area model, existing tabs and consent patterns; do not create a competing FBM map or a separate logistics map. FBM's existing blackout-spatial consumer is the starting point for spatial service calls. The fictional game-world scene remains navigation and does not replace this geographic map.

Reuse Blackout's MapLibre/Coalition implementation and consent patterns. Add source adapters and a research panel for public demographic/economic/election information. Start with one locality and proven datasets, then expand coverage nationwide.

| Layer | Preferred source/data type | Required qualification |
| --- | --- | --- |
| Population, income, poverty, housing, employment | Census ACS and appropriate Census economic datasets | Geography, reference period, estimate, margin of error, missing values |
| Business presence | Relevant public Census/local economic data and opted-in FBM vendors | Aggregate coverage; do not imply a complete live registry |
| Election results/turnout | Certified official state/county election results with boundary data | Election/date, reporting unit, turnout denominator, crosswalk limitations |
| Local needs and supply | Permission-safe FBM/Blackout projections | Consent, freshness, approximate location, sampling/coverage |
| Ingredient/commodity prices | Producer inputs and USDA Market News where coverage exists | Product grade/unit, market/date, retail vs wholesale distinction |

ZIP Codes, ZCTAs, census tracts, neighborhoods, and electoral precincts are different geographies. ACS demographic ZIP-like mapping uses ZCTAs; retain the original geography and crosswalk provenance instead of relabeling a precinct as a neighborhood or presenting estimated allocation as exact. [W02] USDA's local/regional Market News supplies prices/volumes for covered markets, not guaranteed neighborhood retail demand. [W03]

Election layers are aggregate area information. Do not infer an individual's beliefs or tie private needs/customer purchases to voter identities. Geographic research should help communities understand services and resources without creating sensitive person profiles.

Before forecasts, repair the opportunity engine's absent/error-as-zero distinction, query coverage, regional scoping, sample sizes, units and currency semantics. Store source, observation date, collection geography, freshness, and missing/error state.

## 7. Colleague commons, supply expansion, live markets, and tap cards

### Information exchange as a primary destination

Put colleague activity and partner conversation on the base/workshop home and in contextual tool panels. Reuse Matrix identity linking and existing Blackout/FBM bridge contracts.

Support topic rooms for product processes, growing, production systems, maintenance, sourcing, logistics, and organizing. Give users a practical place to ask “who has this?”, share a process, troubleshoot, find partners, and attach a listing or resource request. Distinguish a public group, private partner room, and order conversation. Room membership and consent govern access.

“Constant jabber” means accessible ongoing conversation with real people, not generated activity. Implement send/reply, unread counts, mentions, muted rooms, reconnect, reporting/moderation, and direct context links. Do not auto-post private needs, costing records, or financial data to rooms. Existing iframe chat can remain the first working client while native panels are built.

### Coalitions that improve affordability

Reuse demand pools, costing, order cycles, mutual aid and collective quests. A campaign can identify unmet demand, help additional independent producers enter, share public process knowledge, pool inputs through appropriately structured procurement, and improve distribution.

Show demand, buyer commitments, productive capacity, delivered price, waste, labor compensation, and fulfillment. Expanded supply may lower prices, but outcomes depend on costs, demand, access and logistics. Track affordable supply and durable producers rather than promising that flooding a market automatically creates abundance.

Supplier proposals and private quotes retain independent pricing. Collaboration tooling must not ask competing sellers to agree common prices, discounts, customers or territories. The FTC's guidance explicitly includes agreements to lower or stabilize prices in its price-fixing description. Review shared cost/capacity data features before launch rather than promising a legal safe harbor. [W04]

### Live markets

Reuse Blackout's room/media foundation, existing FBM catalog, the reviewed quote-to-cart acceptance route, bargaining capabilities where verified, checkout and inventory. A session adds host identity, featured products, pinned offer, stock/availability, dialogue, accepted quote reference, and recording/consent policy.

Seller characters represent actual sellers/organizations. Dialogue can be a guided transaction menu or real messaging. Automated help must identify itself and cannot pretend a seller accepted terms.

The same panel must let a user view products, ask questions, make/receive an offer, review exact quantity/price/delivery/tax/fees, accept a server-versioned quote, and proceed to the existing checkout. Keep those panels inside the game presentation where practical. Payment authorization remains the existing web checkout with return to the session/world. Inventory reservations, quote expiry, duplicate payment prevention, refunds and dispute access must work independently of media connectivity.

A video call, video reel, or public vendor catalog is not a complete live-commerce transaction.

### Direct trading and auctions

**Direct trades:** extend the existing barter proposal/service rather than starting another exchange domain. Add explicit listing/participant references and agreed terms for both sides; preserve demand-pool fulfillment behavior for existing callers. Record proposal, counteroffer, acceptance, reservation, each party's handoff, cancellation and dispute separately. Existing immediate acceptance/audit recording is not proof of physical fulfillment. A zero-value noncash audit record must not become fictional cash revenue.

**Auction baseline:** a timed ascending auction on a real inventory lot, with disclosed start/end, starting amount, increment, any reserve, fulfillment terms and payment deadline. Auction appearance in an enum is not a bid engine. The newly requested auction path supersedes the old documentation deferral as a planning priority; it remains unavailable until implemented and verified.

Reuse catalog, seller/customer linkage, inventory, money/currency handling, checkout, orders, payout/refund and messages. Add only auction-specific facts and services: auction/lot reference, append-only bid records, current accepted bid projection, close result, reservation and winner-payment linkage.

- Server time determines opening/closing. Validate bid amount, increment, currency and bidder eligibility; reject seller self-bidding using linked member/seller/team contexts.
- Accept concurrent bids atomically with stable ordering, retry/idempotency and a versioned current state. Broadcast after committed changes; realtime messaging is delivery, not bid authority.
- Close once, persist the outcome, and reconcile after worker outages. A disclosed hard-close policy is sufficient initially; anti-sniping or proxy bidding can be added only as explicit tested rules.
- No qualifying bid or unmet reserve releases the lot according to published terms. A winning bid creates an exclusive reservation and a correctly priced order/checkout opportunity.
- The winner sees the item in Exchanges → Bids/Wins and completes the existing payment flow. An auction win is not permission to silently charge a card. Define failure-to-pay, cancellation and re-listing policy before launch.
- Preserve current bid/terms on reconnect and show honest stale/offline states. Keep private bidder/payment data out of public updates.
- Prevent double allocation across auction, sale and trade; financial settlement uses the existing commerce pipeline after actual payment.

Fixed-price purchases and negotiated trades need no livestream. Auctions and live markets can meet in the same game market square, with a video session only when wanted.

### Tap business cards

Implement both tappable in-app identity cards and physical NFC/QR cards pointing to a controlled public URL. Reuse public seller/producer profiles and identity linking. A card opens a person's public stall/character with contact, follow/save, message, buy/trade, and offer-help actions appropriate to consent.

Store only a URL on the NFC card; never an authentication token or private profile. Card owner can update the landing destination. Provide QR, ordinary link, and downloadable contact options where permitted. Physical-card production and any prices remain separate from the digital feature purchase.

## 8. Architecture and reuse order

**Reuse hierarchy:** existing verified FBM implementation → finish/wire an existing partial → existing Blackout capability → compatible OSS for a demonstrated gap → minimal new domain code.

### Main integration points

| Code area | Planned responsibility |
| --- | --- |
| storefront/src/app/[locale]/(main)/page.tsx and shared layouts | Public market and shared world shell; signed-in entry opens the unified member portal |
| storefront ... /user/page.tsx | Unified member base: buying, selling, trades, bids, goals, equipment, needs and contacts |
| storefront ... /character, /start, /feed, /rewards | Reuse existing pages as world panels/direct links |
| ProductFeed components and lib/data/feed.ts | Working masonry, filters, pagination, honest modes |
| vendor route-map, dashboard, active onboarding, ResourceQuiz | Source for migrated selling tools and character-build onboarding; preserve legacy routes until replaced |
| vendor playbook/feature providers and router extensions | Equipment-aware module visibility and build composition |
| packages/bmc-ui and packages/bmc-portal-kit | Shared components and typed APIs for the unified host; preserve vertical portals during component migration |
| backend progression, entitlement, plugin-registry, seller-extension | XP/ownership/install/version authority and equipment adapter |
| backend playbook and existing portal apps | Starter build recipes and supported portal compositions |
| backend cottage-food, production-costing, opportunity-engine | Production suggestions with trustworthy data and assumptions |
| backend demand-pool, mutual-aid, collective-quest, barter, quote | Real needs, shared purchasing, direct trades and agreed prices; no duplicate resource or money ledgers |
| backend integration routes and Blackout Coalition map/rooms/tabs | Reuse the ecosystem map, needs/resources/projects/tasks, conversation and coordination |
| Blackstar API and existing FBM fulfillment bridge | Transport eligibility, explicit claims/bids, shipment lifecycle and handoffs; expose supported actions within the unified portal |
| admin-panel | Inspect grants, repair pending installs/rewards, manage coverage/catalog and resolve support cases |
| services/jobs/webhooks | Verified goal events, retries, reconciliation, source refresh and notifications |
| mobile | Standard game controls, safe-area layouts, resumable sessions and synchronized web checkout |

**New code boundaries proposed:** a unified member session/context adapter; shared world/action UI; character-build orchestration; an equipment adapter/loadout and portal-build composition layer; a thin personal goal/draft layer where existing quest/playbook data is insufficient; sourced jurisdiction and area-data adapters; a live-market session adapter; and an auction lifecycle/bid service. Extend the existing barter domain for direct trades. These are proposed boundaries, not existing module claims.

Keep payment, inventory, authorization, costing and exchange state in their current authoritative domains. World coordinates, character animations and equipment appearance are presentation state. Real tasks complete only on server-confirmed events.

Use request/event identifiers and an outbox/retry strategy for cross-domain equipment grants and Blackout updates. Identity resolution must respect customer, seller, organization/team and linked Matrix IDs. Do not use synthetic IDs to collapse distinct ownership scopes.

### Open source gap-fill

Start with existing React/Next.js/vendor React components, MapLibre and Matrix integration. A DOM/SVG world can provide actual scene navigation, characters, movement, hotspots and dialogue while keeping existing panels accessible. Prototype and measure this before adding a renderer.

If scene density, animation, camera or interaction needs exceed that approach, evaluate **PixiJS** as a renderer behind the same world/action contract; its official project describes a 2D WebGPU/WebGL rendering engine. It supplies rendering, not payments, character ownership, commerce rules or complete portal-building behavior. [W05]

Do not select or upgrade a runtime merely because it is open source. Check existing dependency versions, license compatibility, React/Next client boundaries, iOS/Capacitor behavior, bundle cost and maintainability. Keep existing signed extension manifests and compatibility checks for plugins; marketplace code cannot acquire privileges by being equipped.

## 8A. Blackstar and Blackout Coalition reuse

### Product and data responsibilities

The unified portal is one experience over existing services. It does not require rebuilding all three systems inside FBM.

| System | Reuse for | Keep authoritative there |
| --- | --- | --- |
| FBM | Character survey, automatic portal builds, equipment, market/stalls, buying/selling/trades/goods auctions, costing, checkout and exchange operations | Existing listings, inventory, agreements, orders, entitlements, fee/payout records and FBM resource domains |
| Blackout Coalition | Real-world map, place/area model, needs, resources, projects, tasks, events, conversations and shared coordination | Its existing Coalition records, room membership, scope/visibility and geographic projections |
| Blackstar | Eligible transport work, node/operator setup, fleet/vehicle/driver records, claims/bids/awards, shipment legs and handoff progression | Operator/node eligibility, transport constraints, shipment board and physical transport state |

Keep cross-system references instead of replacing distinct records with a universal “resource” table. A Coalition project, FBM demand pool, FBM order, Blackstar shipment and Coalition place are different objects that can be linked. Coalition's scope is community coordination; FBM's existing demand pools, inventory, agreements and money records retain their own authority.

### Newly verified Blackstar code

| Capability | Source evidence | Consequence for this plan |
| --- | --- | --- |
| Shipment board and lifecycle | ShipmentBoardListing defines open/claimed/in_transit/delivered/disputed/cancelled; controller exposes create, eligible, claim, bid, award and status APIs. [BS01–BS03] | Reuse these records and APIs; do not build another transport-job board backend. |
| Operator capabilities and eligibility | Node has location/service radius, transport classes, fleet/vehicle/driver relations, credentials and Coalition membership. Eligibility checks activity/attestations, jurisdiction, Coalition, geography and transport constraints. [BS04–BS05] | Survey answers can recommend a transport configuration, but cannot independently declare an operator eligible. Missing coordinates/radius currently permit geography fallback, so do not label that as proven local coverage. |
| Explicit acceptance of work | GlobalDispatchService returns null; claim/bid policies are intentional. [BS02,BS06] | Offer relevant work for operators to accept. Do not promise automatic global assignment. |
| Claims and transport bidding | Bid-policy listings support node proposals and a poster award path. [BS02] | Reuse transport procurement; evaluate reusable validation/award patterns for goods auctions without treating the two as the same engine. |
| Multi-leg transport | ShipmentLegProgressionService checks sequence and emits leg update/handoff events plus listing-level completion. [BS07] | Reuse handoff state. UI mapping and cross-system lifecycle semantics still need work. |
| Federation | Inbound processor handles delivery.option.selected, order.cancelled and node.operator.approved; outbound publisher signs exact event bodies and supports retry state. [BS08–BS09] | Finish the existing bridge instead of adding another webhook protocol. |
| Existing operator UI | Ember dispatch page lists eligible jobs with claim-policy filters and uses a distinct operator login. Reviewed page/controller do not implement full claim/bid/award interaction. [BS10–BS11] | Port working display/request patterns, then wire missing actions into the FBM portal; do not call it a complete operator workspace. |
| Provisioning/access gap | Inbound provisioning creates an inactive node and a user with a random password; the reviewed code notes a password-setup gap for ordinary token sign-in. [BS08] | Define secure member-to-operator sign-in/linking before presenting a seamless operator portal. A machine bridge credential is not a member session. |
| Payment boundary | NonCustodialPaymentGuard rejects holding/disbursing shipment principal. [BS12] | Preserve that boundary. Transport bids and references do not create a new Blackstar wallet or imply completed settlement. |

These are source findings, not claims that the services are deployed or configured. Automated routing optimization, full mesh/depot planning and automatic assignment were not established by these reads. A claimable board and leg service do not demonstrate an optimized routing engine.

### Existing FBM bridges to finish

- The Blackstar provider is registered behind FBM_BLACKSTAR_INTEGRATION=1. Its fulfillment subscriber records a local shipment and emits delivery.option.selected; the provider alone does not book a carrier or create a shipping label. [FD01–FD02]
- Delivery payloads can include known origin coordinates, Coalition/drive references and transport requirements. Existing code deliberately omits unknown context instead of inventing it. [FD03]
- FBM's node-operator endpoint/provisioner already supports explicit opt-in independently of the person's original vendor archetype. Reuse that; owning a van or buying gear does not enroll the person as an operator. [FD04–FD05]
- The inbound receiver applies five listing-level shipment statuses. Leg events are currently recorded as deliberately unapplied receipts rather than projected into shipment status. Preserve that distinction and add a dedicated leg/handoff UI if required. [FD06–FD07]
- Existing delivery-batch API/model paths in FBM are another reuse candidate for grouped runs. Their presence does not demonstrate a working Blackstar pooling integration; verify scope, authorization and parcel/order mapping first. [FD08]
- The existing blackout-spatial consumer is gated by FBM_BLACKOUT_SPATIAL, fails soft and can fall back to local coarse geography. Reuse it and label precision; fallback coordinates are not exact pickup addresses. [FD09]

**Award-authority gap:** the inspected Blackstar controller's mayAward is poster-only. It does not grant Coalition coordinators award authority. Federation-created listings owned by a service account still need an explicitly designed, authenticated coordinator/delegation path before Coalition transport bidding can be called complete. This documentation does not grant that permission.

The older impression that Blackstar nodes had no geography, that bids had no award path, or that every bridge event was absent is not a safe current assumption. The inspected code contains those additions. Deployment and end-to-end behavior still need validation.

### Coalition capabilities already available to reuse

Reviewed NeedsTab, ResourcesTab, ProjectsTab and TasksTab call corresponding create/update clients; server Coalition routes exist for these records. They are more than static concept screens. ChatTab composes the existing Matrix timeline and message composer. EventLogistics uses volunteer-slot and ride-offer endpoints with sign-up/claim actions. MapTab and CoalitionMap provide geographic discovery, while the place contract distinguishes precise pins from approximate areas. [BC01–BC09; S41–S42]

Use these for:

- Community needs and available shared resources, with their existing scopes and permissions.
- Coordinating production, food/resource drives and infrastructure projects.
- Assignable tasks, volunteer participation and event rides where verified.
- Colleague conversations and process exchange in the existing community rooms.
- Public opt-in pickup/resource places and approximate service areas on the shared map.
- Links from Coalition activity to an FBM offer/order/pool or a Blackstar job when appropriate.

A resource availability label is not a booking/reservation engine. An event ride claim is not a carrier freight contract. A Coalition shop feed is not separate checkout. Keep each operation linked to the domain that actually fulfills it.

### Character builder, equipment and automatic portal setup

Transport and organizing are additional paths inside the same character build:

1. Ask what resources and goals the member declares. Offer “I want to carry deliveries” as an explicit follow-up when relevant.
2. Reuse existing node opt-in/provisioning and show real setup/attestation/capability status. The build can offer a setup quest without promising available paid work.
3. Add a Blackstar-backed Transport panel only with correct membership and supported permissions. Include eligible jobs, current commitments and handoff status as those actions are completed.
4. For organizers, compose a Coalition coordination area using existing needs, resources, projects, tasks, chat and map; attach FBM commerce/inventory and Blackstar transport links where useful.
5. Equip software modules/settings/portal builds through the existing ownership system. Paid equipment can improve the interface or automation; it cannot grant legal eligibility, activate an unready node, bypass transport constraints or confer Coalition membership.
6. Render the member's selected modules in one portal. Preserve the distinct service identities, records and authorization underneath.

### Integration sequence and acceptance

**First:** verify configuration and cross-repo identities, then connect the existing map/coordination views and operator setup to the character-builder preview. Use permission-safe clients/adapters or a versioned shared view; do not fork/copy the map into another independently maintained implementation. React components depending on Blackout state/auth cannot simply be imported unchanged into Next.js.

**Then:** complete an ordinary delivery end to end: FBM fulfilled order with selected provider → Blackstar board → eligible voluntary claim → transport progress → delivered event → FBM status and appropriate Coalition/Blackout notification. Existing order.created is a recorded no-op on Blackstar; it does not itself create the shipment.

**Next:** expose bid/award and multi-leg handoff panels where verified, connect Coalition resource drives, and validate grouped-run/order-cycle integration before claiming pooling or optimization.

Required checks include explicit opt-in; operator identity linking and access recovery; inactive/unattested nodes; stale/unknown geography; active Coalition membership; transport-class constraints; competing claims/awards; cancelled orders; replayed, failed and out-of-order events; retries and reconciliation; leg progress versus full delivery; privacy-safe public map projections; and authenticated access to precise fulfillment details.

No bridge secret, private pickup/drop-off detail or live operator position belongs in the public Coalition map. Public service areas and opted-in pickup places must remain distinct from shipment-party access. Preserve ordinary market use when Blackstar or Blackout is unavailable.

## 9. Ordered implementation backlog

Each row is intended as a reviewable work package. One package can span several PRs. Introduce working slices across surfaces rather than leaving backend-only modules without UI.

| Order | Work package | Existing starting points | Deliverable and acceptance |
| --- | --- | --- | --- |
| 0 | Capability and deployment reconciliation | Feature flags, route maps, existing audit/charter docs | Record built/deployed/enabled status, actual live billing, data coverage and owners; identify all affected portal routes. |
| 0a | Unified session and character-builder contract | Customer data/session, seller registration/session, ResourceQuiz, resource recommendations | One member entry point; buying remains usable while selling is pending; a real resource survey previews an automatically assembled starter portal. |
| 1 | Equipment ownership and pricing contract | Entitlement, seller-extension, plugin installs, vendor-plan, fee resolution | Resolve install/entitlement authority; define one-time version rights, migration/backfill and rollback; preserve existing tools and financial history. |
| 2 | Standard world and unified portal host | Existing storefront/user pages, portable vendor tools, shared UI | One signed-in portal with market, stall, exchanges, messages and toolkit; game view standard; preserve auth scopes and legacy links. |
| 3 | Character-build-to-portal vertical slice | ResourceQuiz, recommendation functions, playbook assignment, manifests and equipment projection | Complete resource/goals survey → preview → automatic working starter portal → one real next action; persist/resume and rebuild without data loss. |
| 4 | Adaptive survey and equipment bench | /start, active LaunchWizard/QuickPath, ResourceQuiz, tenancy state and portal loadouts | Add relevant branches, functional equipment preview/equip, clear optional paid recommendations, honest progress, accessibility, and scope-safe rollback. |
| 5 | Functional equipment checkout and earned choice | Existing checkout/order entitlement, XP rewards/redemption | One-time purchase or milestone choice grants usable equipment; retries/refunds/recovery do not duplicate charges or lose rights. |
| 6 | Useful market board | ProductFeed, data functions, catalog/search | Pinterest-style masonry with functioning category/location filters, load more, scroll restoration, truthful ranking and empty states. |
| 7 | Coalition coordination, colleague commons and tap cards | Existing Coalition needs/resources/projects/tasks/chat/map, Matrix provider and public profiles | Reuse existing community tools inside the unified experience; no duplicate map/domain backend; permission-safe links and NFC/QR work. |
| 8 | Plates suggestion and pricing desk | Cottage-food, costing, opportunity engine | One pilot jurisdiction with reviewed sources; real ingredient/cost inputs; honest demand and price ranges; unsupported locations clearly labeled. |
| 7a | Blackstar transport and identity integration | Node opt-in/provisioning, existing board/eligibility/claim/bid APIs, FBM fulfillment bridge | Survey generates an operator setup path; correctly authenticated eligible members can take work and see delivery progress without a separate FBM logistics backend. |
| 8a | Direct member trades | Existing barter proposal/service and demand-pool accept route | Trade from any supported member listing; counterparty terms, scoped acceptance, shared inventory reservation and two-sided handoff confirmation; retain existing pool behavior. |
| 9 | Coalition affordability journey | Demand pools, order cycles, mutual aid, collective quests | Need → join/propose → commit → fulfill → confirmed shared progress; preserve independent pricing and private data. |
| 10 | Extend Coalition map with research | Existing Blackout Coalition map/spatial consumer and consent, new public data adapters | Correct source/geography/time/MOE shown; layers work with stale/missing data and do not reveal individuals. |
| 11 | In-world negotiation and live markets | Quotes/bargaining to verify, FBM checkout/catalog, Blackout media | Real seller dialogue, versioned terms, reservation, checkout and receipt in a continuous session; media failure does not corrupt orders. |
| 11a | Auctions | Existing catalog/inventory/checkout and new auction-specific state | Create lot, concurrent bid, authoritative close, winner reservation/payment, nonpayment recovery and receipts; reject self-bids and duplicate settlement. |
| 12 | Character evolution and operational hardening | Progression, goal events, equipment projection, admin tools | Character reflects real goals/toolkit; meaningful earned progress; no forced daily care; the unified member portal and retained legacy routes recover cleanly from failures. |

The first usable vertical slice is packages 0a–3 together: character creation generates the working unified portal, in standard game view. Do not finish a decorative world while the survey still leads to a generic dashboard. Game view begins in package 2 and improves throughout; it is not deferred into a later optional mode. Rich animation is incremental, while the default navigation and equipment metaphor are part of the first delivered experience.

Dependencies: package 0 precedes rollout; 0a defines unified identity and automatic build; 1 precedes paid equipment; 2–3 deliver character creation and the unified portal as one slice; 4–7 deepen its daily usefulness; 8–10 add evidence-rich coordination and direct trades; 11/11a complete live trading and auctions. Scope auction-specific launch separately from ordinary purchases. Seed real participants, listings, resources and deliverable rewards alongside engineering.

## 10. Verification and release criteria

### Required unified-portal journeys

1. **Visitor:** enter default world → discover a real stall → open product → review delivered terms → checkout → return to receipt.
2. **Character creation:** choose goals/resources/practical preferences → see a reasoned starter build → adjust/accept → receive a functional portal with saved state and one real next action. Paid suggestions are optional and the initial build causes no charge.
3. **Member:** choose a need privately → see real matches or honest next steps → contact consenting person → complete exchange → progress updates.
4. **Same member selling:** buy an item → draft an offer in the same session → complete necessary seller setup → publish/manage sales without losing shopping access or private records.
5. **Equipment purchase:** one-time product → confirmed order → correct scoped ownership → install/configure/equip → real function appears; unequip/re-equip preserves ownership and records.
6. **Earned equipment:** verified milestone → choose from deliverable options → exactly-once grant → real tool/download → no duplicate reward on replay.
7. **Portal build:** preview scoped modules/settings → apply → open functional portal → change/rollback without destroying operational data.
8. **Colleague exchange:** join authorized room → send/reply → unread state updates → mute/leave → private records remain private.
9. **Plates:** select covered state → view sourced suggestions and assumptions → edit cost inputs → draft product; unknown rules/demand remain unknown.
10. **Coalition:** join actual pool/project → agree individual terms → fulfill → progress reconciles with owning records.
11. **Live market:** real dialogue/offer → accept current terms → reserve/purchase → receipt/refund/dispute; disconnects and stale quotes handled.

12. **Direct trade:** propose/counter/accept from a member listing → reserve both sides → record separate handoffs → complete/dispute without a fictitious cash payment.
13. **Auction:** publish a lot → concurrent bids → one authoritative close → winner reservation → payment/expiry → consistent receipt or recovery.
14. **Account boundaries:** seller pending/rejected/unavailable → buying and records still work; customer/seller actions and personal/team ownership remain correctly authorized.

### Meaningful checks

- Existing backend tests plus targeted integration/contract tests for price invariants, entitlement/install reconciliation, scope isolation, equipment activation, migrated extension defaults, XP/reward retries, duplicate events and refund behavior.
- Browser tests for the public market and unified member portal, touch/keyboard/compact navigation, survey → generated portal → real task, optional paid-feature preview without unintended charges, pagination/filters, resume/rebuild, real equip/use and checkout return.
- Recommendation contract tests for zero resources, mixed goals, multiple roles, unsupported jurisdiction/modules, resource opt-in vs consent, accurate explanations, legacy-copy cleanup and client/server consistency.
- Concurrent bid/close/reservation tests, server-clock deadlines, direct-trade handoff state, bid replay/self-bids, payment failure, and inventory contention across sale/trade/auction.
- Cross-repo Blackstar/Coalition contracts: member/operator identity and opt-in, carrier eligibility, delivery-provider event emission, authenticated claims/bids, shipment/leg status mapping, replay/retry/cancel recovery, Coalition scope and privacy-safe map projection.
- Migration tests for verified customer/seller linking, pending seller access, correct actor tokens, old route mapping, retained order/draft/equipment history, and organization permission boundaries.
- Adapt vendor React Router components into the proposed Next.js host using shared packages; preserve server/client boundaries and build/typecheck both the unified host and retained legacy/vertical apps.
- Test low bandwidth, empty markets, unavailable Matrix/media, expired sessions, revoked equipment, incompatible plugins, partial installs and source outages.
- Validate permission-safe public projections, private goals/drafts, consented room access, no exact vulnerable-person location leaks, and team boundaries.
- Measure mobile loading, input responsiveness, memory and battery impact on representative devices before accepting a heavier renderer.
- Confirm deployed flags and real services in staging, then a limited pilot. Source existence and mocked green screens do not satisfy release.
- Run existing relevant CI and broaden only when changes or failures justify it. This plan itself does not claim those checks passed.

### Rollout and rollback

Release the first character-builder → automatically configured unified portal → real-action slice using proven destinations first. Enable new equipment types only when catalog, ownership, install, action and recovery all work. Introduce sourced rule/data coverage incrementally. Use a release cohort and flags for incomplete capabilities without making the standard game view a paid feature.

Maintain direct operational routes and a compact fallback during rollout. Back up and dry-run pricing/ownership migrations. Preserve IDs, entitlement lineage, purchase records and user data. Rollback restores presentation/configuration, not accidental deletion or reversal of settled money. Queue and reconcile cross-system events after outages.

## 11. Outcome measures and remaining decisions

Measure completed needs/exchanges, time from character creation to a useful configured portal, survey completion/resume, build acceptance/edit/rebuild, first-action completion, same-session buying and selling success, repeat partner connections, equipment activation-to-use, optional enhancement adoption without accidental purchase, reward delivery success, auction payment/completion and direct-trade fulfillment, producer cash/economic margins, delivered-price changes for comparable goods, waste, and dispute rates.

Do not optimize for endless scroll time, message count, spending for XP, or daily return for its own sake. Track engagement insofar as it produces useful outcomes.

**Decisions still needing a concrete design choice during implementation:**

- Original character/world art direction using class/starter/evolution inspiration from WoW/Pokémon without copying their assets or locking people into one role.
- Whether the first scene is best delivered with DOM/SVG or needs an OSS renderer after a measured prototype.
- Which free starter build and first three deliverable equipment rewards ship.
- Revised spendable-XP/decay/care policy and event semantics.
- Equipment ownership and licensing for individual vs seller vs organization/team.
- Pilot jurisdiction coverage, rule-review owner and actual data providers.
- Migration treatment of any live legacy recurring customers.
- Scope of portal-build editing: automated curated configurations first; add advanced manual composition after survey-driven setup works.
- Auction hard-close/reserve/payment-window policy, and whether later proxy bids or soft close are needed; reuse Blackstar patterns only where their transport-bid semantics fit.
- Secure member-to-Blackstar operator session/linking and recovery, plus placement of Coalition's existing views inside the unified portal.
- Exact multi-leg UI and batch/order-cycle mapping; avoid promises of routing optimization without a working planner.
- Historical account-linking and actor-session migration details; the unified experience is decided, while the exact implementation requires staged validation.

These choices do not prevent planning or the source audit. They become explicit design/migration decisions at the relevant work package.

## 12. External source notes

- **W01 — Cottage-food source design:** [South Carolina Department of Agriculture, Retail Food Safety](https://agriculture.sc.gov/permits-and-inspections/retail-food-safety/) and [Selling Food From Home FAQ](https://agriculture.sc.gov/wp-content/uploads/2025/07/RF_SellingFoodFromHomeFAQ2025.pdf). Read November 12, 2026. The recommendation architecture above is a proposal, not a legal eligibility determination.
- **W02 — Geographic semantics:** [Census guidance on ZIP data](https://www.census.gov/data/what-is-data-census-gov/guidance-for-data-users/frequently-asked-questions/how-can-i-find-data-for-zip-codes-on-data-census-gov.html), [ZCTAs](https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html), and [ACS state/local handbook](https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_state_local_handbook_2020.pdf). Source supports geography/uncertainty requirements, not a completed FBM integration.
- **W03 — Price-data coverage:** [USDA AMS Local & Regional Food Market News](https://www.ams.usda.gov/market-news/local-regional-food). Supplier of covered market observations; local demand forecasts require separate evidence.
- **W04 — Independent pricing:** [FTC Price Fixing](https://www.ftc.gov/advice-guidance/competition-guidance/guide-antitrust-laws/dealings-competitors/price-fixing). Product design must preserve independent decisions; the architecture is not a legal clearance.
- **W05 — Potential renderer:** [PixiJS official project](https://pixijs.com/). Candidate only if existing rendering is insufficient; no package/version adoption was performed.

## Appendix: pinned code evidence

Links refer to the inspected commit, not a moving branch. Path existence and reviewed behavior are distinguished from deployment readiness throughout this plan.

- **S01** — [storefront/src/app/[locale]/(main)/user/page.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/app/%5Blocale%5D/(main)/user/page.tsx)
- **S02** — [storefront/src/components/sections/ProductFeed/ProductFeed.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/components/sections/ProductFeed/ProductFeed.tsx)
- **S03** — [storefront/src/components/sections/ProductFeed/ProductFeedServer.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/components/sections/ProductFeed/ProductFeedServer.tsx)
- **S04** — [storefront/src/app/[locale]/(main)/feed/page.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/app/%5Blocale%5D/(main)/feed/page.tsx)
- **S05** — [storefront/src/lib/data/feed.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/lib/data/feed.ts)
- **S06** — [storefront/src/app/[locale]/(main)/start/page.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/app/%5Blocale%5D/(main)/start/page.tsx)
- **S07** — [vendor-panel/src/routes/onboarding/onboarding.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/routes/onboarding/onboarding.tsx)
- **S08** — [vendor-panel/src/components/onboarding/launch-wizard.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/components/onboarding/launch-wizard.tsx)
- **S09** — [vendor-panel/src/components/onboarding/quick-path.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/components/onboarding/quick-path.tsx)
- **S10** — [vendor-panel/src/components/onboarding/VendorOnboardingFlow.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/components/onboarding/VendorOnboardingFlow.tsx)
- **S11** — [vendor-panel/src/routes/home/home.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/routes/home/home.tsx)
- **S12** — [vendor-panel/src/routes/dashboard/dashboard.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/routes/dashboard/dashboard.tsx)
- **S13** — [storefront/src/app/[locale]/(main)/character/page.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/app/%5Blocale%5D/(main)/character/page.tsx)
- **S14** — [backend/src/modules/progression/models/character-sheet.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/progression/models/character-sheet.ts)
- **S15** — [backend/src/modules/progression/service.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/progression/service.ts)
- **S16** — [backend/src/modules/progression/rewards.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/progression/rewards.ts)
- **S17** — [backend/src/api/store/xp/redeem/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/store/xp/redeem/route.ts)
- **S18** — [backend/src/subscribers/progression-order-placed.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/subscribers/progression-order-placed.ts)
- **S19** — [docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md)
- **S20** — [backend/src/modules/entitlement/models/entitlement.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/entitlement/models/entitlement.ts)
- **S21** — [backend/src/modules/plugin-registry/entitlement.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/plugin-registry/entitlement.ts)
- **S22** — [backend/src/modules/plugin-registry/manifest.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/plugin-registry/manifest.ts)
- **S23** — [backend/src/api/v1/seller/plugins/[slug]/install/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/v1/seller/plugins/%5Bslug%5D/install/route.ts)
- **S24** — [backend/src/shared/extension-keys.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/shared/extension-keys.ts)
- **S25** — [backend/src/modules/playbook/recipes/types.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/playbook/recipes/types.ts)
- **S26** — [vendor-panel/src/providers/playbook-provider/playbook-context.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/providers/playbook-provider/playbook-context.tsx)
- **S27** — [vendor-panel/src/providers/router-provider/route-extensions.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/providers/router-provider/route-extensions.tsx)
- **S28** — [packages/bmc-ui/README.md](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/packages/bmc-ui/README.md)
- **S29** — [vendor-panel/src/routes/my-website/my-website.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/routes/my-website/my-website.tsx)
- **S30** — [backend/src/modules/cms-blueprint/service.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/cms-blueprint/service.ts)
- **S31** — [backend/src/modules/cottage-food/service.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/cottage-food/service.ts)
- **S32** — [backend/src/api/vendor/cottage-food/onboarding/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/vendor/cottage-food/onboarding/route.ts)
- **S33** — [vendor-panel/src/routes/cottage-food/page.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/routes/cottage-food/page.tsx)
- **S34** — [backend/src/modules/opportunity-engine/service.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/opportunity-engine/service.ts)
- **S35** — [backend/src/modules/opportunity-engine/_signals.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/opportunity-engine/_signals.ts)
- **S36** — [backend/src/modules/production-costing/costing.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/production-costing/costing.ts)
- **S37** — [backend/src/modules/demand-pool/models/demand-post.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/demand-pool/models/demand-post.ts)
- **S38** — [backend/src/api/store/mutual-aid/requests/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/store/mutual-aid/requests/route.ts)
- **S39** — [vendor-panel/src/routes/messages/messages.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/routes/messages/messages.tsx)
- **S40** — [packages/bmc-ui/src/MessageFeed.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/packages/bmc-ui/src/MessageFeed.tsx)
- **S41** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/CoalitionMap.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/CoalitionMap.tsx)
- **S42** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/MapTab.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/MapTab.tsx)
- **S43** — [blackout/apps/blackout-client/src/app/features/creators/fbmClient.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/creators/fbmClient.ts)
- **S44** — [blackout/packages/api/src/services/fbmMatrixBridge/aidBoard.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/packages/api/src/services/fbmMatrixBridge/aidBoard.ts)
- **S45** — [blackout/apps/blackout-client/src/app/features/call/liveInteractionBundle.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/call/liveInteractionBundle.ts)
- **S46** — [backend/src/modules/vendor-plan/catalog.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/vendor-plan/catalog.ts)
- **S47** — [backend/src/modules/payout-breakdown/fee-resolution.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/payout-breakdown/fee-resolution.ts)
- **S48** — [backend/src/shared/feature-flags.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/shared/feature-flags.ts)
- **S49** — [storefront/src/lib/feature-flags.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/lib/feature-flags.ts)
- **S50** — [docs/FBM_RESOURCE_EXCHANGE_CHARTER.md](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/docs/FBM_RESOURCE_EXCHANGE_CHARTER.md)
- **S51** — [docs/FBM_RESOURCE_EXCHANGE_MVP.md](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/docs/FBM_RESOURCE_EXCHANGE_MVP.md)
- **S52** — [backend/src/modules/vendor-quest/engine.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/vendor-quest/engine.ts)
- **S53** — [backend/src/modules/playbook/service.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/playbook/service.ts)
- **S54** — [packages/bmc-portal-kit/README.md](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/packages/bmc-portal-kit/README.md)
- **S55** — [vendor-panel/src/providers/router-provider/settings-extensions.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/providers/router-provider/settings-extensions.tsx)
- **S56** — [blackout/packages/api/src/services/fbmMatrixBridge/logisticsRooms.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/packages/api/src/services/fbmMatrixBridge/logisticsRooms.ts)

### Additional evidence for the unified portal and character builder

- **S57** — [backend/src/shared/seller-registration.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/shared/seller-registration.ts)
- **S58** — [backend/src/api/middlewares/seller-context-v1.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/middlewares/seller-context-v1.ts)
- **S59** — [backend/src/api/auth/seller/session/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/auth/seller/session/route.ts)
- **S60** — [vendor-panel/src/components/authentication/protected-route/protected-route.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/components/authentication/protected-route/protected-route.tsx)
- **S61** — [backend/src/api/store/quotes/[id]/accept/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/store/quotes/%5Bid%5D/accept/route.ts)
- **S62** — [backend/src/modules/barter/models/barter-proposal.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/barter/models/barter-proposal.ts)
- **S63** — [backend/src/api/store/collective/demand-pools/[id]/barter/[proposalId]/accept/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/store/collective/demand-pools/%5Bid%5D/barter/%5BproposalId%5D/accept/route.ts)
- **S64** — [backend/src/modules/agriculture/models/availability-window.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/agriculture/models/availability-window.ts)
- **S65** — [docs/LISTING_TYPES.md](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/docs/LISTING_TYPES.md)
- **S66** — [storefront/src/lib/data/customer.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/storefront/src/lib/data/customer.ts)
- **S67** — [vendor-panel/src/components/playbook/resource-quiz/resource-quiz.tsx](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/vendor-panel/src/components/playbook/resource-quiz/resource-quiz.tsx)
- **S68** — [backend/src/modules/playbook/recommend-from-resources.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/playbook/recommend-from-resources.ts)
- **S69** — [backend/src/modules/playbook/recommend.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/playbook/recommend.ts)

### Additional Blackstar, FBM bridge and Coalition source evidence

- **BS01** — [Blackstar/api/app/Models/ShipmentBoardListing.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Models/ShipmentBoardListing.php)
- **BS02** — [Blackstar/api/app/Http/Controllers/Api/ShipmentBoardListingController.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Http/Controllers/Api/ShipmentBoardListingController.php)
- **BS03** — [Blackstar/api/routes/api.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/routes/api.php)
- **BS04** — [Blackstar/api/app/Models/Node.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Models/Node.php)
- **BS05** — [Blackstar/api/app/Services/ShipmentEligibilityService.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Services/ShipmentEligibilityService.php)
- **BS06** — [Blackstar/api/app/Services/GlobalDispatchService.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Services/GlobalDispatchService.php)
- **BS07** — [Blackstar/api/app/Services/ShipmentLegProgressionService.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Services/ShipmentLegProgressionService.php)
- **BS08** — [Blackstar/api/app/Services/FreeBlackMarket/InboundEventProcessor.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Services/FreeBlackMarket/InboundEventProcessor.php)
- **BS09** — [Blackstar/api/app/Services/FreeBlackMarket/OutboundEventPublisher.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Services/FreeBlackMarket/OutboundEventPublisher.php)
- **BS10** — [Blackstar/console/app/controllers/console/dispatch.js](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/console/app/controllers/console/dispatch.js)
- **BS11** — [Blackstar/console/app/templates/console/dispatch.hbs](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/console/app/templates/console/dispatch.hbs)
- **BS12** — [Blackstar/api/app/Services/Payments/NonCustodialPaymentGuard.php](https://github.com/Blackmarket-coa/Blackstar/blob/ade2ac27135c992d344a50f40bee2d79fb05ff4c/api/app/Services/Payments/NonCustodialPaymentGuard.php)
- **FD01** — [free-black-market/backend/src/modules/blackstar-fulfillment-provider/service.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/blackstar-fulfillment-provider/service.ts)
- **FD02** — [free-black-market/backend/src/subscribers/emit-blackstar-delivery-option-selected.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/subscribers/emit-blackstar-delivery-option-selected.ts)
- **FD03** — [free-black-market/backend/src/lib/blackstar-delivery-payload.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/lib/blackstar-delivery-payload.ts)
- **FD04** — [free-black-market/backend/src/api/vendor/node-operator/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/vendor/node-operator/route.ts)
- **FD05** — [free-black-market/backend/src/shared/provision-node-operator.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/shared/provision-node-operator.ts)
- **FD06** — [free-black-market/backend/src/api/v1/integrations/blackstar/events/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/v1/integrations/blackstar/events/route.ts)
- **FD07** — [free-black-market/backend/src/modules/blackstar-fulfillment/verify-blackstar-signature.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/modules/blackstar-fulfillment/verify-blackstar-signature.ts)
- **FD08** — [free-black-market/backend/src/api/store/delivery-batches/route.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/api/store/delivery-batches/route.ts)
- **FD09** — [free-black-market/backend/src/lib/blackout-spatial.ts](https://github.com/Blackmarket-coa/free-black-market/blob/a449f457aa1102eeb4278f1696455a9a1af584ca/backend/src/lib/blackout-spatial.ts)
- **BC01** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/NeedsTab.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/NeedsTab.tsx)
- **BC02** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/ResourcesTab.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/ResourcesTab.tsx)
- **BC03** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/ProjectsTab.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/ProjectsTab.tsx)
- **BC04** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/TasksTab.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/TasksTab.tsx)
- **BC05** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/ChatTab.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/ChatTab.tsx)
- **BC06** — [blackout/apps/blackout-client/src/app/features/coalition/tabs/EventLogistics.tsx](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/tabs/EventLogistics.tsx)
- **BC07** — [blackout/apps/blackout-client/src/app/features/coalition/coalitionClient.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/apps/blackout-client/src/app/features/coalition/coalitionClient.ts)
- **BC08** — [blackout/packages/api/src/routes/coalition.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/packages/api/src/routes/coalition.ts)
- **BC09** — [blackout/packages/core/src/coalition/place.ts](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/packages/core/src/coalition/place.ts)
