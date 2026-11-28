# BMC Ecosystem Gaps and App Ownership

> Repository publication: November 28, 2026. This is the November 27 planning register, with repository navigation added below. All gaps remain planned, partial, or unverified as recorded; publishing documentation does not close them. Existing domain constraints, including [FBM's payment boundaries](https://github.com/Blackmarket-coa/free-black-market/blob/main/docs/POSTURE_A_COMPLIANCE.md), Blackmask's independently locked Vault, and Blackstar's non-custodial logistics role, remain authoritative. Regional payment and payroll candidates do not authorize new money movement or announce country support.

## Repository copies and app maps

| App | Shared register | App-specific context |
| --- | --- | --- |
| FBM | [Gap register](https://github.com/Blackmarket-coa/free-black-market/blob/main/docs/BMC_ECOSYSTEM_GAPS_AND_APP_OWNERSHIP.md) | [App map / roadmap](https://github.com/Blackmarket-coa/free-black-market/blob/main/docs/FBM_PRODUCT_STRATEGY.md) |
| Blackout | [Gap register](https://github.com/Blackmarket-coa/blackout/blob/develop/docs/product/BMC_ECOSYSTEM_GAPS_AND_APP_OWNERSHIP.md) | [App map / roadmap](https://github.com/Blackmarket-coa/blackout/blob/develop/docs/features/OVERVIEW.md) |
| Blackmask | [Gap register](https://github.com/Blackmarket-coa/blackmask/blob/main/docs/black-mask/ecosystem-gaps-and-app-ownership.md) | [App map / roadmap](https://github.com/Blackmarket-coa/blackmask/blob/main/docs/black-mask/software-map.md) |
| Forge | [Gap register](https://github.com/Blackmarket-coa/Forge/blob/master/BMC_ECOSYSTEM_GAPS_AND_APP_OWNERSHIP.md) | [App map / roadmap](https://github.com/Blackmarket-coa/Forge/blob/master/SOFTWARE_MAP.md) |
| Blackstar | [Gap register](https://github.com/Blackmarket-coa/Blackstar/blob/main/BMC_ECOSYSTEM_GAPS_AND_APP_OWNERSHIP.md) | [App map / roadmap](https://github.com/Blackmarket-coa/Blackstar/blob/main/ROADMAP.md) |

These copies share gap IDs G01–G10. Update the related copies and app-map references together when ownership or scope changes. The [original planning document](https://chatgpt.com/library?file_id=libfile_c59c3184be0081918bc455e2b7248efd&account_id=personal) retains its creation history.

**Recorded:** November 27, 2026  
**Status:** Planning register and proposed ownership assignments.  
**Scope:** Ten gaps identified by comparing common small-business and organizational software functions with current BMC product maps and the documented FBM inventory.

This register links each gap to its best-suited BMC app. It records existing foundations, remaining work, supporting apps, proposed user entry points, and completion criteria. Assignments describe the target product responsibility; they do not claim implementation, deployment, country support, or competitor feature parity.

## Evidence and status

- **Partial:** Relevant modules, surfaces, or source-backed foundations are documented, but the complete workflow is not established.
- **Not established:** The reviewed documents do not establish a complete capability. This is not proof that no related code exists elsewhere.
- **Proposed:** New scope, surfaces, or implementation work recommended by this register.
- A gap closes only after an authorized user can complete its stated workflow and the relevant operational checks pass. A module name, scaffold, connector framework, or planning entry is insufficient.

## Gap ownership index

| ID | Gap | Best-suited primary app | Supporting apps | Current assessment |
| --- | --- | --- | --- | --- |
| [G01](#g01) | Complete merchant accounting | [FBM](#fbm) | Forge; Blackmask | Partial financial foundations; complete accounting workflow not established |
| [G02](#g02) | Payroll and employee administration | [FBM](#fbm) | Forge; Blackmask | Not established as a complete capability |
| [G03](#g03) | Customer relationships and support workflow | [FBM](#fbm) | Blackmask; Blackout; Forge | Customer/order foundations; connected CRM workflow not established |
| [G04](#g04) | Collaborative office workspace | [Blackmask](#blackmask) | Forge; Blackout; FBM | Proposed expansion; office-suite workflow not established |
| [G05](#g05) | Complete retail point of sale | [FBM](#fbm) | Forge; Blackstar | Partial; devices and offline operation unverified |
| [G06](#g06) | Regional payments and reconciliation | [FBM](#fbm) | Forge; Blackmask | Existing payment architecture; country/provider coverage unverified |
| [G07](#g07) | Country-specific business administration | [FBM](#fbm) | Forge; Blackout; Blackmask; Blackstar | Partial jurisdiction-specific foundations; broader country packs proposed |
| [G08](#g08) | Donor, grant, and nonprofit administration | [FBM](#fbm) | Blackout; Blackmask; Forge | Partial donation/fund/volunteer foundations |
| [G09](#g09) | Offline forms and field data collection | [Blackout — Coalition](#blackout) | Blackmask; Forge; FBM; Blackstar | Coordination foundations; reusable field collection workflow not established |
| [G10](#g10) | Existing-software migration and external business connectors | [Forge](#forge) | FBM; Blackmask; Blackout; Blackstar | Some imports/connectors exist; complete migration and conversation-to-order paths unverified |

Primary ownership means ownership of the user's everyday task and its domain records. Supporting apps supply defined services and integrations. No new standalone BMC app is proposed.

## G01

**Complete merchant accounting — primary app: [FBM](#fbm)**

**Existing foundation:** Documented invoices, receivables aging, payment records, production costing, restricted-fund accounting, financial reports, and ledger modules. These do not by themselves establish a full accounting product for each merchant.

**Remaining scope:** Supplier bills and payables, expense capture, chart of accounts, merchant-level double-entry posting, bank imports/feeds where supported, reconciliation, credit notes, financial statements, period closing, correction history, and scoped accountant access. Reuse existing services where their semantics fit; first determine whether an external accounting adapter is the appropriate first delivery.

**Proposed native entry:** FBM → Business tools → Accounts.

**Support:** Forge configures accounting connections, mappings, imports, and advanced automations. Blackmask protects selected sensitive attachments and access where integrated. Neither becomes a competing financial ledger.

**Completion criteria:** A merchant records a sale, expense, supplier bill, payment, and refund; reconciles against a bank statement; and produces consistent reports and an accountant export. Corrections remain traceable, and platform settlement records reconcile with merchant records.

## G02

**Payroll and employee administration — primary app: [FBM](#fbm)**

**Existing foundation:** Team users, invitations, volunteer records, and work-verification areas. These are not a payroll system.

**Remaining scope:** Employee records, employment roles, timesheets, leave, approvals, pay runs, deductions, payslips, payment export, and jurisdiction-specific payroll integrations. Keep employee wages, contractor payments, volunteer recognition, and seller payouts distinct.

**Proposed native entry:** FBM → Business tools → Team & payroll.

**Support:** Forge connects and configures a supported payroll provider or service. Blackmask handles protected personnel documents and private sharing through explicit boundaries.

**Completion criteria:** An authorized employer approves time, reviews a pay run, generates payslips, records or exports payment, and corrects an error without duplicate payment. Enable payroll calculations only for explicitly supported jurisdictions and versions.

## G03

**Customer relationships and support — primary app: [FBM](#fbm)**

**Existing foundation:** Customers, groups, messages, orders, quotes, referrals, and organizational roles.

**Remaining scope:** Lead capture, contact history, follow-up reminders, sales stages, segmentation, service tickets, assignment, and consent-aware communications. Connect conversations to the appropriate quote, order, booking, or support case.

**Proposed native entry:** FBM → Business tools → Customers.

**Support:** Blackmask supplies private business conversations where supported. Blackout supplies permissioned public campaign and community context. Forge configures external sources and automation.

**Completion criteria:** A permitted inquiry becomes a contact and quote, proceeds to an order or booking, and retains a usable support history. Assignment, follow-up, export, and customer deletion/retention behavior respect organization scope. Community membership never silently becomes marketing consent.

## G04

**Collaborative office workspace — primary app: [Blackmask](#blackmask)**

**Assignment rationale:** Private organizational Spaces and secure records make Blackmask the best fit for everyday private collaboration. This is a proposed expansion of that experience; a Vault is not an office suite.

**Remaining scope:** Shared documents and spreadsheets, collaborative editing, version history, shared calendars, meeting links, and organizational email/inbox integration. Connect an appropriate existing service before considering independent implementation of full document editors or mail hosting.

**Proposed native entry:** Blackmask → Spaces → Workspace.

**Support:** Forge installs/configures supported collaboration services, domains, connectors, and recovery. Blackout remains the place for public/community events and publication. FBM may link or attach approved business documents to its records.

**Completion criteria:** A team edits a shared document or sheet, restores an earlier version, schedules an event, and changes access correctly. State the real encryption/access model of each integrated service. Vault keys and contents remain separately locked; external editing must never silently export decrypted Vault material.

## G05

**Complete retail point of sale — primary app: [FBM](#fbm)**

**Existing foundation:** POS/in-person-order surfaces and stock movement through the inventory service. Prior documentation does not establish native terminal, tap-to-pay, or printer support.

**Remaining scope:** Barcode scanning, supported payment devices, receipts, printers, cash sessions, returns, offline order entry, stock synchronization, and reconciliation. Track offline recording separately from offline card authorization.

**Proposed native entry:** FBM → Sell → Checkout / POS.

**Support:** Forge configures supported devices and connectors. Blackstar handles a delivery requested after a sale through its existing logistics contract.

**Completion criteria:** A supported device completes a sale and return, produces a receipt, updates the shared stock source, and reconciles payment. Reconnection must not duplicate orders or charges; inventory conflicts and failed payments must be visible.

## G06

**Regional payments and reconciliation — primary app: [FBM](#fbm)**

**Existing foundation:** Payment, checkout, refunds, payouts, fee disclosures, and settlement architecture.

**Remaining scope:** A verified country/provider matrix covering merchant eligibility, customer payment methods, currencies, settlement destinations, refunds, disputes, and reconciliation. Candidate integrations from the regional review include WiPay, Paystack, MTN MoMo, Wave Business, Orange Money, Yoco, Mercado Pago, and payment services supporting Pix. These are research candidates, not installed providers or confirmed partnerships.

**Proposed native entry:** FBM → Business settings → Payments, with supported methods presented at checkout.

**Support:** Forge configures scoped provider connections and webhook diagnostics. Blackmask supplies relevant protection and sensitive-record controls without turning the Vault into a general payment-secret store.

**Completion criteria:** Each enabled provider/country combination has validated collection, reconciliation, failure, refund, duplicate-event, and settlement behavior. Show actual cashout availability; a recorded balance does not establish access to funds.

## G07

**Country-specific business administration — primary app: [FBM](#fbm)**

**Existing foundation:** Some jurisdiction-specific features, particularly cottage-food guidance and records. Their existence does not establish wider international business coverage.

**Remaining scope:** Versioned country packs for language, currency formatting, addresses, dates, time zones, invoice numbering/templates, applicable tax calculations, electronic invoicing where supported, and accountant exports. Separate interface translation from financial and administrative support.

**Proposed native entry:** FBM → Business settings → Country & business records.

**Support:** Forge installs/configures versioned packs and connectors. Blackout localizes discovery and events. Blackmask localizes private workflows and records. Blackstar owns its transport eligibility and operational requirements for each supported location.

**Completion criteria:** A published support matrix states the supported business tasks, sources, effective dates, maintainer, and limitations. A test business completes the supported invoice/payment/refund/export journey. Unsupported functions are unavailable or accurately labeled.

**Research scope:** Caribbean countries, North America including relevant Central American markets, West Africa, South Africa, Brazil, and Papua New Guinea. Country selection and launch order require separate validation; this register does not promise simultaneous coverage.

## G08

**Donor, grant, and nonprofit administration — primary app: [FBM](#fbm)**

**Existing foundation:** Donations, restricted funds, volunteer work, aid-network intake/allocation, and impact modules. These should be extended rather than duplicated.

**Remaining scope:** Donor histories, pledges, acknowledgments, campaigns, grant applications, budgets, reporting deadlines, restricted spending, beneficiary-case links, and funder-specific reporting.

**Proposed native entry:** FBM → Organization tools → Funds & supporters.

**Support:** Blackout handles outreach, Coalition projects, and volunteer discovery. Blackmask handles sensitive case files and selected private coordination. Forge configures reporting templates and integrations.

**Completion criteria:** An organization records a pledge or grant, receives funds, allocates permitted spending, tracks related work, and produces a consistent donor/funder report. Public impact summaries exclude private donor and beneficiary details. Define transaction-kind fee treatment explicitly rather than treating every contribution as a retail sale.

## G09

**Offline forms and field data collection — primary app: [Blackout](#blackout), inside Coalition**

**Assignment rationale:** Coalition already owns community projects, needs, tasks, resources, and place-based coordination. Reusable field collection fits those everyday activities. This is distinct from FBM's onboarding survey.

**Remaining scope:** Reusable forms, branching questions, field assignments, offline capture, attachments, validation, consent records, synchronization, review, and exports. Collect location only when needed and expressly authorized.

**Proposed native entry:** Blackout → Coalition → Project or task → Forms & fieldwork.

**Support:** Forge authors advanced form schemas, reusable packs, integrations, and deployment settings. Blackmask protects sensitive datasets and private handling where integrated. FBM receives approved inventory, aid, or fund-related records. Blackstar receives authorized delivery/handoff evidence.

**Completion criteria:** A field worker downloads an assignment, collects permitted data offline, synchronizes safely, resolves a conflict, and submits for review. Repeated synchronization creates no duplicates. Public project reporting is a deliberate redacted projection of the approved data.

## G10

**Existing-software migration and external connectors — primary app: [Forge](#forge)**

**Existing foundation:** Forge's connector/automation direction, FBM import areas, and channel integrations. The reviewed inventory identified Faire as the sole registered channel adapter at that source snapshot; Odoo and WooCommerce use separate import/connection paths. This is not a current production assertion about every integration.

**Remaining scope:** Import/export and mapping for spreadsheets and relevant accounting, commerce, contact, calendar, and messaging systems. Include dry runs, validation reports, duplicate detection, resumable batches, reconciliation, and recovery. Add authorized external business-message ingestion and contact/quote/order linking where technically supported.

**Proposed native entry:** Forge → Connect → Import or connect a service. Relevant apps expose Connected services and task-specific Forge links.

**Support and ownership:** FBM owns imported commerce/accounting/customer records and the everyday conversation-to-quote/order actions. Blackmask owns private communication and protected records within its scope. Blackout owns public content/community records. Blackstar owns transport records. Forge owns connection setup, mappings, migration runs, and diagnostics.

**Completion criteria:** A user previews a representative import, fixes mapping errors, imports without duplicates, resumes after interruption, and verifies record/financial totals. A permitted external inquiry can link to a real quote/order without indiscriminately copying private conversations. Export and rollback behavior state their actual limits.

## App responsibilities and links

## FBM

**Primary gaps:** G01, G02, G03, G05, G06, G07, G08.

FBM owns everyday business and organization administration, commercial records, inventory, orders, financial workflows, and settlement. Payroll and expanded accounting are proposed capabilities or integrations, not verified existing products.

**Planning references:** [FBM app inventory](https://chatgpt.com/library?file_id=libfile_97dd11a377ec81919efc5babf5c73c4b&account_id=personal) and [FBM portal/equipment plan](https://chatgpt.com/library?file_id=libfile_d77ee2824af481918d19d1163e7594a4&account_id=personal).

## Blackmask

**Primary gap:** G04. **Supporting role:** Private conversations, sensitive personnel/customer/case documents, protected sharing, and applicable security controls.

The office-workspace assignment is proposed. Preserve independently locked Vault access and selected-item sharing. A connected editor or mail service must disclose its actual protection model.

**Planning reference:** [BMC software maps — Blackmask ownership and boundaries](https://chatgpt.com/library?file_id=libfile_9372a7f7f95c81918b10b7f7a340a004&account_id=personal).

## Blackout

**Primary gap:** G09, inside Coalition. **Supporting role:** Public engagement, campaigns, communities, events, projects, tasks, and volunteer discovery.

Forms and fieldwork should attach to existing projects and tasks rather than require a new top-level app.

**Planning reference:** [Blackout product strategy](https://chatgpt.com/library?file_id=libfile_03e8a63d2c1c819183e754735d0515ca&account_id=personal).

## Forge

**Primary gap:** G10. **Supporting role:** Advanced configuration, authoring, hosting, imports, connector setup, country packs, device configuration, and automation diagnostics.

Keep ordinary business tasks usable in the relevant app while Forge is closed. Every supported task has a native surface or contextual link, a rechecked permission scope, and a return path.

**Planning reference:** [Forge product map](https://chatgpt.com/library?file_id=libfile_08f6d06b9688819190b3ac74d6666a05&account_id=personal).

## Blackstar

**Supporting role:** G05 delivery after a sale, G07 transport-specific localization/eligibility, G09 authorized handoff evidence, and G10 transport-system connectors.

None of these ten comparison gaps requires Blackstar to become the primary owner of accounting, payroll, office work, or field-survey administration. It retains logistics authority and its existing job/claim/bid/handoff responsibilities. This register does not certify completion of existing logistics integrations.

**Planning reference:** [BMC software maps — logistics ownership](https://chatgpt.com/library?file_id=libfile_9372a7f7f95c81918b10b7f7a340a004&account_id=personal).

## Recommended delivery sequence

This sequence is a recommendation, not a deadline or a commitment to build every capability internally.

1. **Reconcile existing capabilities and complete one daily merchant journey:** G03 + G05 + the existing payment flow. Customer inquiry → quote/order → stock → payment → receipt.
2. **Establish trustworthy accounts and data movement:** G01 + the necessary parts of G10. Reconcile sales, expenses, and settlement; provide accountant export.
3. **Validate one international country/provider combination:** G06 + G07, including migration support from G10. Expand only after the supported journey works.
4. **Complete organizational work:** G08 + G09. Contributions → restricted spending → fieldwork → reviewed impact report.
5. **Expand office and employee tools:** G04 + G02 through suitable integrations first, while preserving native everyday access.

Apply offline/synchronization design early to G05 and G09; deferring it until after online workflows are fixed can require rework.

## Shared completion rules

- Reuse authoritative domain records and existing identity/authorization contracts; avoid a second ledger, competing inventory source, or parallel messaging service.
- Preserve the self-hosted production direction. Decide separately which external services or self-hosted components are suitable for each integration.
- Preserve one-time enhancement ownership and the established applicable flat 3% coalition sale-fee direction after processing fees. Do not introduce subscriptions, new fees, or universal donation/payroll fee rules through this register.
- Keep ordinary tasks native. Advanced technical setup belongs in Forge and links back to the originating resource.
- Verify organization isolation, least-privilege roles, access changes, exports, recovery, duplicate events, and interrupted workflows where applicable.
- For each implemented gap, record the repository/commit, enabled configuration, supported country/device/provider, workflow evidence, remaining limitations, and verification date.
- Evaluate native extension versus integration separately. Naming an external product as a comparison or candidate does not select its code, license, hosted service, or partnership.
- Maintain source-present, planned, deployed, enabled, and verified states separately.

## Source basis

This register builds on the documents read during this session:

1. [BMC Software Maps — November 27, 2026](https://chatgpt.com/library?file_id=libfile_9372a7f7f95c81918b10b7f7a340a004&account_id=personal): domain ownership, native surfaces, Forge handoffs, privacy and commercial boundaries.
2. [FBM Mobile App Inventory and Brainstorm](https://chatgpt.com/library?file_id=libfile_97dd11a377ec81919efc5babf5c73c4b&account_id=personal): documented module index, finance, POS, imports, nonprofit operations, and mobile/offline evidence limits.
3. [FBM Game-First Equipment and Portal Plan](https://chatgpt.com/library?file_id=libfile_d77ee2824af481918d19d1163e7594a4&account_id=personal): unified portal, functional tools, permissions, commercial direction, and Blackstar integration boundaries.
4. [Forge Ecosystem Scope and Migration Plan](https://chatgpt.com/library?file_id=libfile_08f6d06b9688819190b3ac74d6666a05&account_id=personal): authoring, infrastructure, integrations, configuration, and documented readiness limits.
5. [Blackout Product Strategy Additions](https://chatgpt.com/library?file_id=libfile_03e8a63d2c1c819183e754735d0515ca&account_id=personal): Coalition community/project/task model, engagement, and private/public information boundaries.

The preceding regional software review supplied comparison categories. This document adds no new market-share ranking or independently verified vendor integration. No application code, deployment, runtime configuration, pricing, or source repository was changed by creating this register.
