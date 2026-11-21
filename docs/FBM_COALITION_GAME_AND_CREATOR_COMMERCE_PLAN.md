# FBM × Blackout Coalition game and creator commerce

**Updated:** November 21, 2026

**Status:** Accepted planning direction; implementation, upstream code adoption, and native release verification remain future work. This update adds documentation, not a working game or imported dependencies.

**Companions:** [FBM app plan](FBM_MOBILE_APP_PLAN.md) · [Unified member portal](FBM_UNIFIED_MEMBER_PORTAL_PLAN.md) · [Creator commerce roadmap](CREATOR_COMMERCE_ROADMAP.md) · [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) · [FBM mobile build guide](../mobile/README.md).

## 1. Shared direction and authority

Add an original location-based collection and cooperative exploration game to Coalition. Players discover companions, complete quests, visit consenting participating places, and work toward community objectives. Members help create the world and can sell supported original digital additions through FBM's creator marketplace.

Coalition supplies existing map, place/area, identity, membership, visibility, and coordination services. Blackout owns the shared game rules and runtime integration; FBM supplies supported product authoring/listings, pricing, checkout, payment, ownership, digital delivery, refunds, and seller settlement. Blackstar remains the transport authority for real goods. Do not create competing maps, accounts, collection ledgers, payment histories, or shipment services in each client.

Start with **one eligible map encounter → original companion → durable owned collection → return to map**. Add cooperation and creator-made packs in independently verified slices. Optional camera AR follows a working map game.

The approved game direction supplements the standard FBM game-view portal; it does not make physical travel, collection, battles, or camera use prerequisites for shopping, selling, aid, business tools, or governance. A virtual stall describes permitted real offerings; a fictional companion is a game asset. Neither can fabricate the other's inventory or ownership.

This plan adapts the supplied November 21 Blackout direction. Its companion documents currently live on [Blackout PR #1018](https://github.com/Blackmarket-coa/blackout/pull/1018), at revision `8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b`:

- [Shared Coalition game plan](https://github.com/Blackmarket-coa/blackout/blob/8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b/docs/product/BLACKOUT_COALITION_GAME_PLAN.md).
- [Blackout app plan](https://github.com/Blackmarket-coa/blackout/blob/8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b/docs/product/BLACKOUT_APP_PLAN.md).
- [Creator economy and delivery requirements](https://github.com/Blackmarket-coa/blackout/blob/8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b/docs/product/BLACKOUT_CREATOR_ECONOMY.md).
- [Coalition geocaching design](https://github.com/Blackmarket-coa/blackout/blob/8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b/docs/coalitions/GEOCACHING_DESIGN.md).
- [Blackout mobile build guide](https://github.com/Blackmarket-coa/blackout/blob/8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b/mobile-application-build-guide.md) and [gamification banlist](https://github.com/Blackmarket-coa/blackout/blob/8edfd4dff399b7e8cb3b9c1daa1eee4088d89c1b/packages/blackout-protocol/src/gamification/banlist.ts).

Pinned links preserve the reviewed planning state, not a deployment claim. Reconcile later revisions explicitly. The charter retains FBM's fee, ownership, privacy, and release invariants.

## 2. Open-source evaluation, not adopted dependencies

The following upstream findings are carried from Blackout's November 21 planning review. Pin exact upstream revisions and recheck repositories, dependencies, assets, and maintenance status before adoption. This change does not independently certify or import them.

| Candidate | Intended evaluation | Maintenance and integration boundary |
|---|---|---|
| [Pokemon Walk](https://github.com/PraxisMapper/PokemonWalk), [release page](https://cerol.itch.io/pokemon-walk), [MIT license](https://github.com/PraxisMapper/PokemonWalk/blob/main/LICENSE) | Godot encounter, collection, battle, raid, companion, and place-based progression systems. Compare selective ports with a limited fork or embedded/exported runtime prototype. Published HTML5/Android versions are starting evidence only. | Blackout's review records archival on September 8, 2026. Adoption makes maintenance our responsibility. Browser/native performance, embedding, exports, saving, and iOS support need testing. No assumption of persistent multiplayer or server-authoritative rewards. |
| [PraxisMapper](https://github.com/PraxisMapper/PraxisMapper), [Apache-2.0 license](https://github.com/PraxisMapper/PraxisMapper/blob/master/LICENSE) | C#/.NET/OpenStreetMap game geospatial algorithms or interactions that fill demonstrated Coalition gaps. | Blackout's review records retirement/archival in September 2026. Add a service only when a measured gap justifies it. Do not duplicate place records, map infrastructure, identities, or inventories to adopt a demo stack. |
| [LocAR.js](https://github.com/AR-js-org/locar.js), [MIT license](https://github.com/AR-js-org/locar.js/blob/master/LICENSE), [AR.js docs](https://ar-js-org.github.io/AR.js-Docs/) | Optional camera-based rendering of eligible encounters anchored to known geographic places. | An AR library, not a complete game. Documented mobile browser support does not establish Capacitor, sensor, WebView, or device compatibility. |

Pokemon Walk's author identifies Pokemon material as fan art. Review reusable source and required notices separately from every distributed creature, name, image, sound, text, model, animation, and font. Use original BMC worldbuilding or appropriately licensed assets. A software license is not blanket permission for third-party characters. Keep map-data attribution and licensing separate.

Every adoption decision records upstream revision, copied files, dependency/source licenses, notices, asset replacements, modifications, maintainer, security/update process, and rollback. Do not label candidates installed or integrated until delivered and verified.

## 3. FBM navigation and player journeys

The game remains a **Coalition capability**, surfaced through FBM's existing World/map/list entry. Do not add a global Game tab or deep game subtab tree. Blackout's four-destination layout is specific to Blackout; it does not silently replace FBM's still-proposed navigation. Keep at most one local selector per surface.

| FBM entry | Player or creator experience | Contextual action |
|---|---|---|
| World / Coalition map or list | Toggle eligible encounters, hunts, quests, and participating places. | Open the authorized encounter/activity card. |
| Encounter card and view | Explain companion/object, eligibility, confirmation, interaction, and actual outcome. | Start, collect, retry where appropriate, or return to the same map context. |
| My Place / Toolkit collection | Search/filter owned companions, variants, and progress. | Inspect/equip a companion; keep collection distinct from commercial inventory. |
| Quest/project or selected community | Show steps, collaborator roles, individual contributions, and shared totals. | Join, contribute, or claim an eligible confirmed reward. |
| Participating place/event detail | Show the consenting venue's activity and supported time. | Participate, RSVP, or open its quest. |
| My Place / character | Display selected companion appearance and optional achievements. | Customize; keep achievements private if preferred. |
| Create / contextual creator tools | Author a supported asset, cosmetic, hunt, or template. | Preview, validate rights/compatibility, test, and submit for review. |
| Exchanges / owned-product detail | Show actual order, delivery, entitlement, and settlement states. | Reopen a purchased pack, install/apply a supported version, or resolve delivery/refund issues. |

Place collection, inventory, quest-management, and creator tools in the searchable Toolkit or relevant detail. Preserve map filters, selected place/activity, scroll, and return context after encounters, purchases, deep links, and AR. AR opens from and returns to the same encounter; camera refusal leaves map interaction usable.

Offer nonlocation and remote contribution paths for people unable to travel or unwilling to share location. Ecology, art, history, and community projects can inspire original themes; game finds do not establish scientifically verified species observations.

## 4. Progression and cooperation

- **Collection:** original companions, discoveries, badges, and optional visual variants.
- **Exploration:** approved public places, selected areas, events, geocaches, and reusable hunts.
- **Cooperation:** roles for exploration, organizing, teaching, documentation, design, and testing.
- **Encounters/raids:** define original rules and completion conditions after reuse evaluation; prove persistent multiplayer and authoritative rewards separately if required.
- **Learning:** short activities connect to useful guides, learning trails, and real projects.
- **Expression:** chosen companions and achievements can remain private.

Preserve the geocaching design and Blackout protocol banlist: no streak mechanics, manufactured urgency, or guilt notifications. Comparisons and leaderboards are opt-in. Maintain a play ledger separate from reputation used for Coalition admission or governance. Neither XP, collection counts, game purchases, nor a game find grants membership, voting power, a commission discount, or financial/transport authority. Genuine community work can qualify only under its separately verified contribution rules.

Game points are not cash or redeemable credit. Any actual coupon, good, entitlement, or credit requires a separately specified, funded, verified reward flow. Existing FBM progression schema issue SD-50 remains a dependency for affected progression paths; this plan does not resolve it.

## 5. Consent, visibility, and confirmation

Reuse the geocaching audience model: public, group-private, and direct activities retain their visibility and encryption requirements. Public places can be locations; people are never public moving markers.

1. Location use is opt-in. Explain collection, audience, retention, and how to stop. Preserve manual-area and remote discovery.
2. Code-at-the-spot remains the default for placed caches/hunts. GPS check-in is an explicit one-use alternative with no retained precise position under the existing design.
3. Evaluate encounter eligibility on-device where possible. Where server validation is necessary, obtain explicit consent for a bounded check. Do not add continuous location tracking or background movement histories.
4. Treat GPS proximity as imperfect and spoofable. Define tolerances, failure/retry behavior, and nonlocation alternatives before valuable rewards depend on it.
5. Preserve placement exclusions, reporting/moderation, delayed public publication, private meeting-place controls, and media metadata rules. Unresolved policy values in geocaching remain unresolved.
6. Exclude precise current location and private group activity from telemetry, analytics, URLs, logs, creator metrics, and sponsor reports.
7. Request camera/orientation access at AR entry. Permission is not consent to upload footage or publish location. Test weak signal, drift, calibration, permission denial, interruption, and app resume.

Real business addresses, pickup details, and shipment-party information keep their existing access controls. Consenting to a game visit does not authorize a purchase, publish a home address, enroll a courier, or permit advertising contact.

## 6. Creator-made world and digital products

Define art direction, asset specifications, compatible runtime formats, previews, versioning, moderation, and supported editors before publishing a sellable product type. Prefer declarative packs; executable extensions retain sandbox, permission, signing, and supported-distribution requirements.

| Output | Candidate catalogue path | Required authoring journey |
|---|---|---|
| Original companion art, models, animations, sounds | Existing asset-bundle / sound-pack foundations; new validated game manifest required. | Original content → preview → confirm rights → compatibility test → review. |
| Companion cosmetics, accessories, effects | Cosmetic / asset-bundle foundations; equip application still required. | Preview on a supported character → validate → review → install/equip. |
| Questlines, hunts, learning trails, event packs | Evaluate community-template, downloadable content, or a new validated game-content artifact. | Export chosen original content → remove private data → test rules/rewards → submit. |
| UI and themed presentation | Theme / approved declarative-plugin foundations. | Customize supported surface → export reusable template → preview → review. |
| Specialized tools | Sandboxed plugin foundations. | Validate manifest/capabilities → review → publish supported distribution. |
| Commissioned community content | Bounty / commissioned-work foundations. | Real request → agree scope, rights, and payment → deliver → record acceptance. |

Original companion designs are game assets; **AI personas remain excluded from sale**. Carry that exclusion through FBM listing creation, templates, discovery, and checkout, including legacy rows with absent artifact-kind metadata. Preserve historical purchases, records, and unrelated entitlements. This documentation does not assert that FBM retirement checks are already implemented.

Do not disguise an unsupported pack as an ordinary download merely to pass checkout. A download can deliver files without establishing a game-installation capability.

| Surface / trigger | Planned prompt | Actual destination requirement |
|---|---|---|
| Empty creator collection | Design your first original companion pack. | Open a supported editor/template only once available. |
| Creator's completed hunt or learning activity | Make a reusable quest pack. | Export selected original content with private data removed. |
| Explicit community request | Help make this world. | Open the actual bounty, scope, rights/payment, and acceptance criteria. |
| Tested compatible pack | Share it free or sell a copy. | Show deliverables, versions, rights, price, fees, and audience before submission. |
| Accepted contribution or actual sale | See your contribution. | Link to the real work, result, and pending/settled earnings state. |

Map Blackout's Create/Studio/marketplace/completion prompts to FBM's Create, relevant detail, Toolkit, and Exchanges surfaces. Generic asset/download/guide prompts are not evidence that game editors, validation, or installation work. No dead-end buttons or unsupported earning promises.

## 7. Commerce and shared integration contracts

| Responsibility | Owner / required contract |
|---|---|
| Places, areas, communities, visibility | Coalition records and authorization; stable place/community IDs. No second editable authority. |
| Encounter and quest rules | Blackout game module: versioned definitions, eligibility, allowed actions, completion/failure/expiry. |
| Collections and progress | Owner-scoped durable shared game records, server validation where needed, idempotent grants; no arbitrary client-selected XP/items. |
| Cooperative objectives | Existing objective/task/event services where suitable; explicit individual contributions and shared totals. |
| Private/direct activity | Existing membership, consent, encrypted-room boundaries; public APIs cannot read private encrypted content. |
| Rendering | Coalition map/list and optional LocAR renderer reference the same eligible activity IDs. |
| Creator packs | Versioned manifest, author/license, preview, compatibility, validation, moderation, actual payload bytes and signed delivery. |
| Payment and ownership | FBM-priced listing → verified payment/webhook → entitlement → compatible signed game-content bundle. Progress is separate from purchase records. |
| Seller earnings | Canonical FBM order/fee/payout state and supported splits; distinguish pending, payable, paid, refunded, and disputed amounts. |
| Sponsored rewards | Disclosed terms, funded budget/inventory, eligible evidence, and actual coupon/good delivery. No reward grants on an unfunded promise. |
| Client/session handoff | Verify member/workspace/entitlement server-side across FBM and Blackout. Preserve return context; never trust a URL-supplied seller ID or client claim of ownership. |

The first paid-pack journey must demonstrate all of the following:

1. Persist an owner-scoped draft that resumes after interruption; store actual asset/upload references, validated manifest, version, rights, and supported runtime information.
2. Link any related content, quest, or preview to its real offer with authorized visibility and a durable association.
3. Snapshot the purchased deliverable/version and price at checkout; validate the actual payment outcome before granting paid rights. Order creation or a client success screen alone is insufficient.
4. Deduplicate webhook retries and grants; recover safely after interruption, late delivery, and reconnect without duplicate charges, XP, or owned items.
5. Verify the buyer's scope, deliver signed bytes for the correct version, validate compatibility/integrity, and apply the bundle in the runtime. Reopen from the owned library/Toolkit without repurchase.
6. Show seller earnings from actual order and settlement records, including agreed splits, reversals, and refunds. An allocation record is not evidence money reached the seller.
7. Define refund/revocation/uninstall behavior for purchased content while preserving unrelated earned progress, historical records, and data access. Specify compatibility and upgrade recovery.

Blackout's wiring review records **metadata-only production listing creation**, a missing actual payload/upload handoff, component-only wizard progress without durable resume, and a general content-to-offer association gap. Actual digital delivery and settlement still need proof. Carry these as cross-repository release blockers, not assumptions fixed by FBM's existing listing model. The [FBM inventory](FBM_MOBILE_IMPLEMENTATION_INVENTORY.md) also records digital-delivery and backend authorization/identifier concerns; resolve applicable blockers for the tested path.

Native enhancements and supported content packs are **one-time purchases**. Hosted storage/usage follows separately disclosed terms; FBM's charter requires transparent at-cost hosted/external usage and does not gain a new software subscription exception through this plan. Preserve processing-fees-first and the flat **3% Coalition commission** on FBM sales. Do not add a duplicate Blackout transaction cut. Cosmetics cannot buy contribution rank, extra Coliseum votes, community authority, or better fee rates. Sponsorship cannot purchase ranking in Blackout's chronological Circle/Reach feeds.

Verify store-specific digital billing, restore/refund behavior, and supported distribution before native release. Existing web checkout and purchase helpers are not proof of store approval. Keep ordinary FBM commerce usable when the game or shared service is unavailable.

## 8. Phased delivery and acceptance

| Phase | Deliverable | Required evidence |
|---|---|---|
| 0. Reuse evaluation | Pin/inspect candidates; compare ports and Godot runtime options. | Adoption decision, dependency/asset inventory, original asset plan, maintenance/rollback owners; no duplicate infrastructure by default. |
| 1. One encounter | Eligible layer → encounter → original companion → durable collection → return. | Existing identity/permissions; no extra global tab; replay-safe grants; declined location has an alternative; compact/map parity. |
| 2. Cooperation | One group hunt/quest tied to a place/event. | Correct membership/consent; shared progress and individual credit; play XP cannot affect admission/governance. |
| 3. Creator contribution | One original asset or declarative quest pack authored, previewed, tested, reviewed, installed. | Rights, private-data removal, manifest compatibility, permissions, versioning, actual runtime application. |
| 4. Real commerce | Creator sells a supported pack; another buyer receives/applies its exact version. | Real FBM checkout/payment, webhook idempotency, entitlement, signed bytes, library reopening, refunds, actual seller settlement; path-specific authoring/delivery blockers closed. |
| 5. Optional AR | Render eligible encounter through LocAR and return to map/detail. | Physical iOS/Android and supported Capacitor/browser validation; camera/sensor denial, drift, calibration, performance, interruption, no footage/location leakage. |
| 6. Expanded world | More original companions, places, quests, sponsors, community content. | Moderation, authoring quality, reward delivery, operational capacity, maintenance, and rollback proven before expansion. |

These are capability gates, not a change to the smaller R1 portal scope. Do not require game expansion to deliver an ordinary useful portal, or monetize packs before their supported application works.

Track successful encounters, useful quests, cooperation, accepted content, correct asset delivery, and creator/community benefit. Do not optimize streaks, retained location histories, compulsory travel, or camera-open time. Existing security, accessibility, operational, and native-release gates remain in force.
