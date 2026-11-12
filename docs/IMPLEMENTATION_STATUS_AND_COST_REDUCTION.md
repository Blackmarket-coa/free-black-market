# Implementation status and cost-reduction inventory

**Updated:** 2026-11-12  
**Scope:** Source inspection and recorded CI evidence; deployment revision, live flags, partner commitments and operational capacity remain unverified. This is not a completed full-platform runtime or security audit.

## Product and pricing decisions

FBM coordinates resource allocation, purchasing, sharing and trade for producers, vendors, operators, organizers and nonprofits. A nationwide network grows through independently operated local nodes. Plates is the initial food pilot, not the limit of the platform.

The [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) remains the product authority. The founder clarified on 2026-11-12:

- **Enhancement features are one-time purchases. No subscription.**
- Software purchases grant the purchased version; future upgrades and optional support must be separately disclosed.
- Existing platform vendor subscriptions and recurring enhancement entitlements are legacy implementation requiring migration, not the approved offering.
- The Coalition sales commission remains flat 3%; purchasing enhancements or gaining KARMA does not change it.
- Payment-processing fees come out first; the remainder is split between the seller and the 3% Coalition commission.
- Actual third-party/hosted usage costs must be separately disclosed at cost, with limits; they must not become a disguised mandatory enhancement subscription.
- E2EE is never paywalled. Gifts, donations, financial programs and regulated flows retain their separate reviewed rules and gates.

A documentation update does not migrate billing, change entitlements, enable flags or establish live availability.

## Evidence and status vocabulary

| Status | Meaning |
| --- | --- |
| Implemented, runtime unverified | Substantive behavior exists in source; the relevant deployed journey was not exercised in this audit. |
| Implemented, default-off | Source exists, but a configuration gate defaults off. Actual deployment settings are unknown. |
| Partial / contract only | Models, UI, validation or some steps exist; the complete promised workflow is not established. |
| Operational dependency | Software can coordinate a service; actual people, assets, contracts, funding or providers are still required. |
| Not established | This review did not establish the capability. This is not proof that no implementation exists anywhere. |

Record built, tested, deployed, enabled and blocked separately. A model, feature flag, passing mocked test, reference manifest or successful build is not a working service by itself.

| Repository | Reviewed branch | Source revision |
| --- | --- | --- |
| free-black-market | main | a449f457aa1102eeb4278f1696455a9a1af584ca |
| blackout | develop | 66523abd9f066a96508832f4731ec387e06846d6 |
| blackmask | main | 3d84b9528b99dbd20f88880b8bac9e0bb4d0c5a4 |

The source heads were unchanged when refreshed on 2026-11-12. No claim here establishes production parity with those heads.

## Commerce, farming, food and B2B

| Problem | Existing solution and source status | Remaining work |
| --- | --- | --- |
| Broker/reseller layers and direct customer access | Marketplace, seller and checkout foundation; implemented, runtime unverified. | Prove order, refund and seller payout in the intended stack; compare full delivered costs. |
| Small orders at retail prices | Demand pools, buyer networks and bargaining groups; substantive implementations. | Supplier commitments, order minimums, deposits/collection rules and a completed group purchase. |
| Suppliers cannot see committed demand | Demand posts, participant commitments, proposals, voting and supplier selection. | Verify the complete buyer/supplier/fulfillment/settlement journey. |
| Production without predictable sales | Order cycles and preorder-related purchasing structures. | Real recurring buyers, cancellation/shortage terms and accurate forecasting. |
| Farm baskets and pickup coordination | Share-box templates, cycle generation and packed/dispatched states. | Packing teams, pickup sites, accessible alternatives and end-to-end verification. |
| Barter | Proposal, acceptance and completion logic. | Customer journey, disputes, settlement and applicable reporting review. |
| Home-food sales records and labels | Cottage-food profiles, declared caps, sale/reversal records, label snapshots and disclosures. | Real producer onboarding and jurisdiction-specific review. The tool does not determine legal eligibility or block sales. |
| Unsustainable producer pricing | Production costing distinguishes cash outlay and economic cost, calculates unit costs and suggested prices; default-off gate. | Enable deliberately and reconcile against real batches and paid labor. |
| Equipment access | Rental availability/cart routes, overlap checks and asset declarations/matching. | Reservation-to-return journey, availability, deposits, damage, insurance and maintenance. |
| Repeated product setup and inefficient methods | Knowledge-base contributions and production records/costing. | Reviewed designs, tested workflows, skills training and quality acceptance. |
| Local small-batch manufacturing and repair | Asset/project matching and service-program building blocks. | Qualified shops, specifications, inspection, warranty and economic comparison with contract production. |
| Unused inputs and avoidable disposal | Mutual-aid matching, aid-network stock/allocation and asset declarations. | Material suitability, traceability, handling, collection and actual receiving capacity. |
| Expensive ingredients, feed, fertilizer and supplies | Group-buy and supplier-discovery infrastructure. | Quality specifications, reliable suppliers, transport and purchasing volume; input production still has costs. |
| Shared kitchens | Kitchen, space, equipment and membership models. | Complete booking/operating journey and real facilities, staffing, insurance and maintenance. |
| Delivery-platform dependence | Food-order, courier assignment, shifts, delivery batches and proof-of-delivery logic. | Drivers, vehicles, insured operations, route density and deployed access-control/fulfillment checks. |
| External marketplace dependence | Channel connector registry implements Faire listing, inventory, order and fulfillment operations. | Validate Faire with credentials; Etsy/TikTok Shop/Amazon are not implemented in this registry. Other imports/content integrations are separate capabilities. |
| Retail POS | Vendor UI and vendor-to-vendor payment-recording checkout; partial retail POS. | Product cart, tender handling, receipts, reconciliation and offline behavior. |
| General pick/pack | Phase 1 POST endpoint validates and echoes the submitted batch; contract only. | Persisted batches, assignments, shortages and completion updates. Share-box packing is separate. |
| General weight pricing | Phase 1 POST endpoint validates and echoes a rule; contract only. | Rule persistence and verified checkout, fulfillment adjustments and payment behavior. |
| B2B invoices and payment terms | Persistent accounts receivable, invoice/payment states, credit exposure and aging; invoicing default-off gate. | Buyer delivery, payment reconciliation, reminders and operational validation. |

Evidence: [demand pools](../backend/src/modules/demand-pool/service.ts), [order cycles](../backend/src/modules/order-cycle/service.ts), [barter](../backend/src/modules/barter/service.ts), [cottage food](../backend/src/modules/cottage-food/README.md), [costing](../backend/src/modules/production-costing/service.ts), [rentals](../backend/src/modules/rental/service.ts), [asset graph](../backend/src/modules/asset-graph/service.ts), [kitchen](../backend/src/modules/kitchen/service.ts), [food distribution](../backend/src/modules/food-distribution/service.ts), [Faire catalog](../backend/src/modules/channel-connector/catalog.ts), [POS checkout](../backend/src/api/vendor/pos/checkout/route.ts), [pick/pack](../backend/src/api/vendor/pick-pack/batches/route.ts), [weight pricing](../backend/src/api/vendor/products/[id]/weight-pricing/route.ts), [accounts receivable](../backend/src/modules/accounts-receivable/service.ts).

## Organizers, nonprofits, marketing and administration

| Problem | Existing solution and source status | Remaining work |
| --- | --- | --- |
| Requests and donations fail to reach useful recipients | Mutual-aid offers, requests, matching, fulfillment, withdrawal and expiration. | Public journey, privacy, notifications and reliable receiving/collection. |
| Organizations cannot coordinate stock | Aid-network intake, allocation suggestions, transfer and receipt logic; default-off gate. | Real partner nodes, stock records, handlers and transfer operations. |
| Restricted funds lack usable records | Fund entries, settlement references, spending checks and reports; default-off gate. | Accounting review, activation and reconciliation with real records. |
| Volunteers and events require duplicated coordination | FBM volunteer records; Blackout tasks, events, RSVPs, slots, signup, withdrawal and ride coordination. | Supervisors, reminders, staffed handoffs and complete deployed organizer journeys. |
| Paying repeatedly to reach an audience | Blackout creator publishing, scheduled content and community/Home distribution. | Actual audiences, opt-in follow-up and measured useful outcomes. No guaranteed reach. |
| Marketing attribution is opaque | FBM links, clicks, promo binding, order attribution, commission states and earnings rollups. | Real campaign validation, abuse controls, refunds and payout verification. |
| Creators/service providers are hard to hire | Bounties and service-program application, contract, delivery, acceptance and dispute logic. | Providers, clear deliverables, funding and verified payment/acceptance. |
| Expensive repeated software subscriptions | Shared open-source modules and integration building blocks. | Complete one-time enhancement pricing migration; funded hosting, support and maintenance. |
| Manual administration and difficult onboarding | Launch wizard, quick path and connected domain records. | Measured signup-to-listing performance; goal-first matching and integrations need journey-level validation. |
| Limited practical knowledge | Knowledge contributions, review states and public pages. | Reviewed content, instructors and effective workshops; a library is not a staffed academy. |
| Disputes lack an accountable process | Persistent order disputes, response/review/resolution and queues. | Staffed support, response expectations and financial-effect verification. |
| Fraud monitoring | Flags/planning exist; complete operational scoring/review was not established. | Trace and test actual detection, review, holds, appeals and loss handling before claiming readiness. |
| Childcare/accessibility blocks participation | Asset-manifest and coordination building blocks. | Actual suitable providers, accessible locations/transport and participation budgets. |
| Professional administration is unaffordable | Invoice, document and fund-record building blocks. | Qualified payroll, bookkeeping, tax, legal and compliance service partners. |
| Community-owned governance and portability | Cooperative/governance and export-related foundations across repositories. | Verify representation, permissions, disputes, export/recovery and accountable operating rules. |

Evidence: [mutual aid](../backend/src/modules/mutual-aid/service.ts), [aid network](../backend/src/modules/aid-network/service.ts), [fund accounting](../backend/src/modules/fund-accounting/service.ts), [creator attribution](../backend/src/modules/creator-attribution/service.ts), [service programs](../backend/src/modules/service-program/service.ts), [knowledge base](../backend/src/modules/knowledge-base/service.ts), [disputes](../backend/src/modules/order-dispute/service.ts), [Blackout coordination](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/packages/api/src/routes/coalition.ts).

## Physical costs and difficult operating expenses

These remain operational dependencies even where models or reference manifests exist.

| Expense/problem | Proposed solution | Still required |
| --- | --- | --- |
| Payroll and skilled labor | Less duplicated administration, shared specialists, training and scheduling. | Sustainable revenue, qualified workers and fair compensation; count donated labor separately. |
| Land and facility costs | Shared use, durable leases, stewardship and suitable cooperative/community ownership. | Sites, due diligence, capital, operators and maintenance reserves. |
| Equipment, vehicles and repairs | Rentals, sharing, preventive maintenance and repair networks. | Actual assets, technicians, coverage and replacement reserves. |
| Warehousing and cold storage | Shared facilities and consolidated inventory. | Staff, temperature monitoring, backup systems and funded operations. |
| Delivery and access without a car | Consolidated routes, pickup hubs and suitable delivery/transit partners. | Order density, drivers, accessibility, insurance and cost-per-stop/trip validation. |
| Health coverage and benefits | Evaluate arrangements through qualified benefits partners. | Providers, plan suitability and ongoing funding; group size does not guarantee savings. |
| Liability/property/vehicle/crop insurance | Risk prevention and coordinated coverage comparison. | Insurers, suitable policies and premiums; coordination does not remove risk. |
| Working capital and borrowing costs | Preorders, purchase commitments, prompt payouts and financing partners. | Refund capacity, underwriting, funded lenders and viable repayment. Working capital is a funding need, not itself an expense. |
| Electricity and fuel | Efficiency, shared use and separately assessed energy projects. | Engineering, providers, installation capital, maintenance and replacement. |
| Water and sewer | Leak reduction, efficient fixtures and appropriate nonpotable reuse. | Qualified trades, site-specific review and infrastructure. |
| Internet and devices | Group offers, shared access, device repair/support. | Providers, backhaul/construction where necessary, devices and ongoing support. |
| Taxes, permits, inspections and compliance | Shared qualified assistance and reusable records/reminders. | Applicable obligations, expertise and payment; software cannot waive them. |
| Organizational continuity | Full-cost reporting, backup providers, reserves and documented handoffs. | Responsible operators, stable funding and tested recovery. |

Measure net savings after replacement costs: paid labor, fees, travel, transport, losses, insurance, maintenance and reserves. Report producer net earnings, organizer time and reliability alongside buyer prices.

## Pricing migration and default-off features

The [vendor-plan catalog](../backend/src/modules/vendor-plan/catalog.ts), [renewal job](../backend/src/jobs/vendor-plan-renewals.ts) and [fee resolver](../backend/src/modules/payout-breakdown/fee-resolution.ts) still implement recurring plans and plan-dependent rates. The catalog includes free 3%, starter 2.5%, pro 2%, scale 1.5%, and an optional monthly all-access 0% plan. They conflict with the current decision.

Required migration: inventory existing assignments and charges; replace recurring enhancement billing with one-time purchases/versioned entitlements; preserve purchased access and export; stop future legacy renewals under a tested migration; reconcile refunds, trials, invoices, schedules, fee quotes, emails and UI; enforce the flat sales rate independently of enhancement ownership. Do not delete historical financial records or silently alter active accounts.

The [feature registry](../backend/src/shared/feature-flags.ts) defaults flags off unless explicitly configured. Relevant gates include POS, weight pricing, pick/pack, invoicing, channel sync, production records/costing, aid network, fund accounting, document vault, nonprofit/shared-goal flows, advances and investments. Processing-first settlement, card-order ledger, digital settlement and ledger-driven payouts have separate gates and dependencies.

Do not enable every flag together. A flag is neither completion evidence nor legal clearance. Deployment revision and effective backend/frontend settings require a separate check; do not put credentials or private configuration values in the report.

## Recorded CI evidence

These are run-specific observations from the 2026-11-11 audit, not a claim about all future builds.

| Repository | Recorded passing evidence | Remaining or failed evidence |
| --- | --- | --- |
| FBM | [CI](https://github.com/Blackmarket-coa/free-black-market/actions/runs/41747287505): unit/integration, money-concurrency soak, builds; [compose Playwright](https://github.com/Blackmarket-coa/free-black-market/actions/runs/41747287484). | Release-validation gate skipped in cited CI. [Filesystem security scan](https://github.com/Blackmarket-coa/free-black-market/actions/runs/43007501199) failed at Trivy; [image workflow](https://github.com/Blackmarket-coa/free-black-market/actions/runs/41747287549) built images but several image scans failed; [load run](https://github.com/Blackmarket-coa/free-black-market/actions/runs/43012725471) failed at scenario step. |
| Blackout | [CI](https://github.com/Blackmarket-coa/blackout/actions/runs/42510040946): API integration, client smoke, navigation, builds and guards. | [Nightly load](https://github.com/Blackmarket-coa/blackout/actions/runs/43014641958) failed installing k6, so no load result was established. Documented operational issues remain. |
| Blackmask | [Tests](https://github.com/Blackmarket-coa/blackmask/actions/runs/41747383072), [browser build](https://github.com/Blackmarket-coa/blackmask/actions/runs/41747383148), [web build](https://github.com/Blackmarket-coa/blackmask/actions/runs/41747383091). | [Lint](https://github.com/Blackmarket-coa/blackmask/actions/runs/41747383090) failed at linter and cargo deny. Actual browser protection/backend validation remains unestablished. |

A green unit test does not supersede the contract-only endpoint findings or prove live money behavior.

## Ecosystem boundaries and release gaps

- **FBM:** economic/resource coordination, commerce, purchasing and records.
- **Blackout:** current communications/community implementation, organizer surfaces and creator distribution. Its [known limitations](https://github.com/Blackmarket-coa/blackout/blob/66523abd9f066a96508832f4731ec387e06846d6/KNOWN_LIMITATIONS.md) document multi-process session/revocation and persistence issues. These were not reproduced or fixed in this documentation pass.
- **Blackmask:** current browser privacy/persona/credential implementation and web vault. Desired comfortable private social interaction remains a product goal; do not claim a separate Discord-replacement implementation from the vault/privacy code. Its [browser checklist](https://github.com/Blackmarket-coa/blackmask/blob/3d84b9528b99dbd20f88880b8bac9e0bb4d0c5a4/docs/black-mask/browser-validation.md) remains open. The 20-domain tracker seed, Firefox-only containers, measurement-only fingerprint reporting and upstream first-install welcome destination limit current claims.
- **Local operators:** actual services, assets, staffing, safety, maintenance and reliable fulfillment. A reference manifest does not establish a functioning tool library, childcare service or delivery cooperative.

## Execution order and closure evidence

1. **Reconcile pricing:** one-time enhancements, no subscriptions, flat commission; inventory existing accounts and test migration.
2. **Verify deployment:** record source/image revision, enabled flags, reachable services and backend/frontend agreement without exposing secrets.
3. **Finish partial workflows:** general pick/pack, weight pricing and retail POS; validate Faire before adding other channel adapters.
4. **Close release blockers:** investigate failing scans/load checks, Blackout operational defects and Blackmask browser/backend/default-install issues.
5. **Complete one local cycle:** Plates + pooled inputs + preorders + shared pickup + creator promotion, with consenting actual participants.
6. **Expand on measured results:** compare full buyer costs, producer net receipts, organizer paid hours, fulfillment and reserves; add assets only against demonstrated demand.

Each closure record needs problem, implementation paths, responsible person/team, environment, flags, reproducible command or journey, result, evidence URL, remaining dependencies and decision. Do not mark a row complete solely because this inventory exists.
