# Federation vs. Foundation — Decision Brief

> Resolves the sequencing conflict gating **Move 2** of the August 2026
> game-theory roadmap ("BMC Architecture & Roadmap — What the Data Says to
> Build"): does partner-facing federation work start now, or after the
> `AGGRESSIVE_OPERATIONS_GUIDE.md` Foundation milestone?
>
> **Status**: Recommended default — **ship the interface, gate the
> operation** (§Recommendation). Pending: maintainer sign-off.
>
> All code claims verified against the repos on 2026-08-12. Updated the
> same day after Move 1 closed (FBM #800 merged) and the first tranche of
> Workstream 2 landed on Blackstar's `claude/move-1-money-path-fixes-ox91sr`
> branch: the API test suite now runs and passes (52 tests, 645
> assertions — the first green run in the repo's history), the committed
> default secrets are gone, both webhook directions carry timestamped
> replay-protected signatures over the full wire body, and the CI gate
> jobs were repaired to run on a hosted runner. Claims below marked
> [resolved] changed as a result; the recommendation is unchanged.

## The conflict, precisely

Three planning artifacts order the same work three different ways:

| Artifact | Last touched | Ordering it implies |
| --- | --- | --- |
| `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` §5 (committed, FBM + Blackout) | 2026-07-06 (PR #739) | **Foundation → Differentiation → Density → Infrastructure.** "Substrate other cooperatives run on" — white-label tenancy, B2B portal, cross-coalition settlement clearing — is Milestone 4, explicitly last. |
| Game-theory roadmap (uncommitted; derives from `results_v3.json`, also uncommitted) | 2026-08-12 | Leverage order: federation & trust substrate is **Tier 1 / Move 2** (+2.2 SI, largest lever tested). Ship connect.js partner-facing and a Blackstar federation interface now. |
| `ROADMAP.md` (committed, repo-native) | current | Never mentions federation, partners, connect.js, or Blackstar at all. Near-term = vendor activation; mid-term = POS/pricing/invoicing. |

Two senses of "federation" are entangled and must be separated:

- **Matrix/Synapse federation** (ops guide §4.1) — Blackout's protocol-level
  federation with the Matrix network. An operational-risk topic, not in
  dispute, and not what Move 2 is about.
- **BMC cross-node federation** (`COMPOSITION_LAYER.md`'s fifth surface; the
  roadmap's HUB) — multiple BMC nodes / sibling marketplaces sharing demand,
  drivers, and hawala settlement. This is the contested work.

## What each document actually argues

**The ops guide argues from capacity.** §3: solo project with AI assistance;
every workstream passes a five-constraint filter (cooperative wedge, solo-dev
capacity, operational cost, bus-factor, wedge-deepening); two failures defer
it. Foundation's exit criteria are concrete: 3–5 real coalitions end-to-end,
10+ Order Cycles run, Coalition Credits settling non-zero volume through the
Stellar/USDC bridge, 25–50 verified vendors, Tier-1 runbook coverage validated
by a bus-factor drill, one co-maintainer onboarded. Milestone 4's premise is
that federation infrastructure becomes justifiable "because real third-party
demand has emerged" — federate when someone real is asking.

**The roadmap argues from leverage.** The v3 simulation's Finding 1:
pre-positioned awareness beats every other lever tested (+2.2 SI), "and
federation is how you buy it." Targeting alone is worth 0.15 SI; targeting on
top of federation is 0.45 — the Node 1 pilot (Move 3) triples in value if
federation exists first, and the value compounds over the model's 30-month
horizon.

**The roadmap also contains the counter-argument to itself.** Its trust-shock
test — one partner network's credibility event — cost 0.34 SI as a
*temporary* hit, and it warns that a real ledger or key-recovery failure
"would cap adoption permanently." Its own Move 1 exists because "other
networks' trust depends on yours." The unbuilt Foundation rows are precisely
what a partner inherits: no offsite backups yet, a single Cloudflare Tunnel
ingress (fallback documented, not enabled), capacity telemetry that §4.1
admits "does not yet exist," a single human operator, no completed bus-factor
drill. Federating before those close means selling partners a dependency on
an SPOF inventory the guide already wrote down.

## Code reality (verified 2026-08-12)

Both prior characterizations of Blackstar — the roadmap's "forked from
Fleetbase, live" and the earlier session's "50-line fulfillment stub, not a
Fleetbase fork" — are wrong, in opposite directions.

### connect.js: real, well-authenticated, one packaging step from partner-ready

- `storefront/public/connect.js` — a 1,205-line hand-written SDK with 34
  exports across three layers (raw API client, 11 render widgets, a zero-JS
  `data-fbm` declarative layer), plus 413 lines of integrator docs
  (`docs/integrations/fbm-connect.md`) and a server-side snippet generator.
- **Auth is the best part of the whole federation surface**: per-vendor
  hashed publishable keys (`pk_live_…`, SHA-256 at rest in the `embed-keys`
  module), an origin allow-list, per-key + per-IP rate limits, and metering
  for billing. The code is honest that origin checks are advisory and the
  per-IP cap is the real backstop.
- **The gap is release engineering, not capability.** `version: "2.0.0"` is
  an object literal nothing reads. There is no versioned URL (`/connect.js`
  only, cached with up to a 24h stale-while-revalidate window), no SRI in the
  generated snippet, no publishable package (the parent `b2c-storefront` is
  `private`), and tests cover one widget of eleven. No external sibling
  should build on a mutable 47 KB URL — and that is the *only* blocker.

### Blackstar: a hollow fork wrapping a real, unproven federation API

- **The Fleetbase fork is a shell.** All 13 submodules point at `fleetbase/*`
  and every one is empty; `api/vendor/` doesn't exist; CI/CD is stock
  Fleetbase targeting Fleetbase's own registry. No Fleetbase engine code has
  ever been present. The fork contributed scaffolding and the stock Ember
  console.
- **The real asset is `Blackstar/api/`** — a greenfield Laravel 10 app
  implementing the federation data model from
  `FEDERATED_LOGISTICS_COMPATIBILITY.md`: `Node`, `TransportClass`,
  `ShipmentBoardListing`, `ShipmentBid`, `ShipmentLeg`, `NodeTrustScore`,
  attestations, governance references, an FBM inbound/outbound event bus; 18
  migrations, 12 feature tests.
- **None of it had ever been verified to run — [resolved 2026-08-12].**
  Release gates 1–2 were incomplete; the workplan attributed this to
  environment blocks (missing `ext-sodium`, unreachable Packagist) — the
  test suite had never executed. It now runs green (52 tests, 645
  assertions) after restoring the empty `database.connections` config,
  fixing two schema bugs the first run exposed (a missing `volume_limit`
  column that 403'd every claim, and a pivot primary key `attach()` could
  never fill), and repairing the CI gate jobs to run on a hosted runner.
  The §12 release-blocker QA checklist and the `federation-audit.md` re-run
  remain to be re-scored, but the "never ran" era is over.
- **Partner-facing UI does not exist.** The console's `node-registration`
  route is an empty class body; "Route visualization" is marked NOT STARTED;
  `blackstar_nav` is a rebranded Fleetbase Navigator *driver* app
  (Dash/Orders/Reports/Chat/Account) that speaks the Fleetbase API — not the
  Blackstar API. The roadmap's "vendor portal with Node and Routes tabs" is
  unsupported by code.

### The FBM↔Blackstar seam: two half-bridges that cannot talk

- FBM's side is the literal "50-line stub":
  `backend/src/modules/blackstar-fulfillment/service.ts` (exactly 50 lines,
  a local DB upsert, zero network calls) plus a no-op fulfillment provider —
  349 lines total, behind one static env key compared with non-constant-time
  `===`, feature-flagged off by default.
- Blackstar's side is a real 523-line bridge: HMAC-SHA256 with constant-time
  compare, persisted inbound receipts (idempotent by `event_id`), retrying
  outbound publisher, 120-line interop test, documented contract.
- **They interoperate zero percent.** Different auth headers
  (`X-FBM-Signature` vs `x-fbm-integration-key`), different schemes (HMAC vs
  static key), and FBM never emits any of the three events Blackstar's
  contract expects (`order.created`, `delivery.option.selected`,
  `order.cancelled` — zero hits in FBM's backend) nor receives Blackstar's
  five outbound events. Even fully configured, no message crosses.
- Shared defect class: global secrets, not per-partner. Blackstar's config
  committed the literal fallback defaults `'fbm_webhook_secret'` /
  `'fbm_outbound_secret'` — **[resolved 2026-08-12]**: defaults removed
  (unset now means 503 / fail-closed), timestamped replay-protected
  signatures added in both directions covering the full wire body, and the
  unauthenticated retry endpoint moved behind auth. Still true: one global
  secret per direction rather than per-partner credentials — that remains
  gated work.

### Cross-node federation in FBM: vocabulary, not code

- No `partner_node` / `peer` / `remote_marketplace` / registry model in any
  of 88 backend modules. No network-operator actor (auth knows `admin`,
  `seller`, `customer`, `driver`). No per-partner API keys (only per-vendor
  embed keys and the one static Blackstar key). Every "node"/"network" hit is
  intra-marketplace (buying clubs, grower-node routing, playbook advice
  strings).
- Three adjacent primitives a federation layer would build on:
  `marketplace-signing` (real Ed25519, Sigstore-shaped generic envelope — the
  strongest available foundation for cross-node trust), `marketplace-webhooks`
  (outbound HMAC, single destination today), and the documented
  `/v1/integrations/<sibling>` convention — whose per-sibling bespoke auth is
  the *stated design*, i.e. the opposite of a uniform federation protocol.

### The roadmap's gap table, corrected

| Component | Roadmap said | Verified reality |
| --- | --- | --- |
| Blackstar | "Forked, live; hard design problem solved" | Hollow fork; real greenfield federation API that has never run; no deploy evidence; stale since March |
| connect.js | "Scoped, not shipped" | Built, documented, authenticated; unshipped only as a *versioned artifact* |
| Vendor portal | "Node and Routes tabs exist" | Neither exists; nav app is a driver app |
| Buyer Center | "Escrow/idempotency defects — hard gate" | Closed before Move 1; guarded by blocking CI soak (PR #800) |
| TigerBeetle | "Sourced, not integrated" | Nonexistent; deferred by decision (PR #800) |
| Federation | strategy with missing plumbing | No plumbing *and* the two existing half-bridges are protocol-incompatible |

## The narrower true question

Not "federation or Foundation" but: **which half of federation starts now?**

- The **interface** — a versioned connect.js artifact, one coherent
  FBM↔Blackstar protocol, a published partner spec — buys the pre-positioned
  awareness the model prices, costs weeks not quarters, and creates no
  partner dependency on unhardened substrate.
- The **operation** — real partner nodes transacting through the ledger,
  drivers crossing nodes, operator dashboards over pooled metrics — is what
  inherits the SPOF inventory and what the trust-shock finding prices at
  permanent-adoption-cap risk.

The ops guide's own §3 filter agrees with this split: interface work passes
(small batches, documented, wedge-deepening); operating multi-node federation
today fails at least solo-dev capacity and bus-factor, which defers it.

## Recommendation: ship the interface, gate the operation

**Move 2 becomes three bounded workstreams, in order:**

1. **connect.js release engineering** (the smallest, highest-certainty item).
   Serve an immutable versioned URL (`/v2.0.0/connect.js`) alongside the
   mutable one; add SRI + `crossorigin` to the snippet generator; add a
   changelog; widen widget test coverage. Optionally publish `@fbm/connect`.
   This is the roadmap's "ship connect.js," and it is one packaging step.
2. **Collapse the Blackstar seam to one protocol.** Adopt Blackstar's
   documented HMAC contract (it is the real bridge): implement FBM's emitting
   side for the three inbound events and an FBM receiver for Blackstar's five
   outbound events; retire the static-key route; constant-time compares
   everywhere; delete the committed default secrets on the Blackstar side;
   add replay protection (its own QA plan already requires it). Also unblock
   Blackstar's never-run test suite (env fix: `ext-sodium`, Packagist
   access) before building anything more on it.
3. **Publish the partner spec** — the federation contract + connect.js docs
   as a versioned, public document set. This is the artifact that buys
   awareness; it commits you to nothing operational.

**Hard gate before any real partner node onboards** (the partner-inherited
subset of Foundation, plus credentials):

- Offsite encrypted Postgres backups running; Cloudflare Tunnel fallback
  ingress enabled; baseline capacity telemetry live; one bus-factor drill
  passed. (All already Foundation-milestone mitigations in ops guide §4.2.)
- Per-partner machine credentials replacing every global secret: key ID in
  the signature header, rotation and revocation paths, a credential on the
  `Node` model. The Ed25519 `marketplace-signing` module is the natural
  foundation.

**Explicitly deferred to Milestone 4, per the guide:** network-operator
dashboards over pooled metrics, white-label tenancy, B2B portal,
cross-coalition settlement clearing.

**What this does to Moves 3–5:** Move 3's pilot proceeds on schedule — a
"federated partner seller" in the pilot is served by a connect.js embed
(commerce-grade today) without multi-node ledger federation, preserving the
targeting×federation interaction the model prices. The pilot's 3–5 real
coalitions double as Foundation exit evidence, converging the two documents
instead of choosing between them. Moves 4 (CCR/HRS ignition + SNAP/EBT
research track) and 5 (savings-routing ledger spec + counsel question) are
untouched by this decision and can start any time.

## What evidence would flip this

- A real sibling marketplace with signed intent to integrate this quarter →
  raises the value of operation-now; pull the operability gate items forward
  aggressively instead of sequencing them.
- Foundation exit criteria proving more than ~2 quarters out at current
  capacity → interface-only Move 2 risks publishing a spec for vaporware;
  rescope toward Foundation-critical rows first.
- `results_v3` sensitivity showing the +2.2 SI collapses without *operating*
  federation (published interfaces insufficient) → the hybrid loses its
  premise; the decision becomes the harder either/or this brief argues it
  currently is not.

## Decision record

- **Decider:** maintainer.
- **Default if unopposed:** the recommendation above; Move 2 rescoped to the
  three interface workstreams; operation gated as specified.
- This document supersedes the roadmap's Tier 1 gap table (corrected above)
  and should be read alongside `AGGRESSIVE_OPERATIONS_GUIDE.md` §5, which it
  leaves intact.
