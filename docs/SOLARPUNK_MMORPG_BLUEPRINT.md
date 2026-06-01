# Solarpunk MMORPG Blueprint

> Reimagining Free Black Market as a **real-world economic MMORPG** —
> organized around *people and their role in the economy* rather than around
> products. This document checks that vision against what already exists in the
> repo, and records the gamification + navigation layer being added to unify it.

## Why this exists

Most marketplaces organize around products (Etsy, Facebook Marketplace). The
stronger framing for Free Black Market — given its existing Coalition, Blackout,
creator-rewards, micro-investment, agriculture, and mutual-aid systems — is a
**Solarpunk MMORPG for the real world**:

- **Producers** level up by producing.
- **Consumers** level up by supporting.
- **Investors** level up by funding.
- **Coalition members** level up by helping.
- Real businesses become guilds, real farms become territories, real projects
  become quests, real wealth creation becomes gameplay.

The interface stays simple enough to understand in 30 seconds ("What are you
doing today?") while the economy underneath is real.

## Vision vs. reality (verification)

A codebase audit found **~60% of the vision already exists**. The Solarpunk
*theme* is fully built; the economic *engines* are real; what was missing is the
**unifying gamification + navigation layer**.

| Vision concept | In repo today | Verdict |
|---|---|---|
| Solarpunk visual theme | `storefront/src/app/colors.css`, `storefront/tailwind.config.ts` (green/amber/cream ramps, Exo_2/Urbanist, gradients, `shadow-solarpunk-*`) | ✅ Done |
| Mobile bottom nav | `storefront/src/components/molecules/MobileLauncher/MobileLauncher.tsx` (radial FAB) | ✅ Exists (re-themed below) |
| Roles (Producer/Consumer/Investor/Coalition) | `seller-extension/models/seller-metadata.ts` `VendorType` (PRODUCER/GARDEN/KITCHEN/MAKER/RESTAURANT/MUTUAL_AID/CREATOR); cooperative/governance/garden roles | ⚠️ Many systems, no unified user *stance* |
| Regions (Agriculture Grove, …) | `cms-blueprint/seed/cms-blueprint-data.ts` (10 canonical product types) | ⚠️ Categories exist, not region-themed |
| Quests / Bounties | `demand-pool/` (collective buy + bounties + voting, FULL), `asset-graph/manifests/creator-bounty.ts` (FULL), `request/` (STUB) | ⚠️ Engines exist, no unified surface |
| Micro-investments | `collective-campaign/` (productive-asset tokens, yield), garden/kitchen investment pools, `hawala-ledger` | ✅ Strong |
| Land / Asset (Farms/Workshops/Hubs) | `asset-graph/`, `garden/`, `kitchen/`, `agriculture/`, `harvest/` | ✅ Strong |
| Coalition Credits | `hawala-ledger/` (ledger + `karma-event`), `volunteer/` time-credits, admin `coalition-credits/page.tsx` | ⚠️ Substrate only, no unified abstraction |
| Reputation (Merchant/Builder/Investor/Steward/Creator) | `vendor-verification` trust_score, `collective-campaign` tiers, `buyer-network` reputation, `impact-metrics` badges | ⚠️ 5 fragmented systems |
| Character sheet / Levels / XP / Titles | Badges only | ❌ Absent — primary gap |
| Creator Hub | `creator-rewards`, `creator-attribution`, `creator-studio` | ⚠️ Fragmented |
| Seasonal Events / Festivals / Challenges | `season/` (garden seasons only) | ⚠️ Ag-only, no festival/challenge framework |

## Design principle: aggregate, never duplicate

The new `progression` module owns only two genuinely-new facts:

1. **`xp_event`** — an append-only XP ledger (modeled on `hawala-ledger`'s
   `karma_event`: signed `amount`, `reason` slug, `source_module`/`source_id`
   audit trail).
2. **`character_sheet`** — a derived cache: authoritative per-role XP/levels,
   plus a *snapshot* of aggregate stats.

All aggregate stats (orders, trust score, karma, time credits, producer
revenue) are **recomputed from the owning modules** via `query.graph` and
snapshotted for fast reads. The source modules remain the source of truth.

## Stance model

`Stance` (`backend/src/modules/progression/stance.ts`) is the active role a user
is "playing": `PRODUCER | CONSUMER | INVESTOR | COALITION | CREATOR`. It is a
superset alignment of the seller-side `VendorType` enum — `PRODUCER`/`CREATOR`
map 1:1; `CONSUMER`/`INVESTOR`/`COALITION` are buyer/community-side roles with no
`VendorType` equivalent. Helpers `vendorTypeToStance` / `stanceToVendorType`
bridge the two. Stance is stored on the character sheet (single source) and
mirrored into the `fbm_stance` cookie for instant SSR theming.

## Region map

`storefront/src/lib/constants/regions.ts` is a *presentational* remap of the 10
cms-blueprint product types onto 6 named Regions (no backend taxonomy change):

| Region | Surfaces blueprint types |
|---|---|
| 🌱 Agriculture Grove | food, land-access |
| 🎨 Artisan District | circular-economy, mutual-aid |
| 🏭 Industrial Quarter | tools-infrastructure |
| 🎬 Creator Commons | digital-services, community-events |
| 🔬 Innovation Lab | electronics-networks, experimental |
| 💰 Investment Guild | membership |

## Leveling curve

`backend/src/modules/progression/leveling.ts` — quadratic RPG curve:
`xpForLevel(n) = 100·n²`, `levelForXp(xp) = floor(√(xp/100))`. Each role track
levels independently; `ROLE_XP_WEIGHTS` allows per-track tuning. Covered by
`__tests__/leveling.unit.spec.ts`.

## XP ingestion

XP is awarded by subscribers hooking *existing* emitted events — additive and
isolated in try/catch so XP can never break a core flow:

| Event | Subscriber | Award |
|---|---|---|
| `order.placed` | `progression-order-placed.ts` | CONSUMER XP ∝ order total |
| `order.canceled` | `progression-order-canceled.ts` | CONSUMER XP clawback |
| `vendor.verified` | `progression-vendor-verified.ts` | PRODUCER XP + trust mirror |

## Titles

`progression_title` is a seedable catalog (Village Farmer, Market Trader,
Community Investor, Coalition Steward, Master Artisan, …). A title is granted
when a customer's level in the matching role track reaches `min_level`. The
default catalog self-seeds lazily on first use (the repo seeds on-demand rather
than via a startup loader).

## Surfaces

- `GET /store/character` — character sheet summary.
- `POST /store/character/stance` — set active stance.
- `POST /store/character/recompute` — refresh aggregate snapshot.
- Storefront `/character` — character profile (role tracks, lifetime stats,
  titles).
- Storefront `/start` — "What are you doing today?" 4-card stance picker.
- `MobileLauncher` bottom nav → Home / Explore / Quests / Coalition / Character.

## Roadmap (remaining)

These are intentionally **not yet built** — they extend the same foundation:

- **PRODUCER/INVESTOR/COALITION XP hooks** from `collective-campaign` backings
  and `volunteer` verified logs (wire via workflow steps once those modules emit
  events, or call `recordXpEvent` inside their services).
- **Region re-skin** of the category/explore pages using `regions.ts`.
- **Unified Creator Hub** consolidating `creator-rewards` / `creator-attribution`.
- **Seasonal Events / festivals / challenges** beyond garden `season/`.
- **Level-up toasts** and a public leaderboard (sheet already indexes `total_xp`).

## Key files

- Backend module: `backend/src/modules/progression/`
- Subscribers: `backend/src/subscribers/progression-*.ts`
- API: `backend/src/api/store/character/**`
- Storefront data lib: `storefront/src/lib/data/progression.ts`
- Storefront regions: `storefront/src/lib/constants/regions.ts`
- Storefront pages: `storefront/src/app/[locale]/(main)/{character,start}/page.tsx`
- Bottom nav: `storefront/src/components/molecules/MobileLauncher/MobileLauncher.tsx`
