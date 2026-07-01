# vendor-quest module — the Quest Engine

Reusable machinery that converts a vendor's **real operating history** on FBM
into leverage toward a concrete outcome (loan, grant, wholesale account,
certification, co-op), structured as a stage-gated progression ending in an
exportable **packet** for the outcome's gatekeeper.

This is a general **engine**, not a set of bespoke features. Each quest in the
catalog (Q1–Q13) is a **definition** (config); adding one is a new file, never
an engine change.

## Layers

| Layer | File(s) | Owns |
|-------|---------|------|
| **Substrate** | `substrate/build.ts`, `substrate/revenue.ts` | Reads the one vendor operating record from existing modules. Universal fields always present; domain fields nullable. |
| **Engine** | `engine.ts` | Pure `evaluateQuest(definition, substrate)` — stage-gate + requirement evaluation. **No quest-key / vendor-vertical / physical-goods branching.** |
| **Definitions** | `definitions/*.ts` | Per-quest config: outcome, gatekeeper + disclaimer, requirements (tagged 🟢🟡⚪❌), stage gates, packet template. |
| **Packet** | `packet.ts` | Generic packet assembly → structured JSON + print-optimized HTML. |
| **Persistence** | `service.ts`, `models/*` | Enrollments, append-only stage events, generated packets, collective grouping + consent. |

## Tables (owned facts only)

`quest_enrollment` · `quest_stage_event` (append-only) · `quest_packet` ·
`quest_collective` · `quest_member_consent`. Everything financial is
**snapshotted from source-of-truth modules** (`hawala-ledger`,
`vendor-verification`, inventory, `production-ledger`, `document-vault`) — never
re-summed here (the "aggregate, never duplicate" rule).

## Hard constraints (do not violate — see `docs/VENDOR_QUEST_ENGINE.md`)

1. **Assemble, never fabricate.** Vendor-supplied / outside-FBM requirements are
   always checklist items; FBM never invents credit reports, IDs, legal
   descriptions, signed forms, or financials.
2. **Ledger-grade integrity.** Any figure that can enter an external application
   traces to real ledger transactions (`substrate/revenue.ts` = CREDIT+PURCHASE).
3. **Opt-in & decoupled.** Quests are vendor-selected, never auto-enrolled;
   dropping a quest never deletes substrate records; enabling one module/quest
   never forces another.
4. **Universal-first substrate.** Only revenue, operating history, customers,
   and reputation are assumed. Inventory/production/channels/documents are
   nullable domain fields; a service/digital/practitioner vendor is first-class.
5. **Honest UI.** Every surface and packet shows the disclaimer: FBM assembles
   evidence; the named gatekeeper decides.
6. **Health-claims guardrail.** Wellness quests (`healthClaimsGuardrail: true`)
   reflect verified credentials only and never imply clinical authority.

## Authoring a new quest

See `docs/VENDOR_QUEST_ENGINE.md`. In short: add `definitions/<key>.ts` exporting
a `QuestDefinition`, register it in `definitions/index.ts`, and map any missing
substrate field in `substrate/build.ts`. No engine edits.

Gated by the `VENDOR_QUESTS_V1` feature flag.
