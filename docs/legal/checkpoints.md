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
| L11 | **Representing a third party's tax status.** Surfacing IRS Pub 78 / EO BMF status, or an Automatic Revocation entry, is BMC asserting something about another organisation on a monthly-stale file. | Phase 1 org verification. The as-of date of the ingested IRS file must be displayed, and "not found in Pub 78" must not render as "not a charity" — those are different states. See `docs/reuse/03-public-data-and-apis.md`. | needs counsel |
| L12 | **CC-BY-SA-4.0 on the HSDS specification.** Open Referral's spec and docs are Attribution-ShareAlike; whether reproducing schema fragments in FBM's own models or docs triggers the share-alike term is unresolved. | Any partner-directory work that adopts HSDS 3.0 as its interchange format. | needs counsel |
| L13 | **Republishing partner directory data.** Source licence and partner consent are separate permissions; having the former is not having the latter. | Partner directory / Workstream C integrations. | needs counsel |
| L14 | **ProPublica Data Terms of Use have not been read line-by-line.** The Nonprofit Explorer API requires no key and publishes no rate limit, which makes it easy to depend on before anyone has checked what the terms permit. | Any use of `projects.propublica.org/nonprofits/api/v2`. Mitigated in the current design by making IRS bulk files the system of record and ProPublica enrichment-only. | needs counsel before shipping that dependency |
| L15 | **Feed America feed licence conflict.** The HSDS feed, datapackage and Terms say CC BY-SA 4.0; the footer and HTTP headers say CC BY 4.0. Which governs, and what share-alike means for an FBM feed derived partly from it. | Any ingest of `feedam.org/hsds/v3`. `docs/reuse/04-partner-platforms.md` §2, §5. | needs counsel |
| L16 | **Third-party terms reaching records that arrive via an aggregator.** AmpleHarvest's terms forbid any automated data access; Feed America's feed appears to contain AmpleHarvest-derived pantry records. | Ingest filtering by record provenance. §5. | needs counsel |
| L17 | **211HSIS taxonomy codes inside ingested HSDS records.** The taxonomy is a paid licence held by 211 LA County. Whether storing, displaying, or republishing codes carried in a partner's feed is use "as part of a licensed product", and whether stripping to free text avoids it. Inform USA standards require published directories to use an open taxonomy *or* map to 211HSIS. | FBM's `taxonomy_terms` endpoint and any 211-sourced record. §2, §3. | needs counsel |
| L18 | **Adapting the Open Referral partnership memorandum.** The Data Collaboration Toolkit's MOU template is draft, CC BY-SA, and written for public-agency coalitions; BMC has no legal entity to be the signatory. | Any partner agreement. §2, §7. | needs counsel |
| L19 | **Naming an organisation as a "partner".** Feeding America member banks and agencies, AmpleHarvest (trademark terms), and any org listed as "verified" — whether a directory listing implies endorsement or requires written consent. | Partner directory publication. §5. | needs counsel |
| L20 | **Publishing an HSDS feed with no auth exposes partner contact data in bulk.** The spec specifies no authentication; Mutual Aid LA took its directory offline over safety of groups and individuals. Partner consent, default-private fields, and group-controlled publication before any feed leaves a feature flag. | HSDS publish path; directory data model. §4, §7. | needs counsel — **and a design constraint now** |
| L21 | **SNAP Online: who is "the retailer".** USDA FNS requires an authorised retailer, a third-party processor, no guest checkout and eligible-item flagging. Whether a multi-vendor marketplace can be the retailer or each vendor must be authorised separately is not answered on the public pages. MarketLink eligibility is per individual producer. | Any SNAP feature; cart architecture. §5. | needs counsel |
| L22 | **EBT settlement via a third-party processor vs Posture A.** Forage settles EBT funds to the authorised merchant; how that transit interacts with the no-balance-holding condition of the payment-processor exemption. | `hawala-ledger` Posture A guard; any Forage integration. §5. `docs/POSTURE_A_COMPLIANCE.md`. | needs counsel |
| L23 | **Paid produce alongside donated produce under TEFAP Farm to Food Bank.** Whether "sponsor-a-box" paid boxes can coexist with reimbursed donated produce in the same programme; funds cannot purchase food. | Phase 2 pilot design. §5. | needs counsel |
| L24 | **Stripe destination charges transit FBM's balance.** Direct charges on a nonprofit's connected account are the only no-custody donation pattern found; destination charges (`on_behalf_of`) move funds through FBM's Stripe balance first. Whether that is "balance-holding outside the purchase→payout context". Also whether a donation line inside a goods cart is a "goods-or-services purchase context". | Donation checkout; Posture A. §6. | needs counsel — **gates Open Decision 2** |
| L25 | **Commercial co-venturer / charitable-solicitor status.** Offering nonprofit choice at checkout, or donating a percentage of sales, may make BMC a commercial co-venturer or professional fundraiser under state law. One vendor (Change) prices this compliance surface as separate plans — it is a known cost, not a theoretical one. Overlaps L1 (state solicitation registration). | Any checkout donation flow. §6. | needs counsel — **gates Open Decision 1** |

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
