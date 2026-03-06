# Vendor Hype + Operations Funding + Prediction
## Product Specification (Phase A + Phase B)

**References:**
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`

---

## 1) Product Narrative

### 1.1 Problem Statement
Supporters want to help high-impact vendors/organizers, but typical donation pages are static and low-trust. Vendors and organizers need recurring operational funding, transparent reporting, and an engaging loop that keeps supporters returning. The platform also needs to establish prediction-style engagement safely, beginning in a non-cash model.

### 1.2 Phase Intent

#### Phase A (Hype + Donation Foundation)
Build high-trust profile and funding experiences that allow supporters to discover mission-driven profiles, donate to specific operational buckets, and verify how funds are allocated.

#### Phase B (Non-Cash Prediction Mode)
Add points-based prediction participation around measurable milestones. Preserve safety by avoiding cash payouts while introducing market lifecycle transparency, settlement visibility, leaderboards, and rewards.

### 1.3 Personas

#### Supporter
- Goal: discover credible profiles, contribute financially, and participate in meaningful outcomes.
- Needs: trust signals, easy donation flow, clear impact reporting, understandable prediction mechanics.

#### Vendor
- Goal: secure recurring operating support and maintain public credibility.
- Needs: profile control, milestone publication, funding bucket setup, public reputation/operations cards.

#### Organizer
- Goal: coordinate community campaigns and show progress toward targets.
- Needs: event/milestone updates, donor communication, dashboard views for inflows/outflows.

#### Operator (Platform Operations/Admin)
- Goal: manage buckets, disbursements, and market operations safely.
- Needs: approval workflows, audit logs, settlement tooling, anti-abuse monitoring.

#### Compliance Reviewer
- Goal: ensure policy adherence and risk controls.
- Needs: mode gating evidence, monitoring logs, incident visibility, review queues and immutable audit trails.

### 1.4 End-to-End Journeys

#### Journey A: Profile Discovery (Supporter)
1. User lands on Hype Directory.
2. User filters by category, location, impact signal, and active milestones.
3. User opens profile detail page.
4. User reviews trust/reputation card, operational readiness, capital need, and recent wins.
5. User chooses next action: donate, predict (Phase B), or follow/share.

Success outcome: user reaches an intent action in ≤2 clicks from profile detail.

#### Journey B: Donation (Supporter → Operator visibility)
1. User clicks “Donate” from profile page.
2. User selects one-time or recurring donation.
3. User assigns donation to a purpose bucket (Ops Core, Production Inputs, Growth, Reserve-eligible flow as applicable).
4. User confirms payment and receives receipt + allocation expectation.
5. Donation appears in public inflow summary (aggregated) and internal ledger entry (detailed).
6. Operator processes related disbursement via approval controls.
7. Supporter sees updated impact/progress over time on profile operations dashboard.

Success outcome: every donation has a traceable pledge and linked allocation trail.

#### Journey C: Prediction Participation (Phase B, non-cash)
1. User opens profile’s active prediction markets.
2. User reviews event definition, close time, scoring rule, and points payout table.
3. User places points position before market lock.
4. Market transitions to locked/in-progress.
5. Oracle/event outcome is ingested.
6. Settlement job computes points outcomes and publishes result.
7. User sees updated streak, leaderboard rank, and reward unlocks.

Success outcome: complete lifecycle from placement to settlement with transparent result source.

#### Journey D: Settlement Visibility (Supporter + Compliance)
1. User/compliance reviewer opens market settlement detail.
2. Page shows final outcome, timestamp, source/oracle reference, and dispute window state.
3. User sees position-level result and points awarded (no cash value).
4. Compliance reviewer accesses audit log showing settlement trigger, job run ID, and moderation notes.

Success outcome: stakeholders can independently verify how and when results were finalized.

### 1.5 Information Architecture and Route Map

#### Public Storefront
- `/hype` — Hype directory/index
- `/hype/:profileId` — Profile detail (story, trust cards, media, milestones)
- `/hype/:profileId/operations` — Public operations dashboard
- `/hype/:profileId/donate` — Donation checkout
- `/hype/:profileId/predictions` — Active/completed non-cash markets (Phase B)
- `/predictions/:marketId` — Market detail and participation
- `/predictions/:marketId/settlement` — Settlement detail and outcome evidence
- `/me/support` — User activity (donations, positions, rewards, receipts)

#### Vendor/Organizer Panel
- `/panel/profiles/:profileId/edit` — Profile management
- `/panel/profiles/:profileId/milestones` — Milestone/event management
- `/panel/profiles/:profileId/buckets` — Funding bucket configuration
- `/panel/predictions` — Market templates and submissions

#### Operator/Admin
- `/admin/ops/ledger` — Ledger + disbursement queue
- `/admin/ops/disbursements/:id` — Approval workflow
- `/admin/predictions/markets` — Market operations and status controls
- `/admin/predictions/settlements` — Settlement pipeline monitor
- `/admin/compliance/flags` — Compliance and abuse review queue

#### Compliance Reviewer Views
- `/admin/compliance/policy-evidence` — Control evidence dashboard
- `/admin/compliance/markets/:marketId/audit` — Market + settlement audit trail
- `/admin/compliance/users/:userId/events` — Safety and enforcement events

### 1.6 KPI Tree (Leading and Lagging)

#### North-Star (Phase A+B)
**Trusted Support Participation Rate** = % of active supporters who complete at least one meaningful action/week (donation, prediction participation, follow/share) on an eligible profile.

#### Engagement Branch
- Leading:
  - Profile CTR from directory
  - Profile-to-action conversion (donate/predict/follow)
  - Prediction placement completion rate
  - Session depth on profile and operations pages
- Lagging:
  - Weekly active supporters
  - 30-day returning supporters
  - Average actions per supporter per month

#### Funding Branch
- Leading:
  - Donation checkout start rate
  - Donation checkout completion rate
  - Recurring opt-in rate
  - Bucket selection confidence (low abandonment on bucket step)
- Lagging:
  - Gross donation volume
  - Recurring retention (30/60/90 day)
  - Ops coverage ratio (covered costs / required costs)

#### Trust & Transparency Branch
- Leading:
  - Settlement detail page views after resolution
  - % donations with visible allocation updates within SLA
  - % markets with full settlement metadata published
- Lagging:
  - Donation dispute rate
  - Settlement dispute rate
  - % funds with auditable allocation trails

#### Safety & Integrity Branch
- Leading:
  - Flag rate per 1K prediction actions
  - Time to moderation action
  - % users hitting safety prompts/limits
- Lagging:
  - Compliance incident rate
  - Confirmed abuse/manipulation rate
  - Repeat offender rate

### 1.7 Explicit Non-Goals (Phase A+B)
- No real-money wagering or cash payout mechanics.
- No jurisdictional cash prediction enablement (reserved for Phase C).
- No investment-position conversion flows (reserved for Phase D).
- No fully automated disbursement without operator approval.
- No advanced algorithmic recommendation/personalization engine beyond basic ranking/filtering.

---

## 2) User Stories

### 2.1 Supporter Stories
- As a supporter, I want to discover credible profiles by impact and trust signals so I can decide where to contribute.
- As a supporter, I want to donate to a specific operational bucket so my support maps to intended use.
- As a supporter, I want recurring donations so I can provide ongoing support without repeated checkout.
- As a supporter, I want to place non-cash prediction positions so I can engage with milestones in a game-like format.
- As a supporter, I want to see settlement evidence and my position outcomes so I trust fairness.

### 2.2 Vendor Stories
- As a vendor, I want to publish profile media, milestones, and trust indicators so supporters understand my readiness and impact.
- As a vendor, I want configurable funding buckets so supporters can fund specific operational needs.
- As a vendor, I want public operations summaries so transparency improves credibility and conversion.

### 2.3 Organizer Stories
- As an organizer, I want to post measurable event targets so supporters can track progress and participate in predictions.
- As an organizer, I want dashboard insights on inflows and outflows so I can improve campaign execution.

### 2.4 Operator Stories
- As an operator, I want donation and disbursement audit trails so I can verify fund integrity.
- As an operator, I want market lifecycle controls and settlement monitoring so outcomes are timely and accurate.
- As an operator, I want moderation and anti-abuse logs so risk can be contained quickly.

### 2.5 Compliance Reviewer Stories
- As a compliance reviewer, I want immutable logs for donation allocations and settlements so I can evidence controls.
- As a compliance reviewer, I want structured review queues for flags and incidents so policy enforcement is consistent.

---

## 3) UX Requirements

### 3.1 Discovery UX
- Directory must support search, filter, and sort by trust score, funding need, and active milestones.
- Profile cards must display: mission summary, trust/reputation score, operational readiness, capital need, recent wins.
- Empty-state guidance must suggest featured profiles and explain trust scoring inputs.

### 3.2 Donation UX
- Checkout sequence: amount → frequency (one-time/recurring) → bucket selection → payment confirmation.
- Bucket descriptions must be plain-language and show recent usage examples.
- Confirmation screen must include receipt ID, bucket, amount, and “where this appears” transparency note.
- Accessibility: form fields keyboard navigable, error summaries announced to screen readers.

### 3.3 Prediction UX (Phase B)
- Market cards must show close time, event rule, settlement source, points payout range, and status.
- Placement flow must include explicit “non-cash points mode” disclosure before confirm.
- Settlement page must display outcome source, timestamp, dispute window status, and user result.
- Leaderboard and streak widgets must explain how scores are calculated.

### 3.4 Operations Transparency UX
- Public dashboard shows aggregated inflow/outflow by category and milestone progress timeline.
- Internal/operator view includes detailed ledger rows and approval actions.
- Delayed updates must show freshness timestamp and “last updated” label.

### 3.5 Safety UX
- Harm-minimization nudges shown for rapid repeated prediction actions.
- User controls include notification preferences and optional cooldown on participation.
- Moderation outcomes are reflected with clear user-facing messaging where applicable.

---

## 4) Functional Requirements

### 4.1 Domain Entities (Phase A+B)
- `HypeProfile`
- `OpsFundingBucket`
- `DonationPledge`
- `PredictionMarket` (non-cash mode only in Phase B)
- `PredictionPosition`
- `PredictionSettlement`
- `OpsAllocationRule`
- `OpsDisbursement`
- `ComplianceFlag`

### 4.2 Phase A Functional Scope

#### Profiles + Operations
- System shall provide list and detail APIs for hype profiles.
- System shall publish public operations summaries by profile (inflow/outflow aggregates).
- System shall allow vendors/organizers to manage profile content and milestones through authenticated panel routes.

#### Donation Rails
- System shall accept one-time and recurring donation pledges.
- System shall require each donation to map to a defined ops funding bucket.
- System shall create ledger-linked records for donation creation, payment confirmation, and allocation update.
- System shall provide supporter-facing donation receipts and history.

#### Allocation + Disbursement
- System shall enforce deterministic allocation priority (reserve minimum → operational critical costs → campaign-linked commitments → discretionary growth).
- System shall require operator approval before disbursement execution.
- System shall log all approval/rejection actions with actor identity and timestamp.

### 4.3 Phase B Functional Scope

#### Market Lifecycle (Non-Cash)
- System shall support market states: draft, open, locked, in_review, settled, voided.
- System shall permit position placement only while market state is `open`.
- System shall prevent edits to market rule fields after lock.

#### Settlement
- System shall ingest outcome events from approved source(s) and persist source reference metadata.
- System shall execute deterministic settlement logic and assign points outcomes.
- System shall expose settlement details and user-level results.
- System shall support dispute flag creation during configured dispute window.

#### Rewards + Engagement
- System shall compute streaks/leaderboard rank from settled outcomes only.
- System shall issue non-cash rewards/badges based on configurable thresholds.

#### Abuse + Compliance Controls
- System shall log suspicious activity markers (rapid placements, coordinated patterns, repeated disputes).
- System shall provide moderation queue for flagged markets/users/actions.
- System shall generate exportable audit records for compliance review.

### 4.4 Analytics Instrumentation
- Track profile impression, profile detail view, donate CTA click, donation step progression, donation complete.
- Track market view, rules expanded, placement started/completed, settlement viewed.
- Track safety prompts displayed and user response.
- Include profileId, marketId, bucketId, user role, and timestamp in event schema (with privacy-safe handling).

---

## 5) Non-Functional Requirements

### 5.1 Security and Data Integrity
- All donation, allocation, disbursement, and settlement writes must be idempotent by request key.
- Audit log entries must be immutable and append-only.
- Role-based access control must separate supporter, vendor/organizer, operator, and compliance reviewer permissions.

### 5.2 Performance
- Directory and profile detail pages: p95 server response ≤ 400ms under target load.
- Donation checkout API actions: p95 ≤ 600ms (excluding payment processor latency).
- Prediction placement API: p95 ≤ 500ms for open markets.

### 5.3 Reliability
- Donation receipt generation success rate ≥ 99.9% monthly.
- Settlement job success rate ≥ 99.5% monthly for non-voided markets.
- Recovery procedures must support replay of settlement events without double-awarding points.

### 5.4 Observability
- All critical workflows emit structured logs, metrics, and trace IDs.
- Alerting thresholds for failed donations, failed settlements, and disbursement queue backlog must be defined before launch.

### 5.5 Compliance and Safety
- Non-cash mode disclosure must be displayed at market participation point.
- Age-gate and jurisdiction policy checks must run before prediction placement (even in non-cash mode where required by policy).
- Data retention for financial and settlement audit records must meet policy baseline and support export.

### 5.6 Accessibility and Localization Readiness
- WCAG 2.1 AA compliance for core supporter journeys (discover, donate, predict, settlement view).
- UI copy architecture must support localization keying for future multi-language rollout.

---

## 6) Acceptance Criteria

### 6.1 Phase A Acceptance Criteria

#### A1 — Profile Discovery
- Given at least 20 published profiles, when a supporter visits `/hype`, then search and filter return results within 1 second p95 and preserve selected filters on pagination.
- Given a profile card click, when supporter opens `/hype/:profileId`, then trust/reputation, operational readiness, capital need, and recent wins sections are visible.

#### A2 — Donation Flow
- Given supporter starts donation at `/hype/:profileId/donate`, when they complete amount, frequency, and bucket steps, then system creates a `DonationPledge` and displays a receipt ID.
- Given recurring donation selection, when payment method authorization succeeds, then recurrence schedule is visible in supporter history.
- Given donation completion, when public dashboard is refreshed, then aggregated inflow includes donation value within defined reporting SLA.

#### A3 — Allocation and Disbursement Integrity
- Given a new donation enters allocation engine, when allocation executes, then resulting split follows configured priority order and is persisted with audit event IDs.
- Given a pending disbursement, when operator rejects it, then payout is not executed and rejection reason is retained in audit log.

### 6.2 Phase B Acceptance Criteria

#### B1 — Prediction Placement (Non-Cash)
- Given market state is `open`, when supporter confirms a position, then a `PredictionPosition` is recorded with points stake and timestamp.
- Given market is `locked` or later, when supporter attempts placement, then API returns a non-success response and no position record is created.
- Given placement confirmation, then UI displays “non-cash points mode” disclosure acknowledgment.

#### B2 — Settlement Transparency
- Given oracle outcome is received for a locked market, when settlement job runs, then market transitions to `settled` and user points outcomes are computed exactly once.
- Given settlement completion, when user opens `/predictions/:marketId/settlement`, then outcome, source reference, settlement timestamp, and dispute-window status are displayed.

#### B3 — Engagement Features
- Given settled positions, when leaderboard job executes, then rankings update using settled outcomes only.
- Given configured reward threshold crossed, when user next loads `/me/support`, then earned badge/perk is shown.

#### B4 — Compliance and Abuse Operations
- Given suspicious pattern detector triggers, when flag is generated, then record appears in `/admin/compliance/flags` with market/user/action reference.
- Given compliance reviewer closes a flag, when closure is saved, then reviewer identity, timestamp, and disposition are appended to immutable audit log.

### 6.3 Cross-Phase Go/No-Go Criteria
- Phase A launch requires: donation-to-ledger traceability, public inflow/outflow visibility, operator approval gates active.
- Phase B launch requires: full non-cash market lifecycle, settlement evidence visibility, moderation queue and abuse logging in production.

