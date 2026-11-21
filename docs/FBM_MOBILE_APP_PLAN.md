# FBM iOS and Android app plan

**Financial companion (November 21, 2026):** [FBM monetization](FBM_MONETIZATION_PLAN.md) and [BMC ecosystem financial analysis](BMC_ECOSYSTEM_FINANCIAL_ANALYSIS.md) distinguish first-party product proceeds, the single fixed 3% fee, creator earnings and conditional 2027 forecasts. No prices, billing or availability are changed.

**Updated:** 2026-11-21

**Status:** Product requirements and proposed delivery plan. The full unified portal and virtual marketplace are not implemented at the reviewed source revision. This document changes no application code, billing, permissions, flags or deployment.

## Authority and scope

FBM will have a standalone iOS and Android app built around one customizable member portal. People can participate in gameplay, buy, sell, trade and negotiate within a virtual marketplace that changes as members publish real offerings and resources. The app also supports websites, inventory, orders, fulfillment and additional business/community tools as those workflows are completed.

The [unified member portal plan](FBM_UNIFIED_MEMBER_PORTAL_PLAN.md) remains canonical for character creation, the shared member host and functional equipment. The [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) retains economic/privacy invariants. The [R1 implementation plan](UNIFIED_MEMBER_PORTAL_R1_PLAN.md) describes a deliberately smaller first delivery. This document extends the product to both mobile platforms; it does not mark R1 or later work complete.

Use the [mobile implementation inventory](FBM_MOBILE_IMPLEMENTATION_INVENTORY.md) for the current source evidence, all local module/provider registrations, plugin catalogs, reuse opportunities and known partials. The older source observations in other plans retain their original dates; the inventory's November 20 evidence supersedes them for the specifically rechecked paths.

**Accepted November 21 direction:** [Coalition game and creator commerce](FBM_COALITION_GAME_AND_CREATOR_COMMERCE_PLAN.md) adds original companions, collection, cooperative exploration, creator-made packs, and optional AR using shared Blackout/Coalition services. It records upstream evaluation candidates, consent, progression separation, commerce contracts, and phased acceptance. Implementation, code adoption, and native verification remain future work.

## Confirmed requirements

The [December launch readiness audit](FBM_DECEMBER_LAUNCH_READINESS.md) records subsequent founder decisions: community-first income opportunities, founder-owned existing enhancements, open geographic storyboard publishing, original-copy sales and supported transfers, a $250 current monthly cost, Windows/Linux development with Forge reuse, and a December 31 public web/iOS/Android target. Its scoped reuse matrix and backlog distinguish source foundations from release evidence; no runtime behavior is changed.

1. One signed-in member experience supports buying, selling, trading and negotiation. Activities are not permanent account classes or separate mandatory portals.
2. Character creation learns goals, resources and practical participation, previews a starter build and automatically configures a useful personal portal. Reuse the resource quiz, playbooks and asset matcher where appropriate.
3. Game view is standard. An accessible compact view provides the same actions. Direct access to search, messages, urgent tasks and checkout never requires avatar movement.
4. The virtual marketplace responds to real additions and availability. A decorative stall never claims goods, services or stock that the owning system cannot supply.
5. Reuse Coalition for shared geography/community coordination and Blackstar for transport. Do not create another editable map, project/task backend or shipment authority.
6. Members can customize their portal and add supported tools. Native enhancements, plugins, settings packs, modules and portal builds are functional equipment.
7. Enhanced software uses one-time purchases, with no recurring software-access subscription. Ownership persists when equipment is unequipped. Software version, upgrade/support scope and actual external costs are disclosed.
8. Members should be able to launch an FBM-hosted site or connect an existing site, manage inventory and orders, and fulfill shipments from the app as these workflows become ready.
9. Preserve the flat 3% sales commission after processing-fee deduction. KARMA, equipment and paid enhancements do not change the rate. Existing legacy billing/fee code needs migration.
10. Personal, seller and organization scopes keep correct server authorization and ownership even within one portal. Pending seller setup must not block ordinary shopping or personal records.
11. Surface the shared Coalition game inside World/map/list, with collection in My Place/Toolkit and contextual creator tools. No extra global game tab. FBM's navigation remains its own design decision; Blackout's four-destination layout is not copied automatically.
12. Sell supported original creator packs only after real authoring, payment, entitlement, signed delivery, compatible runtime application, restoration, refunds, and seller settlement are verified. AI personas remain excluded from sale; game purchases cannot buy rank or community authority.

## Current code versus target app

| Area | Current source finding | Target work |
|---|---|---|
| Native host | Capacitor iOS/Android projects load the deployed Next.js storefront; native bridge, app links and push paths exist. | Reuse the shell while delivering a complete phone experience. Device/signing/release validation remains required. |
| Member home | `/user` remains an account welcome/navigation page. Proposed `/user/build`, `/user/stall` and portal-build backend are absent at the reviewed commit. | Implement survey, saved build, preview, capability resolution and one useful task. |
| Seller phone tools | In-storefront seller inbox supports shipment/tracking and delivered actions. Most seller work remains in the vendor panel. | Progressively bring listing, stock, packing, site and other supported workflows into the portal. Desktop is not a permanent product boundary. |
| Composition | Quiz, eleven playbooks, asset declarations/matching, entitlements and extension registries exist. | Connect them into saved, reversible member layouts and equipment loadouts. |
| Commerce | Quotes-to-cart, collective counteroffers, demand/bounty barter and separate food trades exist. | Build general listing-level haggling and direct trades with explicit agreement/reservation/handoff states. |
| Auctions | Goods-auction lifecycle is not implemented. Blackstar transport bidding is different. | Dedicated bid/close/winner/reservation/payment recovery work. |
| Map updates | Coalition map/community code and FBM aid-board mirroring exist. Mirrored aid records omit coordinates. | Consented geographic projections, listing/stock update/removal events, reconnect and reconciliation. |
| Enhancements | Six add-on packs currently grant 30-day access; recurring plans remain. Five of six plugin seeds have no attached distribution manifest. | Permanent/versioned ownership migration and verification of actual tool/plugin consumers. |
| Shared collection game | November 21 Blackout planning defines the shared direction; this update adds no game runtime, adopted dependency, or executable pack format. | Verify one encounter/collection journey before cooperation, creator packs, real paid delivery, optional AR, and expansion. |

Source presence, a mock test, a catalog seed or a reference manifest is not deployment or service availability. The inventory records substantive code separately from scaffolds and operating dependencies.

## Candidate information architecture

The following navigation is a proposal for design review, not a fixed visual decision.

| Destination | Purpose | Main contents |
|---|---|---|
| World | Discover people, offers and useful activity. | Coalition map, virtual market, search/list view and availability filters. |
| My Place | Personal portal and working base. | Character/build, stall, stock, website, pinned widgets, goals and equipment. |
| Create | Add something useful. | Sale, trade, request, gift, service, event or project; auctions only when supported. |
| Exchanges | Finish commitments. | Buying, selling, offers, trades, bookings, shipments, refunds and disputes; attention-first filtering. |
| Messages | Reach participants. | Listing/order conversations and authorized community rooms. |

Toolkit/Equipment belongs in My Place and can be pinned by frequent users. An organization selector changes who the member acts for; it does not create a buyer/vendor mode switch.

**Recommended visual direction:** a stylized Coalition map with illustrated tappable stalls and a bottom detail sheet, plus a customizable personal workshop. Warm solarpunk, recognizable objects, short labels and calm motion fit the approved direction. An isometric market town or richer world remains a design option; exact camera, art style, avatar movement and layout have not been selected.

## Character creation and personal builds

Goals → resources → practical participation → recommended free starter tools → preview → accept → one real action.

Re-use known answers and support back/save/resume/rebuild. Ask precise location, payout information or operator eligibility only when an action needs it. Owning transport is not consent to carry deliveries. Having a kitchen is not evidence of food eligibility. A recommendation does not grant Coalition membership or install a paid item.

Starter builds may serve shoppers/traders, Plates kitchens, growers, makers, service providers, organizers, creators and opt-in transport operators. These are overlapping configurations. The asset matcher can suggest projects from declared resources, but its current engine lacks geographic filtering and event scheduling; a suggested project is not a staffed or reserved service.

Allow members to pin/reorder widgets, change appearance, select compact/illustrated navigation and preserve layouts across equipment changes. Rebuilding must not delete business records or transfer member-owned tools to an organization.

## Marketplace, negotiation and trades

Tap a stall → inspect actual availability, participant identity and terms → choose a supported action → agree explicitly → fulfill → show the server-confirmed result.

| Action | Experience | Existing foundation / missing work |
|---|---|---|
| Buy/sell | Select quantity and pickup/delivery, pay, track and complete. | Reuse catalog/cart/orders/fulfillment; validate mobile parity and stock handling. |
| Haggle | Offer or counteroffer quantity, total price, fulfillment and expiration. | Reuse quote pricing/cart creation; add listing conversation, history and authorization. Group bargaining is a separate workflow. |
| Trade | Specify both sides' items/services, quantities, condition, deadline and handoff. | Reuse barter/food-trade domains; general direct trades and two-sided reservations/confirmation need completion. Food counteroffer text currently accompanies rejection rather than a negotiation round. |
| Gift/aid | Offer/request, commit, coordinate and confirm receipt. | Reuse mutual-aid lifecycle and privacy-safe projections. |
| Auction | Bid under disclosed rules, close, reserve for winner and complete purchase. | New goods-auction lifecycle; do not substitute a transport bid API. |

Chat text alone is not a binding transaction. Show current agreed terms, actor/workspace and the effect of Accept. Reserve/release authoritative inventory across sale/trade/auction paths so one unit cannot be promised twice. A winning bid is not silent authorization to charge a stored card.

## Coalition map and automatic updates

Reuse Blackout's Coalition map/place/community authority via a maintained shared view or authenticated adapter. The standalone Coalition repository contains additional mobile/gateway work; reconcile useful pieces with the shared contract rather than creating competing editable authorities.

| Change | Expected public/world effect |
|---|---|
| First published offering | Create/update a consented stall or public place projection. |
| Additional product | Update stall contents rather than create permanent map clutter per SKU. |
| Stock depleted or listing withdrawn | Remove from available-now results; retain a business place where appropriate. |
| Timed pickup, event or harvest availability | Show only within supported time/status filters and expire appropriately. |
| Project/need fulfilled | Update status and stop inviting obsolete commitments. |
| Public area, hours or pickup place changed | Refresh the permitted projection. |
| Content deleted or map consent withdrawn | Remove public projection and reconcile caches. |
| Shipment progresses | Update authorized exchange views; do not publish private delivery addresses or live operator positions on the public map. |

The virtual world is navigation over permitted records, not a disclosure of private homes. Permit manual area selection and remote exploration without device location. Pin-versus-service-area semantics remain explicit.

Reuse existing event delivery/signing/retry mechanisms, adding missing event families and recovery. Require stable IDs, versions, deduplication, expiry/deletion handling, durable retry and reconciliation. A foreground stream or bounded polling fallback must recover after reconnect. Source-of-truth stock reservation remains server-side even if a map view is stale.

**Candidate freshness target:** ordinary public changes visible within roughly ten seconds while active; validate before making a promise. Current Faire synchronization intervals are not suitable evidence for that target. Do not show sample pins as real availability after a service failure.

## Daily operations and optional tools

| Workspace/tool | Reuse first | Specific remaining limit |
|---|---|---|
| Inventory and channels | Catalog/locations/reservations, POS stock step, Faire jobs and connection UI. | Faire is the sole registered sales-channel adapter; multi-variant products are rejected by current reduction; stock import is eventual. |
| Fulfillment | Seller orders, Blackstar parcel lifecycle, share-box packing and shipment updates. | Generic pick/pack endpoint is a schema/echo scaffold. Plant label provider is a no-op. Carrier labels, printing and native scanning are not established. |
| Website | Template launch, provisioning/liveness, existing-site embeds, keys and feature toggles. | Configuration required; connect/launch is not a general editor for arbitrary external sites. |
| Plates / production | Food trades, costing, labels, sale/reversal records, production source areas. | Existing seller ID/token issues and sourced eligibility work must be resolved. |
| Grower/maker | Nursery, agriculture and production modules, resource/project matching. | Inspect each real workflow; reference manifests do not supply operators or assets. |
| Organizer | Aid allocation, intake/stock/transfers, needs, projects, volunteers and fund records. | Allocation is a suggestion; money features and organization scope retain existing gates. |
| Services/B2B | Booking-to-cart link, quotes, invoices, programs and subcontracts. | Concurrent booking reservation, actual settlement and full phone workflows require validation. |
| Creator/growth | Product launch orchestration, attribution, creator consent and content adapters. | Content ownership/metrics adapters are not universal social publishing or sales-channel sync. |
| Assistant | Hermes chat transport and schema/confirmation validation. | Current tool branch validates and returns calls; it does not execute business mutations. Do not promise autonomous operations. |

## Equipment and one-time enhancement purchases

Maintain separate states for owned, installed, configured and equipped. Unequipping changes the interface, not ownership or underlying records. Reinstall/device change must restore verified rights from the server. Member/seller/organization ownership scopes remain explicit.

Candidate packs include Grower, Kitchen/Plates, Fulfillment, Site Builder, Multi-channel, Organizer, Automation and Appearance. These are proposed groupings with no approved new prices. A pack can advertise only functioning tools; a plugin catalog name is not an executable bundle.

Before paid rollout, reconcile legacy recurring plans, 30-day add-on entitlements, plugin install authority and fee overrides. Inventory live rights/charges, define the migration and preserve financial history; this docs change does not cancel contracts or migrate accounts. A purchased feature cannot lower the fixed sales commission.

Disclose version, support/upgrade policy and actual third-party costs such as domains, hosting, postage and payment processing. Do not create a disguised required enhancement subscription. Essential privacy/E2EE and access to personal records remain outside optional equipment barriers.

Separate physical-commerce payments from digital feature unlocks. Verify current Apple/Google billing and distribution requirements for intended storefronts/regions before submission, including purchase restoration and refunds. The existing external-checkout helper's device-language region proxy and unconditional Android branch are implementation facts, not proof of approval for a digital equipment store. Consult [Apple's guidelines](https://developer.apple.com/app-store/review/guidelines/) and [Google Play's payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).

## Gameplay tied to useful outcomes

The [November 21 shared game plan](FBM_COALITION_GAME_AND_CREATOR_COMMERCE_PLAN.md) is the detailed acceptance contract for original companions, location-based collection, cooperative quests, creator worldbuilding, and optional AR. Evaluate Pokemon Walk selectively, PraxisMapper only for demonstrated geospatial gaps, and LocAR.js as an optional renderer; none is adopted by this plan. Use original/licensed assets, with maintained dependencies and explicit rollback decisions.

Use verified actions to grow the world and personal toolkit: first need met, first offering, completed exchange, fulfilled aid request, pooled order or project milestone. Reward useful non-spending participation as well as commerce. Choose supported equipment/digital rewards rather than showing undeliverable catalog promises.

Possible loops include market days, seasonal harvests, production paths, resource-discovery tasks and cooperative quests. These remain proposals. Define impact measurements before showing savings or waste avoided. Game progress never grants financial/transport authority, changes commission, or gates essential services behind travel/streaks/spending. Progression-dependent delivery must first resolve the recorded schema defect SD-50.

Keep collection/XP in a play ledger separate from verified contribution reputation, Coalition membership, governance, purchase records, and commercial stock. Preserve opt-in comparisons, no streaks/manufactured urgency/guilt notifications, and nonlocation contribution paths. Reuse geocaching consent/audience rules: code-at-the-spot default, explicitly chosen bounded GPS checks, no continuous tracking or public moving people markers. AR is optional and adds no consent to upload footage. Creator prompts must open real supported editors, bounties, or pack workflows; a listing or generic download template is not a working installation.

## Delivery sequence and acceptance

| Stage | Reviewable result | Required acceptance evidence |
|---|---|---|
| 1. Member foundation | Survey → saved preview → configured `/user` → useful real task. | Correct actor/session/workspace, save/resume/rebuild, approval states and shopping while selling is pending. Follow R1's deliberately limited scope. |
| 2. Shared map | FBM displays authorized Coalition data and updates from real publication/availability changes. | Create/update/remove/expire, consent withdrawal, stale/offline states and reconnect/reconciliation. |
| 3. Phone operations | Listings, stock, packing and supported shipment/site tasks inside one portal. | Real reservations, permissions, duplicate/retry handling, complete order and site journeys. |
| 4. Social exchange | Listing negotiation-to-checkout and direct trade completion. | Agreement history, expiration, inventory exclusivity, cancellation and handoff confirmation. |
| 5. Equipment/sites | Permanent tool ownership, restoration, launch/connect and actual named integrations. | Billing migration, refunds/revocation, installed consumers and verified external configuration. |
| 6. Rich world/expansion | Functional world objects, quests and specialist builds; goods auctions on their own completed lifecycle. | Direct/accessible parity and every visible object linked to an available action. |

For the shared game, apply its separate phase gates: reuse evaluation → one encounter/collection → cooperative activity → reviewed creator pack → verified sale/delivery/application/settlement → optional AR → expansion. This does not enlarge the R1 portal milestone. Close metadata-only listing payload, durable creator-draft resume, content-to-offer association, and actual delivery/settlement gaps for the paid path before offering game packs.

For each capability record source evidence, applicable tests, flags/configuration, required identity/scope, operating dependency, mobile UI and last verified journey. Hide unavailable tools or explain recovery; do not use presence of a module as availability.

Before release: verify signing/versioning, app links, push on real iOS/Android devices, sign-out/device detachment, interruption/resume, network loss, purchase/fulfillment recovery, privacy/deletion and accessible operation. Resolve blocking backend ID/auth/schema defects before advertising affected tools. Recheck CI/load findings; green general CI is not a full app release certification.

## Outstanding design choices

Exact visual style/camera, avatar movement, five-destination navigation, pilot composition, haggle-panel layout and workshop layout remain open. Use the candidate structure above for design review. Start with working domain/capability contracts so changing the presentation does not create duplicate business systems.

