# BMC Survival Programs & Nonprofit Parity

**Status file.** Updated as phases land. Opened 2026-10-01.

Lets Coalitions run community survival programs — food, health coordination,
education, legal support, mobility, housing/jobs, a periodical, civic leverage —
with nonprofits and for-profit vendors on equal footing, able to sponsor each
other, and able to earn so the service stays free or sliding-scale.

---

## 0. Read this before planning anything else

The work prompt supplied several statuses as *"starting hypotheses to verify,
not trust"* and instructed verification in the repos. That verification is done.
**Three of the prompt's own locked decisions describe a future state as if it
were current.** They are listed here because two of them are substantial work
that nobody has scoped, and one would change revenue.

### 0.1 — There is no $10/mo plan and no 0% commission tier

> Locked decision as written: *"Vendor plans: free (3% commission) and a single
> $10/mo all-access plan (0% commission)."*

`backend/src/modules/vendor-plan/catalog.ts` actually ships **five** plans:

| code | `price_amount` | `platform_fee_percent` |
|---|---|---|
| `free` | 0 | **3** |
| `starter` | 2900 ($29) | 2.5 |
| `pro` | 9900 ($99) | 2 |
| `scale` | 24900 ($249) | 1.5 |
| `internal` | 0 | `null` (no opinion) |

No row has `price_amount: 1000`. No row has a 0 fee.

So this is **not** a constraint to respect — it is a migration to perform:
collapse four paid tiers into one $10 tier and take its commission to zero.
That removes the $29/$99/$249 ladder and zeroes the take rate on whoever
subscribes. It interacts with `platform-fee.ts`'s precedence chain (seller
override → plan → platform default) and with every seller currently on a paid
plan.

**Not started. Needs an explicit decision** — see Open Decision 5. The "flat 3%
is never increased" rule is unaffected either way and is being honoured.

### 0.2 — "Capital circles" and "first-order guarantee" do not exist

> Hypothesis as written: *"Community capital circles and first-order guarantee:
> built, gated on securities-law review."*

No module, model, or identifier by either name. Searched `src/modules/**` for
`circle`, `guarantee`, `capitalCircle`, `firstOrderGuarantee` — the only hits are
incidental English in unrelated files (allocation maths, an idempotency comment).

The real built-and-legally-gated capital features are different things:

| Feature | Model | Flag | Why gated |
|---|---|---|---|
| Vendor cash advances | `VendorAdvance` (hawala-ledger) | `FF_VENDOR_ADVANCES_V1` | Quiescent under Posture A pending legal review |
| Producer investment pools | `InvestmentPool` / `Investment` | `FF_INVESTMENT_POOLS_V1` | Quiescent unless an offering is structured under a securities exemption |

Both default off. `docs/POSTURE_A_COMPLIANCE.md` § "Existing models documented
as quiescent". If the intent was these two, say so and the plan reuses them. If
"capital circles" is a genuinely new concept, it is BUILD NEW and needs the
Step-0 justification.

### 0.3 — The KARMA ladder is correct as the prompt states it

Recorded because an earlier pass in conversation got this wrong. The prompt is
right. `backend/src/modules/progression/grower-karma.ts`:

| Tier | min XP | `split_pct` |
|---|---|---|
| Seedling | 0 | 0.60 |
| Sprout | 50 | 0.62 |
| Root | 200 | 0.65 |
| Canopy | 500 | 0.68 |
| Ancestor | 1500 | 0.72 |

It **does** set real payout shares, exactly as the prompt says. Note this is the
*grower's split of a split* — it does not feed the platform fee, so "tier
changes payout share" and "flat 3% platform commission" are both true and do not
conflict. Any new progression is a separate capability track and must not touch
`GROWER_TIERS`.

### 0.4 — Production shipping is ON (operator override, 2026-10-01)

The prompt said *"Do not deploy"* and *"Ship to production"* under **Do not**.
The operator has overridden both. Recorded so nobody re-applies the old rule.

**What this override does not move.** Three gates are external law, not
deployment process, and are unaffected by a decision to deploy:

- Charitable solicitation registration varies by state. Taking donations in a
  state where the receiving org is unregistered is the org's exposure, and BMC
  routing the donation does not remove it.
- Money-transmitter exposure if funds are pooled. The Workstream B default
  (split at checkout, no BMC custody) is what keeps this off the table — if
  custody changes, the gate returns.
- Securities law for `InvestmentPool` / `VendorAdvance`, already flagged off.

Plus the repo's own standing gate, which the operator has not overridden:
**ACH payouts stay disabled** until the §5-C money-transmitter sign-off
(`REPO_CONSOLIDATION_REVIEW.md` §8, restated in `COMMERCE_ROADMAP.md` §5).

Shipping to production is therefore fine for Phase 1 as scoped below. It is not
fine for anything that moves donor money into BMC custody, and the plan keeps
those apart.

---

## 1. Verified inventory (Reuse Report step 0.1)

Full detail in `docs/reuse/00-internal-inventory.md`. Summary of what exists, so
nothing below gets rebuilt:

| Capability | Where | Status |
|---|---|---|
| Collective (multi-org) quests | `vendor-quest` + `collective-quest` | **Built.** `type: "individual" \| "collective"`, `requiredConsentScopes`, `aggregateSubstrates`, `s.collective?.member_count` |
| Quest catalog | `vendor-quest/definitions/` | **Built, Q1–Q15.** Cooperative & Mission family = Q11 coop-formation, Q12 land-pooling, Q13 commons-contribution, Q14 fiscal-sponsorship-readiness |
| Quest engine gate | `FF_VENDOR_QUESTS_V1` | **Off everywhere.** Set in no workflow, compose file, Dockerfile or env template |
| KARMA ladder | `progression/grower-karma.ts` | Live, sets `split_pct` |
| Demand pools | `demand-pool` | Built |
| Bargaining groups | `bargaining` | Built |
| Collective campaigns | `collective-campaign` | Built |
| Mutual aid | `mutual-aid`, `aid-network` | Built (`FF_AID_NETWORK_V1`) |
| Order cycles | `order-cycle` | Built, with the #853 oversell fix |
| Patronage disbursement | `hawala-ledger/patronage-disburse.ts` | Plans only; port unregistered — issue #865 |
| Consignment splits | `hawala-ledger` | Logic + tests present |
| Plugin registry | `plugin-registry` | Built |
| Blackstar fulfilment | `blackstar-fulfillment`, `*-provider` | Built |
| Shipping-label seam | `agriculture/label-provider.ts` | Provider-agnostic, default no-op, `PLANT_LABEL_PROVIDER` — Karrio can slot in |
| connect.js | `storefront/public/connect.js` + `v2.0.0/` | Built. Widgets: products, services, events, reviews, demand-pools, digital, vendor, chat. Backend `embed-keys`, `embed-analytics`, `/store/embed/bookings` |
| Coalitions | Blackout `packages/api/src/services/coalition*.ts` | 23 services; delegated voting in `blackout_runtime/` |

**Not found under the prompt's names:** `bounty`, `escrow`, `app-store`,
`campaign` (it is `collective-campaign`), capital circles, first-order guarantee,
Blackstar "batch claims"/"micro-depots" (the real shape is `ShipmentBoardListing`
+ `claim_policy`).

### Blocker found while inventorying — unrelated to this programme but in the way

Seven `VITE_FF_*` flags are read by `vendor-panel/src/lib/phase0-feature-flags.ts`.
`vendor-panel/Dockerfile` declares **zero** of them as ARGs, and
`docker-build.yml`'s `panelargs` step passes **zero**. Vite inlines at build;
`enabled(undefined)` returns `false`. **POS, weight pricing, pick/pack, invoicing
and channel sync are permanently dark in the published panel image.** Vendor
advances and investment pools are also dark — correct outcome, but by accident,
which means the flag is not actually holding that line.

Same shape as SD-26. Fix this before Phase 1 ships anything panel-side, or no
panel flag we add will work either. Tracked separately.

### Still to do for Step 0

Steps 0.2–0.4 of the Reuse Report (OSS equivalents with licence/maintenance
checks, public-data APIs with terms and rate limits, existing nonprofit
platforms to partner with) require outbound research and are **not yet done**.
AGPL-3.0 compatibility must be checked per candidate before adoption. No BUILD
NEW decision is final until these land.

---

## 2. Phases

Order per the prompt: Reuse Reports → approval → Phase 1 → Phase 2 → Phase 3.

### Phase 1 — Nonprofit parity + shared-goal Coalitions (Workstreams A, B minimum)

Smallest set that makes a nonprofit a first-class actor.

1. **Org verification.** EIN → IRS Tax Exempt Organization Search / Pub 78 /
   BMF, or ProPublica Nonprofit Explorer. Store org type: `501c3`, `501c4`,
   `coop`, `unincorporated`. Only `501c3` may surface receipt tooling, and the
   receipt is issued **by the org**, never by BMC.
   Flag: `FF_NONPROFIT_PARITY_V1`.
2. **0% BMC fee on donations / pledges / tips**, processor cost passed through.
   Implemented in the `platform-fee.ts` precedence chain as a
   transaction-kind rule, not a plan rule, so it cannot be confused with the
   commission ladder. Pending Open Decision 1.
3. **Shared-goal Coalition.** Goal + milestones + per-org role and contribution
   + public progress page + joint impact report. Extends the existing
   `collective-campaign` and Blackout Coalition services rather than adding a
   container.
4. **Money custody: split at checkout** direct to each org's own processor
   account. No pooled BMC custody. Pending Open Decision 2.

Not in Phase 1: restricted-fund ledger, donor receipts, grant exports, in-kind
intake. They follow once custody and fee decisions are settled.

### Phase 2 — Food-access pilot (Workstream E)

Operator's farm + 2–3 partner orgs. Paid boxes through FBM, sponsor-a-box
pledges, volunteer-shift quests. Requires `FF_VENDOR_QUESTS_V1` on.
**Acceptance: a full end-to-end run in Stripe test mode before any live money.**
Partner orgs pending Open Decision 4.

### Phase 3 — Program templates + earning model (Workstreams C, D)

Chapter-in-a-box: the minimum program set as templates, plus the per-program
revenue mapping. The co-op quest chain lands here — as a **definitions file**,
per the catalog's own rule that adding a quest is "a new file + registration,
never an engine change".

Jurisdiction handling is data-driven from the start: a jurisdiction table
covering all US states plus international. No hardcoded state anywhere.

---

## 3. Flags and environment

All new work ships behind flags, default off. Migrations reversible.

| Flag | Scope | Phase |
|---|---|---|
| `FF_NONPROFIT_PARITY_V1` | org verification, nonprofit fee rule | 1 |
| `FF_SHARED_GOAL_COALITION_V1` | shared-goal Coalitions | 1 |
| `FF_PROGRAM_TEMPLATES_V1` | chapter-in-a-box | 3 |
| `FF_VENDOR_QUESTS_V1` | **existing**, must be switched on for Phase 2 | 2 |

Any panel-side counterpart needs a `VITE_FF_*` ARG in the Dockerfile **and** a
line in `docker-build.yml`'s `panelargs` — see the blocker in §1.

---

## 4. Legal checkpoints

`docs/legal/checkpoints.md`. Surfaced, not resolved; each marked
**needs counsel**. Nothing in the product or docs presents legal or tax advice.

---

## 5. Security and privacy

- Signed webhooks, audit logs, PII minimisation. No third-party personal
  documents stored without a documented owner.
- **The private help-request flow must not be described as secure** until the
  Blackout `DecryptionError` issue (BO-1) is resolved or ruled out. Status of
  BO-1 unverified as of this writing — verify before any copy ships. This is the
  same class of defect as the Tor "active" claim: in a tool people may rely on
  for physical safety, an overstated guarantee is the highest-severity bug there
  is.
- User-triggered data export for org and help-request data. Reuses
  `src/lib/customer-data-registry.ts` + `customer-erasure.ts`; any new
  customer-referencing table must be registered there or the drift-guard test
  fails — add the entry, don't silence it.

---

## 6. Open decisions

| # | Question | Default if unanswered |
|---|---|---|
| 1 | 0% BMC fee on donations with processor pass-through? | Yes (Workstream A default) |
| 2 | Money custody: direct split to each org's processor, or BMC-run ledger with counsel sign-off? | Direct split, no BMC custody |
| 3 | Fiscal sponsorship: BMC supplies templates only, or partners with a sponsor org? | Templates only; BMC is not a party |
| 4 | Which 2–3 partner orgs for the pilot? | **Blocks Phase 2** |
| 5 | **New.** Is the $10/mo 0%-commission plan in scope? It does not exist and replaces the $29/$99/$249 ladder. | **Blocks nothing in Phase 1; treated as out of scope until answered** |
| 6 | **New.** Did "capital circles / first-order guarantee" mean `VendorAdvance` + `InvestmentPool`, or something genuinely new? | Treated as the existing two |

---

## Changelog

- **2026-10-01** — File opened. Internal inventory verified (Reuse step 0.1).
  Three prompt statuses corrected against the code; two new open decisions
  raised. Production-ship override recorded. No code written yet.
