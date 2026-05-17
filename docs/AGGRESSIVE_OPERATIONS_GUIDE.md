# Black Market Coalition — Operations Guide

> **Companion docs (FBM repo):** [`ROADMAP.md`](../ROADMAP.md) · [`FEATURE_BUILD_PLAN.md`](../FEATURE_BUILD_PLAN.md) · [`docs/VENDOR_PORTAL_PROJECT_TRACKER.md`](VENDOR_PORTAL_PROJECT_TRACKER.md) · [`docs/VENDOR_FEATURE_MATRIX.md`](VENDOR_FEATURE_MATRIX.md) · [`docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md`](COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md)
>
> **Companion docs (Blackout repo):** [`ROADMAP.md`](https://github.com/Blackmarket-coa/blackout/blob/develop/ROADMAP.md) · [`infra/single-server-baseline/RUNBOOK.md`](https://github.com/Blackmarket-coa/blackout/blob/develop/infra/single-server-baseline/RUNBOOK.md) · [`docs/operations/`](https://github.com/Blackmarket-coa/blackout/tree/develop/docs/operations) · [`docs/runbooks/`](https://github.com/Blackmarket-coa/blackout/tree/develop/docs/runbooks)
>
> This is the unified canonical operations guide for the Black Market Coalition. It supersedes all prior versions of this document, including the previously time-bounded `AGGRESSIVE_OPERATIONS_GUIDE.md` files maintained on `Blackmarket-coa/free-black-market` (`main`) and `Blackmarket-coa/blackout` (`develop` and `claude/aog-cooperative-wedge-restructure-aliJG`). This version removes time constraints. The work is sequenced by what must be true for each milestone, not by when the milestone must complete. Pace is determined by available capacity and observable progress, not by calendar.

-----

## §0 — Reframe and Architectural Consolidation

This document exists because earlier versions described a four-platform ecosystem that no longer reflects the architecture being built, and because earlier versions imposed calendar-based pacing that does not survive contact with solo-dev reality. The four-platform model originally identified FreeBlackMarket as the marketplace, Blackout as the communication platform, Blackstar as the logistics protocol, and Coalition as the spatial super-app. The architecture that has actually emerged through implementation is a two-layer system. Blackstar's logistics responsibilities have been rolled into FBM as a fulfillment module. Coalition's spatial features have been partially rolled into Blackout and will complete that consolidation as Blackout's spatial layer. FBM is already serving as the platform-agnostic creator reward program and the payment-transaction substrate for the entire ecosystem, and is being extended to host the public-facing retail shop alongside its existing vendor marketplace.

The honest description of what the Black Market Coalition is, then, has two layers and one wedge.

The substrate layer is FreeBlackMarket, the cooperative economic platform. It hosts the ledger that settles every economic event in the ecosystem, the entitlements service that gates access across all surfaces, the listings and storefronts that present commerce to end users, the order cycles and CSA primitives that distinguish BMC from generic marketplaces, the cooperative governance modules that give coalitions a voice, the vendor verification and signing infrastructure that establishes trust, and the logistics module that absorbed Blackstar's responsibilities. FBM is a Medusa v2 backend with MercurJS multi-vendor extensions, a vendor panel, a public storefront, and a programmable event bus that the rest of the ecosystem reads from.

The interface layer is Blackout, the communication and governance interface to the substrate. It is a Matrix-first encrypted communication platform built on a Cinny fork talking to a Synapse fork, with a shipped multi-platform compatibility layer that lets existing communities adopt without abandoning their tooling. Twitch IRC, YouTube Live, Kick, Patreon, Streamlabs, OBS-WebSocket, Stream Deck, Discord-shape webhooks, and federated Matrix appservice transactions all keep working unmodified. Blackout will absorb the spatial features previously assigned to Coalition, becoming the geographic and presence interface to FBM's economic activity in addition to its communication and governance roles. Blackout is the primary mobile surface for the entire ecosystem, with FBM commerce flows embedded as views within the Blackout application.

The wedge that distinguishes this two-layer architecture from every competing creator-economy platform is the cooperative economic substrate itself. Coalition Credits as a settlement layer that pays creators and vendors across the ecosystem, Order Cycles and CSA share boxes as time-bounded ordering primitives that nobody else ships, cooperative governance with petition-based steering of platform decisions, vendor verification and marketplace signing as trust signals, and the unified retail and marketplace presentation surface together constitute a system where members own infrastructure rather than paying rent to extractive intermediaries. The five surfaces of the Blackout compatibility layer are not the wedge. They are the leverage that lets existing communities migrate to the substrate without retooling their daily workflow.

This document is structured around milestones, not calendar phases. Section five describes four milestone tiers, each with explicit entry conditions, work in scope, and exit criteria. A tier is complete when its exit criteria are met. There are no months, weeks, or quarters in the milestone descriptions. The maintainer advances through tiers at whatever pace solo-dev capacity and AI assistance leverage permit, with the understanding that some tiers may take much longer than originally projected and others may complete faster than anticipated. The financial trajectory implied by reaching each tier is described in section twelve and is similarly milestone-anchored rather than time-anchored.

-----

## §1 — The Two-Layer Architecture

### §1.1 What FBM is

FreeBlackMarket is the cooperative economic substrate. It is responsible for the canonical record of every economic event in the ecosystem, regardless of which surface that event originated from. A creator reward earned through a Twitch tip, a vendor sale through the marketplace storefront, a CSA share-box delivery, a Patreon pledge synced through the Blackout compatibility layer, a logistics fee paid to a fulfillment node operator, and a Coalition Credits transfer between coalition members are all FBM transactions. They flow through the same ledger, the same payout breakdown logic, the same event bus, and the same analytics pipeline.

FBM owns the listings catalog. The retail shop and the vendor marketplace are presentation variants of the same underlying listing records, with the choice of presentation determined by the buyer's relationship to the vendor and the context in which they encounter the listing. A coalition member browsing their coalition's storefront sees marketplace presentation. A general visitor browsing the public retail shop sees retail presentation. The data is identical; the routing layer and the storefront templates differ.

FBM owns the entitlements service. Every gating decision in the ecosystem flows through this service, including whether a Matrix room admits a user, whether an FBM checkout succeeds, whether a vendor can list a product, whether a governance proposal can be voted on, and whether a creator can withdraw rewards. The service answers four questions for any given user, namely what access they have, what their economic standing is, what governance roles they hold, and what coalitions they belong to. This contract is the stable boundary between the substrate and the interface layer, and is described in detail in section two.

FBM has absorbed the logistics responsibilities that were previously framed as Blackstar. Fulfillment nodes, pickup systems, delivery coordination, vending, ghost kitchen integration, and edge logistics infrastructure all live as FBM modules. The `blackstar-fulfillment` and `blackstar-fulfillment-provider` module names in the FBM backend reflect this absorption. They are FBM modules that handle what was previously framed as a separate platform.

### §1.2 What Blackout is

Blackout is the communication and governance interface to FBM. It is a Matrix-first encrypted communication platform that consumes the FBM substrate through documented contracts. Coalition Credits balance widgets, payout breakdowns, vendor verification status, governance proposal flows, and retail shop browsing all appear in Blackout as views that read from FBM through the entitlements service and the FBM event bus.

Blackout owns the federated communication layer, including the Synapse homeserver, the Cinny-fork client, and the multi-platform compatibility layer that bridges to Twitch, YouTube, Kick, Patreon, Streamlabs, OBS-WebSocket, Stream Deck, and Discord-shape webhooks. The compat layer is shipped infrastructure with one hundred twenty-seven backend integration tests and one hundred fourteen frontend tests passing at commit `ef6ecce` on the `claude/multi-platform-extensions-Euc73` branch. The five compat surfaces are inventoried in Appendix C.

Blackout is absorbing the spatial features previously assigned to Coalition. The MapLibre GL plus PostGIS plus Martin tile server plus PMTiles offline support plus Hono.js gateway stack will run as a Blackout subsystem rather than as a separate application. The seventeen heatmap data layers plus the flash mob ephemeral location layer become Blackout views that read FBM economic activity and Blackout presence data through documented contracts. This consolidation removes the cross-application data flow problem that the four-platform model created.

Blackout is the primary mobile surface for the entire ecosystem. The Capacitor wrapper that wraps the Blackout web client also embeds FBM commerce flows as views within the application. Users interact with one mobile application that handles communication, governance, commerce, and spatial features, rather than installing separate FBM and Blackout applications.

### §1.3 What the wedge is

The wedge is the cooperative economic substrate. The five wedge products that distinguish BMC from every competing platform live in FBM, with Blackout as the interface that exposes them to users.

Coalition Credits is the cross-platform settlement layer. It pays creators and vendors across the ecosystem regardless of which surface generated the transaction, and it settles cooperative obligations between coalition members. Coalition Credits is implemented on top of the existing `hawala-ledger` module with Stellar and USDC as external settlement rails. The Coalition Credits ledger UX, which presents balance, transfer, and settlement views to end users, ships in the foundation milestone tier and is exposed in Blackout as a balance widget that consumes the FBM ledger through the entitlements service.

Order Cycles and CSA share boxes are time-bounded ordering primitives that distinguish BMC from generic e-commerce. The `order-cycle` module already ships in FBM, and the share-box scheduler that sits on top of it is foundation milestone work. The `agriculture`, `garden`, `season`, `producer`, `harvest`, `harvest-batches`, and `food-distribution` modules give FBM a complete CSA primitive that Open Food Network is the closest external comparison to. These modules generalize beyond agricultural use cases to any time-bounded group ordering scenario, including mutual aid disbursements, B2B coalition purchasing, and event ticketing.

Cooperative governance with petition-based steering is the third wedge product. The `cooperative` and `governance` modules in FBM define the governance primitives, with Matrix ACL synchronization in Blackout providing the visible expression of governance roles. The petition feature for finances and large issues, which is added in the differentiation milestone tier, lets coalitions steer platform-level decisions without holding execution authority. Final execution remains with the maintainer; coalitions that disagree with execution decisions can fork the platform under its open-source license, which is the appropriate exit right for a cooperative.

Vendor verification and marketplace signing are the trust signals that make the three percent commission story credible. The `vendor-verification`, `marketplace-signing`, and `vendor-rules` modules in FBM are mature and instrumented end-to-end. Vendor roles are revised under the unified identity model described in section two, mapping Matrix-side governance roles to FBM-side commerce permissions through the entitlements service.

The unified retail and marketplace presentation surface is the fifth wedge product. A single listing record is presented as either retail or marketplace depending on context, eliminating the duplicate-listing problem that competing platforms create when they bolt on B2B and B2C surfaces as separate products. The storefront work in the foundation milestone implements this unified presentation.

The five surfaces of the Blackout compatibility layer covering Twitch, YouTube, and Kick chat ingress, the outbound chat router, the alert and donation pipeline, RTMP simulcast fan-out, and the OBS and Stream Deck control surface remain operationally valuable because they let existing creator workflows attach to BMC without retooling. They are not the wedge. The pitch is the cooperative substrate beneath existing tooling, not another encrypted Discord alternative.

-----

## §2 — Architectural Commitments

This section establishes the architectural decisions that make the two-layer consolidation work. Each commitment is a stable contract that subsequent work depends on. Changes to these commitments require revising this document, not just changing implementation.

### §2.1 Unified identity model

The Matrix MXID is the canonical identity for every actor in the ecosystem. When a user authenticates to Synapse for the first time, an FBM customer record is provisioned with the MXID as the foreign key. The same record is used for subsequent commerce, governance, and reward operations. There is no separate FBM account creation flow; signup happens through Matrix registration on the Blackout-owned Synapse homeserver.

This implies that vendor roles, which were previously expressed as FBM-only permissions, are revised to be Matrix-side governance roles that map to FBM-side commerce permissions through the entitlements service. A user who is granted the vendor role in their coalition's Matrix governance space automatically receives the corresponding FBM permissions to list products, manage orders, and receive payouts. Revoking the Matrix-side role revokes the FBM-side permission. This unification is implemented as part of the entitlements service contract in section 2.5.

The vendor-roles revision is part of the foundation milestone. Existing FBM vendors are migrated to MXID-keyed records during foundation milestone work, with the migration runbook documented under the bus-factor mitigation section.

### §2.2 FBM as canonical event bus and analytics substrate

FBM hosts the canonical event bus for the entire ecosystem. The Medusa event system in FBM is the source of truth for economic events. Blackout-side events that have economic significance, including creator rewards from Twitch tips, Patreon pledges, Streamlabs donations, and OBS-WS stream lifecycle events that trigger reward calculations, are published to the FBM event bus through the existing compat-layer integrations.

Analytics consolidates onto a single ClickHouse instance with Cube as the semantic layer and Metabase as the dashboard. The analytics stack runs alongside FBM on the primary server. Six dashboards constitute the operationally significant view surface, namely Coalition Credits volume, Order Cycles run and completion rate, active coalitions and vendors and DAU, Synapse capacity metrics including PostGIS and tile-serving load, vendor verification funnel, and support inbox SLA. Additional dashboards may be added as needed but the six above are the canonical operational view.

The `impact-metrics` module in FBM is the cross-cutting event taxonomy that feeds the analytics stack. It is extended rather than replaced.

### §2.3 Consolidated secrets management

Secrets across the ecosystem consolidate into a single manager. The recommendation is HashiCorp Vault if the operational capacity to run it exists, with Infisical as a managed alternative, and SOPS-encrypted directory storage in the infrastructure repository as a lightweight fallback.

The choice between Vault and Infisical depends on operational preference. Vault provides stronger access control and audit logging at the cost of higher operational overhead. Infisical provides a managed user experience with a free tier sufficient for the early-stage scale, and trades self-hosted control for reduced operational burden. Either is dramatically better than the current state, in which secrets are distributed across docker-compose environment files, FBM backend configuration, and the Blackout deployment.

The secrets manager hosts Cloudflare Tunnel tokens, Synapse signing keys, Stellar API keys, OAuth provider secrets for the compat layer, MinIO admin credentials, Postgres passwords, Stripe keys for the ACH edge, and any future external integration credentials. The migration from the current distributed state to the consolidated manager is foundation milestone work, and the migration runbook is documented under the bus-factor mitigation section.

### §2.4 Unified deployment topology

FBM and Blackout co-locate on the primary HP ProLiant DL360 Gen9 server. FBM completes the migration from Railway to the primary server during foundation milestone work. The 384 GB of RAM and 40 CPU threads on the DL360 have substantial unused capacity that comfortably accommodates FBM's Postgres workload alongside Synapse's federation traffic, the ClickHouse analytics workload, and the future PostGIS spatial workload.

The smaller secondary server is reserved for two roles. The first is offsite Postgres replication for both the FBM and Synapse databases. The second is a warm standby for the Matrix appservice transactions endpoint. The secondary server does not run production workloads; it exists to bound the recovery time objective in disaster scenarios.

Cloudflare Tunnel remains the primary ingress, with documented fallback nginx and Let's Encrypt configuration as a differentiation milestone enabled mitigation.

### §2.5 Entitlements service contract

The entitlements service is the stable boundary between the substrate layer and the interface layer. It is implemented as an extension of the existing FBM `entitlement` module, exposed over HTTP for Blackout consumption, and exposed in-process to FBM modules.

The contract answers four questions for any pair consisting of a user identified by Matrix MXID and a resource. The first question is access. Does this user have permission to read, write, or administer this resource? Resources include Matrix rooms, FBM listings, governance proposals, fulfillment node operations, ledger transactions, and platform administration surfaces. The second question is economic standing. What is this user's Coalition Credits balance, what payout balances are pending for them, what vendor sales volume have they generated, and what creator reward eligibility do they hold? This question is answered with sufficient granularity to drive payout breakdowns, dunning logic, and reward calculations. The third question is governance roles. What roles does this user hold within which coalitions, what governance proposals can they vote on, what Matrix ACLs follow from their roles, and what FBM commerce permissions follow from their roles? The fourth question is coalition membership. Which coalitions does this user belong to, what is their membership status, and what coalition-specific entitlements follow from membership?

The contract is documented as an OpenAPI specification under `docs/contracts/entitlements.yaml` in the FBM repository. Both FBM-side modules and Blackout-side consumers code against this contract. Changes to the contract require revising this document. The contract is the single most important architectural commitment in this section because it is what makes the two-layer split coherent.

### §2.6 Listings as presentation variants

Listings are stored once in the FBM `marketplace-listing` module. The retail shop and the vendor marketplace are presentation variants of the same record, with the choice of presentation determined by the buyer's relationship to the vendor and the context in which the listing appears. This is implemented in the storefront layer and the routing layer rather than in the data layer.

The unified-listing work is foundation milestone work because it affects the storefront and tenant-scaffolding work that is also in the foundation milestone. Decoupling these later would require migrating data and rewriting routing logic.

### §2.7 Cooperative governance steers, the maintainer executes

Cooperative governance is positioned as a steering function rather than an execution function. Coalitions can propose, deliberate, and vote on platform-level decisions through the petition feature added to the `governance` module in the differentiation milestone. Petitions for finances and large issues are first-class governance objects with the same proposal-deliberation-vote lifecycle as coalition-internal decisions.

The maintainer retains final execution authority. This is the appropriate posture for a solo project at the current stage and is consistent with the cooperative thesis that members own the infrastructure they participate in but the platform itself is run by its maintainer until the operational scale justifies a more distributed governance model.

The exit right is open-source forking. Any coalition that disagrees with execution decisions can fork the BMC platform under its license terms. This is the credible signal that distinguishes cooperative steering from advisory-only feedback, because coalitions can leave with the code if they choose to.

The petition feature is built on top of existing `governance` and `cooperative` module primitives. The differentiation milestone work adds the petition object type, the proposal-deliberation-vote lifecycle for petitions, the surfacing of petition results to the maintainer, and the maintainer's execution-or-decline response surface.

### §2.8 Mobile as Blackout

Blackout is the primary mobile surface for the entire ecosystem. The Capacitor wrapper for Blackout is the canonical mobile application, and FBM commerce flows are embedded as views within the Blackout application. Users install one application, not two.

This means the FBM storefront is exposed to mobile users through the Blackout client rather than as a separate FBM mobile application. Storefront work in the foundation milestone includes ensuring the storefront templates render correctly inside the Blackout Capacitor wrapper, with appropriate authentication delegation to the Blackout-side Matrix session.

iOS deployment is deferred until Mac access is available; Android is the priority for foundation milestone mobile work.

### §2.9 Fork management posture

BMC maintains its modified forks of Cinny, Synapse, MedusaJS, MercurJS, and the absorbed Fleetbase rather than tracking upstream. The modifications are substantial enough that upstream tracking would require constant rebasing and would risk losing modifications during merge conflicts.

AI-driven security review and dependency updates run on the BMC-side repositories. The workflow is documented in section eight as an operational practice. Specifically, security advisories from upstream projects are reviewed by AI tooling, with patches applied to the BMC forks if the affected code paths exist in BMC's modifications, and acknowledged as not-applicable if the upstream advisory affects code that BMC has removed or replaced. Dependency updates are similarly evaluated on the BMC fork rather than pulled from upstream.

The risk this posture creates is that BMC carries the burden of security maintenance for substantial codebases. The mitigation is that AI tooling makes this burden tractable for a solo maintainer, and the alternative of upstream tracking creates the worse risk of losing modifications. The tradeoff is documented and accepted.

-----

## §3 — Solo-Dev Capacity and the Prioritization Filter

The Black Market Coalition is a solo project with AI assistance. Plans that assume a fifteen-engineer team will not survive contact with reality. This section establishes the prioritization filter that every workstream is evaluated against. The filter is the operative replacement for any time-based prioritization rule.

Every workstream is evaluated against five constraints. A workstream that fails two constraints is deferred to a later milestone. A workstream that fails three or more constraints is removed from the plan.

The first constraint is the cooperative wedge. Does this workstream strengthen the cooperative economic substrate in a way that competitors cannot easily replicate? Order Cycles, Coalition Credits, and cooperative governance pass this constraint. Plugin marketplaces, theme stores, and emoji economies do not.

The second constraint is solo-dev capacity. Does this workstream fit the realistic execution envelope, or does it require batches of work too large to ship without dedicated team support? Workstreams that require multi-week-engineer batches without corresponding strategic value are deferred to the infrastructure milestone where co-maintainer capacity is available.

The third constraint is operational cost. Does this workstream raise or lower the cost of running the platform per active user? Synapse capacity work passes this constraint. Building a parallel plugin SDK to compete with Matrix's existing widget and appservice models does not.

The fourth constraint is bus-factor. Does this workstream depend on a single human, or can a co-maintainer ship it? Workstreams that produce tribal knowledge without runbooks fail this constraint. Workstreams that produce documented procedures pass.

The fifth constraint is wedge-deepening. Does this workstream deepen Coalition Credits, Order Cycles, cooperative governance, or vendor trust, or is it cosmetic and displaceable? Workstreams that pass this constraint compound the moat over time. Workstreams that fail this constraint produce surface-level features that competitors can copy.

Two failures defer a workstream to a later milestone. Three or more failures remove it from the plan.

The Blackout-side rider to this filter is that workstreams which strengthen the compatibility layer, by adding or hardening an Appendix C row, or strengthen federation resilience, through Synapse SLO attainment, an operational runbook, or a single-point-of-failure mitigation, also pass the filter, even if they do not directly deepen the cooperative wedge. The compat layer is leverage that makes the wedge accessible. Federation resilience is what keeps the substrate operating.

Concrete prioritization sources within the repositories supersede aspirational task lists. The FBM repository's `FEATURE_BUILD_PLAN.md` and `VENDOR_PORTAL_PROJECT_TRACKER.md` are the authoritative FBM-side prioritization. The Blackout repository's `docs/backlog_prioritization_top20_2026-04-03.md` and `docs/shippable_p0_backlog_2026-04-03.md` are the authoritative Blackout-side prioritization. This document sequences and frames those tracker artifacts; it does not replace them.

The maintainer advances through the milestone tiers in section five at whatever pace solo-dev capacity and AI assistance leverage permit. Some milestones may take much longer than originally projected, particularly the foundation milestone if the architectural commitments prove harder to operationalize than anticipated. Other milestones may complete faster than expected if external collaborators emerge or if specific workstreams turn out to be smaller than estimated. The plan accommodates both possibilities.

-----

## §4 — Federation, Capacity, and Single Points of Failure

This section establishes the operational risk posture for the consolidated stack. The largest non-strategic risks are Synapse federation cost curves on the primary server, the now-larger blast radius of single points of failure under co-location, and the spatial workload that Blackout absorbs from Coalition.

### §4.1 Synapse federation under co-location

Synapse remains the largest single point of failure in the Blackout layer, and co-location with FBM does not change this. What co-location changes is the Postgres workload composition. FBM's Medusa schema, the entitlements service, the analytics ClickHouse sink running on its own database engine, the Synapse state tables, and the absorbed PostGIS spatial workload all share infrastructure on the primary server.

The watch-items remain qualitative pending real telemetry. Synapse media-store growth, including state size, retention policy, and garbage collection cadence, is the cheapest line item to misjudge. Federation outbound queue depth, including sender-localpart staging and EDU backpressure, is the most likely cause of perceived federation degradation. TURN allocation errors during simulcast or town-hall bursts indicate coturn capacity limits. Postgres autovacuum on Synapse state tables under federation load can produce latency spikes that affect every other Postgres consumer on the host.

The new watch-items added by the consolidation are PostGIS query latency on spatial queries that read from FBM commerce data, tile-serving cache hit rates as the spatial layer grows, and Postgres connection pool contention between FBM application traffic and Synapse federation traffic. These need real telemetry before any specific thresholds can be set.

The capacity bands and DAU thresholds that earlier drafts attempted to specify are deferred. The honest answer is that the primary server has substantial unused capacity at the current scale, and that capacity planning for the larger DAU regimes requires operating telemetry that does not yet exist.

### §4.2 Single points of failure inventory

The single-point-of-failure inventory under co-location includes the primary server itself, Cloudflare Tunnel as the only ingress, the maintainer as the only operator, the secrets manager whichever is chosen, and the Postgres instance that hosts both FBM and Synapse data.

Mitigations stage across milestones. Foundation milestone mitigations include nightly encrypted Postgres dumps to offsite storage such as Backblaze B2 for both databases, documented Cloudflare Tunnel fallback nginx configuration, hardware key plus 2FA on the GitHub org owner account, and the bus-factor work in section seven. Differentiation milestone mitigations include enabling the Cloudflare Tunnel fallback nginx ingress, onboarding a co-maintainer with deploy access, and enabling Postgres streaming replication to the secondary server. Infrastructure milestone mitigations include multi-host deployment if scale warrants, two-person on-call rotation, and either Synapse worker mode or a Dendrite or conduwuit migration if Postgres I/O becomes the binding constraint.

The single-point-of-failure map ships as a foundation milestone deliverable at `docs/operations/SPOF_MAP.md` in the appropriate repository, likely the Blackout repository since it owns the operational baseline, and is referenced from this document. The map is updated whenever a new single point of failure is introduced or an existing one is mitigated.

-----

## §5 — Milestone Tiers

The active execution rhythm for the consolidated stack is the four-milestone progression in this section. Each milestone has explicit entry conditions, work in scope, and exit criteria. A milestone is complete when its exit criteria are met. There are no calendar dates in the milestone descriptions. The maintainer advances through milestones at whatever pace solo-dev capacity and AI assistance leverage permit.

The four milestones build on each other. Foundation establishes the architectural commitments and makes the substrate operable. Differentiation makes the substrate visible publicly and adds the wedge products that distinguish BMC from generic platforms. Density raises transactions per coalition and proves the physical-asset rent-to-own pattern. Infrastructure makes BMC the substrate that other cooperatives run on.

### Milestone 1 — Foundation (architectural commitments operable)

**Entry conditions:** This milestone has no entry conditions. It is the starting point.

**Strategic goal:** Make the two-layer architecture real and recoverable. Real means the architectural commitments in section two ship and are demonstrable end-to-end with a small number of real coalitions. Recoverable means a co-maintainer with the runbooks can keep the stack running for thirty days without the maintainer being available.

**FBM workstreams in scope:** Coalition Credits ledger UX with Stellar and USDC settlement; entitlements service contract implementation and OpenAPI documentation; vendor-roles revision under the unified identity model with migration of existing vendors; unified retail-and-marketplace listing presentation; Order Cycles share-box scheduler on top of the existing `order-cycle` and `food-distribution` modules; vendor verification and marketplace signing instrumentation end-to-end; the Railway-to-primary-server migration with documented runbook; storefront polish that ensures correct rendering inside the Blackout Capacitor wrapper.

**Blackout workstreams in scope:** Synapse capacity telemetry through Prometheus and Grafana; Synapse media retention policy implementation; Postgres tuning baseline; Synapse worker-mode readiness with configuration documented but not yet enabled; the Coalition Credits balance widget that consumes the FBM entitlements service; cooperative governance UI with Matrix ACL synchronization; Settings Appearance and Steganography pages that are already in flight; spatial layer integration consisting of the PostGIS plus Martin plus PMTiles stack consuming FBM commerce data through the entitlements service.

**Cross-cutting workstreams in scope:** Bus-factor work documented in detail in section seven; secrets manager consolidation with documented migration runbook; analytics consolidation onto ClickHouse plus Cube plus Metabase; AI-driven security and dependency update workflow documented as an operational practice.

**Exit criteria — all must be true to complete this milestone:** Three to five real coalitions are active on FBM and demonstrably using the substrate end-to-end. Ten or more Order Cycles have run end-to-end through the share-box scheduler. Coalition Credits has settled at least one non-zero transaction volume through the Stellar/USDC bridge. Twenty-five to fifty vendors have completed verification and are actively listing or transacting. Synapse remains in the comfortable capacity band with no observed federation degradation. Runbook coverage of Tier-1 operations is complete and validated through at least one bus-factor drill. One co-maintainer has been onboarded with read access to the repository and has demonstrated the ability to follow runbooks during the drill.

**What this milestone deliberately does not include:** Revenue is not an exit criterion. The foundation question is whether the cooperative substrate works end-to-end. Revenue follows substrate; trying to optimize revenue before substrate exists is how cooperatives get captured by extractive dynamics.

### Milestone 2 — Differentiation (the substrate visible publicly)

**Entry conditions:** Milestone 1 exit criteria all met. The architectural commitments in section two are operational. At least three coalitions are running real Order Cycles. Coalition Credits has settled real transactions. The bus-factor drill has been completed successfully at least once.

**Strategic goal:** Make the wedge demonstrable to a wider audience. The substrate from the foundation milestone is real; this milestone makes it visible.

**FBM workstreams in scope:** Community garden harvest-to-listing pipeline; Order Cycles production hardening for higher concurrency; group commerce primitives covering collective campaigns, demand pools, and bargaining wired to Coalition Credits; services marketplace with `service-program` plus `ticket-booking` plus `rental` modules; vendor activation Sprint B covering CSV import, listing templates, and Launch Assist Mode; wishlist and content-platform creator pages; donation rails wired to creator coalitions through Coalition Credits; volunteer coordination for coalition launches; vendor hype operations prediction Phase A; design specifications frozen for POS, weight-based pricing, and channel sync, which build in the density milestone.

**Blackout workstreams in scope:** Petition feature in cooperative governance for finances and large issues; cooperative governance UX deepening with proposal templates, vote tallies, and governance boost UX; community discovery covering search and trending coalitions; creator dashboards with Coalition Credits earnings visible; spatial layer feature parity with the previous Coalition application's planned features; identity-economy primitives as governance-recognition rather than for-sale (badges that mean something governance-wise but are not commodity cosmetics); Stream Deck Companion module shipped upstream to bitfocus/companion; StreamElements and Streamlabs widget shims documented for overlay creators; Synapse appservice deployment documentation that covers ops drop-in end-to-end.

**Cross-cutting workstreams in scope:** Public-facing onramps for the existing compat surfaces so streamers can adopt the substrate without retooling; documented partnership outreach to existing food cooperatives and CSAs and mutual-aid networks; marketing site (Astro plus Tailwind, Foxi fork) that leads with cooperative economics rather than encrypted-Discord-alternative framing; Cloudflare Tunnel fallback nginx ingress enabled.

**Exit criteria — all must be true to complete this milestone:** Twenty-five to fifty active coalitions are using the platform. Fifty or more Order Cycles run per measurement period at sustained cadence. Five to ten community gardens have onboarded and are using the harvest-to-listing pipeline. Coalition Credits settlement volume has reached the twenty-five thousand to seventy-five thousand dollar range per measurement period. Two hundred to five hundred vendors are verified and active. Synapse capacity remains adequate with worker mode active if needed. The petition feature is live and at least one petition has completed the proposal-deliberation-vote-execution cycle. The Order Cycles launch and the Coalition Credits launch have both shipped publicly.

**What this milestone deliberately does not include:** The plugin SDK, themes and emojis as governance products, and the federated identity economy remain deferred to the infrastructure milestone. White-label tenancy and B2B portal are deferred. Physical-asset pilot is the next milestone, not this one.

### Milestone 3 — Density (raising transactions per coalition)

**Entry conditions:** Milestone 2 exit criteria all met. The wedge products are publicly demonstrable. The petition feature has been exercised at least once. Coalition count and Order Cycles cadence have reached the differentiation milestone exit thresholds. The Cloudflare Tunnel fallback ingress is enabled and tested.

**Strategic goal:** Raise transaction density inside existing coalitions and prove the physical-asset rent-to-own pattern. Coalition count growth is secondary; per-coalition transaction velocity is primary.

**FBM workstreams in scope:** POS module MVP per `FEATURE_BUILD_PLAN.md` section one; weight-based pricing per section two; channel sync for real-time inventory and order synchronization per section three; pick-and-pack `fulfillment-ops` per section four; invoicing module per section five; vendor hype operations prediction Phase B; vendor activation Sprint C covering follow-up cadence, dashboard coaching, and incentives; CSA share-box scheduler v2 with rotation and yield forecast; crop planning v2 extending the agriculture, garden, and season modules; ghost kitchen integration covering kitchen, restaurant, food-distribution, order-subcontract, and supplier-forwarding modules; physical-asset rent-to-own equity ledger that supports the pilot.

**Blackout workstreams in scope:** Federation optimization, specifically Postgres I/O if the Synapse load curve indicates the binding constraint is approaching; governance-gated paid community channels (channels gated by coalition membership rather than by cosmetic subscription); creator dashboards with full Coalition Credits earnings history; mobile-first feature parity for the Capacitor wrapper; opt-in AI plugin connectors for external AI services; PostGIS query optimization as spatial-layer adoption grows.

**Physical-asset pilot in scope:** Two to three smart kiosks or one cargo e-bike fleet deployed under the rent-to-own model. Coalition members accumulate equity in the pilot assets through operations, with ownership transferring once equity reaches asset cost plus fifteen to twenty-five percent margin funding the next acquisition. The pilot is the proof point that BMC tells a story Stripe and Shopify cannot.

**Exit criteria — all must be true to complete this milestone:** One hundred to two hundred fifty active coalitions are using the platform. Coalition Credits settlement volume has reached the two hundred fifty thousand to seven hundred fifty thousand dollar range per measurement period. One thousand to two thousand five hundred vendors are verified and active. Synapse remains operational with whatever federation optimization the load curve required. Two to five physical assets are operating in rent-to-own. Five to fifteen ghost kitchen partners are integrated. One co-maintainer has reached full autonomy and is shipping production work without maintainer review on routine items.

**What this milestone deliberately does not include:** White-label tenancy, B2B portal, and the full plugin SDK remain deferred to the infrastructure milestone. The physical-asset fleet expansion beyond the pilot deployment is also deferred; this milestone proves the pattern, the next milestone scales it.

### Milestone 4 — Infrastructure (substrate becomes infrastructure)

**Entry conditions:** Milestone 3 exit criteria all met. The physical-asset pilot has been operating long enough to validate the rent-to-own pattern. At least one full-autonomy co-maintainer is shipping production work. Synapse has scaled to whatever capacity the differentiation and density milestones required.

**Strategic goal:** Make BMC the substrate that other cooperatives run on. White-label tenancy, B2B portal, and physical asset fleet expansion. The plugin SDK and developer ecosystem are now justifiable because real third-party demand has emerged from the differentiation and density milestones.

**Workstreams in scope:** White-label API surface extending `tenancy` with Kong gateway; B2B portal extending `buyer-network` with Vendure B2B starter patterns; merchant support module per `FEATURE_BUILD_PLAN.md` section six; risk and fraud monitoring per section seven; managed onboarding success program per section eight; marketing guidance hub per section nine; academy and training delivery per section ten; website services productization per section eleven; promotional tools suite per section twelve; resource library per section thirteen; full plugin SDK; federated identity economy covering themes, emojis, and badges as governance-recognition products; federation scaling beyond DL360 single-host if scale warrants; expansion of the rent-to-own physical asset fleet to twenty-five to fifty units; cross-coalition settlement clearing on top of `hawala-ledger`.

**Exit criteria — all must be true to declare this milestone complete:** Five hundred to fifteen hundred active coalitions are using the platform. Coalition Credits settlement volume has reached the five million to fifteen million dollar range per measurement period. Five thousand to fifteen thousand vendors are verified and active. Synapse has been migrated to multi-host or remains stable on the consolidated DL360 deployment, depending on the load curve. Twenty-five to fifty physical assets are operating in rent-to-own. Five to fifteen white-label tenants are running their own coalitions on the BMC substrate. Annualized retained revenue has reached the five to fifteen million dollar range. Two-person on-call rotation is active.

**What this milestone deliberately does not include:** This milestone is the projected destination, not a final state. Beyond this milestone, the project becomes substantially different in operational character because the maintainer is no longer the only operator and the platform is no longer a single-tenant deployment. Planning beyond this milestone is deferred until the milestone itself is in sight.

-----

## §6 — Milestone Progression Notes

This section captures the operating logic for moving between milestones, including what to do when progress is slow, what to do when external events accelerate progress, and what to do when a milestone exit criterion proves unachievable.

### §6.1 When progress is slow

The most likely scenario is that the foundation milestone takes substantially longer than initial estimates suggested. The architectural commitments in section two are not small workstreams. The Coalition Credits ledger UX, the entitlements service contract, the vendor-roles revision, and the FBM migration from Railway are each multi-week efforts in absolute terms, and any of them can stretch much longer if dependencies surface or if the maintainer's available focused-development hours are reduced by external commitments.

Slow progress is not a reason to compress scope or skip exit criteria. The foundation milestone exit criteria exist because the substrate does not work end-to-end without all of them. A foundation milestone declared complete with only some criteria met is a fragile foundation, and every subsequent milestone inherits that fragility.

The correct response to slow progress is to maintain the scope and let the milestone take as long as it takes. If progress is slow enough that the maintainer's runway becomes a concern, the secondary response is to evaluate whether co-maintainer onboarding can be accelerated from its differentiation milestone target. Co-maintainer onboarding adds cash expense (per section twelve) but also expands the execution envelope and unlocks workstreams that solo-dev capacity cannot ship in reasonable time.

### §6.2 When external events accelerate progress

The opposite scenario is also possible. A coalition partner with engineering capacity may volunteer to ship a workstream. An external open-source contribution may cover ground that would otherwise be solo-dev work. AI tooling capabilities may improve in ways that materially expand execution leverage. In any of these cases, the milestone progression accelerates without the maintainer needing to do more than accept the help.

The correct response to acceleration is to validate that the accelerated workstream actually meets the exit criteria for its milestone. External contributors and AI tooling can both produce code that ships but does not satisfy the operational requirements of the milestone. The bus-factor work in section seven is the most important guard against this: a workstream that ships without runbooks fails the bus-factor exit criterion regardless of whether the code itself is correct.

### §6.3 When an exit criterion proves unachievable

Some exit criteria may prove harder to achieve than the criterion itself anticipates. The differentiation milestone exit criterion of twenty-five to fifty active coalitions, for example, depends on outreach and partnership work that solo-dev capacity does not strongly support. If coalitions do not adopt the platform at the projected rate, the differentiation milestone cannot complete, and density milestone work cannot begin.

The correct response is to identify the binding constraint and address it rather than to redefine the milestone. If coalition adoption is the binding constraint, the response is to invest in cooperative partnership outreach (which is genuine work, not just marketing), to attend cooperative-economy conferences and events, or to onboard a co-maintainer or external partner whose primary role is coalition-side relationships rather than engineering. The milestone exit criteria exist because they describe what must be true for the substrate to be self-sustaining; revising them downward produces a platform that depends on the maintainer's continued attention rather than on real cooperative adoption.

### §6.4 Honest assessment of capacity over time

Solo-dev capacity is not constant. Periods of high focus and high productivity alternate with periods of administrative work, recovery, illness, or other commitments. The unified guide takes the position that this variance is normal and should be planned around rather than fought against. The milestone progression accommodates wide variance in actual execution velocity precisely because it is not calendar-anchored.

The maintainer should expect that some milestones will feel like they are taking too long. This is normal. The correct response is to continue working through the in-scope workstreams in priority order, to track progress against exit criteria rather than against a calendar target, and to communicate with coalition partners and any co-maintainers in milestone-anchored terms rather than calendar-anchored terms. "We are working toward foundation milestone exit; current blockers are X and Y" is a more honest and more useful status update than "we expect to ship in two months."

-----

## §7 — Bus-Factor Mitigation

The maintainer is the largest non-technical operational risk in the consolidated stack. This section establishes the runbooks, co-maintainer onboarding, and identity hardening that bound the impact of maintainer unavailability.

### §7.1 Existing runbook coverage (Blackout repository)

The Blackout repository already ships substantial runbook coverage that this document references rather than duplicates. The existing runbooks include `docs/runbooks/bot_abuse_spike_playbook.md`, `docs/runbooks/distributed_self_healing_operations.md`, `docs/operations/runbooks/townhall-observability-runbook.md`, `docs/operations/oncall_escalation_tree.md`, `docs/operations/secrets_rotation_break_glass.md`, `docs/operations/operator_onboarding_pack.md`, `infra/single-server-baseline/RUNBOOK.md`, `apps/blackout-server/docs/blackout-ops-runbook.md`, `deploy/docker/production/BRIDGE_OPS_RUNBOOK.md`, and `deploy/docker/production/CLOUDFLARE_TUNNEL_MIGRATION_RUNBOOK.md`.

These remain the authoritative operational documentation for the Blackout layer. New runbooks added by this consolidation extend rather than replace them.

### §7.2 New runbooks required by the consolidation

The consolidation introduces nine new runbooks that ship as part of foundation milestone work. The first six are the original consolidation set; the last three were added with the §5.1 FBM workstreams.

The single-point-of-failure map at `docs/operations/SPOF_MAP.md` inventories the single points of failure across the consolidated stack, including the primary server, Cloudflare Tunnel, Postgres hosting both FBM and Synapse, the secrets manager, and the maintainer. The map is updated whenever a new single point of failure is introduced or an existing one is mitigated.

The co-maintainer onboarding doc at `docs/operations/CO_MAINTAINER_ONBOARDING.md` documents what access to grant in what order with what scope. The doc covers repository read access, deploy access to the primary server, secrets-manager access at appropriate scope, Stripe and Stellar dashboard read access, and the documented "if the maintainer is unavailable" decision tree.

The Railway-to-primary-server migration runbook at `docs/runbooks/FBM_MIGRATION_TO_PRIMARY_SERVER.md` documents the foundation milestone migration of FBM from Railway to the primary DL360 server, including the data migration steps, the DNS cutover, the rollback procedure, and the validation checklist.

The secrets manager migration runbook at `docs/runbooks/SECRETS_MANAGER_MIGRATION.md` documents the consolidation of secrets from their current distributed state into the chosen secrets manager (Vault, Infisical, or SOPS-encrypted directory), including the inventory of existing secrets, the migration steps for each, and the validation that no secret is referenced from multiple sources after migration.

The compat-layer credential recovery runbook at `docs/runbooks/COMPAT_LAYER_CREDENTIAL_RECOVERY.md` documents recovery procedures for linked-account OAuth tokens, widget secrets, and OBS-WS passwords (which are AES-GCM at rest in the Blackout database) in data-loss scenarios.

The deaddrop-appservice runbook at `docs/runbooks/DEADDROP_APPSERVICE.md` documents the operational procedures for the `apps/deaddrop-appservice/` application that ships in the Blackout repository but currently has no operational runbook.

The MXID vendor backfill runbook at `docs/runbooks/MXID_VENDOR_BACKFILL.md` documents how to backfill `seller_metadata.mxid` for existing vendors via the override-CSV / Synapse user-directory / email-localpart-synthesis resolution chain, including pre-flight checks, dry-run, live run, verification queries, and rollback.

The Stellar/USDC bridge runbook at `docs/runbooks/STELLAR_USDC_BRIDGE.md` documents the mainnet config checklist, key rotation SOP, failed-tx triage, liquidity provisioning, deferred multi-sig governance plan, and the structured-log metric counters emitted by the bridge code paths.

The storefront Capacitor embed runbook at `docs/runbooks/STOREFRONT_CAPACITOR_EMBED.md` documents the X-FBM-Embed-Origin handshake, the BLACKOUT_EMBED_ALLOWED_ORIGINS allowlist, the `/api/auth/embed-bootstrap` POST contract, the manual + automated test path, and the JWS-verification deferral.

### §7.3 Identity hardening

Identity hardening for the maintainer ships as part of foundation milestone work. Two-factor authentication is enabled on every external service, including GitHub, Cloudflare, Railway during the migration window, Stellar, Stripe, MinIO admin, and the secrets manager. A hardware key such as YubiKey is the second factor for the GitHub organization owner account. A passphrase manager with emergency-access delegate is the recovery surface. Git identity is properly configured on the primary server through `git config --global user.name` and `user.email`, which is a known outstanding item from previous sessions.

### §7.4 Practice cadence

A periodic bus-factor drill validates that the runbooks cover what they claim to cover. The drill is the test of whether a stranger handed the runbooks and the credentials vault could keep BMC running for thirty days. If the drill fails, the runbooks are revised. The drill cadence is documented at `docs/operations/BUS_FACTOR_DRILL_CADENCE.md`. The drill should occur at least once during the foundation milestone (which is part of the foundation exit criteria) and at least once per subsequent milestone, with the exact cadence determined by operational rhythm rather than by calendar.

-----

## §8 — Daily Operations and AI-Driven Maintenance

The daily operations cadence for a solo maintainer with AI assistance is narrower than the multi-track cadence prescribed by earlier framings. This section documents the realistic cadence and the AI-driven security and dependency update workflow that supports the fork-management posture from section 2.9.

### §8.1 Daily cadence

The daily cadence is built around several hours of deep code work on the largest current-milestone priority, a smaller block of operations and incident handling (checking Synapse and Postgres metrics, triaging the vendor support inbox, reviewing alerts), a smaller block of marketing or content output (one thoughtful piece per day rather than fifty short videos, with outreach to a handful of actual cooperatives rather than a thousand creator-economy DMs), a smaller block of coalition calls or community engagement, and the remainder reserved for buffer, administrative work, and recovery.

The specific hours allocated to each block vary day to day and week to week. The principle is that the maintainer's available focused-development hours go to the largest current-milestone priority first, and everything else is fitted around that. The earlier framing's six-to-ten-hours-of-daily-marketing prescription on top of full development load is rejected as unsustainable.

### §8.2 What gets tracked

The minimum viable instrumentation is one event bus (FBM's Medusa event system feeding ClickHouse) and one dashboard surface (Metabase with the six canonical views from section 2.2). The runbook and SLO dashboards in `docs/operations/dashboards/` covering federation_resilience_dashboard, blackout_module_adoption_dashboard, and townhall-sfu-observability-dashboard remain operational dashboards distinct from the analytics dashboards.

### §8.3 AI-driven security and dependency updates

The fork-management posture from section 2.9 is supported by an AI-driven security and dependency update workflow. The workflow has four steps.

Security advisories from upstream projects (Cinny, Synapse, MedusaJS, MercurJS, the absorbed Fleetbase) are aggregated through a feed at `docs/operations/UPSTREAM_ADVISORIES.md`. The aggregation is automated through a scheduled GitHub Action that pulls from upstream security advisory feeds and writes the results to the markdown file as a tracked artifact.

AI tooling reviews each new advisory against the BMC fork's modifications to determine applicability. The output is one of three classifications: applicable (the affected code path exists in the BMC fork and the advisory's mitigation should be applied), not applicable (the affected code path has been removed or replaced in the BMC fork), or requires human review (the AI tooling cannot make a confident determination).

For applicable advisories, AI tooling produces a candidate patch on a feature branch, with the patch description identifying the upstream advisory and explaining the mitigation. The maintainer reviews the patch and merges it after passing CI.

For requires-human-review advisories, the maintainer reviews the advisory in person and decides applicability. This is the residual human-in-the-loop step that bounds the risk of AI tooling making incorrect classifications.

Dependency updates follow the same workflow. AI tooling proposes updates, classifies them by risk, and the maintainer approves or defers.

The workflow is documented at `docs/operations/AI_SECURITY_WORKFLOW.md` and is the explicit operational answer to the fork-management burden that section 2.9 acknowledges.

-----

## §9 — Master Progress Tracker

The master progress tracker is restructured around the two-layer architecture and the four milestone tiers. The previous four-platform tracker covering FBM, Blackout, and Blackstar has been collapsed into two layers, FBM and Blackout. Blackstar rows are folded into FBM's logistics tracker. Coalition rows are folded into Blackout's spatial layer tracker. Each unbuilt row is tagged with the milestone in which it ships.

### §9.1 FBM tracker

Already-shipping rows (instrument and report on):

|System                                            |Progress|Backing module(s)                                              |
|--------------------------------------------------|--------|---------------------------------------------------------------|
|Vendor verification & KYC                         |0–100%  |`vendor-verification`                                          |
|Marketplace signing                               |0–100%  |`marketplace-signing`                                          |
|Demand pools                                      |0–100%  |`demand-pool`                                                  |
|Collective campaigns                              |0–100%  |`collective-campaign`                                          |
|Bargaining                                        |0–100%  |`bargaining`                                                   |
|Cooperative governance                            |0–100%  |`cooperative`, `governance`                                    |
|Buyer network                                     |0–100%  |`buyer-network`                                                |
|Order cycles                                      |0–100%  |`order-cycle`                                                  |
|Hawala ledger settlements                         |0–100%  |`hawala-ledger`                                                |
|Payout breakdowns                                 |0–100%  |`payout-breakdown`                                             |
|Vendor Hype Operations Prediction                 |0–100%  |`vendor-hype-operations-prediction`                            |
|WooCommerce / Odoo / Printful integrations        |0–100%  |`woocommerce-import`, `odoo`, `printful-fulfillment`           |
|Tenancy / multi-tenant                            |0–100%  |`tenancy`                                                      |
|Volunteer coordination                            |0–100%  |`volunteer`                                                    |
|Impact metrics                                    |0–100%  |`impact-metrics`                                               |
|Content platform                                  |0–100%  |`content-platform`                                             |
|Ticket booking + rental                           |0–100%  |`ticket-booking`, `rental`                                     |
|Producer / garden / season / harvest              |0–100%  |`producer`, `garden`, `season`, `harvest`, `harvest-batches`   |
|Wishlist + donation                               |0–100%  |`wishlist`, `donation`                                         |
|Food distribution + order subcontracting          |0–100%  |`food-distribution`, `order-subcontract`, `supplier-forwarding`|
|Subscription billing                              |0–100%  |`subscription`                                                 |
|Entitlements (FBM-internal)                       |0–100%  |`entitlement`                                                  |
|Creator program & rewards                         |0–100%  |`creator-program`, `creator-rewards`, `creator-attribution`    |
|Marketplace webhooks                              |0–100%  |`marketplace-webhooks`                                         |
|Logistics (formerly Blackstar) — fulfillment hooks|0–100%  |`blackstar-fulfillment`, `blackstar-fulfillment-provider`      |
|Logistics — local delivery                        |0–100%  |`local-delivery-fulfillment`, `delivery`                       |

Foundation milestone unbuilt rows:

|System                                                                        |Progress|Status                                                                   |
|------------------------------------------------------------------------------|--------|-------------------------------------------------------------------------|
|Coalition Credits ledger UX (extends `hawala-ledger`)                         |75–100% |Backend aggregator + economic-standing endpoint + storefront `/user/coalition-credits` + admin dashboard shipped (`53190aa`); Stripe-ACH leg + transfer-to-member UI deferred|
|Stellar/USDC settlement bridge production-ready                               |75–100% |Retry/backoff + dual-rail selector + bridge health + runbook + .env template shipped (`ae5c59e`); mainnet cutover and signer key provisioning remain operator work|
|Entitlements service contract (HTTP exposure, OpenAPI doc)                    |100%    |Shipped: `a1db190` (initial HTTP surface) + `fe4a33f` (governance-roles) + `53190aa` (economic-standing)|
|Vendor-roles revision (Matrix MXID-keyed)                                     |100%    |Shipped (`fe4a33f`): partial-unique mxid column + getGovernanceRoles + role→permission map|
|Existing-vendor migration to MXID-keyed records                               |75–100% |Backfill script + `MXID_VENDOR_BACKFILL.md` runbook shipped (`fe4a33f`); production execution remains operator work|
|Unified retail/marketplace listing presentation                               |75–100% |Selector + retail/marketplace ProductDetailsPage prop + `/shop` retail entry shipped (`ead9e2a`); retail browse styling deferred to differentiation|
|Order Cycles share-box scheduler (extends `order-cycle` + `food-distribution`)|100%    |Shipped (`b5c158d`)                                                       |
|Storefront polish + Capacitor render compatibility                            |75–100% |Embed-context detector + middleware CSP swap + `/api/auth/embed-bootstrap` + `STOREFRONT_CAPACITOR_EMBED.md` shipped (`97bc3e2`); JWS verification awaits Blackout pubkey publication|
|Vendor activation Sprint A (TTFLL ≤ 5 min)                                    |0–100%  |Foundation milestone; partially specced; `FEATURE_BUILD_PLAN.md` Sprint A|
|Cooperative governance proposal flow with Matrix ACL sync                     |0–100%  |Foundation milestone; extends `cooperative` + `governance`               |
|Railway → primary-server migration (FBM)                                      |0–100%  |Foundation milestone critical                                            |

Differentiation milestone unbuilt rows:

|System                                                              |Progress|Status                                                           |
|--------------------------------------------------------------------|--------|-----------------------------------------------------------------|
|Petition feature in `governance` (finances + large issues)          |0–100%  |Differentiation milestone                                        |
|Community garden harvest-to-listing pipeline                        |0–100%  |Differentiation milestone; extends agriculture/garden modules    |
|Vendor activation Sprint B                                          |0–100%  |Differentiation milestone; `FEATURE_BUILD_PLAN.md` Sprint B      |
|Vendor activation Sprint C                                          |0–100%  |Differentiation milestone; `FEATURE_BUILD_PLAN.md` Sprint C      |
|Vendor Hype Operations Prediction Phase A                           |0–100%  |Differentiation milestone; growth launch plan                    |
|Donation rails wired to creator coalitions through Coalition Credits|0–100%  |Differentiation milestone; extends `donation` + Coalition Credits|
|Volunteer coordination for coalition launches                       |0–100%  |Differentiation milestone; extends `volunteer`                   |
|POS / weight pricing / channel sync design specs frozen             |0–100%  |Differentiation milestone; `FEATURE_BUILD_PLAN.md` Phase 0       |

Density milestone unbuilt rows:

|System                                   |Progress|Status                                                        |
|-----------------------------------------|--------|--------------------------------------------------------------|
|POS module                               |0–100%  |Density milestone; `FEATURE_BUILD_PLAN.md` §1                 |
|Weight-based pricing                     |0–100%  |Density milestone; `FEATURE_BUILD_PLAN.md` §2                 |
|Channel sync (`channel-sync`)            |0–100%  |Density milestone; `FEATURE_BUILD_PLAN.md` §3                 |
|Pick-and-pack (`fulfillment-ops`)        |0–100%  |Density milestone; `FEATURE_BUILD_PLAN.md` §4                 |
|Invoicing                                |0–100%  |Density milestone; `FEATURE_BUILD_PLAN.md` §5                 |
|Crop planning v2                         |0–100%  |Density milestone; extends agriculture/garden/season          |
|CSA share-box scheduler v2               |0–100%  |Density milestone; extends `order-cycle` + `food-distribution`|
|Ghost kitchen integration                |0–100%  |Density milestone; extends kitchen/restaurant modules         |
|Physical-asset rent-to-own equity ledger |0–100%  |Density milestone                                             |
|Vendor Hype Operations Prediction Phase B|0–100%  |Density milestone; growth launch plan                         |

Infrastructure milestone unbuilt rows:

|System                                                           |Progress|Status                                                       |
|-----------------------------------------------------------------|--------|-------------------------------------------------------------|
|Merchant support module                                          |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §6         |
|Risk / fraud monitoring                                          |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §7         |
|Managed onboarding success                                       |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §8         |
|Marketing guidance hub                                           |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §9         |
|Academy / workshops                                              |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §10        |
|Website services                                                 |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §11        |
|Promotional tools suite                                          |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §12        |
|Resource library                                                 |0–100%  |Infrastructure milestone; `FEATURE_BUILD_PLAN.md` §13        |
|Advanced analytics warehouse (ClickHouse + Cube + Metabase)      |0–100%  |Foundation cross-cutting; matures in infrastructure milestone|
|B2B portal                                                       |0–100%  |Infrastructure milestone; greenfield on `buyer-network`      |
|White-label API surface                                          |0–100%  |Infrastructure milestone; greenfield on `tenancy` + Kong     |
|Cross-coalition settlement clearing                              |0–100%  |Infrastructure milestone; extends `hawala-ledger`            |
|Plugin SDK                                                       |0–100%  |Infrastructure milestone                                     |
|Federated identity economy (themes/emojis as governance products)|0–100%  |Infrastructure milestone                                     |

### §9.2 Blackout tracker

The Blackout compat-layer rows shipped at commit `ef6ecce` are inventoried in detail in Appendix C and are summarized here for completeness.

Already-shipping rows (instrument and report on):

|System                                                   |Progress|Backing module(s)                                                               |
|---------------------------------------------------------|--------|--------------------------------------------------------------------------------|
|Twitch chat ingress (IRC)                                |0–100%  |`packages/api/src/integrations/twitch/chatIngress.ts`                           |
|YouTube Live chat ingress                                |0–100%  |`packages/api/src/integrations/youtube/{api,chatBridge}.ts`                     |
|Kick chat ingress (Pusher v7)                            |0–100%  |`packages/api/src/integrations/kick/{chatIngress,pusherProtocol}.ts`            |
|Twitch EventSub receiver                                 |0–100%  |`packages/api/src/integrations/twitch/eventSub.ts` + `routes/twitchEventSub.ts` |
|Patreon webhook receiver                                 |0–100%  |`routes/patreonWebhook.ts` + `integrations/patreon/webhookEvents.ts`            |
|Streamlabs donation sync                                 |0–100%  |`services/streamlabsDonationSync.ts` + `services/streamlabsDonationScheduler.ts`|
|Widget alerts SSE pipe (Streamlabs/StreamElements-shaped)|0–100%  |`routes/widgetAlerts.ts` + `services/widgetBus.ts`                              |
|StreamElements OverlayWS compat                          |0–100%  |`integrations/se-overlay-compat/server.ts`                                      |
|Linked accounts (5 OAuth providers)                      |0–100%  |`services/linkedAccounts.ts` + `services/oauthProviders.ts`                     |
|Outbound chat router                                     |0–100%  |`services/outboundMessageRouter.ts`                                             |
|Simulcast destinations CRUD (AES-GCM at rest)            |0–100%  |`services/simulcastDestinations.ts` + migration `014`                           |
|RTMP fan-out worker                                      |0–100%  |`services/rtmpFanoutWorker.ts` + `routes/rtmpFanout.ts`                         |
|Twitch IRC bot shim                                      |0–100%  |`integrations/twitch-compat/ircServer.ts`                                       |
|OBS-WebSocket v5 server                                  |0–100%  |`integrations/obs-ws-compat/server.ts`                                          |
|Stream Deck Companion module package                     |0–100%  |`packages/companion-blackout/*`                                                 |
|Discord-shape inbound webhooks                           |0–100%  |`services/discordCompatWebhooks.ts` + migration `016`                           |
|Discord-shape outbound webhooks (10 event types)         |0–100%  |`services/outboundEventWebhooks.ts` + migration `017`                           |
|Matrix appservice transactions endpoint                  |0–100%  |`routes/matrixAppservice.ts`                                                    |
|Synapse appservice registration YAML stub                |0–100%  |`deploy/matrix-appservice/registration.yaml`                                    |
|Settings UIs (10 panels)                                 |0–100%  |`apps/blackout-client/src/app/features/settings/*`                              |
|Integrations health snapshot                             |0–100%  |`services/integrationsHealth.ts` + `routes/integrationsHealth.ts`               |
|DeepDive room discovery                                  |0–100%  |shipped (`Blackout_App` swipe-to-join)                                          |
|Mobile Capacitor wrapper foundation                      |0–100%  |`blackout-mobile/`                                                              |

Foundation milestone unbuilt rows:

|System                                                       |Progress|Status                                   |
|-------------------------------------------------------------|--------|-----------------------------------------|
|Synapse capacity telemetry (Prometheus + Grafana)            |0–100%  |Foundation milestone critical            |
|Synapse media retention policy                               |0–100%  |Foundation milestone critical            |
|Postgres tuning baseline                                     |0–100%  |Foundation milestone critical            |
|Synapse worker-mode config (documented, not enabled)         |0–100%  |Foundation milestone critical            |
|Coalition Credits balance widget (consumes FBM entitlements) |0–100%  |Foundation milestone critical            |
|Cooperative governance UI with Matrix ACL sync               |0–100%  |Foundation milestone critical            |
|Settings: Appearance + Steganography pages                   |0–100%  |Foundation milestone; in flight          |
|Spatial layer integration (PostGIS + Martin + PMTiles) — base|0–100%  |Foundation milestone (formerly Coalition)|
|FBM commerce flows embedded as Blackout views (mobile-first) |0–100%  |Foundation milestone                     |
|SPOF map                                                     |0–100%  |Foundation milestone                     |
|Co-maintainer onboarding doc                                 |0–100%  |Foundation milestone                     |
|Compat-layer credential recovery runbook                     |0–100%  |Foundation milestone                     |
|`apps/deaddrop-appservice/` runbook                          |0–100%  |Foundation milestone                     |
|Bus-factor drill cadence doc                                 |0–100%  |Foundation milestone                     |

Differentiation milestone and beyond unbuilt rows:

|System                                                                |Progress|Status                                                      |
|----------------------------------------------------------------------|--------|------------------------------------------------------------|
|Spatial layer feature parity (17 heatmap layers + flash mob layer)    |0–100%  |Differentiation milestone (formerly Coalition)              |
|Linked-accounts UX polish (5 OAuth providers)                         |0–100%  |Differentiation milestone                                   |
|Stream Deck Companion module shipped upstream to bitfocus/companion   |0–100%  |Differentiation milestone (upstream-PR-ready per Appendix C)|
|Federation optimization (Postgres I/O if Synapse load curve indicates)|0–100%  |Density milestone                                           |
|Governance-gated paid community channels                              |0–100%  |Density milestone                                           |
|Mobile Capacitor wrapper feature parity with web                      |0–100%  |Density milestone                                           |
|Opt-in AI plugin connectors                                           |0–100%  |Density milestone                                           |
|Plugin SDK                                                            |0–100%  |Infrastructure milestone (now justifiable)                  |
|Federated identity economy products                                   |0–100%  |Infrastructure milestone                                    |

### §9.3 Cross-cutting tracker

|System                                                  |Progress|Status                                      |
|--------------------------------------------------------|--------|--------------------------------------------|
|Secrets manager consolidation (Vault / Infisical / SOPS)|0–100%  |Foundation milestone critical               |
|AI-driven security and dependency update workflow       |0–100%  |Foundation milestone                        |
|Upstream advisories aggregation feed                    |0–100%  |Foundation milestone                        |
|ClickHouse + Cube + Metabase analytics consolidation    |0–100%  |Foundation milestone                        |
|Marketing site (Astro + Tailwind, Foxi fork)            |0–100%  |Differentiation milestone                   |
|Cloudflare Tunnel fallback nginx documented             |0–100%  |Foundation milestone                        |
|Cloudflare Tunnel fallback nginx enabled                |0–100%  |Differentiation milestone                   |
|Postgres streaming replication to secondary server      |0–100%  |Density milestone                           |
|Multi-host Blackout deployment                          |0–100%  |Infrastructure milestone (if scale warrants)|
|Two-person on-call rotation                             |0–100%  |Infrastructure milestone                    |

-----

## §10 — The Strategic Rule

Every workstream must pass the five-constraint filter from section three. The five constraints are the cooperative wedge, solo-dev capacity, operational cost, bus-factor, and wedge-deepening. Two failures defer a workstream to a later milestone. Three or more failures remove it from the plan.

The Blackout-side rider applies, namely that workstreams that strengthen the compatibility layer or strengthen federation resilience also pass the filter, even if they do not directly deepen the cooperative wedge.

A workstream that survives the filter and ships compounds the moat. A workstream that does not survive the filter is either deferred to a later milestone or removed from the plan entirely.

The earlier framing's strategic rule, that every feature must increase monetization, retention, creator earnings, ecosystem lock-in, or infrastructure ownership, is preserved as historical reference but is too generic for the consolidated plan. The five-constraint filter is the operative rule.

-----

## §11 — Open Architectural Decisions

This section names architectural decisions that the consolidation creates but does not resolve. Each decision is bounded by a milestone-anchored window for resolution.

The first open decision is how cooperative governance interacts with platform-level decisions over time. Section 2.7 establishes that coalitions can steer through petitions but the maintainer executes. As the platform scales beyond a single maintainer, the relationship will need to evolve. The decision is deferred to the infrastructure milestone but the entitlements service contract leaves room for it: the contract can answer questions about platform-level governance roles without requiring schema changes.

The second open decision is whether the petition feature should be limited to financial and large-issue decisions or should generalize to any platform-level decision. The differentiation milestone scope is the limited version; the infrastructure milestone may generalize.

The third open decision is the long-term posture toward upstream open-source projects. Section 2.9 commits to maintaining the modified forks rather than tracking upstream. As the modifications stabilize, some BMC-side patches may become candidates for upstreaming back to Cinny, Synapse, MedusaJS, or MercurJS. The Stream Deck Companion module is already on this path as upstream-PR-ready. Other patches may follow. The decision is to evaluate upstreaming opportunistically rather than systematically.

The fourth open decision is whether to expand the BMC fork management to additional upstream projects, for example replacing components currently provided by external dependencies with BMC-managed forks. The default is no; the BMC scope is bounded by the existing five forks unless a strong operational justification emerges.

The fifth open decision is the long-term shape of the rent-to-own equity ledger. The density milestone pilot establishes the operational pattern; the infrastructure milestone expansion to twenty-five to fifty units will surface scaling questions about how equity is distributed, how it is transferred when a member leaves a coalition, and how it interacts with Coalition Credits as a settlement layer.

-----

## §12 — Financial Profile by Milestone

This section translates the milestone progression into financial expectations. The figures below are anchored to milestone exit conditions rather than to calendar periods. Reaching a milestone implies the financial profile described; not reaching a milestone implies remaining at the prior milestone's financial profile.

### §12.1 Foundation milestone financial profile

Revenue at foundation milestone exit is structurally minimal because the foundation exit criteria are operational rather than commercial. Three to five real coalitions transacting through the substrate produce nominal commission revenue, and Coalition Credits has settled at least one non-zero transaction, but neither produces material annualized revenue. The honest expectation is that foundation milestone exit corresponds to revenue measured in hundreds of dollars per month at most, and possibly zero for extended periods if the platform's first real coalitions are using the substrate without yet running material commerce through it.

Operating expenses at the foundation milestone are minimal. Hardware infrastructure is largely sunk cost on the owned DL360. Recurring expenses include colocation power and bandwidth, offsite backup storage, the chosen secrets manager, and minor cloud and external service costs. Total foundation milestone monthly operating expense is in the range of one to two thousand dollars per month.

The maintainer's opportunity cost is the dominant cost throughout the foundation milestone but is not a cash expense. Cash runway through foundation milestone exit is achievable from personal runway or modest external capital; the cumulative cash expense to reach foundation milestone exit is in the range of low five figures depending on milestone duration.

### §12.2 Differentiation milestone financial profile

Revenue at differentiation milestone exit reaches an annualized run rate of approximately nine hundred thousand to two and seven-tenths million dollars based on three percent commission against the differentiation exit Coalition Credits settlement volume range. Vendor verification enrollment fees contribute additional cumulative revenue in the range of twenty thousand to one hundred twenty-five thousand dollars at the differentiation exit vendor count. Order cycles aggregation fees contribute additional run-rate revenue. Float income on Coalition Credits reserves is below one hundred thousand dollars annualized at this milestone and is not yet material.

Operating expenses at the differentiation milestone scale modestly. The marketing site adds infrastructure but minimal recurring cost given the open-source stack. Legal and compliance costs begin to be material as Coalition Credits volume grows, estimated at one to three thousand dollars per month for legal review, accounting services, and tax preparation. Total differentiation milestone monthly operating expense is in the range of two to five thousand dollars per month, before any co-maintainer compensation.

Co-maintainer compensation is the largest discretionary cost decision in the model. The differentiation milestone exit criterion includes one co-maintainer with read access who has demonstrated runbook competence; this does not require full-time compensation. Differentiation milestone work can complete with this arrangement and with the maintainer continuing as the sole full-time operator.

### §12.3 Density milestone financial profile

Revenue at density milestone exit reaches an annualized run rate of approximately nine to twenty-seven million dollars based on three percent commission against the density exit Coalition Credits settlement volume range. The physical-asset pilot contributes operational margin to the platform, estimated at low five figures to low six figures annualized at the density exit pilot scale of two to five units. Float income on Coalition Credits reserves becomes material at this milestone, estimated in the range of one hundred thousand to four hundred thousand dollars annualized depending on actual reserve duration. Vendor verification fees, services marketplace commission, order cycles aggregation fees, and the other layered ecosystem services contribute additional run-rate revenue.

Operating expenses at the density milestone include co-maintainer compensation. The density milestone exit criterion includes one full-autonomy co-maintainer shipping production work, which implies full-time compensation in the range of ten to twenty thousand dollars per month including benefits and equity-equivalent participation. Other operating expenses (legal, compliance, accounting) scale modestly to the three to seven thousand dollars per month range. Total density milestone monthly operating expense is in the range of fifteen to thirty thousand dollars per month.

The physical-asset pilot deploys capital in the range of fifteen to forty thousand dollars at density milestone scope, funded from operating cash flow rather than external capital.

### §12.4 Infrastructure milestone financial profile

Revenue at infrastructure milestone exit reaches the unified guide's annualized retained revenue range of five to fifteen million dollars. Gross revenue before coalition-distributed Coalition Credits rebates, vendor incentive payments, and the cooperative governance commitment to return a portion of margin to participating coalitions is materially higher, estimated in the range of seventy to one hundred eighty-five million dollars annualized. The wide range reflects genuine uncertainty about transaction velocity per coalition, the ratio of Coalition Credits volume to direct fiat commerce, and the pace of physical-asset fleet expansion. The infrastructure milestone retained revenue figure is the more conservative and operationally honest representation; the gross revenue figure represents settlement volume across the ecosystem at this milestone scale.

White-label tenant revenue contributes one hundred forty-four thousand to one and seven-tenths million dollars annualized in platform fees alone, plus metered usage fees that scale with tenant adoption.

The physical-asset rent-to-own fleet at twenty-five to fifty units produces operational margin in the range of seventy thousand to six hundred thousand dollars annualized at the lower bound of unit economics, plus capital recycling on units completing equity transfer. The capital recycling benefit funds further fleet expansion without external financing.

Operating expenses at the infrastructure milestone scale to the range of thirty to seventy-five thousand dollars per month, dominated by co-maintainer compensation (likely two or more co-maintainers at this milestone), legal and compliance costs that may include state-level money transmission considerations if Coalition Credits volume crosses regulatory thresholds, and increased external service costs as USDC custody volume grows and white-label tenant infrastructure scales.

### §12.5 What this financial profile is not

These figures are directional and milestone-anchored. They are not calendar projections. Reaching the infrastructure milestone in a specific calendar period is not implied by anything in this document. The financial profile is what is true when the milestone is reached, regardless of when that occurs.

These figures are also not investment guidance. The wide ranges on each milestone reflect genuine uncertainty about variables that will not be observable until the corresponding milestone is in sight. Specific decisions about external capital, equity-equivalent compensation structures for co-maintainers, regulatory posture on Coalition Credits as a settlement instrument, and tax structuring for the rent-to-own pilot warrant review by qualified legal and financial counsel. The maintainer is not a financial advisor and this document is not financial advice.

The figures should be updated as each milestone is reached, with actual coalition count, settlement volume, and operating cost data substituted for assumptions. Updating this section at each milestone exit is recommended as a milestone exit deliverable.

-----

## Appendix A — FBM Module Inventory and Mapping

This appendix is preserved verbatim from the prior FBM-side document. It maps every workstream that touches FBM to the concrete code path under `backend/src/modules/*` and the spec document, where one exists. Use it as the source of truth when a contributor asks where something lives in the FBM repository.

### Creator economy

|Workstream              |Module path                               |Spec / docs|
|------------------------|------------------------------------------|-----------|
|Creator affiliate system|`backend/src/modules/creator-attribution` |—          |
|Creator program         |`backend/src/modules/creator-program`     |—          |
|Creator rewards         |`backend/src/modules/creator-rewards`     |—          |
|Affiliate links API     |`backend/src/api/vendor/affiliate-links/*`|—          |

### Commerce primitives

|Workstream                 |Module path                                                                             |Spec / docs                                              |
|---------------------------|----------------------------------------------------------------------------------------|---------------------------------------------------------|
|Digital products           |`backend/src/modules/digital-product`, `backend/src/modules/digital-product-fulfillment`|—                                                        |
|Subscription infrastructure|`backend/src/modules/subscription`                                                      |—                                                        |
|Marketplace listings       |`backend/src/modules/marketplace-listing`                                               |`docs/VENDOR_FEATURE_MATRIX.md`                          |
|Entitlements               |`backend/src/modules/entitlement`                                                       |extended in §2.5 (HTTP exposure for Blackout consumption)|
|Wishlist                   |`backend/src/modules/wishlist`                                                          |—                                                        |

### Group commerce / coalition

|Workstream            |Module path                                                                                           |Spec / docs                                           |
|----------------------|------------------------------------------------------------------------------------------------------|------------------------------------------------------|
|Group commerce        |`backend/src/modules/collective-campaign`, `demand-pool`, `bargaining`, `cooperative`, `buyer-network`|`docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md`       |
|Cooperative governance|`backend/src/modules/cooperative`, `backend/src/modules/governance`                                   |extended in §2.7 (petition feature)                   |
|Order cycles          |`backend/src/modules/order-cycle`                                                                     |extended in foundation milestone (share-box scheduler)|
|Volunteer coordination|`backend/src/modules/volunteer`                                                                       |—                                                     |

### Services / events / rentals

|Workstream          |Module path                          |Spec / docs|
|--------------------|-------------------------------------|-----------|
|Services marketplace|`backend/src/modules/service-program`|—          |
|Ticket booking      |`backend/src/modules/ticket-booking` |—          |
|Rentals             |`backend/src/modules/rental`         |—          |

### Settlements / payouts

|Workstream         |Module path                                            |Spec / docs                                                                        |
|-------------------|-------------------------------------------------------|-----------------------------------------------------------------------------------|
|Revenue split rails|`backend/src/modules/payout-breakdown`, `hawala-ledger`|extended in foundation milestone (Coalition Credits ledger UX, Stellar/USDC bridge)|

### Identity / trust

|Workstream               |Module path                              |Spec / docs                                                          |
|-------------------------|-----------------------------------------|---------------------------------------------------------------------|
|Vendor verification & KYC|`backend/src/modules/vendor-verification`|—                                                                    |
|Marketplace signing      |`backend/src/modules/marketplace-signing`|—                                                                    |
|Vendor rules             |`backend/src/modules/vendor-rules`       |revised in §2.1 (Matrix-side governance roles map to FBM permissions)|
|Work verification        |`backend/src/modules/work-verification`  |—                                                                    |

### Agriculture / CSA / food

|Workstream             |Module path                                                                            |Spec / docs                                      |
|-----------------------|---------------------------------------------------------------------------------------|-------------------------------------------------|
|Crop planning          |`backend/src/modules/agriculture`, `garden`, `season`                                  |—                                                |
|Producers / harvests   |`backend/src/modules/producer`, `harvest`, `harvest-batches`                           |—                                                |
|CSA / food distribution|`backend/src/modules/food-distribution`                                                |`backend/src/modules/food-distribution/README.md`|
|Ghost kitchens         |`backend/src/modules/kitchen`, `restaurant`, `order-subcontract`, `supplier-forwarding`|—                                                |

### Omnichannel / integrations

|Workstream          |Module path                               |Spec / docs|
|--------------------|------------------------------------------|-----------|
|WooCommerce sync    |`backend/src/modules/woocommerce-import`  |—          |
|Odoo ERP integration|`backend/src/modules/odoo`                |—          |
|Printful POD        |`backend/src/modules/printful-fulfillment`|—          |
|Webhooks            |`backend/src/modules/marketplace-webhooks`|—          |

### Logistics (formerly Blackstar, now FBM)

|Workstream       |Module path                                                                  |Spec / docs|
|-----------------|-----------------------------------------------------------------------------|-----------|
|Fulfillment hooks|`backend/src/modules/blackstar-fulfillment`, `blackstar-fulfillment-provider`|—          |
|Local delivery   |`backend/src/modules/local-delivery-fulfillment`, `delivery`                 |—          |

### Forecast / impact

|Workstream                       |Module path                                            |Spec / docs                                                                                                     |
|---------------------------------|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
|Vendor Hype Operations Prediction|`backend/src/modules/vendor-hype-operations-prediction`|`docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md` and the full `VENDOR_HYPE_OPERATIONS_PREDICTION_*` series|
|Impact metrics                   |`backend/src/modules/impact-metrics`                   |extended in §2.2 (feeds ClickHouse analytics consolidation)                                                     |

### Platform

|Workstream            |Module path                           |Spec / docs                                                   |
|----------------------|--------------------------------------|--------------------------------------------------------------|
|Tenancy / multi-tenant|`backend/src/modules/tenancy`         |extended in infrastructure milestone (white-label API surface)|
|File / object storage |`backend/src/modules/minio-file`      |—                                                             |
|Email / SMTP / Resend |`backend/src/modules/smtp`, `resend`  |—                                                             |
|CMS blueprint         |`backend/src/modules/cms-blueprint`   |—                                                             |
|Content platform      |`backend/src/modules/content-platform`|—                                                             |

-----

## Appendix B — Open-Source Adoption Map for Unbuilt FBM Workstreams

This appendix is preserved verbatim from the prior FBM-side document. For every unbuilt FBM workstream, this table recommends a primary OSS project to fork, embed, or crib patterns from, plus viable alternates. License is listed; AGPL/SSPL and similar strong-copyleft items are sidecar-only or pattern-only and are never compiled into `backend/src/modules/*` source without legal review.

### Selection principles

Permissive licenses (MIT/Apache/BSD) are preferred over weak-copyleft (LGPL/MPL), which is preferred over strong copyleft (GPL/AGPL). Strong-copyleft items are deployed as sidecar microservices behind an HTTP API or used purely as pattern reference. Active commits in the last ninety days and at least one thousand GitHub stars are baseline criteria, except for small niches such as CSA and agri tools. Projects whose data model can be expressed as a Medusa module are preferred so that the ecosystem ends up with one event bus, one auth model, and one ledger. When two projects tie, the one already adjacent to FBM's stack (Postgres, Node/TS, Redis) is chosen to avoid a polyglot tax.

### Core unbuilt workstreams

|Unbuilt workstream                 |Primary OSS recommendation                                                              |License                                 |Alternates                                                                                                                                                                                                                   |
|-----------------------------------|----------------------------------------------------------------------------------------|----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|POS module                         |uniCenta oPOS (`https://github.com/poin/unicenta-opos`)                                 |GPL-3.0                                 |Odoo POS (already integrated via `odoo` module; LGPL/AGPL); Open Source POS (`https://github.com/opensourcepos/opensourcepos`, MIT); Floreant POS (restaurant-focused, `https://github.com/floreantpos/floreantpos`, MPL-2.0)|
|Weight-based pricing               |OCA `sale_order_variable_quantity` (`https://github.com/OCA/sale-workflow`)             |AGPL-3.0                                |PrestaShop Variable Quantity community modules (OSL-3.0); copy patterns into a Medusa price-calculation workflow                                                                                                             |
|Channel-sync                       |Debezium (`https://github.com/debezium/debezium`) for Postgres CDC + Apache Kafka topics|Apache-2.0                              |Saleor (BSD-3); Vendure (MIT); n8n (Sustainable Use) for connector glue                                                                                                                                                      |
|Pick-and-pack (`fulfillment-ops`)  |OpenBoxes (`https://github.com/openboxes/openboxes`)                                    |Eclipse-1.0                             |ERPNext Stock (GPL-3.0); Tryton stock_inventory (GPL-3.0)                                                                                                                                                                    |
|Invoicing                          |Invoice Ninja (`https://github.com/invoiceninja/invoiceninja`)                          |Elastic-2.0 (review)                    |Crater (AGPL-3.0); Akaunting (GPL-3.0); InvoicePlane (MIT but stagnant)                                                                                                                                                      |
|Merchant support / case management |Chatwoot (`https://github.com/chatwoot/chatwoot`)                                       |MIT                                     |FreeScout (AGPL-3.0); Zammad (AGPL-3.0); UVdesk (MIT)                                                                                                                                                                        |
|Risk / fraud monitoring            |Drools rules engine + MaxMind GeoLite2                                                  |Apache-2.0 / proprietary-redistributable|Apache Flink CEP (Apache-2.0); Stripe Radar webhook events as upstream signal                                                                                                                                                |
|Managed onboarding success         |Plane (`https://github.com/makeplane/plane`)                                            |AGPL-3.0 (review)                       |Focalboard (MIT/Custom); OpenProject (GPL-3.0); Vikunja (AGPL-3.0)                                                                                                                                                           |
|Marketing guidance hub             |Mautic (`https://github.com/mautic/mautic`)                                             |GPL-3.0                                 |listmonk (AGPL-3.0); PostHog (MIT) for funnel guidance                                                                                                                                                                       |
|Academy / training                 |Moodle (`https://github.com/moodle/moodle`)                                             |GPL-3.0                                 |Open edX (AGPL-3.0); Forem (AGPL-3.0); pair with BigBlueButton (LGPL-3.0) for live workshops, or reuse the existing Jitsi in `infrastructure/jitsi/`                                                                         |
|Website services productization    |Plane for project tracking + Penpot for design handoff                                  |AGPL-3.0 / MPL-2.0                      |OpenProject (GPL-3.0); Kanboard (MIT)                                                                                                                                                                                        |
|Promotional tools suite            |Medusa core promotions module — extend, do not replace                                  |MIT                                     |GrowthBook (MIT) for A/B campaign measurement; Saleor promotions patterns (BSD-3)                                                                                                                                            |
|Resource library (e-books/webinars)|Strapi (`https://github.com/strapi/strapi`)                                             |MIT (community edition)                 |Ghost (MIT) for content; Outline (BSL — review); existing Jitsi + BigBlueButton for webinars                                                                                                                                 |
|Vendor activation TTFLL wizard     |react-step-wizard + React Hook Form                                                     |MIT / MIT                               |Reference Saleor Dashboard onboarding flows (BSD-3); Vendure Admin UI wizards (MIT)                                                                                                                                          |
|Advanced analytics warehouse       |ClickHouse + Cube semantic layer + Metabase BI                                          |Apache-2.0 / Apache-2.0 / AGPL-3.0      |Apache Superset (Apache-2.0); PostHog (MIT) for product analytics standalone; DuckDB (MIT) for embedded                                                                                                                      |
|B2B portal                         |Vendure B2B starter (`https://github.com/vendure-ecommerce/vendure`)                    |MIT                                     |Sylius B2B Suite (MIT); Spree (BSD-3); Saleor B2B features (BSD-3); Akeneo PIM (OSL-3.0) for catalog                                                                                                                         |
|White-label API surface            |Kong Gateway (`https://github.com/Kong/kong`)                                           |Apache-2.0                              |KrakenD CE (Apache-2.0); Tyk (MPL-2.0); pair with the existing `tenancy` module for key/tenant binding                                                                                                                       |

### Bonus mappings — workstreams where OSS leverage helps fill gaps in already-built modules

|Workstream                                                |OSS to evaluate                                                            |License                |Notes                                                                                                                        |
|----------------------------------------------------------|---------------------------------------------------------------------------|-----------------------|-----------------------------------------------------------------------------------------------------------------------------|
|CSA systems (`agriculture` + `food-distribution`)         |Open Food Network (`https://github.com/openfoodfoundation/openfoodnetwork`)|AGPL-3.0               |Native CSA share boxes, drop-points, producer billing — closest to FBM's coalition model. Differentiation milestone priority.|
|Crop planning (deepen `agriculture` / `garden` / `season`)|LiteFarm (`https://github.com/LiteFarm/LiteFarm`)                          |GPL-3.0                |Cooperative farm planning + crop rotation; or farmOS (GPL-2.0); or Tania (Apache-2.0, archived but referenceable)            |
|Ghost kitchen ops (extend `kitchen` + `restaurant`)       |Floreant POS for kitchen-side ticketing                                    |MPL-2.0                |Existing `kitchen` module covers orchestration; Floreant fills the FOH/BOH ticket gap                                        |
|Live workshops / community calls                          |Jitsi Meet (already vendored under `infrastructure/jitsi/`)                |Apache-2.0             |Already in-tree; default to Jitsi before reaching for BigBlueButton                                                          |
|Webhook reliability / connector glue                      |n8n                                                                        |Sustainable Use License|Useful for low-code creator → coalition integrations alongside Medusa events                                                 |

-----

## Appendix C — Blackout Compat-Layer Inventory

This appendix is preserved verbatim from the prior Blackout-side document. It mirrors the FBM tracker pattern in Appendix A but for the Blackout repository's multi-platform third-party software compatibility layer. The compat layer is shipped infrastructure and operationally valuable, but it is not the strategic moat per section 1.3. It remains useful as leverage that lets existing communities adopt the cooperative substrate without retooling.

### C.0 — Provenance

The Blackout repository at `Blackmarket-coa/blackout`, branch `claude/multi-platform-extensions-Euc73`, at last update commit `ef6ecce` ("feat(compat): every outbound event also pushes to OBS-WS surfaces"). Test counts at HEAD: 127 backend integration tests + 114 frontend tests across the compat surface, all green. The plan that drove this work is `docs/14-stream-revenue-implementation-plan.md` and the streamer-onboarding plan in `/root/.claude/plans/potential-user-had-this-glowing-toucan.md`.

### C.1 — Shipped commit log (chronological, grouped by epic)

#### Linked accounts foundation

|Commit   |Title                                                                      |
|---------|---------------------------------------------------------------------------|
|`55e66cf`|feat(compat): linked_accounts schema + Twitch OAuth link flow              |
|`baae392`|feat(compat): factor OAuth flow into providerFlow + add Discord and Patreon|
|`391b5c9`|feat(compat): YouTube OAuth + refresh-token rotation + provider registry   |
|`85294ea`|feat(client): linked-accounts Settings section                             |

#### Chat ingress + bridges

|Commit   |Title                                                       |
|---------|------------------------------------------------------------|
|`26a8e0d`|feat(compat): Twitch IRC chat ingress                       |
|`2fafc61`|feat(compat): wire Twitch chat ingress into Matrix den rooms|
|`1901e79`|feat(client): Twitch chat bridges Settings section          |
|`f366785`|feat(compat): YouTube Live chat ingress                     |
|`81bcd27`|feat(client): YouTube chat bridges Settings section         |
|`5b2eb5d`|feat(compat): Kick chat ingress (Pusher v7 WS)              |
|`2030471`|feat(compat): Kick chat bridge service + routes             |
|`471d3ba`|feat(client): Kick chat bridges Settings section            |

#### EventSub + alerts + Patreon + Streamlabs

|Commit                       |Title                                                                               |
|-----------------------------|------------------------------------------------------------------------------------|
|`e0e9d4b`                    |feat(compat): Twitch EventSub webhook receiver + auto-resume bridges at boot        |
|`f9e487b`                    |feat(compat): EventSub subscription manager + Matrix alert forwarding               |
|`271ea88`                    |feat(compat): Streamlabs-shaped widget alerts (SSE)                                 |
|`b4d876d`                    |feat(client): widget-token Settings panel with one-time secret reveal               |
|`8906806`                    |feat(compat): chat-ingress idle-detection + force-reconnect on stale sockets        |
|`87dad47`                    |feat(compat): synthetic test-alert endpoint + UI buttons                            |
|`56cf360`                    |feat(client): OAuth popup callback page replaces paste-back UX                      |
|`bdb2487`                    |feat(compat): Patreon webhook ingress → donation alerts on the same SSE feed        |
|`c970486`                    |feat(compat): Streamlabs as a 5th OAuth provider + donation sync                    |
|`9bd8ca3`                    |feat(compat): persistent sync_cursor on linked_accounts; Streamlabs survives restart|
|`2f9dea5`                    |feat(client): "Sync donations" button on the linked Streamlabs row                  |
|`cf11b4e`                    |feat(compat): Streamlabs donation auto-poll scheduler                               |
|(multi-platform-extensions-2)|feat(compat): StreamElements-shape OverlayWS shim — SE overlays connect unmodified  |

#### Outbound chat back to source platforms

|Commit   |Title                                                                                    |
|---------|-----------------------------------------------------------------------------------------|
|`9056c9a`|feat(compat): Twitch outbound mirror — send chat through the existing bridge WSS         |
|`31c9117`|feat(compat): YouTube outbound mirror — write back into live chat via the same OAuth link|
|`62f3f8b`|feat(compat): outboundMessageRouter — single Matrix-room → platforms entry point         |

#### Simulcast destinations + RTMP fan-out worker

|Commit   |Title                                                                              |
|---------|-----------------------------------------------------------------------------------|
|`1d85e14`|feat(compat): RTMP simulcast destinations — backend (migration + service + routes) |
|`30dd63e`|feat(client): simulcast destinations Settings UI                                   |
|`ed02515`|feat(compat): RTMP fan-out worker                                                  |
|`f731cd5`|feat(client): RTMP fan-out runtime status in the simulcast destinations Settings UI|
|`8f25d1c`|feat(compat): live SSE pipe for RTMP fan-out supervisor status                     |

#### Health + integrations observability

|Commit   |Title                                                                    |
|---------|-------------------------------------------------------------------------|
|`0e96ccc`|feat(compat): integrations health snapshot + Settings observability panel|

#### Discord-shape inbound + outbound webhooks

|Commit   |Title                                                                                            |
|---------|-------------------------------------------------------------------------------------------------|
|`99bb47b`|feat(compat): Discord-shape inbound webhooks                                                     |
|`ed659b9`|feat(client): Discord-shape inbound webhooks Settings section                                    |
|`2e30fac`|feat(compat): outbound Discord-shape event webhooks                                              |
|`6cc9d14`|feat(client): outbound Discord-shape event webhooks Settings section                             |
|`8afe6e6`|feat(compat): outbound webhook secrets at rest; wire tip.captured → tip.created dispatch         |
|`8073cd6`|feat(compat): fan out 4 more event types through outbound webhook pipeline                       |
|`0370e28`|feat(compat): outbound webhooks fan out 5 more event types (subscribe/gift/cheer/raid/streamgoal)|
|`3080465`|feat(compat): wire YouTube SuperChats + Patreon pledges into the outbound webhook pipeline       |

#### Twitch IRC bot shim (Nightbot/StreamElements/Moobot)

|Commit   |Title                                                                                     |
|---------|------------------------------------------------------------------------------------------|
|`c774975`|feat(compat): Twitch IRC bot shim foundations                                             |
|`8fbafba`|feat(compat): live Twitch IRC bot shim — Nightbot/StreamElements/Moobot connect unmodified|
|`a0274f2`|feat(compat): IRC bot shim now spans Twitch + YouTube + Kick on one connection            |
|`5710c42`|feat(compat): IRC shim bot PRIVMSG → real Twitch IRC outbound (Twitch-shape channels only)|

#### OBS-WebSocket v5 server (Stream Deck / Companion / Touch Portal)

|Commit                       |Title                                                                                                                           |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------|
|`bd65c80`                    |feat(compat): live OBS-WebSocket v5 server shim — Stream Deck/Companion/Touch Portal connect unmodified                         |
|`ccf347e`                    |feat(compat): wire OBS-WS request matrix to creator stream lifecycle                                                            |
|`3318bb3`                    |feat(compat): OBS-WS push events — Stream Deck tiles flip live on stream-state changes                                          |
|(multi-platform-extensions-2)|feat(compat): Stream Deck Companion module package — upstream-PR-ready for bitfocus/companion                                   |
|(multi-platform-extensions-2)|feat(compat): OBS-WS SetInputMute / GetInputMute / ToggleInputMute → LiveKit admin mute (hardcoded Mic/Microphone/Desktop Audio)|

#### Matrix appservice listener

|Commit                       |Title                                                                                           |
|-----------------------------|------------------------------------------------------------------------------------------------|
|`bbda88a`                    |feat(compat): wire Blackout-side messages route to the outbound chat router                     |
|`8c0a5a4`                    |feat(compat): Matrix appservice transactions endpoint — fans federation/bridge messages outbound|
|(multi-platform-extensions-2)|feat(compat): Synapse appservice registration YAML stub for ops drop-in                         |

#### Connected-session observability + cross-cutting event push

|Commit   |Title                                                                   |
|---------|------------------------------------------------------------------------|
|`bac8318`|feat(compat): observability — show connected IRC bots in Settings       |
|`fd42b70`|feat(compat): observability — show connected OBS-WS surfaces in Settings|
|`ef6ecce`|feat(compat): every outbound event also pushes to OBS-WS surfaces       |

### C.2 — Source-path cross-reference

#### C.2.1 Workstreams already shipped

|Workstream                               |Backing file path(s)                                                                                                                                                                                                                                       |
|-----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Twitch / YouTube / Kick chat ingress     |`packages/api/src/integrations/{twitch,youtube,kick}/*` + `packages/api/src/services/{twitchChatBridge,youtubeChatBridge,kickChatBridge}.ts` + `packages/api/src/routes/{twitchChatBridges,youtubeChatBridges,kickChatBridges}.ts`                         |
|Twitch IRC chat ingress                  |`packages/api/src/integrations/twitch/{chatIngress,chatBridge,ircParser}.ts`                                                                                                                                                                               |
|YouTube Live chat ingress                |`packages/api/src/integrations/youtube/{api,chatBridge}.ts` + `packages/api/src/services/youtubeChatBridge.ts`                                                                                                                                             |
|Kick chat ingress (Pusher v7)            |`packages/api/src/integrations/kick/{chatIngress,chatBridge,pusherProtocol}.ts`                                                                                                                                                                            |
|Twitch EventSub receiver                 |`packages/api/src/integrations/twitch/eventSub.ts` + `packages/api/src/routes/twitchEventSub.ts` + `packages/api/src/services/twitchEventSubManager.ts`                                                                                                    |
|Patreon webhook receiver                 |`packages/api/src/routes/patreonWebhook.ts` + `packages/api/src/integrations/patreon/webhookEvents.ts`                                                                                                                                                     |
|Streamlabs donation sync                 |`packages/api/src/services/streamlabsDonationSync.ts` + `packages/api/src/services/streamlabsDonationScheduler.ts`                                                                                                                                         |
|Widget alerts SSE pipe                   |`packages/api/src/routes/widgetAlerts.ts` + `packages/api/src/services/widgetBus.ts` + `packages/api/src/services/widgetAlertTokens.ts`                                                                                                                    |
|StreamElements OverlayWS compat          |`packages/api/src/integrations/se-overlay-compat/server.ts` + `packages/api/src/integrations/widgets/seOverlayShape.ts`                                                                                                                                    |
|Linked accounts (5 OAuth providers)      |`packages/api/src/services/linkedAccounts.ts` + `packages/api/src/services/oauthProviders.ts` + `packages/api/src/integrations/_oauth/*`                                                                                                                   |
|Outbound chat router                     |`packages/api/src/services/outboundMessageRouter.ts`                                                                                                                                                                                                       |
|Simulcast destinations CRUD              |`packages/api/src/services/simulcastDestinations.ts` + `packages/api/src/db/migrations/014_*.sql`                                                                                                                                                          |
|RTMP fan-out worker                      |`packages/api/src/services/rtmpFanoutWorker.ts` + `packages/api/src/routes/rtmpFanout.ts`                                                                                                                                                                  |
|RTMP fan-out SSE status pipe             |`packages/api/src/routes/rtmpFanout.ts` (`/stream` route) + `subscribeStatusForUser` in the worker                                                                                                                                                         |
|Twitch IRC bot shim — protocol layer     |`packages/api/src/integrations/twitch-compat/ircServerProtocol.ts`                                                                                                                                                                                         |
|Twitch IRC bot shim — WS server          |`packages/api/src/integrations/twitch-compat/ircServer.ts`                                                                                                                                                                                                 |
|Twitch IRC bot tokens                    |`packages/api/src/services/twitchIrcBotTokens.ts` + `packages/api/src/routes/twitchIrcBotTokens.ts` + `packages/api/src/db/migrations/018_*.sql`                                                                                                           |
|OBS-WebSocket v5 — protocol              |`packages/api/src/integrations/obs-ws-compat/protocol.ts`                                                                                                                                                                                                  |
|OBS-WebSocket v5 — server                |`packages/api/src/integrations/obs-ws-compat/server.ts`                                                                                                                                                                                                    |
|OBS-WS request matrix                    |`dispatchRequest` in `packages/api/src/integrations/obs-ws-compat/protocol.ts` + `defaultStreamCommands` in the server                                                                                                                                     |
|OBS-WS SetInputMute → LiveKit admin mute |`dispatchRequest` cases in `obs-ws-compat/protocol.ts` + `services/livekitAdmin.ts` + `services/voiceRooms.ts`                                                                                                                                             |
|OBS-WS push events                       |`notifyStreamStarted/Ended/notifyBlackoutEvent` in `packages/api/src/integrations/obs-ws-compat/server.ts`                                                                                                                                                 |
|Stream Deck Companion module package     |`packages/companion-blackout/*` (target: bitfocus/companion)                                                                                                                                                                                               |
|OBS-WS passwords (AES-GCM at rest)       |`packages/api/src/services/obsWsPasswords.ts` + `packages/api/src/routes/obsWsPasswords.ts` + `packages/api/src/db/migrations/019_*.sql`                                                                                                                   |
|Discord-shape inbound webhooks           |`packages/api/src/services/discordCompatWebhooks.ts` + `packages/api/src/routes/discordCompatWebhooks.ts` + `packages/api/src/db/migrations/016_*.sql`                                                                                                     |
|Discord-shape outbound webhooks          |`packages/api/src/services/outboundEventWebhooks.ts` + `packages/api/src/routes/outboundEventWebhooks.ts` + `packages/api/src/db/migrations/017_*.sql`                                                                                                     |
|Outbound event sources wired (10 types)  |`packages/api/src/services/{tips,outboundEventWebhooks,streamGoals,youtubeChatBridge,kickChatBridge,twitchChatBridge}.ts` + `packages/api/src/routes/{twitchEventSub,patreonWebhook}.ts` + `packages/api/src/modules/streaming.ts`                         |
|Matrix appservice transactions endpoint  |`packages/api/src/routes/matrixAppservice.ts`                                                                                                                                                                                                              |
|Synapse appservice registration YAML stub|`deploy/matrix-appservice/registration.yaml` + `deploy/matrix-appservice/README.md`                                                                                                                                                                        |
|In-process chat message hub              |`packages/api/src/services/chatMessageHub.ts`                                                                                                                                                                                                              |
|Settings UIs (10 panels)                 |`apps/blackout-client/src/app/features/settings/{simulcast-destinations,kick-chat-bridges,twitch-chat-bridges,youtube-chat-bridges,obs-ws-passwords,twitch-irc-bot-tokens,discord-compat-webhooks,outbound-event-webhooks,widget-alerts,linked-accounts}/*`|
|Integrations health snapshot             |`packages/api/src/services/integrationsHealth.ts` + `packages/api/src/routes/integrationsHealth.ts`                                                                                                                                                        |

#### C.2.2 Workstreams in flight or roadblocked

|Workstream                              |Status             |Reason / next step                                                                                                        |
|----------------------------------------|-------------------|--------------------------------------------------------------------------------------------------------------------------|
|TikTok Live chat ingress                |Roadblocked        |Webcast WS uses protobuf-encoded frames; requires a third-party decoder.                                                  |
|Discord bot gateway shim (Spacebar fork)|Roadblocked        |Requires forking `spacebarchat/spacebarchat` and swapping its persistence to a Matrix adapter. Multi-week-engineer batch. |
|Twitch Extensions iframe shim           |Roadblocked        |Needs proprietary `twitch-ext.min.js` + EBS JWT signing infra + extension-bundle install lifecycle. Requires legal review.|
|Discord Activities Embedded App SDK     |Roadblocked        |Closed Discord SDK; no public path.                                                                                       |
|Hono ≥ 4.13.0 bump                      |Blocked on registry|Internal npm mirror exposes Hono up to `4.12.18` only. Re-attempt once mirror catches up.                                 |

### C.3 — Test inventory

Backend integration test files covering the compat surface, all green at `ef6ecce`:

|File                                                                  |Tests|
|----------------------------------------------------------------------|-----|
|`packages/api/test/matrix-appservice.integration.test.ts`             |7    |
|`packages/api/test/matrix-appservice-registration.integration.test.ts`|7    |
|`packages/api/test/se-overlay-shim-server.integration.test.ts`        |7    |
|`packages/api/test/companion-module-manifest.integration.test.ts`     |7    |
|`packages/api/test/obs-ws-input-mute.integration.test.ts`             |8    |
|`packages/api/test/outbound-message-router.integration.test.ts`       |8    |
|`packages/api/test/rtmp-fanout-worker.integration.test.ts`            |11   |
|`packages/api/test/youtube-chat-bridge.integration.test.ts`           |23   |
|`packages/api/test/patreon-webhook.integration.test.ts`               |14   |
|`packages/api/test/obs-ws-shim-server.integration.test.ts`            |18   |
|`packages/api/test/twitch-irc-shim-server.integration.test.ts`        |12   |
|`packages/api/test/twitch-irc-bot-tokens.integration.test.ts`         |9    |
|`packages/api/test/outbound-event-webhooks.integration.test.ts`       |14   |
|`packages/api/test/discord-compat-webhooks.integration.test.ts`       |5    |
|`packages/api/test/kick-chat-bridge.integration.test.ts`              |6    |

Frontend test files (vitest, all green) live under `apps/blackout-client/tests/unit/features/settings/{simulcast-destinations,kick-chat-bridges,obs-ws-passwords,twitch-irc-bot-tokens,discord-compat-webhooks,outbound-event-webhooks}/*.test.ts`. There are 12 files with approximately 50 cases on the compat-related panels.

Full compat regression command:

```
cd packages/api && pnpm exec tsx --test \
  test/matrix-appservice.integration.test.ts \
  test/outbound-message-router.integration.test.ts \
  test/rtmp-fanout-worker.integration.test.ts \
  test/youtube-chat-bridge.integration.test.ts \
  test/patreon-webhook.integration.test.ts \
  test/obs-ws-shim-server.integration.test.ts \
  test/twitch-irc-shim-server.integration.test.ts \
  test/twitch-irc-bot-tokens.integration.test.ts \
  test/outbound-event-webhooks.integration.test.ts \
  test/discord-compat-webhooks.integration.test.ts \
  test/kick-chat-bridge.integration.test.ts
```

-----

## Appendix D — Changelog vs Prior Versions

This unified document supersedes all prior versions of this operations guide.

### vs. the calendar-anchored versions

The most significant change in this version is the removal of all calendar-based pacing. Earlier versions structured the work as a twenty-four-month execution calendar with month-by-month workstream assignments and time-bounded KPI targets. This version replaces that structure with a milestone progression in which each milestone has explicit entry conditions and exit criteria, but no time bound. The maintainer advances through milestones at whatever pace solo-dev capacity and AI assistance leverage permit. The financial profile in section twelve is similarly milestone-anchored rather than time-anchored.

This change reflects the reality that solo-dev pace is highly variable and that calendar-based pacing produces either overly optimistic plans (which fail when execution is slow) or overly conservative plans (which leave capacity on the table when execution is fast). Milestone-based pacing accommodates both possibilities without requiring revision of the plan itself.

The previous month-by-month FBM module-leverage tables, which were operationally useful as cross-references between calendar items and concrete code paths, have been removed from this version because the milestone progression makes them redundant. The FBM module inventory in Appendix A and the OSS adoption map in Appendix B remain authoritative for "where does this live" and "what should I fork from" questions.

### vs. the FBM `main` version

The FBM document was the original aggressive-growth framing with month-by-month FBM expansion tables. This unified document preserves the FBM module inventory in Appendix A and the open-source adoption map in Appendix B verbatim. The unified document supersedes the FBM document's framing: the cooperative wedge replaces the monetize-attention frame, the four-milestone progression replaces the month-by-month rhythm, and the two-layer architecture replaces the FBM-as-one-of-four-platforms framing. The original Blackstar tables in the FBM document are folded into FBM's logistics module under `blackstar-fulfillment`. The original Blackout sub-blocks in the FBM document covering paid communities, theme system, emoji marketplace, plugin architecture MVP, Discord/Twitch/YouTube bridges, and mobile optimization are partially shipped (the compat layer in Appendix C) and partially deferred to the infrastructure milestone (plugin SDK and themes/emojis as governance products).

### vs. the Blackout `claude/aog-cooperative-wedge-restructure-aliJG` version

The Blackout document was a Blackout-side-only restructure that introduced the cooperative wedge framing while explicitly deferring FBM-side framing and the cooperative-economics moat. This unified document removes that scope limitation. The FBM-as-substrate framing returns, Coalition Credits returns as foundation milestone work now operationally grounded in the `hawala-ledger` extension, and the wedge framing covers both layers. The Blackout document's Appendix C compat-layer inventory is preserved verbatim. The Blackout document's section on Synapse federation risk is preserved with extensions for the absorbed PostGIS spatial workload. The Blackout document's bus-factor section is preserved with new runbooks added to cover the consolidation-specific migrations and credential recovery procedures.

### Net-new content in the unified document

The architectural commitments in section two are net-new content that did not appear in either prior document. They establish the unified identity model with Matrix MXID as canonical identity, FBM as canonical event bus, consolidated secrets management, unified deployment topology, the entitlements service contract, listings as presentation variants, governance steers and maintainer executes, mobile as Blackout, and the fork-management posture with AI-driven security workflow.

The four-milestone progression in section five is net-new sequencing that replaces both the month-by-month calendar from the FBM document and the looser phase descriptions from the Blackout document. The milestone progression notes in section six, including how to handle slow progress, accelerated progress, and unachievable exit criteria, are also net-new.

The financial profile in section twelve is net-new content that reframes the prior aggressive-growth projections as milestone-anchored expectations. The retained revenue range of five to fifteen million dollars annualized at infrastructure milestone exit is substantially below the prior aggressive-growth Year 2 projections of thirty million dollars per month MRR, but reflects the cooperative-wedge frame's narrower revenue base and structurally higher retention.

The open architectural decisions in section eleven name the questions the consolidation creates without resolving.

### Branch and PR strategy

Suggested branch name: `claude/aog-milestone-based-architecture` in both repositories. The unified document is identical in both `Blackmarket-coa/free-black-market` and `Blackmarket-coa/blackout`. The PR descriptions in each repository reference the cross-repository nature of the change and acknowledge that merge order does not matter because the document is identical.

-----
