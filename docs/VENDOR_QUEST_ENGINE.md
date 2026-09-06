# Vendor Quest Engine

The Vendor Quest Engine turns a vendor's **real operating history** on FBM into
leverage toward a concrete real-world outcome — an FSA loan, a grant, a
wholesale account, a certification, a cooperative — structured as a stage-gated
progression that ends in an exportable **packet** for the outcome's gatekeeper.

It is a general **engine**, not thirteen bespoke features. Every quest in the
catalog (Q1–Q13) is a **definition** (config). Adding one is a new file, never
an engine change.

> **Pilot → general.** The pilot is a South Carolina edible/medicinal plant
> nursery pursuing FSA Farm Loan Readiness (Q1). But no table, field, or module
> hardcodes "nursery" or that vendor. Nursery specifics live in the opt-in
> `nursery-vertical` module; the substrate + engine serve any vendor, validated
> by a universal-only wellness-practitioner quest (Q9/Q10) that runs through the
> same engine with no physical-goods branching.

## Architecture

```
        ┌─────────────────────────────────────────────┐
        │  Quest definitions (config)  definitions/*.ts │  ← add a file to add a quest
        └───────────────┬─────────────────────────────┘
                        │ QuestDefinition
        ┌───────────────▼─────────────┐   pure, no quest-key branching
        │  Engine   engine.ts          │   evaluateQuest(def, substrate)
        └───────────────┬─────────────┘
                        │ reads
        ┌───────────────▼─────────────┐   built once, queried by every quest
        │  Substrate  substrate/*.ts   │   universal fields + domain-optional
        └───────────────┬─────────────┘
                        │ snapshots (never re-sums)
        ┌───────────────▼──────────────────────────────────────────────┐
        │ hawala-ledger · vendor-verification · inventory ·             │
        │ production-ledger · document-vault · vendor-rules (channels)  │
        └───────────────────────────────────────────────────────────────┘
```

Persistence (`vendor-quest` module) owns only new facts: `quest_enrollment`,
append-only `quest_stage_event`, `quest_packet`, `quest_collective`,
`quest_member_consent`. Everything financial is snapshotted from source-of-truth
modules via `query.graph` — the "aggregate, never duplicate" rule.

## The substrate: two layers

Only **universal** fields are assumed for every vendor:

| Field | Source |
|-------|--------|
| `revenue` (income, cash-flow, seasonality) | `hawala-ledger` (CREDIT + PURCHASE entries) |
| `operating` (tenure, listings, fulfillment) | seller + orders on the `seller_order` link (`substrate/operating.ts` defines fulfilled and reliability) |
| `customers` (buyers/clients, repeat, wholesale) | orders; `vendor-rules` `WHOLESALE` tiers |
| `reputation` (trust score, XP, disputes) | `vendor-verification`; `progression` (the seller's members' `total_xp`); `order-dispute` (live cases) |

**Domain-optional** fields are `null` unless relevant, and quests degrade
gracefully around them:

| Field | Source (opt-in) |
|-------|-----------------|
| `inventory` | inventory / `harvest-batches` |
| `production` | `production-ledger` |
| `channels` | `vendor-rules` customer tiers |
| `documents` | `document-vault` |

A service / digital / practitioner vendor has every domain field `null` and is a
**first-class citizen** — this is enforced by tests, not just intent.

## Implemented catalog (Q1–Q13)

All thirteen catalog quests ship as definitions in `definitions/`, each running
through the same engine:

| # | Key | Type | Packet |
|---|-----|------|--------|
| Q1 | `fsa-farm-loan` | individual | Lender Packet |
| Q2 | `grant-readiness` | individual | Grant Application Packet |
| Q3 | `microlender-readiness` | individual | Lender Summary |
| Q4 | `crowdfunding-traction` | individual | Traction One-Pager |
| Q5 | `wholesale-account` | individual | Line Sheet + Capacity |
| Q6 | `market-vendor` | individual | Vendor Application Bundle |
| Q7 | `ready-to-hire` | individual | Hiring-Readiness Summary |
| Q8 | `compliance-tracker` | individual | Certification Checklist *(guardrail)* |
| Q9 | `wellness-insurance` | individual | Insurer Summary *(guardrail)* |
| Q10 | `trust-tier` | individual | none (internal) *(guardrail)* |
| Q11 | `coop-formation` | collective | Co-op Formation Bundle |
| Q12 | `land-pooling` | collective | Joint Financing Packet |
| Q13 | `commons-contribution` | individual | none (internal + XP) |

A whole-catalog test (`__tests__/catalog.unit.spec.ts`) runs every definition
through the engine, so a regression in any one is caught.

## How to author a new quest definition

Adding, say, **Q5 Wholesale Account Readiness**:

1. **Create `src/modules/vendor-quest/definitions/wholesale-account.ts`** exporting
   a `QuestDefinition`:
   - `outcome`, `category`, `title`, `type: "individual"`.
   - `gatekeeper` — name, `disclaimer` (use the `disclaimer()` helper), links.
   - `requirements[]` — each tagged `platform` 🟢 / `assisted` 🟡 /
     `vendor-supplied` ⚪ / `outside-fbm` ❌. For platform/assisted give a
     `satisfied(substrate)` predicate; list any `needs: DomainFieldKey[]`.
     Vendor-supplied / outside-fbm are always checklist — **never** auto-satisfy
     them (FBM must not fabricate).
   - `stageGates[]` — ordered gates, each with `unlocks(substrate)` and
     `missing(substrate)`. Reuse helpers in `definitions/shared.ts`.
   - `packetTemplate` — sections that `build(substrate)` and mark themselves
     `available: false` when a needed domain field is absent; plus
     `remainingItems(substrate)`. Use `null` for internal-unlock quests.
   - `usesFields` — the domain fields the quest can use (drives the "what it
     needs" catalog UI).
2. **Register it** in `definitions/index.ts` (`QUEST_DEFINITIONS`).
3. **Map any missing substrate field** in `substrate/build.ts` if the quest needs
   data not yet assembled. Add it as a universal field (always present) or a
   domain-optional field (`null` when absent) — never make it required.
4. **Do NOT touch the engine.** If you find yourself editing `engine.ts` for a
   specific quest, stop — the need belongs in the definition or the substrate.

Verify with `TEST_TYPE=unit pnpm test:unit` — the engine test scans `engine.ts`
and fails if any quest key or domain-field literal leaks into engine code.

## Collective quests (Q11–Q13)

Collective quests reuse the **same generic engine** — no collective-specific
evaluation code. The flow:

1. A vendor **forms** a collective for a `type: "collective"` quest (Q11 Co-op
   Formation is implemented) and is auto-enrolled as the first member.
2. Others **join** (an enrollment tagged with the `collective_id`). Joining grants
   no data access.
3. Each member records **scoped consent** (`quest_member_consent`, e.g.
   `["revenue","operating","documents"]`). A member is aggregated only if they
   consent to **every** scope in the definition's `requiredConsentScopes`.
4. Evaluation builds each consenting member's substrate, combines them with
   `aggregateSubstrates()` into one synthetic substrate (universal fields sum,
   domain fields union, `collective.member_count` set), and runs the ordinary
   `evaluateQuest()`. Non-consenting members and non-members are never read, so
   one vendor's records never leak to another.
5. The **owner** generates the joint packet once the final gate opens; it's
   assembled from the aggregate exactly like an individual packet.

`collective` is a domain-optional substrate field (`null` for individuals), so a
collective definition reading `s.collective?.member_count` needs no engine
branching. Routes live under `/vendor/quests/collective*`; consent is
always self-scoped (a seller can only consent for themselves), and detail/packet
access is limited to members/owner.

## Hard constraints (for all contributors)

1. **Assemble, never fabricate.** No synthetic credit reports, IDs, legal
   descriptions, signed forms, or financials. Vendor-supplied / outside-FBM
   requirements are always checklist + links.
2. **Ledger-grade integrity.** Any figure that can enter an external application
   traces to real ledger transactions and reconciles to the settlement ledger
   (`substrate/revenue.ts`). No parallel un-reconciled totals.
3. **Opt-in & decoupled.** Quests are vendor-selected, never auto-enrolled and
   never a prerequisite for selling. Dropping a quest never deletes substrate
   records. Enabling one module/quest never forces another (independent feature
   flags).
4. **Universal-first substrate.** Never assume inventory/production/physical
   channels. Those are nullable domain fields; a service/digital/practitioner
   vendor is first-class.
5. **Privacy & consent.** Quest data is gated to the vendor owner. Collective
   quests aggregate only consenting members (`quest_member_consent`, scoped) and
   never leak one vendor's records to another. Honor existing E2EE/privacy
   commitments; never paywall them.
6. **Honest UI.** Every quest surface and every packet states that FBM assembles
   documentation, the named gatekeeper decides, and official forms/humans are the
   actual gate.
7. **Wellness health-claims guardrail.** Wellness product/practitioner quests set
   `healthClaimsGuardrail: true`; their copy reflects verified credentials ONLY
   and never implies clinical/medical authority or licensure beyond what was
   verified.

## Feature flags

| Flag | Enables |
|------|---------|
| `FF_VENDOR_QUESTS_V1` | the quest engine + `/vendor/quests*` routes |
| `FF_PRODUCTION_LEDGER_V1` | the opt-in production ledger |
| `FF_DOCUMENT_VAULT_V1` | the opt-in document vault |
| `FF_NURSERY_VERTICAL_V1` | the nursery product vertical + profit-per-sqft |

All default OFF; each is independently adoptable.

## API surface (vendor-panel PR wires the UI)

- `GET /vendor/quests` — catalog (what each quest needs, before opting in).
- `GET/POST /vendor/quests/enrollments` — list (with live evaluation) / enroll.
- `GET/DELETE /vendor/quests/enrollments/:id` — detail / drop.
- `POST /vendor/quests/enrollments/:id/packet[?format=html]` — generate packet.
- `GET/POST /vendor/production-batches`, `GET/POST /vendor/vault` — opt-in modules.
- `POST /vendor/nursery/profit-per-sqft` — decision-support ranking.

## Tests

`backend/src/modules/vendor-quest/__tests__/` and
`backend/src/modules/nursery-vertical/__tests__/`:

- `profit-per-sqft` math (+ vertical stacking, ranking).
- generic stage-gate evaluation; wellness quest through the same engine; the
  engine-source scan proving no FSA / physical-goods branching.
- income reconciles to the ledger.
- decoupling: drop preserves substrate, independent flags, universal-only vendor,
  nursery works with no quest.
- packet assembly (disclaimer + checklist always present, graceful degradation).
