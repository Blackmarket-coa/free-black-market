/**
 * swarm.ts — the Tier-2 STRESS engine.
 *
 * A deterministic swarm generator: N simulated actors driving the app at volume,
 * meant to run ALONGSIDE a Surfaces persona (the combined surface×stress
 * flagship). Seeded RNG →
 * reproducible; resource-capped → a flood can never OOM or peg the dev host.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  THE STRESS/DOM SPLIT — read this before touching anything here.           │
 * │                                                                            │
 * │  DOM personas (agents/personas/*, agents/lib/persona.ts) are API-BLIND by  │
 * │  design — they may use ONLY `page`/`browser`, never Playwright's `request` │
 * │  context. That is the whole point of the Surfaces layer.                   │
 * │                                                                            │
 * │  The SWARM IS DIFFERENT. It is the LOAD ENGINE, not a persona. Its actors  │
 * │  MAY use the `request` API context for volume — that is how they generate  │
 * │  contention. This is allowed ONLY because the swarm lives under stress/,   │
 * │  clearly separated from the DOM personas, and honors the hard rules below. │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * HARD RULES (all enforced here):
 *   • LOCAL-ONLY, FAIL-CLOSED. The backend target MUST be loopback or the swarm
 *     refuses to build (`assertLoopback`). No BMC prod/staging/dev — ever.
 *   • STUB-ONLY SIDE EFFECTS. No real payment gateway: local `pp_system_default`
 *     only (`LOCAL_PAYMENT_PROVIDER`); a live Stripe key aborts the build. Email
 *     is a no-op locally (no SMTP provider) so a flood sends ZERO outbound mail.
 *   • NO LLM, NO HOSTED CALLS. The swarm is pure deterministic logic + loopback
 *     HTTP; it never calls a model or any third-party host.
 *   • RESOURCE-CAPPED, NO SILENT CAPS. Actor count / concurrency / duration are
 *     clamped to `SWARM_CAPS`; any clamp or duration-cut is recorded as a caveat.
 *
 * The concurrency-critical SCENARIOS that use this engine (oversell, double-
 * redeem, payment-replay) are GATED-ON-BUG-01 — see `stressGate()` and
 * `runScenario()`. Until the cart-creation 500 (BUG-01) is fixed and inventory
 * is pinned, they SKIP rather than run against a broken checkout, and they never
 * emit a false green.
 */

import { request as playwrightRequest, type APIRequestContext } from "@playwright/test"
import { assertLoopback, storeContext, targets } from "../lib/guard"
import { Oracle, type OracleResult, type StressObservation } from "../lib/oracle"
import type { Divergence, Severity, SwarmReport } from "../lib/verdict"

// -------------------------------------------------------------------------
// Stub-only side-effect rule: no real gateway, local provider only.
// -------------------------------------------------------------------------

/** The one payment provider the swarm may use locally — a stub, moves no money. */
export const LOCAL_PAYMENT_PROVIDER = "pp_system_default"

/**
 * Fail-closed on any real third-party side effect. A live payment gateway or a
 * non-local payment provider aborts the swarm build. No-op when nothing live is
 * configured (the normal local case). Email is intentionally NOT checked here:
 * locally there is no SMTP provider, so email is already a no-op — a flood sends
 * zero mail by construction.
 */
export function assertStubbedSideEffects(): void {
  const provider = process.env.STRESS_PAYMENT_PROVIDER
  if (provider && provider !== LOCAL_PAYMENT_PROVIDER) {
    throw new Error(
      `[swarm] stub-only: payment provider must be ${LOCAL_PAYMENT_PROVIDER} locally, ` +
        `got ${JSON.stringify(provider)} (no real gateway under load).`
    )
  }
  const liveKeys: Array<[string, string | undefined]> = [
    ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY],
    ["STRIPE_API_KEY", process.env.STRIPE_API_KEY],
  ]
  for (const [name, val] of liveKeys) {
    if (val && /^sk_live_/.test(val)) {
      throw new Error(
        `[swarm] stub-only: a LIVE ${name} (sk_live_…) is set — the swarm must NEVER ` +
          `touch a real gateway. Remove it or point at a local stub.`
      )
    }
  }
}

/** Guard a payment action to the local stub provider. Future scenario tasks call this. */
export function assertLocalProvider(providerId: string): void {
  if (providerId !== LOCAL_PAYMENT_PROVIDER) {
    throw new Error(
      `[swarm] stub-only: refusing payment via ${JSON.stringify(providerId)} — ` +
        `local runs use ${LOCAL_PAYMENT_PROVIDER} only.`
    )
  }
}

// -------------------------------------------------------------------------
// Seeded RNG (deterministic, reproducible — Tier 2).
// -------------------------------------------------------------------------

/** FNV-1a hash → a 32-bit seed from a number or string. */
export function hashSeed(seed: number | string): number {
  let h = 2166136261 >>> 0
  const s = String(seed)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 PRNG — tiny, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// -------------------------------------------------------------------------
// Config + resource caps (bounded so a flood cannot peg the host).
// -------------------------------------------------------------------------

/** Hard local ceilings. A request above these is CLAMPED and a caveat recorded. */
export const SWARM_CAPS = {
  maxActors: 50,
  maxConcurrency: 8,
  maxDurationMs: 60_000,
} as const

const SWARM_DEFAULTS = {
  actors: 12,
  concurrency: 4,
  durationMs: 15_000,
  seed: 1337,
} as const

export interface SwarmConfig {
  /** Total simulated actors to run (clamped to SWARM_CAPS.maxActors). */
  actors: number
  /** Max actors in flight at once (clamped to SWARM_CAPS.maxConcurrency). */
  concurrency: number
  /** Wall-clock budget in ms (clamped to SWARM_CAPS.maxDurationMs). */
  durationMs: number
  /** RNG seed — same seed ⇒ same per-actor decisions. */
  seed: number
  backendUrl: string
  publishableKey: string
  regionId: string
}

export interface ResolvedSwarmConfig extends SwarmConfig {
  /** No-silent-caps: every clamp/cut applied is recorded here. */
  caveats: string[]
}

function clampInt(name: string, raw: number, def: number, max: number, caveats: string[]): number {
  let v = Number.isFinite(raw) ? Math.floor(raw) : def
  if (v < 1) v = def
  if (v > max) {
    caveats.push(`${name} capped ${v}→${max} (SWARM_CAPS, no-silent-caps)`)
    v = max
  }
  return v
}

/**
 * Resolve config from overrides → env → defaults, clamping to SWARM_CAPS and
 * recording every clamp as a caveat. Env: SWARM_ACTORS, SWARM_CONCURRENCY,
 * SWARM_DURATION_MS, SWARM_SEED. Backend/key/region come from the loopback guard.
 */
export function resolveSwarmConfig(overrides: Partial<SwarmConfig> = {}): ResolvedSwarmConfig {
  const caveats: string[] = []
  const envNum = (k: string): number | undefined => {
    const v = process.env[k]
    if (v == null || v === "") return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const store = storeContext()
  const rawActors = overrides.actors ?? envNum("SWARM_ACTORS") ?? SWARM_DEFAULTS.actors
  const rawConc = overrides.concurrency ?? envNum("SWARM_CONCURRENCY") ?? SWARM_DEFAULTS.concurrency
  const rawDur = overrides.durationMs ?? envNum("SWARM_DURATION_MS") ?? SWARM_DEFAULTS.durationMs
  const seed = overrides.seed ?? envNum("SWARM_SEED") ?? SWARM_DEFAULTS.seed

  const actors = clampInt("actors", rawActors, SWARM_DEFAULTS.actors, SWARM_CAPS.maxActors, caveats)
  let concurrency = clampInt(
    "concurrency",
    rawConc,
    SWARM_DEFAULTS.concurrency,
    SWARM_CAPS.maxConcurrency,
    caveats
  )
  if (concurrency > actors) concurrency = actors
  const durationMs = clampInt(
    "durationMs",
    rawDur,
    SWARM_DEFAULTS.durationMs,
    SWARM_CAPS.maxDurationMs,
    caveats
  )

  return {
    actors,
    concurrency,
    durationMs,
    seed,
    backendUrl: overrides.backendUrl ?? targets().backend,
    publishableKey: overrides.publishableKey ?? store.publishableKey,
    regionId: overrides.regionId ?? store.regionId,
    caveats,
  }
}

// -------------------------------------------------------------------------
// Actors + the run engine.
// -------------------------------------------------------------------------

/** The result an actor task reports (engine fills in actorId + latencyMs). */
export type ActorResult = {
  ok: boolean
  label: string
  /** True if this actor believes it acquired/sold a unit (oversell accounting). */
  soldUnit?: boolean
  /** True if a charge was recorded for the shared intent (double-charge accounting). */
  charged?: boolean
  /** True if a single-use code redeemed for this actor (double-redeem accounting). */
  redeemed?: boolean
  /** Deterministic value for smoke assertions (unused by live scenarios). */
  value?: number
  error?: string
}

/** A single actor outcome as aggregated by the engine. */
export interface ActorOutcome extends ActorResult {
  actorId: number
  latencyMs: number
}

/**
 * What an actor task receives. `rng` is a PER-ACTOR deterministic stream (seed +
 * id), so an actor's parameter choices reproduce across runs even though the
 * INTERLEAVING across actors is intentionally racy (that is the stress). The
 * `request()` accessor lazily builds ONE shared loopback API context — the load
 * engine's channel, forbidden to DOM personas.
 */
export interface ActorContext {
  id: number
  rng: () => number
  cfg: ResolvedSwarmConfig
  /** The local stub payment provider — never a real gateway. */
  paymentProvider: string
  /** Lazily-built shared loopback API request context (load engine only). */
  request: () => Promise<APIRequestContext>
}

export type ActorTask = (ctx: ActorContext) => Promise<ActorResult>

export interface SwarmRunResult {
  scenario: string
  actorsRequested: number
  actorsRun: number
  durationMs: number
  outcomes: ActorOutcome[]
  successCount: number
  errorCount: number
  errorRate: number
  p95LatencyMs: number
  /** No-silent-caps: clamps + any duration cut that ended the run early. */
  caveats: string[]
}

export class Swarm {
  readonly config: ResolvedSwarmConfig
  private ctx: APIRequestContext | null = null

  private constructor(config: ResolvedSwarmConfig) {
    this.config = config
  }

  /**
   * Build a swarm. FAILS CLOSED if the backend is off-loopback and ABORTS on any
   * live side-effect config (loopback + stub-only guards). Does NOT open a network connection — the
   * API context is built lazily on first actor use, so pure smoke runs touch no
   * stack.
   */
  static async create(overrides: Partial<SwarmConfig> = {}): Promise<Swarm> {
    const config = resolveSwarmConfig(overrides)
    assertLoopback(config.backendUrl, "BACKEND_URL (swarm)")
    assertStubbedSideEffects()
    return new Swarm(config)
  }

  /** Lazily build (and cache) the one shared loopback API context. */
  private async sharedRequest(): Promise<APIRequestContext> {
    if (!this.ctx) {
      assertLoopback(this.config.backendUrl, "BACKEND_URL (swarm request)")
      this.ctx = await playwrightRequest.newContext({
        baseURL: this.config.backendUrl,
        extraHTTPHeaders: { "x-publishable-api-key": this.config.publishableKey },
      })
    }
    return this.ctx
  }

  private actorContext(id: number): ActorContext {
    return {
      id,
      rng: mulberry32(hashSeed(`${this.config.seed}:actor:${id}`)),
      cfg: this.config,
      paymentProvider: LOCAL_PAYMENT_PROVIDER,
      request: () => this.sharedRequest(),
    }
  }

  /**
   * Run `task` across the configured actor pool with bounded concurrency and a
   * hard wall-clock deadline. Actors that would start after the deadline are not
   * launched (recorded as a caveat). Returns aggregated outcomes + timing.
   */
  async run(scenario: string, task: ActorTask): Promise<SwarmRunResult> {
    const cfg = this.config
    const started = Date.now()
    const deadline = started + cfg.durationMs
    const outcomes: ActorOutcome[] = []
    const caveats = [...cfg.caveats]
    let next = 0
    let deadlineHit = false

    const worker = async (): Promise<void> => {
      for (;;) {
        const id = next++
        if (id >= cfg.actors) return
        if (Date.now() >= deadline) {
          deadlineHit = true
          return
        }
        const t0 = Date.now()
        try {
          const r = await task(this.actorContext(id))
          outcomes.push({
            actorId: id,
            latencyMs: Date.now() - t0,
            ok: r.ok,
            label: r.label,
            soldUnit: r.soldUnit,
            charged: r.charged,
            redeemed: r.redeemed,
            value: r.value,
            error: r.error,
          })
        } catch (e) {
          outcomes.push({
            actorId: id,
            latencyMs: Date.now() - t0,
            ok: false,
            label: `${scenario}:threw`,
            error: String(e),
          })
        }
      }
    }

    const nWorkers = Math.max(1, Math.min(cfg.concurrency, cfg.actors))
    await Promise.all(Array.from({ length: nWorkers }, () => worker()))

    const durationMs = Date.now() - started
    const actorsRun = outcomes.length
    if (deadlineHit || actorsRun < cfg.actors) {
      caveats.push(
        `duration cap hit: ${actorsRun}/${cfg.actors} actors ran within ${cfg.durationMs}ms ` +
          `(resource cap, no-silent-caps)`
      )
    }
    const errorCount = outcomes.filter((o) => !o.ok).length
    const successCount = actorsRun - errorCount

    return {
      scenario,
      actorsRequested: cfg.actors,
      actorsRun,
      durationMs,
      outcomes,
      successCount,
      errorCount,
      errorRate: actorsRun ? errorCount / actorsRun : 0,
      p95LatencyMs: percentile(outcomes.map((o) => o.latencyMs), 95),
      caveats,
    }
  }

  async dispose(): Promise<void> {
    if (this.ctx) {
      await this.ctx.dispose()
      this.ctx = null
    }
  }
}

/** p-th percentile of a numeric sample (0 for an empty sample). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

// -------------------------------------------------------------------------
// The BUG-01 gate (the realism gate).
// -------------------------------------------------------------------------

/** State of the stress gate: is it safe to run against the live checkout yet? */
export interface StressGate {
  open: boolean
  reason: string
  /** The pinned last-unit stock count, when inventory is pinned; else null. */
  inventoryPinned: number | null
}

/**
 * The check-then-write scenarios cannot run meaningfully until BUG-01 (cart-
 * creation 500) is fixed AND inventory is pinned to a known last-unit count
 * (the realism gate). This gate is CLOSED BY DEFAULT. Open it only after the fix
 * lands and is verified on the local stack:
 *   STRESS_BUG01_CLEARED=1  STRESS_INVENTORY_PINNED=<n>
 */
export function stressGate(): StressGate {
  const cleared = process.env.STRESS_BUG01_CLEARED === "1"
  const pinnedRaw = process.env.STRESS_INVENTORY_PINNED
  const pinnedNum = pinnedRaw != null && pinnedRaw !== "" ? Number(pinnedRaw) : NaN
  const inventoryPinned = Number.isFinite(pinnedNum) && pinnedNum > 0 ? Math.floor(pinnedNum) : null

  if (!cleared) {
    return {
      open: false,
      inventoryPinned,
      reason:
        "BUG-01 (cart-creation 500) is NOT marked cleared — set STRESS_BUG01_CLEARED=1 only " +
        "after the fix lands and is verified on the local stack.",
    }
  }
  if (inventoryPinned == null) {
    return {
      open: false,
      inventoryPinned: null,
      reason:
        "inventory is NOT pinned — set STRESS_INVENTORY_PINNED=<n> to the known last-unit stock " +
        "count so oversell accounting has a ground truth.",
    }
  }
  return {
    open: true,
    inventoryPinned,
    reason: `gate OPEN: BUG-01 cleared and inventory pinned to ${inventoryPinned} unit(s).`,
  }
}

// -------------------------------------------------------------------------
// Scenario framework — GATED, honest-skip, never a false green.
// -------------------------------------------------------------------------

/**
 * A stress scenario as data. The engine (`runScenario`) supplies the gate + skip
 * behavior; a scenario only declares its contention `task`, how to `observe`
 * swarm outcomes into a StressObservation, and which oracle `checks` to run.
 *
 * `task`/`observe` are OPTIONAL: while UNDEFINED the scenario is a WIRING STUB
 * (GATED-ON-BUG-01). Even with the gate open, an unwired scenario refuses to emit
 * a green — it reports NOT-YET-WIRED as a caveat (no-silent-caps).
 */
export interface ScenarioDef {
  name: string
  invariant: string
  description: string
  /** The bug this scenario is gated behind. Default "BUG-01". */
  gatedOn?: string
  /** Per-actor contention task. UNDEFINED ⇒ not yet wired (honest skip). */
  task?: ActorTask
  /** Map swarm outcomes + the pinned stock into a StressObservation. */
  observe?: (run: SwarmRunResult, gate: StressGate) => StressObservation
  /** The oracle invariant checks that decide the verdict. */
  checks: (oracle: Oracle, obs: StressObservation) => OracleResult[]
}

export interface ScenarioDeps {
  swarm: Swarm
  oracle: Oracle
  gate: StressGate
}

/** The result of attempting a scenario — LEADS ONLY (the harness files nothing). */
export interface ScenarioOutcome {
  scenario: string
  invariant: string
  gatedOn: string
  gateOpen: boolean
  /** Did the live swarm actually run? False when gated OR unwired. */
  ran: boolean
  oracleResults: OracleResult[]
  report: SwarmReport
  /** PLAUSIBLE divergences from oracle failures (never auto-filed). */
  findings: Divergence[]
}

/**
 * Run a scenario through the gate. Three honest outcomes:
 *   1. gate CLOSED           → skip, caveat "GATED-ON-<bug>", nothing exercised.
 *   2. gate OPEN but UNWIRED  → skip, caveat "NOT YET WIRED", no false green.
 *   3. gate OPEN and wired    → run the swarm, evaluate the oracle, report.
 * In every case invariants are only reported HELD if they were actually
 * exercised and passed; a skip lists neither held nor broken.
 */
export async function runScenario(
  def: ScenarioDef,
  { swarm, oracle, gate }: ScenarioDeps
): Promise<ScenarioOutcome> {
  const gatedOn = def.gatedOn ?? "BUG-01"
  const base = { scenario: def.name, invariant: def.invariant, gatedOn, gateOpen: gate.open }

  if (!gate.open) {
    return skippedOutcome(
      base,
      def,
      oracle,
      `GATED-ON-${gatedOn}: ${gate.reason} Scenario NOT run against the live checkout path ` +
        `(no-silent-caps).`
    )
  }

  if (!def.task || !def.observe) {
    return skippedOutcome(
      base,
      def,
      oracle,
      `${gatedOn} gate is OPEN but the live contention task is NOT YET WIRED — refusing to emit a ` +
        `green (no-silent-caps). Wire ScenarioDef.task + ScenarioDef.observe against the fixed ` +
        `checkout, then this scenario runs.`
    )
  }

  const run = await swarm.run(def.name, def.task)
  const obs = def.observe(run, gate)
  const oracleResults = def.checks(oracle, obs)
  const held = oracleResults.filter((r) => r.status === "pass").map((r) => r.invariant)
  const broken = oracleResults.filter((r) => r.status === "fail").map((r) => r.invariant)
  const skippedInv = oracleResults.filter((r) => r.status === "skipped").map((r) => r.invariant)

  const caveats = [...run.caveats]
  if (skippedInv.length) {
    caveats.push(
      `invariants NOT evaluated (insufficient observations): ${skippedInv.join(", ")} ` +
        `(no-silent-caps)`
    )
  }

  const findings: Divergence[] = oracleResults
    .filter((r) => r.status === "fail")
    .map((r) => ({
      source: "oracle",
      verdict: "PLAUSIBLE",
      severity: (r.severity ?? "major") as Severity,
      invariant: r.invariant,
      location: `stress:${def.name}`,
      failureScenario: r.detail,
      evidence: r.evidence,
      timestamp: new Date().toISOString(),
    }))

  return {
    ...base,
    ran: true,
    oracleResults,
    findings,
    report: {
      scenario: def.name,
      actors: run.actorsRun,
      durationMs: run.durationMs,
      invariantsHeld: held,
      invariantsBroken: broken,
      errorRate: run.errorRate,
      p95LatencyMs: run.p95LatencyMs,
      caveats,
    },
  }
}

function skippedOutcome(
  base: { scenario: string; invariant: string; gatedOn: string; gateOpen: boolean },
  def: ScenarioDef,
  oracle: Oracle,
  reason: string
): ScenarioOutcome {
  // Evaluate the checks with NO observations: every invariant returns `skipped`,
  // so the doc shows what was DEFERRED — never a pass on unexercised state.
  const oracleResults = def.checks(oracle, {})
  return {
    ...base,
    ran: false,
    oracleResults,
    findings: [],
    report: {
      scenario: base.scenario,
      actors: 0,
      durationMs: 0,
      invariantsHeld: [],
      invariantsBroken: [],
      caveats: [reason],
    },
  }
}
