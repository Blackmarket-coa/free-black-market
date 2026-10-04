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

**Not started in code. Decided in scope 2026-10-03** by the Black Mask launch
spec (`docs/BLACK_MASK_LAUNCH_PLAN.md` §4, F8), which lists the $10/month
0%-commission all-access plan as an existing FBM decision. The code still has no
such plan, so it is scheduled as work: add the plan, retire the $29/$99/$249
tiers with a migration path for current subscribers, and revisit the catalog
spec's "ladder only discounts / internal null" semantics. Open Decision 5 is
answered. The "flat 3% is never increased" rule is unaffected (0% is a decrease)
and is being honoured.

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

> **Amended 2026-10-03 (Black Mask launch spec): money comes off the ladder.**
> The reputation ladder below is unchanged — tiers, XP, quests and unlocks stay
> exactly as described. What changes is that **payouts no longer vary by tier**:
> the `split_pct` shares (0.60 Seedling → 0.72 Ancestor) and the per-node
> `GROWER_SPLIT_CONFIG` flatten to one share, as a payout migration with counsel
> review (legal checkpoint **L27**). See `docs/BLACK_MASK_LAUNCH_PLAN.md` §4 and
> F7. Not implemented yet.

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

### A blocker that turned out to be already fixed — recorded as a method failure

The first pass of this inventory reported that seven `VITE_FF_*` flags were
read by the panels but declared in neither Dockerfile nor passed by
`docker-build.yml`, leaving five built features permanently dark in every
published image.

**That was true of `ebff02ea` (14 Sep) and false of `main`.** It was fixed on
25 Sep by `965d9d40` ("build: pass feature-flag build args, stamp build SHA,
gate prod deploys on legal placeholders"), which declares all twelve ARGs
across the two panels and passes all seven from repo variables.

The error was procedural, not analytical: the branch was cut from a
six-day-old `main` and the diagnosis was run against the working tree without
re-checking `origin/main` first. Everything asserted about Vite's build-time
inlining and `enabled(undefined) === false` is still correct; the claim that
it was *live* was not.

**What survived:** `scripts/check-panel-feature-flags.mjs`, which `main` does
not have. It compares three lists — flags the reader consumes, flags the
Dockerfile declares *and* re-exports as `ENV`, flags the workflow passes — and
fails CI on drift. Verified to pass against `main`'s own wiring, so it ratifies
the existing fix rather than duplicating it, and it would have caught the
original gap.

**The standing lesson for this programme:** re-read `origin/main` before
diagnosing anything, and treat any inventory in this file as valid only as of
its stated commit.

### Step 0 progress

**0.2, 0.3 and 0.4 are done (2026-10-01)** — `docs/reuse/02-oss-equivalents.md`,
`03-public-data-and-apis.md` and `04-partner-platforms.md`. **Step 0 is
complete.** The BUILD NEW list in 0.4 §7 is four narrow items; **none starts
until the operator approves it**, and 0.4 §3–§6 were not fact-checked (see its
§9). Two of its checkpoints gate the open decisions directly: **L24** (Stripe
destination vs direct charges) gates Decision 2 on custody, and **L25**
(commercial co-venturer status) gates Decision 1 on the 0% donation fee.

Two results from 0.3 change the Phase 1 design rather than merely informing it,
so they are folded into the phase description below:

1. **IRS TEOS has no API.** It publishes monthly, pipe-delimited bulk files
   (Pub 78 Data, EO BMF, the 990 series, and the Automatic Revocation list).
   ProPublica's Nonprofit Explorer *does* have a keyless v2 API, but its own
   docs publish no rate limit and say the API is "subject to change". So the
   IRS bulk files become the **system of record** and ProPublica is enrichment
   only — not the other way round, which is the tempting build because the API
   is easier to call.
2. **Open Referral HSDS 3.0 already exists**, licensed CC-BY-SA-4.0, and is
   already consumed by findhelp, United Way 211 and Unite Us. Any partner or
   resource directory should speak that format instead of accumulating
   bilateral integrations. It also reframes 0.4: the question is "who already
   publishes or consumes an HSDS feed", not "who will grant us API access".

From 0.2, the one adoption trap worth carrying forward: **Karrio has a paid
Enterprise Edition** above its Apache-2.0 core, so the existing
`label-provider.ts` seam must pin the OSS edition explicitly. Liveness checks
(last commit, maintainers, whether it runs on the DL360) could not be done —
this session's GitHub access is scoped to the three BMC repos and
`api.github.com` 403s for third parties — and are still owed.

---

## 2. Phases

Order per the prompt: Reuse Reports → approval → Phase 1 → Phase 2 → Phase 3.

### Phase 1 — Nonprofit parity + shared-goal Coalitions (Workstreams A, B minimum)

Smallest set that makes a nonprofit a first-class actor.

1. **Org verification.** EIN → a **monthly ingest of the IRS bulk files**
   (Pub 78 Data for deductibility eligibility, EO BMF for determination, and
   the **Automatic Revocation list**, which is the one that stops BMC vouching
   for an org whose status has lapsed). ProPublica Nonprofit Explorer is
   enrichment only — see 0.3 for why. Store org type: `501c3`, `501c4`,
   `coop`, `unincorporated`. Only `501c3` may surface receipt tooling, and the
   receipt is issued **by the org**, never by BMC.
   Three constraints that fall out of the data rather than the design:
   - **Show the as-of date.** "Verified" means verified against the file
     published on a given date, not verified live. The UI must say which.
   - **"Not found" is not "not a charity."** Absence from Pub 78 and presence
     on the Automatic Revocation list are different states and must not
     collapse into one `unverified` value.
   - Monthly refresh is not a compromise — it is the actual resolution of the
     upstream data.
   Flag: `FF_NONPROFIT_PARITY_V1`. Legal checkpoints **L11** (representing a
   third party's tax status) and **L14** (ProPublica terms unread).
2. **0% BMC fee on donations / pledges / tips**, processor cost passed through.
   Implemented in the `platform-fee.ts` precedence chain as a
   transaction-kind rule, not a plan rule, so it cannot be confused with the
   commission ladder. **Decision 1 answered 2026-10-03: yes.**
3. **Shared-goal Coalition.** Goal + milestones + per-org role and contribution
   + public progress page + joint impact report. Extends the existing
   `collective-campaign` and Blackout Coalition services rather than adding a
   container.
4. **Money custody: split at checkout** direct to each org's own processor
   account. No pooled BMC custody. **Decision 2 answered 2026-10-03: BMC
   executes the split as one direct charge per org, plus a record-only
   ledger** (see §6 for the custody reading).

Not in Phase 1: restricted-fund ledger, donor receipts, grant exports, in-kind
intake. They follow once custody and fee decisions are settled.

### Phase 2 — Food-access pilot (Workstream E)

Operator's farm + 2–3 partner orgs. Paid boxes through FBM, sponsor-a-box
pledges, volunteer-shift quests. Requires `FF_VENDOR_QUESTS_V1` on.
**Acceptance: a full end-to-end run in Stripe test mode before any live money.**
Partner orgs: **Ground Up Liberation Project (GULP) decided 2026-10-03**; two
more still open (Decision 4).

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

| # | Question | Default if unanswered | Decision (operator, 2026-10-03) |
|---|---|---|---|
| 1 | 0% BMC fee on donations with processor pass-through? | Yes (Workstream A default) | **Decided: yes.** 0% BMC fee on donations, pledges and tips; processor cost passed through. Implemented as a transaction-kind rule in the platform-fee precedence chain, never as a plan rule. L25 (commercial co-venturer status at checkout) still has to be cleared by counsel before this is switched on for live money; the flag ships default-off. |
| 2 | Money custody: direct split to each org's processor, or BMC-run ledger with counsel sign-off? | Direct split, no BMC custody | **Decided: direct split, with a ledger, and the split is done by BMC** (operator, 2026-10-03, two messages). Read as: BMC's checkout computes and executes the split -- it issues **one direct Stripe Connect charge per recipient org**, each landing on that org's own connected account, and writes every leg to a BMC-side **ledger that records and never holds funds**. BMC does the split in software; no money transits an FBM balance. That is the one shape that keeps Posture A intact. The other way to "do the split" -- a single charge into FBM's Stripe balance followed by transfers out (Stripe's separate-charges-and-transfers or destination charges) -- is custody, is what **L24** exists for, and is not built unless counsel clears it in writing. If the operator specifically wants funds to transit BMC, that is an L24 answer, not a code change. |
| 3 | Fiscal sponsorship: BMC supplies templates only, or partners with a sponsor org? | Templates only; BMC is not a party | **Decided: both.** BMC supplies the templates (Open Referral Data Collaboration Toolkit MOU, adapted -- L18) *and* partners with a sponsor org for groups that need a fiscal host (Open Collective hosts such as Raft; Zeffy for EIN-only groups, per 0.4 §6). BMC itself is still not a party to any sponsorship and holds no partner money. The sponsor-org relationship is a partner record with the "host + collective" shape from 0.4 §7, not a BMC product. |
| 4 | Which 2–3 partner orgs for the pilot? | **Blocks Phase 2** | **Decided: Ground Up Liberation Project (GULP)** is the first pilot partner; a partner record is to be created for it. Only the name is known at decision time -- EIN, org type, fiscal host and contact are to be supplied by the operator, and the record stays unverified and unpublished until they are. Second and third partners still open; one partner is enough to unblock the Phase 2 build but not the live pilot. |
| 5 | **New.** Is the $10/mo 0%-commission plan in scope? It does not exist and replaces the $29/$99/$249 ladder. | **Blocks nothing in Phase 1; treated as out of scope until answered** | **Decided: in scope** (Black Mask launch spec, 2026-10-03, which treats it as an existing decision). Not built; scheduled as `docs/BLACK_MASK_LAUNCH_PLAN.md` F8. Not part of the Phase 1 nonprofit-parity slices. |
| 6 | **New.** Did "capital circles / first-order guarantee" mean `VendorAdvance` + `InvestmentPool`, or something genuinely new? | Treated as the existing two | **Decided: the existing two, extended to nonprofits -- and the InvestmentPool is carried by a nonprofit, not by BMC** (operator, 2026-10-03, two messages). Concretely: (a) `VendorAdvance` gains verified nonprofit orgs as eligible recipients alongside vendors; (b) every `InvestmentPool` gets a **carrier**: a verified nonprofit partner record that holds and administers the pool's funds on its own accounts, under its own governance. BMC runs the software and the ledger, records every contribution and distribution, and **never holds pool funds** -- the same no-custody shape as Decision 2. A pool with no carrier cannot accept money. Both gated on the org-verification status from Phase 1 item 1 and behind `FF_NONPROFIT_PARITY_V1`. Nothing new is built. **New legal checkpoint L26** (securities, private benefit, charitable solicitation, now with the nonprofit as the issuing/operating party); counsel before any carried pool goes live. Scoped as Phase 1b: after items 1-4 land. |
| 7 | **New (Phase 1b).** Does FBM build the public **contribution flow for a carried pool** (a contributor paying the carrier through FBM, by direct charge on the carrier's connected account like S9)? That flow *is* the offering: with it, BMC matches contributors to a revenue-sharing pool it does not carry. | Not built; a carried pool is read-only on the storefront and the operator records what the carrier received (P1-14). | **Open — needs counsel on L26 / L3 first.** Not a code question. |
| 8 | **New (Phase 1b).** What happens to **ledger money already inside an uncarried pool** when `FF_NONPROFIT_PARITY_V1` turns on? Today a refund leg out of such a pool is refused mid-refund by the no-custody guard (P1-14). Options: (a) require every legacy pool to be emptied (withdraw / refund) before the flag; (b) allow refund legs *out* of a legacy pool but never *in*; (c) migrate legacy pools to carriers. | (a): the flag is set nowhere, and there are no production pools (the offering has always been dark). | **Open — operator.** Blocks setting the flag on a database that has pool balances; blocks nothing otherwise. |

---

## Changelog

- **2026-10-04 (part E, Phase 1b)** — S12 (a verified nonprofit as an
  InvestmentPool's **carrier**: frozen verification snapshot on the pool, a
  service-layer guard in `createTransfer` so no pool ledger leg exists with the
  flag on and a carried pool never gets one at all, record-only carrier
  contributions and distributions with derived totals) and S13 (verified
  nonprofits as record-only VendorAdvance recipients: operator-stated
  eligibility, no auto-approve, one conditional-update approval carrying the
  external disbursement reference, manual repayments idempotent by reference,
  no ledger account or entry for the org) built on the part-E branch,
  default-off; ledger rows P1-14, P1-15. Both migrations first reconcile the
  pre-existing model/DDL drift that made those tables un-insertable on a
  migration-built database. Two decisions deliberately NOT taken in code and
  added to §6 as 7 and 8. Go-live waits on L26.
- **2026-10-04 (part D)** — S11 (shared-goal Coalitions as a `goal_kind` on
  `collective-campaign`: participants, milestones, 0% fee, public progress and
  joint impact report; contributions counted from the S9 direct-charge webhook
  by one row per PaymentIntent, totals derived, full refunds reversed; no
  backings, no escrow, no custody) built on the part-D branch, default-off;
  ledger row P1-13. **All four Phase 1 items are now built.** Live money still
  waits on L24 / L25; Phase 1b (L26) is next.
- **2026-10-04 (part C)** — S9 (direct-charge donation checkout on the org's own
  Stripe account, record-only `donation_split_record`, service-layer guard,
  `stripe-connect-direct` provider, Connect webhook; Posture A doc corrected to
  what the specs assert) and S10 (accrual subscriber, batch disbursement and
  `ledger_batch` retired under the flag) built on the part-C branch, default-off;
  ledger rows P1-10, P1-11. Phase 1 items 1, 2 and 4 are now built; item 3
  (shared-goal Coalitions) remains. Live money waits on L24 / L25.
- **2026-10-04 (part B)** — S2 (cross-app flag wiring; storefront now under the
  drift guard; admin-panel deliberately unwired) and S8 (IRS lookup wired into
  partner verification: `applyIrsLookup` as the only writer, admin verify route,
  post-ingest re-verify, auto-unpublish on revoked / not_found, storefront badge
  copy) built on the part-B branch, default-off; ledger rows P1-8, P1-9.
- **2026-10-04** — Phase 1 slices S1 (flags), S3+S4 (0% donation rung + DONATION
  line), S5+S6 (`partner_org` record, admin CRUD, GULP seed) and S7 (IRS
  exempt-org ingest) built on the working branch, all default-off; ledger rows
  P1-1 … P1-7 in `docs/AUDIT_DEBT.md`. Operator's Black Mask launch spec recorded
  in `docs/BLACK_MASK_LAUNCH_PLAN.md`; it answers Open Decision 5 (the $10 plan
  is in scope) and amends 0.3 (money comes off the KARMA ladder, L27). Legal
  checkpoints L27–L31 added.
- **2026-10-03** — Operator answered Open Decisions 1–4: 0% on donations;
  direct split executed by BMC as one direct charge per org, with a
  record-only ledger (no custody); fiscal sponsorship via
  partner sponsor orgs *and* templates; GULP named as the first pilot partner.
  Decision 6 answered later the same day, in two parts: the existing
  `VendorAdvance` + `InvestmentPool`, extended to verified nonprofits, with
  every InvestmentPool **carried by a nonprofit** that holds the funds -- BMC
  keeps the ledger and no custody (Phase 1b, new checkpoint L26). Decision 5
  stays on its default. Phase 1 build starts.
- **2026-10-01** — Panel feature-flag wiring fixed in both panels, with a CI
  drift guard. Unblocks any panel-side flag this programme adds.
- **2026-10-01** — File opened. Internal inventory verified (Reuse step 0.1).
  Three prompt statuses corrected against the code; two new open decisions
  raised. Production-ship override recorded. No code written yet.
