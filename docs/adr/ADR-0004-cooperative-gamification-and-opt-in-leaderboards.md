# ADR-0004: Cooperative Gamification and Opt-in Leaderboards

- **Status:** Accepted
- **Date:** 2026-06-24
- **Owners:** Platform / Progression
- **Phase:** BMC Unified Design & Behavioral System

## Context

The unified-design brief calls for **collective** mechanics — shared progress
"thermometers" for treasury/governance/category goals and Habitica-style group
quests — rather than competitive ranking. The research is explicit:

- Leaderboards are "of ambivalent nature" and can crowd out cooperation;
  competitive ranking is sometimes "perceived as surveillance rather than
  motivation" (community-health-worker study).
- Showing individual **and** team leaderboards made participants fixate on
  personal rank with "no sense of shared goals but only a sense of shared
  rewards" (Qiao et al., 2024). Lesson: emphasize shared **goals**, not shared
  rewards.
- Cooperative reviews (Morschheuser/Hamari et al.) find shared goals drive
  enjoyment, mutual assistance, and cooperative behavior.

The repo already has the aggregates these mechanics should read from —
`collective_campaign` (backed vs. goal), `demand_post` (committed vs. target),
governance proposal quorum, volunteer `time_credit` — so a new module must
**aggregate, never duplicate** (the principle the `character_sheet` follows).

## Decision

1. **New thin module `backend/src/modules/collective-quest/`** owns only
   genuinely-new facts: group **quest** definitions, an append-only
   **contribution** ledger, and shared **reward-pool** distributions. A
   **goal** ("thermometer") caches a `current_value` that is *snapshotted from
   the owning module* via `query.graph` (`recomputeGoal`) — never independently
   re-summed.

2. **Boss HP drops only on verified contributions.** Quest progress reuses the
   peer-attestation path (ADR-0003), so collective progress can't be farmed.

3. **Reward the collective, salience on shared goals.** On quest completion the
   `reward_pool_xp` is split across contributors via `recordXpEvent` (COALITION
   role), reinforcing relatedness and *shared-goal* salience (not just shared
   rewards, per Qiao et al.).

4. **Leaderboards are opt-in, relative-to-self, and secondary.**
   `getDenLeaderboard(denId, { optInOnly })` returns each member's progress
   relative to their **own** baseline (percentile bands), excludes members who
   have not opted in, and is surfaced as a secondary UI element. There is **no
   global-rank endpoint** by default.

## Consequences

### Positive

- Collective progress is computed from source-of-truth modules — no drift, no
  duplication.
- Cooperation is the default; ranking is opt-in and self-relative, avoiding the
  surveillance/fixation failure modes.
- Verified-only HP keeps collective progress honest.

### Tradeoffs

- `recomputeGoal` adds read load against source modules; snapshot + schedule it
  the way `recomputeAggregates` is handled.
- Opt-in leaderboards show fewer participants by design — intentional.

## Implementation Notes

- Module: `backend/src/modules/collective-quest/` (models `collective-goal`,
  `collective-quest`, `quest-contribution`, `quest-reward-grant`; `service.ts`;
  migration).
- API: `backend/src/api/store/collective-quest/{goals,quests,quests/[id]/contribute,leaderboard}/route.ts`.
- Storefront: `components/sections/CollectiveQuests/{Thermometer,QuestBoss,DenLeaderboard}.tsx`,
  page `app/[locale]/(main)/coalition/quests/page.tsx`, `QuestProgressWatcher.tsx`
  (clone of `ProgressWatcher.tsx`) reusing `celebrate("milestone")`.
- Tests: `backend/src/modules/collective-quest/__tests__/service.unit.spec.ts`
  (verified-only HP, reward split sums to pool, goal snapshot reads source,
  leaderboard omits non-opt-in).
