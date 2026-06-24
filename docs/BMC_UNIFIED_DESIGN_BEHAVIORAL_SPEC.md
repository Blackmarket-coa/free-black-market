# BMC Unified Design & Behavioral System Spec

> The single canonical, research-grounded design & behavioral spec for the
> **FBM × Blackout** experience: XP/reputation, vendor onboarding, the
> solarpunk visual system, the calm audio-visual tone system, and cooperative
> gamification — unified across the marketplace and governance surfaces.

This document **maps a research brief to what already exists in the repo**
(Present / Partial / Missing), following the verification-table convention of
`docs/SOLARPUNK_MMORPG_BLUEPRINT.md`. It is the index of record for the unified
design system; each *Partial* / *Missing* row links to the gap that closes it.

## Why this exists

Most of the brief's vision is **already built** — the progression/XP ledger, the
dual-balance redemption economy, the calm earcon + bloom experience layer, the
hawala/Stellar settlement substrate, and the solarpunk theme. The remaining
value is twofold:

1. **Ground the existing choices in the research** so future contributors know
   *why* (e.g. why no streaks, why off-black not pure-black, why leaderboards are
   opt-in and relative-to-self), and
2. **Close the genuine gaps** the brief surfaces without duplicating what exists.

The guiding principle, inherited from the progression module, is **aggregate,
never duplicate**: derive from source-of-truth modules via `query.graph`; new
modules own only genuinely-new facts.

## Research foundations (the "why")

- **Threshold privilege tiers + just-in-time guidance** (Stack Overflow model):
  privileges unlock instantly at reputation thresholds, with milestone
  celebration and "you're close" nudges. → drives Gap C.
- **Leaderboards are ambivalent and can read as surveillance** (Qiao et al.,
  2024; cooperative-gamification reviews). Showing individual + team rank made
  participants fixate on personal rank with "no sense of shared goals." →
  leaderboards must be **opt-in, relative-to-self, and secondary**; lead with
  shared goals, not shared rewards. → Gap E, ADR-0004.
- **Cooperative mechanics that work**: Habitica-style party + group boss quests
  turn individual completion into collective progress against shared boss HP. →
  Gap E.
- **Demurrage** (Sarafu / Gesell): a small decay on a *spendable* balance keeps
  value circulating rather than hoarded. Lifetime status must never decay. →
  Gap D, ADR-0003.
- **Soulbound reputation** (EIP-5192 lock flag / EIP-4973 account-bound;
  Buterin/Weyl/Ohlhaver "Decentralized Society"): remove transferability exactly
  where transferability would destroy the signal's meaning. XP is already
  non-transferable by construction — make it explicit and add peer attestation
  so XP is weighted by *verified* value (anti-karma-farming). → Gap B, ADR-0003.
- **Behavioral onboarding** (Fogg B=MAP; Zeigarnik / endowed-progress, Nunes &
  Drèze 2006: 34% vs 19% completion with a pre-filled head start; Shopify ≤5-step
  checklists; Self-Determination Theory). → **already shipped** (see System 7).
- **Calm Technology + psychoacoustics** (Stothart et al. 2015 on notification
  cost; Plomp & Levelt 1965 critical-bandwidth roughness; Fletcher-Munson
  equal-loudness; Edworthy et al. 1991 urgency parameters). → **already shipped**
  in `earcons.ts` (consonant simple-ratio intervals, ~500–1000 Hz fundamentals,
  ≥20 ms soft attack). See System 8.
- **Accessibility** (WCAG 2.2 AA): 4.5:1 for body text, 3:1 for large text and UI
  components — applied **independently in dark mode**; never `#000000` (halation),
  never `#FFFFFF` on black. → drives Gap F and the contrast checklist below.
- **Hawala as delay-tolerant bilateral credit** (Stellar/Ripple "trust lines"
  resemble hawala): XP accrual = provisional credit that settles later; money
  movement runs on compliant Stellar/USDC rails with KYC/AML — hawala is design
  inspiration only, not a replication of its anonymity. → **already shipped** as
  `hawala-ledger` (see System 1) and framed in `docs/COMPOSITION_LAYER.md` /
  `docs/POSTURE_A_COMPLIANCE.md`.

## System-by-system status

| # | System | Verdict | Evidence / Gap |
|---|---|---|---|
| 1 | **XP reputation ledger + hawala settlement** | ✅ Present | `backend/src/modules/progression/` (`xp_event`, `character_sheet`, `leveling.ts`, titles); settlement substrate `backend/src/modules/hawala-ledger/` (`stellar-settlement.ts`, `reconciler.ts`, `escrow-state-machine.ts`). Two ledgers, one profile — XP never converts to crypto. |
| 2 | **Dual-balance redemption (spend vs. status)** | ✅ Present | `character_sheet.spendable_xp` vs lifetime `total_xp`; `xp_redemption` ledger; `rewards.ts` catalog; `backend/src/api/store/xp/`. Spending never lowers status. |
| 3 | **Solarpunk visual system** | ✅ Present (light-first) | `storefront/src/app/colors.css`, `storefront/tailwind.config.ts`, `shadow-solarpunk-*`. → re-based **dark-first** by Gap F. |
| 4 | **Calm audio-visual tone system** | ✅ Present | `storefront/src/lib/audio/earcons.ts`, `BlackoutEffects/` provider + `Bloom.tsx`, warm night grading `html[data-blackout-night]`. Documented in `docs/BLACKOUT_EXPERIENCE_LAYER.md`. |
| 5 | **Threshold gating + JIT guidance + global level-up toasts** | ⚠️ Partial | `ProgressWatcher` fires `milestone` only on `/character`; no entitlement-on-threshold, no "you're close" nudge, no global toast. → **Gap C**. |
| 6 | **Cooperative gamification** (thermometers, group quests, den reward pools, opt-in leaderboards) | ❌ Missing | No shared-goal/boss-HP surface today. → **Gap E**. |
| 7 | **Behavioral onboarding funnel** (endowed progress, ≤5 steps, no dark patterns) | ✅ Present | `storefront/src/components/sections/Onboarding/OnboardingChecklist.tsx`; vendor `routes/onboarding/`; `onboarding-48h-followup.ts`. Pre-filled "Account created"; progress bar, no streaks/guilt. |
| 8 | **PRODUCER/INVESTOR/COALITION XP accrual** | ❌ Missing | XP wired only for `order.placed`/`order.canceled`/`vendor.verified`. Campaign backings & verified volunteer hours award nothing. → **Gap A**. |
| 9 | **Soulbound semantics + peer attestation** | ⚠️ Partial | XP is non-transferable by construction (de-facto soulbound) but unstated; no attestation weighting by verified value. → **Gap B**, ADR-0003. |
| 10 | **Demurrage (anti-hoarding) on spendable XP** | ❌ Missing | Spendable XP never decays. → **Gap D**, ADR-0003. |

## Gaps (close in dependency order)

See the implementation plan for full detail. Summary:

- **Gap A — accrual hooks** *(first; everything else needs richer XP)*. Emit
  `campaign.backed` (collective-campaign backing route) and `volunteer.verified`
  (`verify-hours` workflow); add `progression-campaign-backed` /
  `progression-volunteer-verified` subscribers (clones of
  `progression-order-placed.ts`); extend `recomputeAggregates` with a
  `collective_backing` block.
- **Gap B — soulbound + attestation**. `progression/soulbound.ts` (EIP-5192/4973
  mapping); `xp_attestation` model + migration; `recordAttestedXpEvent`
  (rejects self-attestation, validates attester trust, weights the award). Route
  the volunteer-verified accrual through it (`verified_by_id` = attester).
- **Gap C — threshold gating + global toasts**. `progression/thresholds.ts`
  static table; `checkAndGrantThresholdPrivileges` after title-granting in
  `recordXpEvent` (grants entitlements, idempotent); `nextUnlock` hint in the
  character-sheet summary; `GlobalProgressWatcher` in the storefront root layout
  reusing the `milestone` earcon + Bloom.
- **Gap D — demurrage**. `recordDemurrage` (spendable-only, floored at 0;
  **never** touches `total_xp`/levels/titles) + `applyDemurrage`; weekly
  `backend/src/jobs/xp-demurrage.ts` mirroring `demand-pool-expiry.ts`.
- **Gap E — cooperative gamification**. New `backend/src/modules/collective-quest/`
  (goal/quest/contribution/reward-grant models; service that snapshots goal
  progress from source modules via `query.graph`; opt-in relative-to-self
  leaderboard); store API + storefront `Thermometer`/`QuestBoss`/`DenLeaderboard`
  + `coalition/quests` page + `QuestProgressWatcher`.
- **Gap F — dark-first theme**. Re-base `storefront/src/app/colors.css` semantic
  tokens to off-black `#121212` / off-white `#EDEDED` with brighter teal/green/
  amber accents (token **names unchanged**); keep light behind
  `html[data-theme="light"]`; panels default to dark.

## Dark-mode WCAG contrast checklist (Gap F)

Every foreground/background pair must pass **independently** in dark mode
(4.5:1 text, 3:1 large text + UI). Audit at minimum:

| Token (fg) | On surface | Requirement | Note |
|---|---|---|---|
| `--content-primary` `#EDEDED` | `--bg-primary` `#121212` | 4.5:1 (≈15.9:1 ✓) | body text |
| `--content-secondary` | `#121212` | 4.5:1 | pick a stop ≥ `#9aa0a6` |
| `--content-action-primary` | `#121212` | 4.5:1 | **must remap** off `--brand-600/700` (fails) to `--brand-300/400` |
| `--bg-action-primary` (button fill) + its on-color | each other | 4.5:1 text / 3:1 UI | verify both directions |
| `--border-action` / focus ring | `#121212` | 3:1 (UI) | use `--brand-300/400` |
| `--content-warning/negative/positive-primary` | `#121212` | 4.5:1 | verify each amber/terracotta/green stop |

**Highest risk:** every `--content-*-primary` token currently pointing at a
brand/green 600–900 stop will fail AA on off-black and must be remapped to a
lighter stop. Pure black is prohibited; off-white text (`#EDEDED`/`#E0E0E0`),
never `#FFFFFF`.

## Anti-pattern guardrails (kill-criteria)

- **No dark patterns**: no manufactured streak anxiety, escalating guilt
  notifications, or monetized loss-recovery (the Duolingo cautionary tale).
  Borrow only the *leniency* lesson — grace periods, no-penalty pause.
- **No speculation**: XP is non-transferable, no secondary market, no fiat/crypto
  off-ramp; demurrage applies to the *spendable* balance only.
- If any mechanic produces measurable anxiety, surveillance perception, or
  engagement decoupled from real economic value — roll it back.

## Caveats

- 432 Hz tuning and binaural beats are **evidence-modest** (small studies, some
  null results). They remain optional, honestly-described enhancements in
  `earcons.ts` — never marketed as medical claims.
- Hawala carries real AML/regulatory baggage; the repo borrows only its
  trust/delay-tolerant settlement *model*. Money moves on compliant Stellar/USDC
  rails with KYC/AML per `docs/POSTURE_A_COMPLIANCE.md`.
- Specific palette hex values are recommendations to be confirmed by a designer
  and a full WCAG audit.

## Cross-references

- `docs/SOLARPUNK_MMORPG_BLUEPRINT.md` — progression/stance/region/leveling model.
- `docs/BLACKOUT_EXPERIENCE_LAYER.md` — shipped earcons/bloom/onboarding + XP economy.
- `docs/COMPOSITION_LAYER.md`, `docs/POSTURE_A_COMPLIANCE.md` — hawala settlement + compliance.
- `docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md`, `docs/GOVERNANCE.md` — sources for Gap E thermometers.
- `docs/adr/ADR-0003-xp-demurrage-and-soulbound-semantics.md`,
  `docs/adr/ADR-0004-cooperative-gamification-and-opt-in-leaderboards.md`.
