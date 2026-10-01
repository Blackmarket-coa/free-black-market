# Legal and compliance checkpoints — survival programs / nonprofit parity

**Every item here is `needs counsel`.** This file exists to make the questions
visible and locate them in the code. It states no legal conclusion, and nothing
in it — or in the product — is legal or tax advice.

Opened 2026-10-01 alongside `docs/BMC_SURVIVAL_PROGRAMS.md`.

A note on sequencing, since production shipping is now on: these are **not**
deployment-process rules. Deploying does not resolve any of them, and most
attach to the partner org rather than to BMC. The plan keeps the features that
touch them behind flags so the decision to ship code and the decision to cross a
legal line stay separate.

---

| # | Checkpoint | Where it attaches in the code | Status |
|---|---|---|---|
| L1 | **Charitable solicitation registration varies by state** (and country). Most US states require a charity to register before soliciting there; several regulate the platform that facilitates it. | Donation/pledge entry points added in Phase 1; the jurisdiction table driving Workstream C. Attaches per receiving org × per solicited jurisdiction, not once. | needs counsel |
| L2 | **Restricted gifts must be honoured.** A gift given for a stated purpose cannot be spent on another. | The restricted/unrestricted split in the Workstream A ledger. Enforcement must be a write-time constraint, not a reporting view. | needs counsel |
| L3 | **Securities law** for investment-shaped capital features. | `InvestmentPool` / `Investment` in `hawala-ledger`, gated by `FF_INVESTMENT_POOLS_V1`. Already off. Also `VendorAdvance` / `FF_VENDOR_ADVANCES_V1`. `docs/POSTURE_A_COMPLIANCE.md` § quiescent models. | needs counsel — **already gated** |
| L4 | **Money-transmitter and fiduciary exposure if funds are pooled.** | Avoided by the Workstream B default: split at checkout to each org's own processor, no BMC custody. If Open Decision 2 changes to a BMC-run ledger, this becomes live and joins L3 under `PRE_LAUNCH_AUDIT.md` §5-C. Related standing gate: **ACH payouts stay disabled** (`REPO_CONSOLIDATION_REVIEW.md` §8). | needs counsel if custody changes |
| L5 | **Unrelated business income tax (UBIT)** on earned income inside a nonprofit. | Workstream D — every program that earns (boxes, courses, subscriptions, bounties). Affects the partner org's filings, not BMC's. | needs counsel |
| L6 | **Grants to non-charities** carry extra diligence and expenditure-responsibility rules for the granting org. | Workstream B cross-sponsorship and matching, where a (c)(3) supports an unincorporated group. | needs counsel |
| L7 | **1099-B reporting for organised barter.** Barter exchanges have an information-reporting obligation. | `barter` module; any in-kind swap in Workstream B ("farm surplus for delivery capacity"). Noted in `COMMERCE_ROADMAP.md` §5 as a gate **not** present in the canonical §8 list — so nobody reading the canonical gates will honour it. | needs counsel — **and needs promoting into §8** |
| L8 | **Health claims; clinic and legal-aid licensing.** BMC coordinates, never provides. | Workstream C health and legal templates. The existing health-claims guardrail applies. Directory integrations must not shade into referral or advice. | needs counsel |
| L9 | **501(c)(3) lobbying and electoral limits.** (c)(3)s face strict limits; (c)(4)s differ. | Workstream C civic leverage — voter registration and petition links must stay nonpartisan, and the org-type field from Phase 1 verification should drive what a given org can surface. | needs counsel |
| L10 | **Deductibility and receipting.** Only a (c)(3) can issue a deductible receipt, and the receipt comes from the org. | Phase 1 org verification + Workstream A receipts. **Copy rule: the UI must never imply tax advice or deductibility.** A lint or copy check is cheaper than a retraction. | needs counsel |

---

## Carried from the existing gate list

Two items in `COMMERCE_ROADMAP.md` §5 are named there but absent from
`REPO_CONSOLIDATION_REVIEW.md` §8, which is the list people actually consult:

- 1099-B exposure (L7 above)
- legal review of a KARMA-linked pricing rebase

Promoting them into §8 is an operator decision; a roadmap document cannot
promote itself. Until that happens they are known holes, not gates.

## How to use this file

- Adding a feature that touches a row: link the PR here, keep the status.
- A row moves off `needs counsel` only when counsel has answered **in writing**
  and the answer is recorded, with date and scope.
- A row is never closed because the code shipped.
