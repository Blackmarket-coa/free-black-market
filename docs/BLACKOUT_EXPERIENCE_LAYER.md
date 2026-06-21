# Blackout Experience Layer — Calm Tones, Pleasant Lights & Shaping Onboarding

This document describes the storefront "experience layer": psychologically-pleasant
audio/visual feedback for positive moments, and an ethical (White-Hat) onboarding flow.
It also records the **deferred** XP-economy design (Stage 2) so it can be picked up later.

## Goals

1. Acknowledge positive interactions (across FBM **and** Blackout-bridged moments) with
   **calm, pleasant tones and lights** — psychoacoustically and visually gentle, not
   slot-machine. **On by default, fully toggleable off.**
2. Onboard members with **behavioral "shaping"** done ethically — momentum and encouragement,
   never streak anxiety, guilt, or manufactured scarcity.

## What shipped (Stage 1 — experience layer)

Implemented entirely in the **storefront** (Next.js / React), reusing the existing
`progression` (XP / character sheet) system as-is.

### Audio — `src/lib/audio/earcons.ts`
- Dependency-free Web Audio synthesizer. Calm earcon design: consonant simple-ratio intervals
  (octave 2:1, perfect fifth 3:2, major third 5:4), fundamentals ~500–1000 Hz (clear of the
  2–4 kHz "alarm" band), soft ≥20 ms attack + gentle exponential release, sine/triangle
  oscillators, low default volume. Optional alternate tuning (e.g. 432 Hz).
- Three earcons: `confirm` (small actions), `celebrate` (orders / onboarding steps),
  `milestone` (level-ups / titles / onboarding complete).
- SSR-safe; `AudioContext` created lazily on first use (autoplay-policy friendly).

### Lights — `src/app/globals.css` + `BlackoutEffects/Bloom.tsx`
- A transient warm amber/forest "bloom" glow on positive moments (reuses solarpunk palette).
- Optional **warm night grading** (`html[data-blackout-night]`) for a lower-strain palette.
- All motion is suppressed under `@media (prefers-reduced-motion: reduce)`.

### Preferences + provider — `src/components/providers/BlackoutEffects/`
- Context provider (mirrors the admin `theme-provider` pattern) persisting to `localStorage`
  key `fbm_blackout_prefs`. Prefs: `soundEnabled`, `lightsEnabled`, `nightGrading`, `volume`
  — **all sensory effects default ON**.
- `useBlackoutEffects().celebrate(kind)` is the single entry point (plays tone if sound on,
  shows bloom if lights on and motion is allowed).
- `CelebrateOnMount` is a drop-in for server pages (dedupes per event via `sessionStorage`).

### Settings — `src/components/molecules/BlackoutEffectsSettings/`
- "Effects & Sound" section on `/user/settings`: switches for Sound, Lights, Warm night mode,
  plus a volume slider.

### Trigger wiring (all FBM moments + Blackout-bridged events)
- **Order confirmed** (`order/[id]/confirmed`) — the `purchase.succeeded` moment → `celebrate`.
- **Add to cart** — soft `confirm` (centralized in `CartProvider`).
- **Level-up / new title** (`/character` via `ProgressWatcher`) → `milestone`.
- **Onboarding step completion** (below) → `celebrate` / `milestone`.
- Inside the Blackout embed the effects fire automatically (same React app) and respect prefs.

### Onboarding — `src/components/sections/Onboarding/OnboardingChecklist.tsx`
Rendered on `/start` for authenticated members; steps derived from real account signals.
- **Endowed-progress head start**: the first step ("Account created") arrives pre-completed.
- Progress **bar** (no bare "2/4" count) → framed as growth, not deficit.
- Calm celebration on newly-completed steps (vs. last seen, persisted locally).
- Always dismissible; every step optional. **No streaks, countdowns, guilt, or fake scarcity.**

### Tests — `src/__tests__/earcons.test.ts`
Cover the pure earcon acoustics (intervals, attack/release, frequency band, retuning) and the
preferences normalization (defaults-on, validation/clamping).

## Deferred — Stage 2 (XP economy; NOT yet built)

Design decisions already made with the product owner, recorded here for continuity:

- **Dual balance.** Keep `total_xp` as non-spendable lifetime *status* (drives levels/titles).
  Add a separate **spendable** balance — either a `spendable_xp` column on `character_sheet`
  or a dedicated `xp_wallet` reusing the append-only `XpEvent`/ledger pattern. Spending never
  lowers a member's level.
- **Redemption** for **both** entitlement perks (themes, emoji packs, access passes, featured
  slots — via the `entitlement` module) **and** digital-product downloads (via
  `digital-product` fulfillment). Follow the `volunteer/TimeCredit` earn→redeem precedent.
- **Accrual wiring.** Call `progression.recordXpEvent` from the blackout/FBM subscribers
  (`backend/src/subscribers/emit-blackout-*`) so XP accrues from both platforms.
- Threshold gating via `entitlement`; anti-speculation guaranteed because XP is
  non-transferable by construction.
