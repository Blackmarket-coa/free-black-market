# FBM Composition Layer

The composition layer is what FreeBlackMarket becomes after the playbook system,
listing-type extensions, escrow-bearing hawala ledger, creator bounties, mutual
aid, and federated delivery sit on one substrate. This document describes how
those pieces fit together. Individual pieces have their own canonical docs:

- `docs/PLAYBOOK_SYSTEM.md` — the ten playbooks and the migration from
  `vendor-type` to `playbook`.
- `docs/LISTING_TYPES.md` — listing-type taxonomy (v1 ship list + v2/v3
  deferrals).
- `docs/POSTURE_A_COMPLIANCE.md` — the compliance frame the composition layer
  is required to honor.

## The thesis

FBM is not a marketplace with cooperative bolt-ons. It is a federated
cooperative economy substrate where:

- A vendor picks a **playbook** at setup that determines governance shape,
  payout structure, and storefront identity from day one.
- A playbook composes with one or more **listing-types** to describe what is
  on offer (a physical product, a ticketed event, a subscription, a
  consignment listing, a bookable slot, a crowdfunded campaign).
- Value moves through one **internal hawala-style ledger** on Stellar with
  USDC and Coalition Credits as internal assets, settling out at Stripe ACH
  edges to vendor bank accounts.
- Four **surfaces** present that substrate to different audiences:

```
                  ┌───────────────────────────────────────────┐
                  │      Stellar Internal Hawala Ledger       │
                  │  (LedgerAccount per: Seller, SellerMember,│
                  │   Patron, Creator, MutualAidNode, Driver, │
                  │   SolidarityPool, OperatorFee)            │
                  └─────────────┬─────────────┬───────────────┘
                                │             │
       ┌────────────────┬──────┴──────┬──────┴────────────┬─────────────────┐
       │                │             │                   │                 │
   Commerce          Refrain       Threshold           Blackstar         Federation
   (FBM proper)    (bounties)    (mutual-aid)        (delivery)       (BMC cross-node)
       │                │             │                   │                 │
   3% comm.         3% comm.    0% (donations)         3% comm.        cross-node split
   Stripe ACH       Stripe ACH  Fiscal sponsor        Stripe ACH       hawala settlement
   payout           payout      routes                payout
```

Commerce is the spine. Refrain, Threshold, and Blackstar are limbs.

## What this branch lands

The composition layer ships across multiple branches. This branch
(`claude/fbm-composition-layer-HMhFm`) lands the **foundational substrate**
that subsequent branches build on:

| Piece                                            | This branch | Subsequent |
| ------------------------------------------------ | ----------- | ---------- |
| `playbook` module + 10 playbook recipes          | ✓           |            |
| `listing-type` module + 9 v1 listing-types       | ✓           |            |
| `hawala-ledger` EscrowAgreement model            | ✓           |            |
| `hawala-ledger` PatronageAllocation model        | ✓           |            |
| Coalition Credits closed-loop service guard      | ✓           |            |
| Quarterly patronage refund job                   | ✓           |            |
| 3-question vendor picker (vendor-panel)          | ✓           |            |
| Sliding-scale tier picker (storefront checkout)  | ✓           |            |
| Fiscal-sponsor routing on donation widget        | ✓           |            |
| Visual signature SVG library + phenology bar     |             | ✓          |
| Radial wheel mobile launcher                     |             | ✓          |
| Three-bucket notifications (awaits-me/about-me)  |             | ✓          |
| Blackstar `DeliveryService` listing extension    |             | ✓          |
| Refrain (creator bounties) module                |             | ✓          |
| Threshold (mutual-aid) module                    |             | ✓          |
| Governance v2 (proposals, consent rounds)        |             | ✓          |
| Capital accounts (per-member ledger)             |             | ✓          |
| Coalition Credits payout election with bonus    |             | ✓          |
| Posture C activation (USDC vendor payouts)      |             | ✓          |

## How the surfaces share infrastructure

A single BMC Member identity anchors a Stellar account. Many roles attach to
that identity (vendor, member-of-cooperative, creator, driver, mutual-aid
volunteer, customer, donor). One internal ledger records value movement.
Stripe ACH bridges out at the edge.

- **Commerce surface (FBM proper)**: the ten playbooks render the storefront,
  vendor dashboard, and payout flow. Listing-types compose with each playbook
  to describe the offering. Commission is 3 %; quarterly patronage refunds
  return surplus to vendors weighted by paid commission.
- **Refrain surface**: any vendor (or non-vendor patron under explicit policy
  gates) posts a bounty. Any creator with a Refrain profile (which is *not*
  a vendor profile — creators do not list products) can claim or accept.
  Bounties are escrowed via `hawala-ledger` `EscrowAgreement`.
- **Threshold surface**: mutual-aid posts (free stores, community fridges,
  tool libraries, mutual-aid asks, mutual-aid funds, skill shares, repair
  cafés) live on a separate surface that explicitly forbids prices and
  imposes hyperlocal-by-default visibility. Donations route through a
  501(c)(3) fiscal sponsor.
- **Blackstar surface**: drivers onboard as Service-playbook vendors with a
  `DeliveryService` listing extension. Dispatch optimizes for a multi-
  objective function (cost, utilization, fairness, carbon, worker
  preferences). Federation lets a driver from one BMC node accept a request
  from a vendor in another.

## How Coalition Credits move

Coalition Credits are a closed-loop Stellar custom asset, issued by an
FBM-controlled account with `authorization_required` and
`authorization_revocable`. They are **never** redeemable to cash and
**never** transferable between accounts outside of a goods-or-services
purchase context. The closed-loop nature is what keeps them outside the
FinCEN money-transmission classification under Posture A.

Where Credits flow across surfaces:

- **Commerce**: vendors elect to take payout in Credits with a configured
  bonus (e.g. $97 USD → 102 CCR). Mint happens on payout election.
- **Refrain**: patrons can pay creators in Credits; creators can stake
  Credits as a reputation deposit.
- **Threshold**: Credits never substitute for mutual-aid gifting (that would
  collapse the gift economy). A separate **Karma** asset tracks
  anti-hoarding balance for tool libraries and free stores.
- **Blackstar**: a buyer or vendor can pay a driver in Credits for a
  mutual-aid run.

## What this composition is not

- **Not a Patreon.** Refrain is platform-agnostic. Creators stay on their
  existing audiences (YouTube, Bandcamp, Substack, TikTok, IPFS) and Refrain
  is the connection-and-payment layer.
- **Not a Cameo / Fiverr.** Defaults shape culture: rights default to
  creator-retains-ownership; competitive mode pays proposal honoraria so
  speculative work is not unpaid; time-locked auto-release protects creators
  from patron ghosting.
- **Not a Buy Nothing fork.** Threshold borrows the hyperlocal-and-private
  posture but stays on the same identity and ledger as the rest of FBM,
  letting commerce-side checkout flow value to mutual-aid funds through
  donation widgets.
- **Not Uber-with-co-op-skinning.** Blackstar does not have surge pricing,
  ever. Auction dispatch is off by default. Fairness constraints prevent a
  single driver from dominating the queue.

## Verification

The substrate this branch lands is exercised by:

- `backend/src/modules/playbook/__tests__/` — unit tests for the
  recommendation function (24 answer permutations) and seed integrity.
- `backend/src/modules/listing-type/__tests__/` — unit tests for the
  playbook × listing-type compatibility matrix.
- `backend/src/modules/hawala-ledger/__tests__/posture-a-invariants.spec.ts`
  — CI test asserting Coalition Credit public methods refuse non-purchase
  contexts.
- `backend/src/modules/hawala-ledger/__tests__/escrow-agreement.unit.spec.ts`
  — state transitions and time-locked recovery semantics.
- Manual smoke (Phases 5–6): onboard test sellers across all ten playbooks;
  checkout a product per sliding-scale tier with donation toggled; verify
  Stripe ACH settlement lands at the fiscal-sponsor account.


## Privacy/security composition and technical ownership (2026-11-27)

This map adds privacy/security handoffs without changing FBM's existing commerce/transaction, settlement, fulfillment, consent or authorization contracts. A private collaboration workflow does not migrate required order/customer records into another service or change their retention automatically.

| User need | Everyday owner / FBM entry | Backend or advanced owner |
| --- | --- | --- |
| Seller/buyer permissions and commerce data | FBM account/team and transaction surfaces | FBM remains authoritative; a Blackmask organization role does not grant commerce administration |
| Private client/team collaboration, selected records or document request | Contextual Open in Blackmask from a supported team/project/sharing context | Blackmask private UX and separately locked vault; existing Matrix services and per-object grants remain authoritative |
| Identity/recipient review, guest access, access reviews and incident decisions | Blackmask context selected explicitly; return to original FBM resource | Each linked service confirms its own grants/revocation; no universal offboarding shortcut inferred |
| Website launch/connection, component/embed setup and domains | FBM shows result/status and normal commerce actions | Advanced configuration in Forge, with exact project/tool context and a return path |
| Advanced protection preset, integration, backup or hosting setup | Persistent Forge entry near account Settings/Privacy plus supported contextual links | Forge orchestration through scoped domain APIs; no decrypted Vault data or raw credentials in projects/URLs/logs |
| Checkout, orders, inventory, payouts and eligible transport | Existing FBM/Blackstar surfaces | Existing domain owners; privacy consolidation does not create a duplicate ledger or logistics system |

The [Blackmask software map](https://github.com/Blackmarket-coa/blackmask/blob/main/docs/black-mask/software-map.md) maps 36 proposed workflows for individuals, businesses, startups, organizations and groups. The [Forge software map](https://github.com/Blackmarket-coa/Forge/blob/master/SOFTWARE_MAP.md) defines technical configuration surfaces. Related Blackout social/community and Matrix services retain their authority.

Handoffs must be user-directed and carry only authorized identifiers plus a short-lived authenticated reference. Never silently send customer/order content, plaintext documents, vault secrets or message history. Show the actual audience, identity and selected payload; the destination reauthorizes. Preserve intent and a useful path for unavailable/unsupported/signed-out states. Joining/paying for an organization does not grant personal-vault or unrelated-chat access.

Retain fixed commerce rules and existing one-time enhancement policy. Blackmask's storage-only recurring exception does not create a new FBM subscription. New sharing/recovery, native capture and OSS research remain planned/unverified until their owning service records evidence. This is a documentation map change, not a deployment or data migration.

## Forge technical/creative product-map consolidation (2026-11-27)

The [FBM–Forge integration map](FORGE_INTEGRATION.md) and [BMC software maps](BMC_SOFTWARE_MAPS.md) extend the ownership section above. Rehome advanced website Launch/Connect, domains, embeds/SDK, portal/theme/widget authoring, technical connector setup, app packaging and authorized hosting operations into Forge. FBM keeps catalog/orders/checkout/registry/entitlements/settlement, native starter setup and everyday equipment use.

Add the permanent Forge hub near Settings/Privacy and contextual My Website, Appearance/equipment, Creator tools, Connected services and project-status links. Preserve exact authorized project context and return path. Durable drafts and the complete authored-file-to-buyer installation path precede expansion of visual editors.

The competitor backlog adds reusable kits, sample stores, isolated previews, design properties/brand kits, licensed remixing, versioned publishing, supported recovery and tested automations. Detailed authoring lives in Forge; normal transactions and applying a compatible result remain native. No runtime, pricing or authority changes are established by this documentation.

