/**
 * persona.ts — the goal-directed, DOM-only agent base class + fixture.
 *
 * A Persona is a small POLICY, not a fixed script. The base class drives the
 * loop:  perceive(page) → decide(goal, memory) → act(page) → observe(oracle)
 * and stops on:  goal reached | stuck N steps with no progress | oracle
 * violated | max steps | thrown error.
 *
 * DOM-ONLY, non-negotiable: the agent surface exposes ONLY `page` and
 * `browser`. Personas MUST NOT import or use Playwright's `request` context or
 * any /store /admin /vendor HTTP client — being unable to cheat via the API is
 * the entire point. Import the `test`/`agent` fixture from THIS file (not from
 * "@playwright/test") so you only ever receive { page, browser }.
 *
 * A persona subclass implements `decide()` (and optionally `goalReached()` and
 * `checkInvariants()`); everything else — perception, the loop, stop
 * conditions, oracle wiring, divergence logging — is provided here.
 */

import { test as base, type Browser, type Page, type TestInfo } from "@playwright/test"
import { assertLoopbackTargets } from "./guard"
import { Oracle, anyFailed, type OracleResult } from "./oracle"
import { VerdictLogger, type Divergence } from "./verdict"
import { addToCartState } from "./selectors"

/** The ONLY handles a persona receives. No `request`, by design. */
export interface AgentHandles {
  page: Page
  browser: Browser
}

/** A structured read of the current screen (the accessibility-tree view). */
export interface Percept {
  url: string
  title: string
  headings: string[]
  /** Visible button labels. */
  buttons: string[]
  /** Visible link hrefs. */
  links: string[]
  /** Raw money-shaped tokens found on screen. */
  prices: string[]
  /** First ~4k chars of body text. */
  bodyText: string
  /** HTTP 5xx on the last document nav, or a server-error page rendered. */
  hasServerError: boolean
  /** The PDP/region fallback ("NOT AVAILABLE IN YOUR REGION") is showing. */
  notAvailableInRegion: boolean
  /** An out-of-stock state is showing. */
  outOfStock: boolean
  /** State of the primary Add-to-Cart control, if present. */
  addToCart: { present: boolean; label: string; enabled: boolean }
}

/** What `decide()` returns. Use `act()`, `DONE`, or `giveUp()` to build one. */
export interface Action {
  type: "act" | "done" | "giveup"
  /** Short description for the run log. */
  label: string
  /** The DOM operation to run (for type: "act"). Page-only — no request. */
  perform?: (page: Page) => Promise<void>
}

/** Build an action that performs a DOM operation. */
export function act(label: string, perform: (page: Page) => Promise<void>): Action {
  return { type: "act", label, perform }
}
/** Signal the goal is reached — stop successfully. */
export const DONE: Action = { type: "done", label: "goal reached" }
/** Give up — stop unsuccessfully (dead end the policy can't resolve). */
export function giveUp(label = "gave up"): Action {
  return { type: "giveup", label }
}

export type StopReason =
  | "goal-reached"
  | "stuck"
  | "funnel-blocked"
  | "oracle-violated"
  | "max-steps"
  | "error"

/** Mutable per-run memory the policy reads/writes across steps. */
export interface PersonaMemory {
  steps: number
  visited: string[]
  noProgressStreak: number
  notes: Record<string, unknown>
  lastPercept?: Percept
  /** internal: last screen signature for stuck-detection. */
  _lastSig?: string
  /** internal: how many times each screen signature has been seen (cycle-detect). */
  _sigCounts?: Record<string, number>
}

export interface PersonaOptions {
  /**
   * Hard cap on loop iterations (default 20). A firm ceiling so a policy that
   * keeps finding new-but-useless screens still terminates well under the
   * per-test timeout on a broken stack.
   */
  maxSteps?: number
  /** Consecutive no-progress steps before "stuck" (default 3). */
  stuckThreshold?: number
  /**
   * Stop when the SAME screen has been visited more than this many times, even if
   * the policy keeps oscillating between a few screens (so its consecutive
   * no-progress streak never builds). Catches the A→B→A→B bounce that
   * `stuckThreshold` alone misses. Defaults to `stuckThreshold + 1`.
   */
  revisitLimit?: number
  /** Stop when an oracle check fails (default true). */
  stopOnOracleViolation?: boolean
  /** Auto-log 5xx/server-error + region-fallback divergences (default true). */
  autoReachabilityChecks?: boolean
  /** Country code segment used for storefront routing (default "us"). */
  countryCode?: string
}

type ResolvedOptions = Required<PersonaOptions>

const DEFAULT_OPTIONS: ResolvedOptions = {
  maxSteps: 20,
  stuckThreshold: 3,
  revisitLimit: 4,
  stopOnOracleViolation: true,
  autoReachabilityChecks: true,
  countryCode: "us",
}

export interface PersonaDeps {
  oracle?: Oracle
  verdict?: VerdictLogger
  /** Passed through so divergences retain screenshots/attachments. */
  testInfo?: TestInfo
  options?: PersonaOptions
}

/** The outcome of a full persona run. */
export interface PersonaResult {
  persona: string
  goal: string
  stop: StopReason
  steps: number
  success: boolean
  finalUrl: string
  divergences: readonly Divergence[]
  memory: PersonaMemory
}

const SERVER_ERROR_RE = /internal server error|application error|server-side exception|unhandled runtime error/i

/**
 * Native JS error constructors. A throw of one of these from perceive()/decide()/
 * act() is a bug in OUR OWN harness code — not the app under test — so it must keep
 * stop="error": the exact signal the spec guard `expect(result.stop).not.toBe("error")`
 * exists to catch. App-brokenness must never be misfiled here.
 */
const HARNESS_BUG_ERROR_NAMES = new Set([
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "EvalError",
  "URIError",
])

/**
 * Signatures of a Playwright API-call / DOM / navigation failure. When the loop
 * throws with one of these, the APP under test is broken (an element was missing/
 * detached, a click had nothing to act on, a 5xx aborted a navigation) — that is a
 * LEAD, not a harness bug. Action/nav/locator TIMEOUTS surface as a `TimeoutError`
 * and are matched by name before this regex is consulted.
 */
const PLAYWRIGHT_APP_ERROR_RE =
  /(?:locator|page|frame|elementhandle|mouse|keyboard|response|request|navigation)\.[\w$]+:|Timeout\s+\d+\s?m?s\s+exceeded|waiting for|strict mode violation|net::ERR|ERR_[A-Z_]+|Target (?:page|closed|crashed)|has been closed|Navigation (?:failed|to|interrupted)|not (?:visible|enabled|stable|attached)|intercepts pointer events|detached from the DOM/i

/**
 * Classify a thrown loop error: is it APP-brokenness (→ a lead + graceful stop) or
 * a genuine HARNESS bug (→ keep stop="error")? Conservative by design — anything
 * NOT positively recognized as a Playwright/app failure stays a harness bug, so the
 * spec guard keeps its teeth and unknown throws are surfaced, not swallowed.
 */
export function isAppBrokenness(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (HARNESS_BUG_ERROR_NAMES.has(e.name)) return false
  if (e.name === "TimeoutError") return true
  return PLAYWRIGHT_APP_ERROR_RE.test(e.message || "")
}

export abstract class Persona {
  /** Stable persona slug, e.g. "bargain-hunter". Subclass MUST set it. */
  abstract readonly name: string
  /** One-line statement of the shopping/vendor goal. Subclass MUST set it. */
  abstract readonly goal: string

  protected readonly page: Page
  protected readonly browser: Browser
  readonly oracle: Oracle
  readonly options: ResolvedOptions
  readonly memory: PersonaMemory

  private readonly _testInfo?: TestInfo
  private _verdict?: VerdictLogger
  private _lastDocStatus?: number

  constructor(handles: AgentHandles, deps: PersonaDeps = {}) {
    this.page = handles.page
    this.browser = handles.browser
    this.oracle = deps.oracle ?? new Oracle()
    this._verdict = deps.verdict
    this._testInfo = deps.testInfo
    const merged = { ...DEFAULT_OPTIONS, ...(deps.options ?? {}) }
    // revisitLimit tracks stuckThreshold unless the caller pins it explicitly, so
    // a persona that widens its no-progress tolerance also widens the cycle cap.
    if (deps.options?.revisitLimit == null) merged.revisitLimit = merged.stuckThreshold + 1
    this.options = merged
    this.memory = { steps: 0, visited: [], noProgressStreak: 0, notes: {}, _sigCounts: {} }

    // Track the last main-frame document status for reachability oracles.
    this.page.on("response", (res) => {
      try {
        if (res.request().resourceType() === "document" && res.frame() === this.page.mainFrame()) {
          this._lastDocStatus = res.status()
        }
      } catch {
        /* ignore */
      }
    })
  }

  /**
   * HTTP status of the last main-frame document navigation (or undefined before
   * the first nav). Non-5xx statuses (e.g. a region-404) are NOT auto-logged by
   * the reachability oracle, so policies that need to detect a 404 read this.
   */
  protected get lastDocStatus(): number | undefined {
    return this._lastDocStatus
  }

  /** Lazily-built logger (uses the subclass `name`, unavailable at super time). */
  get verdict(): VerdictLogger {
    if (!this._verdict) {
      this._verdict = new VerdictLogger({ run: this.name || "persona", testInfo: this._testInfo })
    }
    return this._verdict
  }

  // -------- Subclass surface --------

  /** REQUIRED: choose the next action from the current screen + memory. */
  abstract decide(percept: Percept, memory: PersonaMemory): Action | Promise<Action>

  /** OPTIONAL: declare the goal reached from the screen (default: never — use DONE). */
  goalReached(_percept: Percept, _memory: PersonaMemory): boolean {
    return false
  }

  /** OPTIONAL: persona-specific oracle checks each step (default: none). */
  protected checkInvariants(_percept: Percept): OracleResult[] | Promise<OracleResult[]> {
    return []
  }

  /**
   * Route a throw from the perceive→decide→act loop to the right terminal state.
   *
   * App-side brokenness (a Playwright action/nav/locator timeout, a missing or
   * detached element, a 5xx-aborted navigation) is LOGGED AS A LEAD and terminates
   * the run GRACEFULLY as "funnel-blocked" — never "error" — and is NOT rethrown.
   * Because that lead is a counted divergence, a blocked persona's verdict doc
   * reads CHANGES-NEEDED (not a false CLEAR).
   *
   * A genuine harness/programming bug (TypeError/ReferenceError/… or any throw not
   * recognized as an app failure) keeps stop="error" so the spec guard
   * `expect(result.stop).not.toBe("error")` stays a real harness-bug detector.
   *
   * Returns the StopReason the loop should break with.
   */
  private classifyThrow(
    where: "perceive" | "decide" | "act",
    actionLabel: string | undefined,
    e: unknown
  ): StopReason {
    if (!isAppBrokenness(e)) {
      // Our bug: retain the raw error for the report and keep the hard signal.
      this.memory.notes[`${where}Error`] = actionLabel ? `${actionLabel}: ${String(e)}` : String(e)
      return "error"
    }
    const reason = e instanceof Error ? e.message.split("\n")[0] || e.name : String(e)
    const url = this.memory.lastPercept?.url ?? this.page.url()
    const serverDriven =
      !!this.memory.lastPercept?.hasServerError ||
      (this._lastDocStatus != null && this._lastDocStatus >= 500)
    const what =
      where === "act"
        ? `perform the action "${actionLabel ?? "?"}"`
        : where === "decide"
          ? "choose its next step"
          : "read the current screen"
    this.verdict.divergence({
      source: "persona",
      location: url,
      failureScenario:
        `the persona could not ${what} — the page failed under it: ${reason}. ` +
        `A working storefront must let a buyer complete this step; the broken page BLOCKS the ` +
        `journey here, so add-to-cart / cart / checkout downstream are unreachable via the UI.`,
      severity: serverDriven ? "blocker" : "major",
      invariant: "action-failed",
      fix:
        "Fix the underlying page failure (see the reachability leads for the 5xx / region cause) " +
        "so this DOM step completes; only then is the rest of the funnel reachable/testable.",
      evidence: {
        where,
        action: actionLabel ?? null,
        error: reason,
        step: this.memory.steps,
        lastDocStatus: this._lastDocStatus ?? null,
        serverDriven,
      },
    })
    this.memory.notes.funnelBlocked = `${where}${actionLabel ? ` "${actionLabel}"` : ""}: ${reason}`
    return "funnel-blocked"
  }

  // -------- Base loop (provided) --------

  /** Read the current screen into a structured Percept (DOM-only). */
  async perceive(): Promise<Percept> {
    const page = this.page
    const url = page.url()
    const title = await page.title().catch(() => "")
    const headings = await page.getByRole("heading").allInnerTexts().catch(() => [])
    const buttons = await page.getByRole("button").allInnerTexts().catch(() => [])
    const links = await page
      .locator("a[href]")
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") || ""))
      .catch(() => [] as string[])
    const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 4000)
    const prices = (bodyText.match(/[€$£]\s?-?\d[\d.,]*/g) || []).slice(0, 40)
    const atc = await addToCartState(page)

    const serverErrorByStatus = this._lastDocStatus != null && this._lastDocStatus >= 500
    const serverErrorByText = SERVER_ERROR_RE.test(title) || SERVER_ERROR_RE.test(bodyText)

    return {
      url,
      title,
      headings,
      buttons,
      links: links.filter(Boolean),
      prices,
      bodyText,
      hasServerError: serverErrorByStatus || serverErrorByText,
      notAvailableInRegion: atc.regionFallback || /not available in your region/i.test(bodyText),
      outOfStock: atc.outOfStock || /out of stock/i.test(bodyText),
      addToCart: { present: atc.present, label: atc.label, enabled: atc.enabled },
    }
  }

  /** Run the chosen DOM operation. */
  async act(action: Action): Promise<void> {
    if (action.type === "act" && action.perform) {
      await action.perform(this.page)
    }
  }

  /**
   * Run oracle checks for this step: automatic reachability checks (5xx /
   * region-fallback) plus the subclass `checkInvariants`. Logs failures as
   * PLAUSIBLE divergences and returns the results so the loop can stop.
   */
  async observe(percept: Percept): Promise<OracleResult[]> {
    const results: OracleResult[] = []

    if (this.options.autoReachabilityChecks) {
      if (percept.hasServerError) {
        this.verdict.divergence({
          source: "reachability",
          location: percept.url,
          failureScenario: `server error (HTTP 5xx / error page) rendered at ${percept.url}` +
            (this._lastDocStatus ? ` [status ${this._lastDocStatus}]` : ""),
          severity: "blocker",
          invariant: "reachable-no-5xx",
          evidence: { status: this._lastDocStatus, title: percept.title },
        })
        results.push({
          invariant: "reachable-no-5xx",
          status: "fail",
          severity: "blocker",
          detail: `server-error page at ${percept.url}`,
        })
      }
      if (percept.notAvailableInRegion) {
        // Logged, non-fatal: the policy may try another product/region.
        this.verdict.divergence({
          source: "reachability",
          location: percept.url,
          failureScenario:
            `region fallback shown ("NOT AVAILABLE IN YOUR REGION") at ${percept.url} — ` +
            `storefront routed to a country segment with no matching region`,
          severity: "major",
          invariant: "region-routing",
          evidence: { countryCode: this.options.countryCode },
        })
      }
    }

    const custom = await this.checkInvariants(percept)
    for (const r of custom) {
      results.push(r)
      if (r.status === "fail") {
        this.verdict.fromOracle(percept.url, r)
      }
    }
    return results
  }

  /** Drive the full loop to a stop condition and return the outcome. */
  async run(): Promise<PersonaResult> {
    assertLoopbackTargets()
    let stop: StopReason = "max-steps"
    let success = false

    while (this.memory.steps < this.options.maxSteps) {
      // A broken page can make perception itself throw (a hung/absent element under
      // the accessibility read). Treat that like any app-side failure: a lead, not
      // an uncaught throw out of run().
      let percept: Percept
      try {
        percept = await this.perceive()
      } catch (e) {
        stop = this.classifyThrow("perceive", undefined, e)
        break
      }
      this.memory.lastPercept = percept
      if (!this.memory.visited.includes(percept.url)) this.memory.visited.push(percept.url)

      // stuck-detection: has the screen changed since last step, and how often
      // have we landed on this exact screen before (cycle-detection)?
      const sig = this.signature(percept)
      const counts = (this.memory._sigCounts ??= {})
      const seen = (counts[sig] = (counts[sig] ?? 0) + 1)
      if (sig === this.memory._lastSig) this.memory.noProgressStreak++
      else this.memory.noProgressStreak = 0
      this.memory._lastSig = sig

      const results = await this.observe(percept)
      if (this.options.stopOnOracleViolation && anyFailed(results)) {
        stop = "oracle-violated"
        break
      }

      if (this.goalReached(percept, this.memory)) {
        success = true
        stop = "goal-reached"
        break
      }

      let action: Action
      try {
        action = await this.decide(percept, this.memory)
      } catch (e) {
        // decide() reads the live page (selectors, price/cart snapshots), so a
        // broken page can throw HERE too — classify it, don't blanket-"error" it.
        stop = this.classifyThrow("decide", undefined, e)
        break
      }

      if (action.type === "done") {
        success = true
        stop = "goal-reached"
        break
      }
      if (action.type === "giveup") {
        this.memory.notes.gaveUp = action.label
        stop = "stuck"
        break
      }

      // Fire "stuck" firmly: either a short no-progress streak on the same screen,
      // OR the policy keeps oscillating back onto a screen it has already seen
      // more than `revisitLimit` times (the bounce a plain streak never catches).
      if (this.memory.noProgressStreak >= this.options.stuckThreshold) {
        this.memory.notes.stuckReason = `no progress for ${this.memory.noProgressStreak} consecutive steps`
        stop = "stuck"
        break
      }
      if (seen > this.options.revisitLimit) {
        this.memory.notes.stuckReason = `revisited the same screen ${seen}× (cycle) — ${sig.slice(0, 80)}`
        stop = "stuck"
        break
      }

      try {
        await this.act(action)
      } catch (e) {
        // The action fired against a broken page (timeout / missing element / 5xx).
        // This is the leak cart-editor hit: it must become a lead + graceful
        // "funnel-blocked", not a harness "error" that trips the spec guard.
        stop = this.classifyThrow("act", action.label, e)
        break
      }
      this.memory.steps++
    }

    this.verdict.note(
      `persona=${this.name} stop=${stop} steps=${this.memory.steps} success=${success}`
    )

    return {
      persona: this.name,
      goal: this.goal,
      stop,
      steps: this.memory.steps,
      success,
      finalUrl: this.page.url(),
      divergences: this.verdict.all(),
      memory: this.memory,
    }
  }

  /** A cheap signature of the screen for no-progress detection. */
  protected signature(p: Percept): string {
    return `${p.url}|${p.headings.join(",")}|${p.buttons.join(",")}`
  }

  /** Navigate to a storefront path (leading slash). Convenience for policies. */
  protected async goto(path: string): Promise<void> {
    await this.page.goto(path)
  }
}

/**
 * The DOM-only test fixture. Import THIS `test` (and `expect`) in persona specs:
 *
 *   import { test, expect } from "../lib/persona"
 *   test("bargain hunter", async ({ agent }, testInfo) => {
 *     const p = new BargainHunter(agent, { testInfo })
 *     const result = await p.run()
 *     expect(result.divergences.filter(d => d.severity === "blocker")).toHaveLength(0)
 *   })
 *
 * `agent` is { page, browser } ONLY — there is no `request` here. The fixture
 * also runs the fail-closed loopback guard before the browser is touched.
 */
export const test = base.extend<{ agent: AgentHandles }>({
  agent: async ({ page, browser }, use) => {
    assertLoopbackTargets()
    await use({ page, browser })
  },
})

export { expect } from "@playwright/test"
