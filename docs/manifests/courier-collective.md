# Manifest: Courier Collective (v0.1.0)

| Field | Value |
| --- | --- |
| Slug | `courier-collective` |
| Playbook | `workshop` (worker co-op with sociocratic circles, rotating roles) |
| Listing types | `bookable`, `recurring` |
| Surface | `blackstar` (delivery / mobility — last unused surface; this manifest completes Surface enum coverage) |
| Governance | `collective` |
| Sensitivity floor | `member-visible` |
| Settlement rails | `usdc`, `hours`, `karma`, `gift` |

## The project

A worker-owned delivery cooperative. A small group of couriers
declares their skills, their vehicle, their license, and weekly
hours; a dispatcher coordinates pickups and deliveries. Customers
pay in USDC; couriers accrue time-bank HRS alongside cash earnings;
KARMA records completed runs (rider/recipient ratings); GIFT covers
free deliveries to mutual-aid recipients (Threshold members).

The mixed-rail model is the substantive shape: this is the first
manifest where cash settlement (USDC) and time-bank settlement (HRS)
flow side by side, because the courier collective is both a paid
service AND a labor-pooling time-bank within the worker cooperative.

## Required asset declarations

| Slug | Role | Min count | Optional? | Notes |
| --- | --- | --- | --- | --- |
| `skill.driving` | operator | 2 | no | each courier declares their driving skill + comfortable vehicle classes |
| `credential.drivers-license` | operator | 2 | no | VC body on attestation; sensitivity defaults to `match-only` (PII) |
| `tool.vehicle.*` | operator-or-shared | 2 | no | **depth-2 wildcard**; matches truck/bicycle/cargo-bike subkinds |
| `time.recurring` | operator | 2 | no | `hours_per_week_min: 5`; weekly courier shifts |
| `time.coordinator` | coordinator | 1 | no | `hours_per_week_min: 10`; dispatcher |

## Settlement

- **USDC** for customer-paid deliveries. The reconciler routes
  these through `createTransfer` between the customer's
  `USER_WALLET-USDC` and the collective's accounts. The dual-rail
  selector picks Stripe-ACH vs. Stellar-USDC per bridge health.
- **Hours** for the labor-pool side: each delivery a courier
  completes records an HRS entry in the time-bank, so couriers
  accumulate credits redeemable for collective services (or for
  borrowing from peer time-bank manifests like the tool library).
- **Karma** signals quality. Recipient ratings translate to KARMA
  events on the courier's `karma_event` log.
- **Gift** for free mutual-aid deliveries (Threshold). No
  settlement; recorded for audit.

No CCR — courier service isn't goods-trade-context-bound under
Posture A; USDC handles the cash leg. No USD on the manifest —
fiat falls out via the dual-rail selector's Stripe-ACH path when
USDC bridge health requires it.

## Governance

`collective`. Couriers own the collective; major decisions
(dispatch rules, vehicle policies, mutual-aid quotas) run through
the cooperative's governance circles. The workshop playbook's
`member_model: sociocratic` shape is the right organizational form
for this; the manifest's `governance_model: collective` is the
schema-level marker for "co-op decisions, not solo operator."

## What this manifest exercises in v0.1

- **`blackstar` surface** — last unused Surface enum value. With
  this manifest, the catalog covers every Surface enum value:
  commerce, threshold, refrain, blackstar. **Full Surface
  coverage** — the strongest possible surface-axis proof.
- **`tool.vehicle.*` depth-2 wildcard** — fourth wildcard root in
  the catalog (after `tool.*`, `skill.repair.*`, `skill.creative.*`)
  and the first at depth 2. Proves the wildcard matcher works
  regardless of taxonomy depth.
- **Mixed cash + time-bank settlement** — first manifest where
  USDC and HRS coexist on the same vertical. The earlier manifests
  used cash rails (nursery: ccr/usdc/usd) OR time-bank rails
  (tools/childcare: hours/karma) but not both.
- **VC-typed driver's license** — second manifest (after childcare)
  to declare a VC-bearing credential. The
  `credential.drivers-license` kind defaults to `match-only`
  sensitivity (driver's licenses are PII, even when the credential
  is government-issued).
- **Workshop playbook hosting a second manifest** — repair-cafe
  was the first. The two differ on surface (threshold vs.
  blackstar) and governance (consensus vs. collective), so the
  orthogonality test passes the (playbook, governance, surface)
  uniqueness check.

## Open dependencies

- **Per-delivery settlement workflow.** When a courier completes a
  delivery, the system should automatically emit:
    - USDC settlement: customer → courier (or courier → collective
      pool, depending on payout cadence)
    - HRS settlement: collective → courier (labor credit)
    - KARMA event: from recipient rating
  This is a workflow concern; the asset-graph layer has the
  composers but the dispatch event → settlement chain isn't wired.
- **Dispatch routing engine.** The matcher confirms the collective
  *can* run; the actual delivery-routing primitive (which courier
  takes which pickup, time-windowed) is post-v0.1 — a logistics
  engine outside the asset-graph schema.
- **Insurance + bonding.** Real courier collectives carry liability
  insurance and sometimes commercial bonding. v0.1's schema has
  the credential.* category to model these as VC-typed
  declarations but no concrete `credential.commercial-bond` kind
  yet.

## Why this is the right v0.1 sixth manifest

Two reasons.

First, it closes the catalog's Surface coverage. With blackstar
landing, the substrate has now demonstrated structural fit on every
Surface enum value (commerce, threshold, refrain, blackstar) AND
every other manifest-schema enum (Lifecycle, SettlementRail,
GovernanceModel). The four-axis coverage is the strongest available
structural proof that v0/v0.1 generalizes — there's no enum value
the substrate hasn't been stress-tested against.

Second, it lands the depth-2 wildcard case as a concrete fact in
the manifest catalog. Three wildcard roots already proved the
matcher isn't biased to a single category; the fourth proves the
matcher isn't biased to a single taxonomy depth either. If the
wildcard mechanism is ever changed in a way that breaks depth-2
matching, courier-collective fails to load alongside the parsing
test, which is the right pressure.
