# CCR/HRS ignition — state assessment (Move 4)

What it would actually take to get Coalition Credits and time-bank hours
circulating. Grounded in a full sweep of `backend/src` (2026-08-14); every
claim cites its file. Companion to `docs/SNAP_EBT_RESEARCH.md` (the other
half of Move 4) and `docs/POSTURE_A_COMPLIANCE.md`.

**Verdict: the economy is fully specified and not ignited.** The rail
registry, Posture A guards, time-bank vocabulary, and reconciler are all
real and tested — and there is no live path by which a single CCR or HRS
unit enters circulation. This is not one missing feature; it is a short
chain of five missing links, each small, plus a set of latent guard
violations that must be defused *before* the first CCR wallet exists (the
same failure class Move 1 fixed for `DEMAND_BOUNTY`).

## 1. What is live today

- **One CCR mint**, behind `FBM_CREATOR_CREDITS_LIVE=1`: XP → CCR
  conversion (1,000 XP → 50₡) debiting the system issuer RESERVE into a
  creator's `CREATOR_EARNINGS`-CCR account
  (`api/vendor/creator/credits/convert-xp/route.ts:100-111`,
  `lib/creator-credits.ts:29-31`). It passes Posture A via the
  `CREDIT_PAYOUT_MINT` issuer bypass (`posture-a-guard.ts:74-79`). Its
  matching burn is the withdraw route (`credits/withdraw/route.ts:55-68`).
- **A rich set of sinks** — checkout escrow, demand pools, bounties,
  campaign escrow, payouts, revenue shares
  (`hawala-ledger/service.ts:1363-1399`, `services/collective-hawala.ts`,
  `payout-breakdown/grower-payout.ts:212-221`) — every one of which debits
  a **USD**-denominated account today, because every user wallet is USD.
- **The reconciler** (15-min job,
  `jobs/asset-graph-settlement-reconciler.ts:39-76`) that would write CCR,
  HRS, and KARMA from asset-graph settlement records — sweeping an empty
  queue forever.

## 2. The blocker chain (ordered)

1. **The issuer holds nothing and cannot be funded in-repo.** The CCR
   issuer RESERVE is lazily created at balance 0
   (`lib/creator-hub.ts:94-112`); `createTransfer` refuses overdrafts
   (`hawala-ledger/service.ts:884-887`); no admin path writes a balance
   (`api/admin/hawala/accounts/[id]/route.ts:31-52`); `ISSUE`/`BURN` are
   declared in the guard's issuer set (`posture-a-guard.ts:74-79`) but
   absent from the `entry_type` enum (`models/ledger-entry.ts:31-55`) and
   have zero callers. Funding is "an ops step" with no tool
   (`creator-hub.ts:88-92`). → **Needs: an `ISSUE` entry type + a
   governed issuance script.** Until then even the one live mint 500s on
   an empty issuer.
2. **No member can hold CCR.** The registry says CCR lives on
   `USER_WALLET` (`rails.ts:94`); the only CCR account factory makes
   `CREATOR_EARNINGS` (`creator-hub.ts:64-78`); wallet creation defaults
   to USD (`api/store/hawala/wallet/route.ts:30-34`,
   `service.ts:71`). The reconciler looks up `USER_WALLET`+CCR
   (`asset-graph/reconciler.ts:262-275`) and will never find one.
   → **Needs: a policy decision** (who gets a CCR wallet, when) **and
   either wallet provisioning or a registry correction** — the drift
   between `rails.ts:94` and reality must be resolved deliberately, not
   papered over.
3. **Nothing emits settlement records.** `emitSettlementRecord`
   (`asset-graph/service.ts:374`) and `composeSettlement`
   (`settlement.ts:251`) are called only from tests. The reconciler is
   the *sole* HRS writer, the *sole* KARMA writer, and one of two CCR
   writers — so three rails have zero producers. → **Needs: the first
   real emitter** (the manifest recipes that declare `hours`/`karma` —
   childcare, courier-collective, tool-library
   (`manifests/childcare.ts:129` etc.) — are the natural first sites).
4. **No TIME_BANK account is ever created.** `grep TIME_BANK` finds the
   registry, the model enum, the reconciler, and tests — no factory, no
   route (`rails.ts:138`, `reconciler.ts:277-286`). The intended opening
   mechanism — `HOURS_OPEN_BALANCE`/`HOURS_ARCHIVE_BALANCE`
   (`posture-a-guard.ts:192-195`) and `TIMEBANK_OPEN_BALANCE`
   (`posture-a-guard.ts:183`) — is declared with no callers. → **Needs:
   time-bank provisioning + the open-balance writer.** This is HRS's
   literal ignition switch.
5. **The gates are undocumented.** `HAWALA_CCR_GUARD_MODE`,
   `FBM_CREATOR_CREDITS_LIVE`, `FBM_CAMPAIGN_ESCROW_LIVE` are read raw
   off `process.env` and appear in neither `docs/ENV_CONFIGURATION.md`
   nor the validated schema (`shared/config.ts`). → **Needs: schema +
   docs entries** so ignition is an operator action, not archaeology.

## 3. Defuse before wallets ship: latent Posture A violations

The blessed CCR purchase-context set is exactly nine values
(`posture-a-guard.ts:51-66`); only `ORDER`, `REFUND`,
`CREATOR_ATTRIBUTION`, and `DEMAND_BOUNTY` have live producers — `CART`,
`PAYOUT`, `ESCROW_FUND`, `ESCROW_RELEASE`, `SUBSCRIPTION_RENEWAL` are
posted nowhere. Meanwhile these money paths post reference types *outside*
the set and would throw `ClosedLoopViolationError` in strict mode the
moment their debit account is CCR — latent only because no CCR wallet
exists yet (`docs/POSTURE_A_COMPLIANCE.md:155-160` records this exact
class for `DEMAND_BOUNTY`):

| Path | reference_type | Site |
| --- | --- | --- |
| Campaign escrow (all legs) | `MANUAL` | `service.ts:520-644` |
| Creator credit mint/burn | `MANUAL` (issuer-bypassed today) | `convert-xp/route.ts`, `withdraw/route.ts` |
| Sponsorship escrow/release | `SPONSORSHIP` | `collective-hawala.ts:583-651` |
| Payout request + fee | `PAYOUT_REQUEST` | `service.ts:2128-2146` |
| Vendor advance + repayment | `VENDOR_ADVANCE` | `service.ts:2326-2385` |
| Stripe payment record | `STRIPE_PAYMENT` | `service.ts:1291,1319` |
| Creator reward pool | `CREATOR_REWARD_POOL` | `service.ts:282,319` |

Each needs the Move 1 treatment before step 2 of the chain: either enter
the blessed set deliberately (with the parity spec updated —
`__tests__/reference-type-parity.unit.spec.ts`) or carry a purchase
context. Two documentation defects belong to the same cleanup:
`docs/POSTURE_A_COMPLIANCE.md:68-72` claims a purchase-context middleware,
cart workflow hooks, and a nightly reaper that do not exist
(`api/hawala-validation.ts` is a schema library; no `x-purchase-context`
anywhere), and `createTransferSchema` (`hawala-validation.ts:141-147`) is
dead code the admin route never imports.

## 4. Fixed with this assessment: cross-rail leakage

`createTransfer` derived the entry's rail from the **debit** account only
(`service.ts:873-882, 899`) and never compared the two legs' currencies —
a CCR-debit → USD-credit transfer would pass the CCR guard and inflate a
USD balance: closed-loop value escaping into a cash-rail account. Harmless
today (every account is USD) and exactly the kind of latent money defect
Move 1 existed to catch, so the guard ships with this document: mismatched
legs now throw before any balance moves, pinned by a regression spec.
(The GIFT rail's zero-amount barter records on USD wallets
(`barter/[proposalId]/accept/route.ts:61-80`) are unaffected — same
currency both legs.)

## 5. Recommended ignition sequence

Small, ordered, each independently shippable — **pending the two policy
answers only the operator can give**: (a) who gets CCR wallets and when;
(b) what governs issuance volume (the issuer RESERVE is the monetary
policy instrument).

1. `ISSUE`/`BURN` entry types + governed issuance script (chain link 1).
2. The §3 reference-type defusal + Posture A doc correction.
3. Resolve the `rails.ts:94` registry drift; CCR wallet provisioning per
   policy (a).
4. Time-bank provisioning + `TIMEBANK_OPEN_BALANCE` writer (HRS switch).
5. First settlement-record emitter on one manifest recipe (childcare or
   tool-library), lighting the reconciler.
6. Env schema + `ENV_CONFIGURATION.md` entries for the three raw flags.

Steps 1–2 are pure engineering and safe now; 3–5 follow the policy calls;
6 rides with any of them. The SNAP/EBT track (companion doc) stays
entirely on the cash rails and is unaffected by all of this — its only
join point is the GusNIP incentive pattern, which would arrive as a
purchase-context-restricted CCR grant *after* ignition.
