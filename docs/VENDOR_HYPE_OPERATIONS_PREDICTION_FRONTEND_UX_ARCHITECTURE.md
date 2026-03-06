# Vendor Hype + Operations Funding + Prediction
## Frontend UX Architecture (Storefront, Vendor Panel, Admin Panel)

**Role perspective:** Senior Frontend Architect  
**Primary references:**
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_PHASE_A_B_PRODUCT_SPEC.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md`

---

## 1) Scope and UX Principles

### 1.1 Scope
This document defines implementation-ready UI requirements for:
- **Storefront:** supporter discovery, donation, prediction participation, settlement visibility.
- **Vendor Panel:** profile curation, milestone management, bucket governance, market drafting.
- **Admin Panel:** moderation, disbursements, settlement operations, compliance evidence views.

### 1.2 UX Principles
1. **Trust first:** always surface provenance, timestamps, and policy mode context.
2. **Progressive disclosure:** keep primary actions obvious; advanced detail one click away.
3. **Deterministic status UI:** every mutable workflow has explicit state + state reason.
4. **Fail safely:** policy/eligibility uncertainty defaults to disabled actions + explanation.
5. **Accessibility baseline:** WCAG 2.1 AA for core journeys.

---

## 2) Route Map

### 2.1 Storefront Routes

| Route | Surface | Purpose | Auth | Primary Data |
|---|---|---|---|---|
| `/hype` | Directory | Browse/search hype profiles | Optional | Profile cards, filters, trust snapshots |
| `/hype/:profileId` | Profile Detail | Story, trust cards, actions | Optional | Profile, milestones, media, CTA eligibility |
| `/hype/:profileId/operations` | Public Ops Dashboard | Inflow/outflow summaries + milestones | Optional | Aggregated ledger data |
| `/hype/:profileId/donate` | Donation Checkout | One-time/recurring donations with bucket tagging | Required on submit | Buckets, donation config, payment intent |
| `/hype/:profileId/predictions` | Market List | Active + settled markets by profile | Optional (required on submit) | Market cards, mode disclosure |
| `/predictions/:marketId` | Market Detail | Rules, options, place position | Optional (required on submit) | Market, options, policy decision |
| `/predictions/:marketId/settlement` | Settlement Detail | Outcome evidence + user result | Optional | Settlement evidence, payout/points result |
| `/me/support` | Supporter Activity | Donation history, positions, rewards | Required | Donation receipts, positions, streaks |

### 2.2 Vendor Panel Routes

| Route | Purpose | Primary Actions |
|---|---|---|
| `/panel/profiles/:profileId/edit` | Profile editing | Update mission/media/cards, publish/unpublish |
| `/panel/profiles/:profileId/milestones` | Milestone management | Create/update/archive milestones |
| `/panel/profiles/:profileId/buckets` | Funding buckets | Reorder buckets, activate/deactivate, descriptions |
| `/panel/predictions/markets` | Market management | Create draft, edit, submit for approval |
| `/panel/predictions/markets/:marketId` | Market detail | Validate config, view approval state |

### 2.3 Admin Panel Routes

| Route | Purpose | Primary Actions |
|---|---|---|
| `/admin/ops/ledger` | Ledger observability | Filter inflows/outflows, inspect entries |
| `/admin/ops/disbursements` | Disbursement queue | Approve/reject/retry disbursements |
| `/admin/predictions/markets` | Market operations | Publish/lock/void market |
| `/admin/predictions/settlements` | Settlement monitor | Ingest outcomes, finalize/reverse settlement |
| `/admin/compliance/flags` | Compliance queue | Triage flags, assign, close with reason |
| `/admin/compliance/policy-evidence` | Policy evidence | Export logs/artifacts by date/entity |
| `/admin/compliance/markets/:marketId/audit` | Audit drilldown | Review end-to-end evidence chain |

---

## 3) Component Inventory

### 3.1 Storefront Components

#### Directory + Profile
- `HypeFilterBar` (search, category, trust, funding-need filters)
- `HypeProfileCard`
- `TrustSignalCard`
- `OperationalReadinessCard`
- `CapitalNeedCard`
- `RecentWinsFeed`
- `ActionRail` (Donate / Predict / Share / Follow)

#### Operations Dashboard
- `OpsInflowOutflowChart`
- `BucketAllocationBreakdown`
- `MilestoneTimeline`
- `DataFreshnessBadge`

#### Donation Flow
- `DonationAmountSelector`
- `DonationFrequencyToggle`
- `FundingBucketPicker`
- `DonationSummaryCard`
- `PaymentMethodForm`
- `DonationReceiptPanel`

#### Prediction Flow
- `PredictionMarketCard`
- `ModeDisclosureBanner`
- `MarketRulePanel`
- `OutcomeOptionSelector`
- `PositionConfirmModal`
- `StreakWidget`
- `LeaderboardPreview`
- `SettlementEvidencePanel`
- `UserOutcomeSummary`

#### Supporter Account
- `SupportActivityTabs`
- `DonationHistoryTable`
- `PredictionPositionTable`
- `RewardBadgeGrid`

### 3.2 Vendor Panel Components
- `ProfileEditorForm`
- `MediaUploadManager`
- `MilestoneForm`
- `MilestoneListTable`
- `BucketConfigTable`
- `BucketPriorityDragList`
- `MarketTemplateSelector`
- `MarketBuilderForm`
- `ApprovalStatusBanner`

### 3.3 Admin Panel Components
- `LedgerEntryTable`
- `DisbursementQueueTable`
- `DisbursementDecisionModal`
- `MarketOpsTable`
- `SettlementPipelineTable`
- `OutcomeIngestionForm`
- `FlagQueueTable`
- `FlagDetailDrawer`
- `AuditTrailTimeline`
- `EvidenceExportPanel`

---

## 4) Data-Fetch and Caching Strategy

### 4.1 Data Layer Standards
- Use **React Query / TanStack Query** for server state.
- Use typed API client (`zod`/OpenAPI-generated types) for all contracts.
- Query keys follow deterministic namespace pattern:
  - `['hype','profiles',filters]`
  - `['hype','profile',profileId]`
  - `['donations','me',page]`
  - `['predictions','market',marketId]`
  - `['admin','compliance','flags',filters]`

### 4.2 Caching Policy by Surface

| Data Type | Stale Time | Cache Time | Refetch Trigger | Notes |
|---|---:|---:|---|---|
| Public profile cards | 60s | 10m | Window focus + filter change | CDN-friendly |
| Profile detail + trust cards | 30s | 5m | Focus, reconnect | Include freshness badge |
| Public operations aggregates | 15s | 2m | Poll every 30s (active page) | Show last updated timestamp |
| Donation bucket config | 60s | 5m | On checkout entry | Invalidate after bucket update |
| Market list/detail (open) | 10s | 2m | Poll every 10–15s | lock countdown needs freshness |
| Settlement detail | 30s | 10m | Focus, explicit refresh | Once settled, less frequent |
| Admin queues | 5s | 1m | Poll every 5–10s | high-operational urgency |

### 4.3 Mutations + Invalidation
- `createDonation`: optimistic disable submit; invalidate `['donations','me']`, `['hype','operations',profileId]`.
- `placePosition`: optimistic pending state for button; invalidate market + me positions.
- `finalizeSettlement`: invalidate settlement list + market detail + leaderboard widgets.
- `approveDisbursement/rejectDisbursement`: invalidate disbursement queue + ledger summaries.

### 4.4 Real-Time and Eventing
- Prefer SSE/WebSocket channels for:
  - market lock/settle status updates,
  - admin queue changes,
  - disbursement status transitions.
- Fallback to short polling if live channel unavailable.

### 4.5 Offline/Retry
- Disable destructive/financial mutations offline.
- Retry policy:
  - GET: exponential backoff, max 3 retries.
  - POST financial/settlement actions: no auto-retry without idempotency key; show explicit retry CTA.

---

## 5) Loading / Empty / Error States

### 5.1 Loading States
- Use **skeletons** for lists/cards (`HypeProfileCardSkeleton`, `MarketCardSkeleton`).
- Use **inline spinners** for button-level mutations (`Submitting donation...`).
- For polling surfaces, avoid full-page flicker; use incremental row shimmer.

### 5.2 Empty States
- Directory: “No profiles match filters” + clear-filter CTA + featured profiles.
- Predictions list: “No active markets” + show settled markets tab.
- Donation history: “No donations yet” + discover CTA.
- Admin queues: “No pending items” + last refresh timestamp.

### 5.3 Error States
- Use typed error mapping:
  - `policy_denied` -> eligibility explanation card.
  - `validation_error` -> inline form errors + summary alert.
  - `conflict` -> stale-state warning + refresh CTA.
  - `internal_error` -> retry panel + support link.
- Always show `request_id` in admin error UIs.

### 5.4 State Matrix Example (Market Detail)

| Condition | UI State |
|---|---|
| Data loading | Market skeleton + disabled action rail |
| Market open + eligible | Active outcome selector + confirm CTA |
| Market open + policy denied | CTA disabled + policy reason panel |
| Market locked | “Locked” status chip + settlement pending timeline |
| Settlement available | Evidence panel + user outcome summary |
| API error | Retry panel with error code |

---

## 6) Accessibility Requirements

### 6.1 Global
- Conform to **WCAG 2.1 AA** for all core flows.
- Ensure color contrast >= 4.5:1 for text and status indicators.
- Provide visible focus states and logical tab order.

### 6.2 Forms and Interactions
- Every input has `<label>` and `aria-describedby` for help/error text.
- Validation errors are announced via `aria-live="assertive"` region.
- Modal dialogs (confirmation, decisions) must trap focus and restore focus on close.

### 6.3 Data Visualization
- Charts require accessible summaries and table fallbacks.
- Status color cannot be sole indicator; include icon + text (`Locked`, `Settled`, `Failed`).

### 6.4 Timers and Live Updates
- Lock countdowns must have non-animated textual equivalent.
- Live updates announced in polite region (`aria-live="polite"`).
- Avoid seizure-triggering animations; respect reduced-motion preference.

### 6.5 Localization + Readability
- All UI copy externalized as i18n keys.
- Readability target: plain language for donation and mode-disclosure messages.

---

## 7) Analytics Instrumentation Points

### 7.1 Event Taxonomy Standard
Event naming: `surface.object.action`  
Examples: `store.profile.viewed`, `store.donation.completed`, `admin.settlement.finalized`.

Common event payload fields:
- `event_id`
- `timestamp`
- `user_id` (if authenticated)
- `role` (supporter/vendor/operator/compliance)
- `profile_id` (optional)
- `market_id` (optional)
- `bucket_id` (optional)
- `jurisdiction_code` (if relevant)
- `mode` (if prediction surface)
- `request_id`

### 7.2 Storefront Events
- `store.directory.viewed`
- `store.profile.card_clicked`
- `store.profile.viewed`
- `store.operations.viewed`
- `store.donation.started`
- `store.donation.step_completed` (step index)
- `store.donation.completed`
- `store.market.viewed`
- `store.position.submitted`
- `store.position.rejected_policy`
- `store.settlement.viewed`
- `store.reward.viewed`

### 7.3 Vendor Events
- `vendor.profile.updated`
- `vendor.milestone.created`
- `vendor.bucket.updated`
- `vendor.market.draft_created`
- `vendor.market.submitted_for_approval`

### 7.4 Admin/Compliance Events
- `admin.market.published`
- `admin.market.voided`
- `admin.settlement.outcome_ingested`
- `admin.settlement.finalized`
- `admin.disbursement.approved`
- `admin.disbursement.rejected`
- `compliance.flag.opened`
- `compliance.flag.closed`
- `compliance.evidence.exported`

### 7.5 Analytics Guardrails
- No raw PII in analytics payloads.
- Use sampled session replay only on non-sensitive pages; exclude payment forms.
- Enforce schema validation at emit time; drop invalid payloads with warning log.

---

## 8) Component Contracts (Implementation-Ready)

### 8.1 `HypeProfileCard`
```ts
export interface HypeProfileCardProps {
  profileId: string;
  slug: string;
  displayName: string;
  missionSnippet: string;
  trustScore?: number;
  readinessScore?: number;
  capitalNeedAmount?: number;
  recentWinCount?: number;
  isLoading?: boolean;
  onClick: (profileId: string) => void;
  onDonateClick?: (profileId: string) => void;
  onPredictClick?: (profileId: string) => void;
}
```

### 8.2 `FundingBucketPicker`
```ts
export interface FundingBucketOption {
  id: string;
  code: "ops_core" | "production_inputs" | "growth" | "reserve" | "custom";
  name: string;
  description?: string;
  isActive: boolean;
  recentAllocationPct?: number;
}

export interface FundingBucketPickerProps {
  buckets: FundingBucketOption[];
  selectedBucketId?: string;
  disabled?: boolean;
  error?: string;
  onSelect: (bucketId: string) => void;
}
```

### 8.3 `PredictionMarketCard`
```ts
export interface PredictionMarketCardProps {
  marketId: string;
  title: string;
  mode: "non_cash" | "sweepstakes" | "regulated_cash";
  state: "draft" | "scheduled" | "open" | "locked" | "in_review" | "settled" | "voided";
  locksAt: string; // ISO timestamp
  settlementDeadlineAt?: string;
  eligibility: {
    isEligible: boolean;
    reasonCode?: string;
    reasonMessage?: string;
  };
  onView: (marketId: string) => void;
  onParticipate?: (marketId: string) => void;
}
```

### 8.4 `PositionConfirmModal`
```ts
export interface PositionConfirmModalProps {
  open: boolean;
  marketId: string;
  selectedOutcomeOptionId?: string;
  stakeAmount: number;
  stakeUnit: "points" | "currency";
  modeDisclosureText: string;
  isSubmitting?: boolean;
  submissionError?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}
```

### 8.5 `SettlementEvidencePanel`
```ts
export interface SettlementEvidencePanelProps {
  marketId: string;
  settlementRef: string;
  settledAt: string;
  outcomeKey: string;
  oracleEvidenceUri: string;
  disputeWindowEndsAt?: string;
  status: "proposed" | "final" | "reversed";
  userOutcome?: {
    result: "won" | "lost" | "voided";
    payoutAmount: number;
    payoutUnit: "points" | "currency";
  };
}
```

### 8.6 `DisbursementQueueTable`
```ts
export interface DisbursementQueueItem {
  disbursementId: string;
  profileId: string;
  bucketCode: string;
  amount: number;
  currencyCode: string;
  status: "pending" | "approved" | "rejected" | "processing" | "paid" | "failed";
  requestedBy: string;
  createdAt: string;
}

export interface DisbursementQueueTableProps {
  items: DisbursementQueueItem[];
  isLoading?: boolean;
  error?: string;
  onApprove: (disbursementId: string) => Promise<void>;
  onReject: (disbursementId: string, reason: string) => Promise<void>;
  onRetry: (disbursementId: string) => Promise<void>;
}
```

### 8.7 `FlagQueueTable`
```ts
export interface ComplianceFlagRow {
  flagId: string;
  entityType: "market" | "position" | "user" | "disbursement";
  entityId: string;
  reasonCode: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "in_review" | "closed";
  createdAt: string;
}

export interface FlagQueueTableProps {
  rows: ComplianceFlagRow[];
  selectedFlagId?: string;
  isLoading?: boolean;
  onSelect: (flagId: string) => void;
  onCloseFlag: (flagId: string, resolution: string) => Promise<void>;
}
```

---

## 9) Page-Level Requirements by Surface

### 9.1 Storefront: `/hype/:profileId`
- Must render profile header within 250ms after data fetch resolution.
- Must show CTA states based on eligibility:
  - donate always visible (if profile published),
  - predict visible only when active markets exist.
- Must include `DataFreshnessBadge` and last-updated timestamp for trust metrics.

### 9.2 Storefront: `/hype/:profileId/donate`
- Multi-step form with persisted step state in URL query (`?step=2`) for reload resilience.
- Prevent duplicate submissions with disabled primary button while mutation pending.
- On success, route to receipt subview and emit `store.donation.completed`.

### 9.3 Storefront: `/predictions/:marketId`
- Must show `ModeDisclosureBanner` before enabling confirm action.
- If `policy_denied`, disable action controls and show jurisdiction/mode explanation.
- Countdown to lock must switch UI to locked state without manual refresh.

### 9.4 Vendor: `/panel/predictions/markets/:marketId`
- Draft validation panel must block submit-for-approval when required fields missing.
- Approval status changes should update in near-real-time.

### 9.5 Admin: `/admin/predictions/settlements`
- Settlement rows must expose state chip, timestamp, and action menu by permissions.
- Finalize action requires confirmation modal with irreversible warning text.

### 9.6 Compliance: `/admin/compliance/markets/:marketId/audit`
- Timeline must show ordered evidence events with actor + timestamp + policy version.
- Export controls must provide CSV/JSON/PDF options and show request tracking ID.

---

## 10) Delivery Checklist (Frontend)

1. Implement route shells and permission guards.
2. Add typed API client and query-key constants.
3. Build shared status components (`StatusChip`, `ErrorPanel`, `FreshnessBadge`).
4. Implement storefront components for discovery/donation/prediction/settlement.
5. Implement vendor panel forms and validation.
6. Implement admin/compliance operational tables and decision modals.
7. Add analytics instrumentation wrappers and schema checks.
8. Complete accessibility QA + keyboard-only QA + screen-reader audit.
9. Add integration tests for critical flows and error states.
10. Validate event payloads and observability hooks in staging.

