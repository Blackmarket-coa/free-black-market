# Work Order: Free Black Market Platform Build

_Created: 2026-02-23_
_Source: `FEATURE_BUILD_PLAN.md`_
_Status: Active_

This work order translates the Feature Build Plan into an executable, dependency-ordered task list. Each work item has a unique ID, explicit dependencies, acceptance criteria, and the surfaces it touches.

---

## How to Use This Document

- **Status values**: `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`
- **Priority**: P0 (do now), P1 (next), P2 (after P1), P3 (backlog)
- **Dependencies**: Listed by work item ID. A task cannot start until all dependencies are `DONE`.
- **Owner**: Assign when work begins. Leave `—` until then.
- **Surfaces**: `BE` = backend, `VP` = vendor-panel, `AP` = admin-panel, `SF` = storefront, `OPS` = runbooks/docs

---

## Prerequisites (Already Complete)

These items are done and unblock all downstream work:

| ID | Description | Status | Evidence |
|---|---|---|---|
| PRE-1 | Phase 0 domain contracts + JSON schemas | DONE | `docs/contracts/phase0/domain-contracts.schema.json` |
| PRE-2 | ADRs (event-driven sync, idempotency) | DONE | `docs/adr/ADR-0001-*`, `ADR-0002-*` |
| PRE-3 | Feature flag registry | DONE | `backend/src/shared/feature-flags.ts` |
| PRE-4 | Queue topics + DLQ policies | DONE | `backend/src/shared/queue-topics.ts` |
| PRE-5 | Observability baseline + SLO targets | DONE | `docs/observability/PHASE1_SLO_DASHBOARDS.md` |
| PRE-6 | QA remediation (all release gates green) | DONE | `docs/QA_WORK_TRACKER.md` |
| PRE-7 | Open-source enablement package | DONE | CONTRIBUTING, CODE_OF_CONDUCT, CI, labels, governance, funding |
| PRE-8 | Release validation automation | DONE | `scripts/release_validation.sh`, CI gate on `release/*` |

---

## Track 1: Vendor Activation Fast-Track (TTFLL)

### Sprint A — Launch-First Onboarding [P0]

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| WO-A01 | Reduce vendor signup to required fields only (`email`, `password/magic-link`, `store_name`). Remove or defer all non-essential fields (tax, compliance, payout profile). | — | — | VP, BE | NOT STARTED | Signup completes in < 60s with only 3 fields. Non-essential fields moved to post-listing profile completion. |
| WO-A02 | Auto-redirect new vendors into First Listing wizard after signup completion. | — | WO-A01 | VP | NOT STARTED | After signup, vendor lands on wizard Step 1 without manual navigation. Return visitors who haven't published see wizard resume prompt. |
| WO-A03 | Implement wizard Step 1: selling-type selector (`physical`, `digital`, `service`, `event/class`). | — | WO-A02 | VP | NOT STARTED | Vendor selects one type. Selection persists across sessions. Type determines downstream form fields and delivery defaults. |
| WO-A04 | Implement wizard Step 2: minimal product form (title, price, description, one image). | — | WO-A03 | VP, BE | NOT STARTED | Form submits successfully with all 4 fields. Image uploads to MinIO. Product is created in draft state in backend. |
| WO-A05 | Implement wizard Step 3: delivery setup by selling type (simple defaults). | — | WO-A04 | VP, BE | NOT STARTED | Physical: flat-rate or local pickup. Digital: instant download. Service: booking link. Defaults pre-selected; vendor can override. |
| WO-A06 | Implement wizard Step 4: publish screen with celebration state, storefront URL, copy-link CTA, share buttons. | — | WO-A05 | VP | NOT STARTED | Product status changes to `published`. Vendor sees live storefront URL. Copy-link and social share buttons functional. |
| WO-A07 | Add Advanced accordion to Step 2 for optional fields (SKU, variants, SEO, advanced inventory). | — | WO-A04 | VP | NOT STARTED | Accordion is collapsed by default. Expanding reveals optional fields. Fields save correctly but are not required. |
| WO-A08 | Add persistent reassurance copy: "You can edit this anytime." | — | WO-A03 | VP | NOT STARTED | Copy visible on every wizard step. Does not obstruct primary CTA. |
| WO-A09 | Implement wizard autosave + resume support. | — | WO-A03 | VP, BE | NOT STARTED | Partial wizard state persists on tab close / session timeout. Returning vendor resumes at last completed step. |
| WO-A10 | Add step-level analytics events and funnel dashboard. | — | WO-A03 | VP, BE | NOT STARTED | Events fire on step entry, exit, and publish. Dashboard shows conversion funnel with drop-off per step. TTFLL metric computed. |
| WO-A11 | TTFLL measurement pack (ships with Sprint A). | — | WO-A10 | BE, AP | NOT STARTED | Dashboard displays: signup->publish conversion, avg/median TTFLL, per-step drop-off, % with 3+ listings. |

**Sprint A gate review:** All WO-A items DONE + median TTFLL <= 5 min + >= 40% first-session publish rate.

---

### Sprint B — Scale Listing Velocity [P1]

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| WO-B01 | Generic CSV product import with downloadable template and error report. | — | WO-A04 | VP, BE | NOT STARTED | Vendor uploads CSV. System validates, reports errors, creates draft products for valid rows. Template available for download. |
| WO-B02 | Pre-filled listing templates (farm produce, handmade goods, digital download, coaching service). | — | WO-A03 | VP | NOT STARTED | Template selector appears before Step 2. Selecting a template pre-fills relevant form fields. Vendor can override any field. |
| WO-B03 | Launch Assist Mode (concierge intake: website link, photos, description). | — | WO-B01 | VP, BE | NOT STARTED | Vendor submits intake form. System creates draft listing from submitted info. Admin can review/finalize. |
| WO-B04 | Auto-good storefront baseline (default banner, non-empty layout, starter theme at first publish). | — | WO-A06 | SF | NOT STARTED | First-time vendor's store page renders with attractive defaults. No empty-state or broken layout on first visit. |
| WO-B05 | Payout barrier removal (defer payout setup until first sale/threshold). | — | — | BE, VP | NOT STARTED | Vendor can list and publish without completing payout onboarding. System prompts for payout setup when first sale occurs or payout threshold is reached. |

**Sprint B gate review:** All WO-B items DONE + >= 25% drop-off reduction + >= 30% of new vendors publish 3+ in 14 days.

---

### Sprint C — Retention Automation [P1]

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| WO-C01 | 48-hour follow-up automation (Branch A: no listing -> help CTA; Branch B: 1 listing -> nudge for 2 more). | — | WO-A10 | BE | NOT STARTED | Automated emails/notifications fire at 48h mark. Branch selection based on listing count. Open/click tracking enabled. |
| WO-C02 | Dashboard micro-coaching cards tied to activation state. | — | WO-A10 | VP | NOT STARTED | Vendor dashboard shows context-appropriate "next step" card. Cards change based on activation milestones (0 listings, 1 listing, 3+ listings, first sale). |
| WO-C03 | Early-vendor incentives framework (badge, reduced fee window, newsletter highlight, social spotlight). | — | — | BE, VP, SF | NOT STARTED | Incentive toggles configurable by admin. Vendor sees earned badges on dashboard. Fee reduction applies automatically during window. |
| WO-C04 | Movement-first onboarding narrative (mission + earnings copy throughout onboarding). | — | WO-A06 | VP | NOT STARTED | Onboarding flow includes community-mission messaging alongside earnings messaging. Copy reviewed and approved by product owner. |

**Sprint C gate review:** Re-engagement rate improves + email-to-action conversion measurable for both 48h branches.

---

## Track 2: Core Commerce Operations (Phase 1)

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| **POS** | | | | | | |
| WO-P01 | Create `pos` backend module with models: `pos_session`, `pos_device`, `pos_transaction`, `cash_drawer_count`. | — | PRE-3 | BE | NOT STARTED | Module loads. Models migrate. Feature flag `FF_POS_ENABLED` gates access. |
| WO-P02 | Implement POS APIs: open/close session, ring sale, void/refund, end-of-day report. | — | WO-P01 | BE | NOT STARTED | All endpoints return correct responses. Transactions integrate into order pipeline with `sales_channel=POS`. |
| WO-P03 | Implement offline-tolerant cart capture and queued sync. | — | WO-P02 | BE | NOT STARTED | Cart state persists locally when offline. Queued transactions sync when connectivity resumes. No data loss on reconnect. |
| WO-P04 | Build vendor panel POS route (`/pos`) with quick product search, weighted item entry, discount buttons. | — | WO-P02 | VP | NOT STARTED | POS UI is tablet-friendly. Product search returns results in < 500ms. Sale completes in < 20s median. |
| WO-P05 | Printable receipt template + QR order lookup. | — | WO-P02 | VP | NOT STARTED | Receipt prints correctly. QR code links to order detail page. |
| WO-P06 | POS device setup guide and market-day ops checklist. | — | WO-P02 | OPS | NOT STARTED | Documentation covers device pairing, Wi-Fi fallback, end-of-day reconciliation procedure. |
| **Weight Pricing** | | | | | | |
| WO-W01 | Extend product/pricing schema with weight pricing fields (`pricing_mode`, `weight_unit`, `price_per_unit`, `min_weight`, `step_weight`, `average_weight`). | — | PRE-3 | BE | NOT STARTED | Schema migrates. Feature flag `FF_WEIGHT_PRICING_ENABLED` gates access. Existing products unaffected. |
| WO-W02 | Add capture/finalization delta charge workflow for weight products. | — | WO-W01 | BE | NOT STARTED | Checkout captures estimated total. Fulfillment triggers final weight entry. Delta charge/refund issued automatically. |
| WO-W03 | Build vendor product editor for weight pricing rules. | — | WO-W01 | VP | NOT STARTED | Vendor can set pricing mode to `weight`, configure unit/price/min/step. Preview shows sample price calculation. |
| WO-W04 | Build storefront UI for estimated total and post-fulfillment final total. | — | WO-W01 | SF | NOT STARTED | Cart shows "Estimated based on average weight" label. Order confirmation shows final total after fulfillment. |
| WO-W05 | POS support for direct scale/weight input. | — | WO-P04, WO-W01 | VP | NOT STARTED | POS UI allows manual weight entry for weight-priced items. Price calculates automatically. |
| **Channel Sync** | | | | | | |
| WO-S01 | Create `channel-sync` backend module with event bus consumers for order and inventory events. | — | PRE-3, PRE-4 | BE | NOT STARTED | Module loads. Consumers subscribe to order placement/cancellation/return and inventory adjustment topics. |
| WO-S02 | Implement conflict resolution (last-write with version vector + retry queue). | — | WO-S01 | BE | NOT STARTED | Concurrent updates resolve deterministically. Failed syncs retry with exponential backoff. DLQ captures unresolvable conflicts. |
| WO-S03 | Implement channel health state and lag metrics. | — | WO-S01 | BE | NOT STARTED | Per-channel lag metric exposed. Lag exceeding SLO triggers alert. Health endpoint reports channel sync status. |
| WO-S04 | Build vendor/admin sync dashboard with lag, errors, and replay controls. | — | WO-S03 | VP, AP | NOT STARTED | Dashboard shows per-channel lag in real-time. Admin can trigger replay for failed events. Error log is filterable. |
| WO-S05 | Add product-level "channel sync status" indicator. | — | WO-S01 | VP, AP | NOT STARTED | Product list/detail shows sync status badge per channel. Out-of-sync state is visually distinct. |

---

## Track 3: Fulfillment & Financial Operations (Phase 2)

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| **Pick/Pack** | | | | | | |
| WO-F01 | Create `fulfillment-ops` backend module with models: `pick_pack_batch`, `pick_item`, `pack_confirmation`, `substitution_log`. | — | PRE-3 | BE | NOT STARTED | Module loads. Models migrate. |
| WO-F02 | Implement batch APIs: create/assign/complete batches, substitution handling. | — | WO-F01 | BE | NOT STARTED | Batches generated by delivery date/zone/order cycle. Completion updates order fulfillment state. |
| WO-F03 | Build vendor tablet-optimized pick workflow UI. | — | WO-F02 | VP | NOT STARTED | Pick list renders on tablet. Items checkable. Short-pick and substitution flows are accessible. |
| WO-F04 | Implement print/export for pick lists, pack slips, labels (CSV + PDF). | — | WO-F02 | VP | NOT STARTED | PDF renders correctly. CSV download works. Labels include order/item identifiers. |
| **Invoicing** | | | | | | |
| WO-I01 | Create `invoicing` backend module with models: `invoice`, `invoice_line`, `credit_note`, `payment_application`. | — | PRE-3 | BE | NOT STARTED | Module loads. Models migrate. Sequential numbering works. Feature flag `FF_INVOICING_ENABLED` gates access. |
| WO-I02 | Implement invoice lifecycle APIs: create draft, finalize, send, mark paid, issue credit note. | — | WO-I01 | BE | NOT STARTED | Full lifecycle works. PDF rendered. Email dispatched. Hawala/Stripe payment hooks fire. |
| WO-I03 | Build vendor invoice UI: create/send, mark paid, issue credit. | — | WO-I02 | VP | NOT STARTED | Vendor can manage full invoice lifecycle from panel. |
| WO-I04 | Build admin invoice oversight: aging report, search, audit log. | — | WO-I02 | AP | NOT STARTED | Admin sees all invoices. Aging report groups by 30/60/90 day buckets. Audit log shows all state changes. |
| WO-I05 | Build storefront customer invoice history and download. | — | WO-I02 | SF | NOT STARTED | Customer sees invoice list in account. PDF download works. |
| **Merchant Support** | | | | | | |
| WO-M01 | Create `merchant-support` backend module with models: `merchant_case`, `case_note`, `case_tag`, `sla_timer`, `case_event`. | — | — | BE | NOT STARTED | Module loads. Models migrate. |
| WO-M02 | Implement support case APIs: create, update, assign, escalate, resolve. Integrate with Rocket.Chat/email. | — | WO-M01 | BE | NOT STARTED | Cases can be created and progress through lifecycle. Email/chat notifications fire on state changes. SLA timers enforce response deadlines. |
| WO-M03 | Build vendor Support center UI: open case, attach files, track status. | — | WO-M02 | VP | NOT STARTED | Vendor can open support case, add attachments, see status updates in real time. |
| WO-M04 | Build admin support console: queues, assignment, SLA dashboard. | — | WO-M02 | AP | NOT STARTED | Admin sees case queue. Can assign to team members. SLA breach alerts visible. |
| **Fraud Monitoring** | | | | | | |
| WO-R01 | Create `risk` backend module with models: `risk_alert`, decision outcomes. | — | PRE-3 | BE | NOT STARTED | Module loads. Models migrate. Feature flag `FF_FRAUD_MONITORING_ENABLED` gates access. |
| WO-R02 | Implement rules engine: velocity, geo mismatch, unusual amount, repeated payment failure. | — | WO-R01 | BE | NOT STARTED | Rules evaluate on order/payment/account events. Alerts created with severity and evidence payload. |
| WO-R03 | Build admin risk dashboard: approve/hold/reject actions, explainability panel. | — | WO-R02 | AP | NOT STARTED | Admin sees alert queue. Can take action. Decision is recorded in immutable audit log. Explainability shows which rules triggered. |

---

## Track 4: Service Programs & Enablement (Phase 3)

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| WO-E01 | Create `onboarding-success` module (cohorts, tasks, owners, milestones). | — | WO-A06 | BE | NOT STARTED | Module loads. Auto-assigns onboarding plan to new vendors. |
| WO-E02 | Build vendor progress tracker + admin onboarding board. | — | WO-E01 | VP, AP | NOT STARTED | Vendor sees milestone progress. Admin manages workload across onboarding cohorts. |
| WO-E03 | Create `marketing-guidance` module (playbooks, checklists, templates). | — | — | BE | NOT STARTED | Module loads. Playbooks are CRUD-able by admin. |
| WO-E04 | Build vendor Marketing Hub UI. | — | WO-E03 | VP | NOT STARTED | Vendor follows channel-specific checklists. KPI cards display performance proxies. |
| WO-E05 | Create `academy` module (courses, lessons, workshops, certificates). | — | — | BE | NOT STARTED | Module loads. Courses publishable. Workshop events schedulable. Certificates issuable. |
| WO-E06 | Build vendor learning portal + workshop calendar. | — | WO-E05 | VP | NOT STARTED | Vendor browses courses, registers for workshops, tracks completion progress. |
| WO-E07 | Create `website-services` module (packages, brief forms, milestones, handoff). | — | — | BE | NOT STARTED | Module loads. Service requests flow through intake-to-delivery pipeline. |
| WO-E08 | Build vendor website-build request UI + admin project board. | — | WO-E07 | VP, AP | NOT STARTED | Vendor requests website build. Admin tracks project milestones and handoff. |
| WO-E09 | Extend promotions domain with campaign orchestration and audience segments. | — | — | BE | NOT STARTED | Campaigns CRUD-able. Audience segments definable. Attribution fields capture performance data. |
| WO-E10 | Build vendor campaign builder + analytics dashboard. | — | WO-E09 | VP | NOT STARTED | Vendor creates campaign from template. Schedules launch. Reviews performance analytics. |
| WO-E11 | Create `resources` module (assets, categories, downloads, webinar events). | — | — | BE | NOT STARTED | Module loads. E-books uploadable. Webinar events schedulable. Download analytics captured. |
| WO-E12 | Build public resource center + vendor library + webinar registration flow. | — | WO-E11 | SF, VP | NOT STARTED | Public visitors browse resources. Vendors access gated content. Webinar registration and reminders work. |

---

## Track 5: Tech Debt & Hardening (Ongoing)

| ID | Task | Owner | Depends On | Surfaces | Status | Acceptance Criteria |
|---|---|---|---|---|---|---|
| WO-D01 | Burn down admin-panel `lint:strict` violations (weekly batches). | — | — | AP | NOT STARTED | Violation count trends down each sprint. Default `lint` gate stays green. |
| WO-D02 | Resolve vendor-panel full-route typecheck mismatches. | — | — | VP | NOT STARTED | No critical route type mismatches in active release surfaces. |
| WO-D03 | Add static internal-link route validation to QA/release checks. | — | — | SF | NOT STARTED | Automated check detects unmatched hard-coded hrefs before release. |
| WO-D04 | Consolidate docs navigation under `docs/README.md` index. | — | — | OPS | NOT STARTED | Single entry point links to all planning, audit, and operational docs. |
| WO-D05 | Add high-level architecture diagram + per-surface quickstart. | — | — | OPS | NOT STARTED | README or docs includes visual architecture diagram. Each surface has a "get started in 5 commands" section. |
| WO-D06 | Add README badges (build status, license, coverage). | — | — | OPS | NOT STARTED | Badges render correctly and link to CI/license/coverage artifacts. |
| WO-D07 | Expand backend test coverage for new modules (enforce threshold). | — | — | BE | NOT STARTED | Each new module ships with >= 80% statement coverage on service files. CI enforces threshold. |

---

## Dependency Graph (Simplified)

```
PRE-* (all complete)
  │
  ├─► Track 1: TTFLL
  │     WO-A01 → A02 → A03 → A04 → A05 → A06
  │                              │       │       │
  │                              A07     A08     A09, A10 → A11
  │                              │
  │                    WO-B01 → B03
  │                    WO-B02
  │                    WO-B04 (after A06)
  │                    WO-B05 (independent)
  │                              │
  │                    WO-C01, C02 (after A10)
  │                    WO-C03 (independent)
  │                    WO-C04 (after A06)
  │
  ├─► Track 2: Core Commerce (can run in parallel with Track 1)
  │     POS:     WO-P01 → P02 → P03, P04, P05, P06
  │     Weight:  WO-W01 → W02, W03, W04
  │              WO-W05 (after P04 + W01)
  │     Sync:    WO-S01 → S02, S03 → S04, S05
  │
  ├─► Track 3: Fulfillment & Finance (after Track 2 core items)
  │     Pick/Pack:  WO-F01 → F02 → F03, F04
  │     Invoicing:  WO-I01 → I02 → I03, I04, I05
  │     Support:    WO-M01 → M02 → M03, M04
  │     Fraud:      WO-R01 → R02 → R03
  │
  └─► Track 4: Service Programs (after Track 1 Sprint A)
        WO-E01 → E02
        WO-E03 → E04
        WO-E05 → E06
        WO-E07 → E08
        WO-E09 → E10
        WO-E11 → E12

  Track 5: Tech Debt (ongoing, parallel with all tracks)
        WO-D01 through WO-D07 (independent)
```

---

## Summary Statistics

| Track | Total Items | Done | In Progress | Not Started |
|---|---|---|---|---|
| Prerequisites | 8 | 8 | 0 | 0 |
| Track 1: TTFLL (Sprint A) | 11 | 0 | 0 | 11 |
| Track 1: TTFLL (Sprint B) | 5 | 0 | 0 | 5 |
| Track 1: TTFLL (Sprint C) | 4 | 0 | 0 | 4 |
| Track 2: Core Commerce | 15 | 0 | 0 | 15 |
| Track 3: Fulfillment & Finance | 14 | 0 | 0 | 14 |
| Track 4: Service Programs | 12 | 0 | 0 | 12 |
| Track 5: Tech Debt | 7 | 0 | 0 | 7 |
| **Total** | **76** | **8** | **0** | **68** |

---

## Execution Priorities (What to Start Now)

1. **Immediately**: WO-A01 through WO-A11 (TTFLL Sprint A) — this is the P0 business priority.
2. **In parallel**: WO-P01, WO-W01, WO-S01 (Phase 1 backend module scaffolding) — backend engineers can start module creation while frontend focuses on TTFLL wizard.
3. **In parallel**: WO-D01, WO-D02 (tech debt burn-down) — can be done in weekly micro-sprints alongside feature work.
4. **After Sprint A ships**: WO-B01 through WO-B05 (Sprint B) + Phase 1 frontend work.
5. **After Phase 1**: Track 3 items, starting with WO-M01 (merchant support) and WO-I01 (invoicing) as highest-value.

---

## Review Cadence

- **Weekly**: Update status column for all in-progress items. Flag any BLOCKED items.
- **Sprint boundary**: Gate review against exit criteria before advancing to next sprint/phase.
- **Release cut**: Run `scripts/release_validation.sh` and append evidence to `docs/QA_WORK_TRACKER.md`.
