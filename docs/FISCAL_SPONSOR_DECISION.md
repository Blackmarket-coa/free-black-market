# Fiscal Sponsor Decision

> Resolves the "Fiscal sponsor selection" open question from
> `docs/POSTURE_A_COMPLIANCE.md`.
>
> **Status**: Recommended default — **Allied Media Projects (AMP)**.
> Pending: signed fiscal sponsorship agreement, board sign-off, and
> initial $10k+ test disbursement before going live. Until the
> agreement is signed, the donation widget surfaces "pending fiscal
> sponsor" copy and the disbursement job is held.

## Why we need a fiscal sponsor at all

Under Posture A, FBM is a payment facilitator — not a charity, not a
501(c)(3). When a buyer adds a donation at checkout (or a vendor
elects to route a portion of revenue to mutual aid), the donor MUST
have a 501(c)(3) recipient of record to:

1. Receive the legal tax-deductible-receipt counterparty role.
2. Handle state charity registration (≈40 states require registration
   for any org soliciting donations from their residents — a per-state
   compliance burden FBM cannot absorb at this stage).
3. Issue donor receipts at year-end with the sponsor's EIN.
4. Disburse to the actual beneficiary (a non-501(c)(3) mutual-aid
   network, an unincorporated community fridge, an individual
   recipient under the sponsor's grantmaking program, etc.).

FBM is the routing layer. The fiscal sponsor is the receipt-issuing
counterparty.

## Candidates and evaluation

We evaluated four candidates surfaced in
`docs/POSTURE_A_COMPLIANCE.md`'s open-questions section. Criteria
weighted by what FBM-v1 actually needs at this stage: cooperative-/
movement-aligned mission, manageable fee structure, willingness to
sponsor unincorporated mutual-aid recipients, and a clear path to
batched disbursements over Stripe ACH.

| Criterion                          | AMP                                                                            | NEO Philanthropy                                                                | Tides Foundation                                                                | Local SELC-recommended (TBD)                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Mission alignment                  | High — Detroit-rooted, sponsors solidarity-economy projects.                   | Medium — national social-change focus; less cooperative-specific.               | Medium — broad progressive philanthropy; cooperative-economy is one wedge.      | High by definition — SELC vets for solidarity-economy fit.                    |
| Fee structure (admin / regrant)    | ~7 % of revenue; published rate.                                               | ~10 % (negotiated; some projects lower).                                        | ~8–10 % standard tier.                                                          | Variable; often 5–7 %, sometimes lower for small sponsors.                    |
| State charity-registration cover.  | Yes — AMP files where required.                                                | Yes — full national coverage.                                                   | Yes — full national coverage.                                                   | Varies; smaller sponsors may not file in all 40 states.                       |
| Tolerance for unincorporated bene. | High — explicit comfort with mutual-aid pods, community fridges, free stores.  | Medium — case-by-case; tends toward established nonprofits.                     | Medium — case-by-case.                                                          | High — SELC's recommendations skew toward solidarity-economy operators.       |
| Onboarding time                    | 60–90 days typical.                                                            | 90–120 days.                                                                    | 90–120 days.                                                                    | 30–60 days for established sponsors; longer for newer.                        |
| Stripe-ACH integration             | Receives via standard ACH; no platform-side integration needed.                | Same.                                                                           | Same.                                                                           | Same.                                                                         |
| Operational maturity for scale     | Medium — well-run but smaller than NEO/Tides.                                  | High — institutional, supports large grantee portfolios.                        | High — largest of the four; longest track record.                               | Low–medium; varies sharply by sponsor.                                        |
| Risk of mission drift / governance | Low — board includes movement-aligned members.                                 | Medium — large institutional board; less direct accountability.                 | Medium — same.                                                                  | Varies.                                                                       |

## Recommendation: Allied Media Projects (AMP)

Reasoning, in order of weight:

1. **Mission fit is the dominant signal at this stage.** FBM-v1 routes
   donations to community fridges, mutual-aid pods, and free stores —
   the exact recipient profile AMP already sponsors. NEO and Tides
   sponsor causes orthogonal to cooperative commerce; the fit is
   weaker.

2. **Tolerance for unincorporated beneficiaries is a hard requirement.**
   Most of FBM's actual donation traffic will flow to recipients that
   are not themselves 501(c)(3)s. AMP's existing grantee portfolio
   demonstrates the operational pattern; NEO and Tides require more
   per-recipient diligence.

3. **Fee structure is competitive.** AMP's ~7 % is on par with the
   field; NEO and Tides are typically 10 %.

4. **Onboarding is fast enough for v1.** 60–90 days is compatible with
   FBM's launch window. A faster local SELC sponsor would shorten this
   but at the cost of mission-fit certainty.

5. **Risk of mission drift is lowest.** AMP's governance structure
   keeps the fiscal sponsor accountable to the movement it sponsors —
   important because FBM is the routing layer, but AMP is the entity
   that signs receipts and faces donors.

**Trade-offs accepted**:

- **Scale capacity is lower than NEO/Tides.** If donation volume
  exceeds AMP's ability to administer (rough threshold: ~$1M/year), we
  expect to transition to a second sponsor. The code path is
  env-driven so that transition is a config change, not a refactor.
- **State coverage may have edges.** AMP files in the states it needs
  to; we expect FBM to start in a single state (Michigan, where AMP
  is based) and expand as the sponsor's footprint allows. The
  storefront should not solicit donations from out-of-coverage
  states until AMP confirms it's registered there.

## Working assumption vs. live status

This document records the **working recommendation**. The code in
`backend/src/modules/donation/fiscal-sponsors.ts` ships AMP as the
default but reads `FBM_FISCAL_SPONSOR_PROVIDER` from env so the
deployment owner can override (e.g. for a staging environment that
routes to a sandbox sponsor, or after a future transition).

The recommendation does **not** itself constitute a contract. Going
live requires:

- A signed fiscal sponsorship agreement between FBM (or its operating
  entity) and AMP.
- AMP-side onboarding: KYC on the FBM org, banking instructions
  exchange, sample disbursement run.
- A test transfer of ≥ $10,000 to AMP, confirmed received and posted
  on AMP's books, before the donation widget switches from "pending"
  to "live".
- Board minute recording the selection and the agreed fee.

Until those items are complete, the donation widget surfaces "pending
fiscal sponsor — routing held" and the donation-batch-disbursement
job no-ops on AMP-routed disbursements. See
`getOrCreateDefaultSettings()` in
`backend/src/modules/donation/service.ts` — when the configured
sponsor's `live` flag is false, settlement_mode is forced to
`ledger_batch` and disbursements stay in `pending` status until the
flag flips.

## Switching the sponsor later

The sponsor selection is **swappable**. If we transition to NEO,
Tides, or a local SELC sponsor:

1. Add the new sponsor entry to `FISCAL_SPONSORS` in
   `backend/src/modules/donation/fiscal-sponsors.ts`.
2. Set `FBM_FISCAL_SPONSOR_PROVIDER=<new_key>` in production env.
3. Update `donation_settings.fiscal_sponsor_account_id` to the new
   sponsor's LedgerAccount via the admin UI (or
   `upsertDefaultSettings`).
4. Update this document; record the date and reason of the switch in
   the changelog section below.

A future migration that changes the recipient of past donations
requires the prior sponsor's release and the new sponsor's acceptance
— that is a legal step, not a code change.

## Open items (post-recommendation)

- [ ] Board minute approving AMP as the working default.
- [ ] Outreach to AMP intake on the FBM use case (volume, recipient
      profile, fee negotiation).
- [ ] Draft fiscal sponsorship agreement reviewed by counsel.
- [ ] State-by-state charity-registration footprint confirmed against
      FBM's launch geography.
- [ ] LedgerAccount for AMP set up in the hawala ledger (`ledger_account`
      row with `subject_type = "fiscal_sponsor"`).
- [ ] Set `FBM_FISCAL_SPONSOR_LIVE=true` once the test transfer
      clears.

## Changelog

- 2026-05-11 — Initial decision: AMP recommended as default. Pending
  agreement.

## References

- `docs/POSTURE_A_COMPLIANCE.md` § "All donation receipts route
  through a 501(c)(3) fiscal sponsor".
- `backend/src/modules/donation/models/donation-settings.ts`
- `backend/src/modules/donation/fiscal-sponsors.ts` — registry shipped
  by this decision.
- SELC Mutual Aid Toolkit (donation routing recommendations).
