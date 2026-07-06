/**
 * verdict.ts — divergence logger emitting the run-output contract.
 *
 * The harness emits one structured verdict-doc shape so functional and security
 * reviewers receive identical documents. This module owns the first-class
 * tokens (Verdict / Severity) and builds the verdict-doc:
 *   (1) headline count line   e.g. "CHANGES-NEEDED · 1 blocker · 1 major · 2 minor"
 *   (2) ranked findings       location · failure scenario · verdict · severity · fix
 *   (3) verified-clean list   which flows/invariants were exercised AND passed
 *   (4) swarm report          (Tier 2) invariants held/broken under N/duration
 *
 * The harness produces LEADS ONLY — it files nothing. A DOM divergence defaults
 * to PLAUSIBLE (differential-flagged) or REFUTED (flake); promotion to CONFIRMED
 * requires an independent skeptic re-repro against the live local stack.
 * On divergence the logger retains the trace/screenshot via the TestInfo it was
 * given, so a red carries evidence.
 */

import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import type { TestInfo } from "@playwright/test"

/** Reproduction confidence. Defaults to the conservative end. */
export type Verdict = "CONFIRMED" | "PLAUSIBLE" | "REFUTED"

/** Impact tier. */
export type Severity = "blocker" | "major" | "minor"

/** Where a divergence was produced. */
export type DivergenceSource = "oracle" | "differential" | "persona" | "reachability"

/** A ranked finding in the verdict doc. */
export interface Finding {
  /** Component / URL / route the divergence lives at. */
  location: string
  /** Concrete inputs/state → wrong output/observation. */
  failureScenario: string
  verdict: Verdict
  severity: Severity
  /** Suggested fix or next diagnostic step. */
  fix?: string
  /** The invariant slug this violates, if any (oracle.ts). */
  invariant?: string
  /** Structured backing numbers/ids. */
  evidence?: Record<string, unknown>
}

/** A finding tagged with its source + capture time. */
export interface Divergence extends Finding {
  source: DivergenceSource
  timestamp: string
}

/** A flow/invariant that was actually exercised AND passed (so green informs). */
export interface VerifiedClean {
  flow: string
  detail?: string
}

/** Tier-2 swarm summary (invariants held/broken under load). */
export interface SwarmReport {
  scenario: string
  actors: number
  durationMs: number
  invariantsHeld: string[]
  invariantsBroken: string[]
  errorRate?: number
  p95LatencyMs?: number
  /** No-silent-caps: note anything sampled/capped/not-run. */
  caveats?: string[]
}

/** The full verdict artifact. */
export interface VerdictDoc {
  run: string
  target: string
  status: "CHANGES-NEEDED" | "CLEAR"
  /** e.g. "CHANGES-NEEDED · 1 blocker · 1 major · 2 minor". */
  headline: string
  counts: { blocker: number; major: number; minor: number }
  /** Ranked most-severe / most-confident first. REFUTED findings excluded. */
  findings: Finding[]
  /** REFUTED candidates, retained for transparency (not counted). */
  refuted: Finding[]
  verifiedClean: VerifiedClean[]
  swarm?: SwarmReport[]
  notes: string[]
  generatedAt: string
}

const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 }
const VERDICT_RANK: Record<Verdict, number> = { CONFIRMED: 0, PLAUSIBLE: 1, REFUTED: 2 }

export interface VerdictLoggerOptions {
  /** Run label, e.g. "bargain-hunter@eur". */
  run: string
  /** Target under test; defaults to STOREFRONT_URL. */
  target?: string
  /** When provided, artifacts (screenshot) are attached on divergence. */
  testInfo?: TestInfo
}

/**
 * Accumulates divergences + verified-clean notes over a run, then builds/writes
 * the verdict doc. One logger per persona run (or per stress scenario).
 */
export class VerdictLogger {
  private readonly run: string
  private readonly target: string
  private readonly testInfo?: TestInfo
  private readonly divergences: Divergence[] = []
  private readonly clean: VerifiedClean[] = []
  private readonly swarm: SwarmReport[] = []
  private readonly notes: string[] = []

  constructor(opts: VerdictLoggerOptions) {
    this.run = opts.run
    this.target = opts.target || process.env.STOREFRONT_URL || "http://localhost:3000"
    this.testInfo = opts.testInfo
  }

  /**
   * Record a divergence. Defaults verdict to PLAUSIBLE (conservative floor).
   * Attaches a screenshot to the TestInfo (if any) so the red carries evidence.
   */
  divergence(
    d: Omit<Divergence, "timestamp" | "verdict"> & { verdict?: Verdict }
  ): Divergence {
    const rec: Divergence = {
      ...d,
      verdict: d.verdict ?? "PLAUSIBLE",
      timestamp: new Date().toISOString(),
    }
    this.divergences.push(rec)
    void this.retainEvidence(rec)
    return rec
  }

  /** Convenience for oracle failures → a PLAUSIBLE divergence. */
  fromOracle(
    location: string,
    inv: { invariant: string; detail: string; severity?: Severity; evidence?: Record<string, unknown> }
  ): Divergence {
    return this.divergence({
      source: "oracle",
      location,
      invariant: inv.invariant,
      failureScenario: inv.detail,
      severity: inv.severity ?? "major",
      evidence: inv.evidence,
    })
  }

  /** Note a flow/invariant that was exercised AND passed. */
  verifiedClean(flow: string, detail?: string): void {
    this.clean.push({ flow, detail })
  }

  /** Attach a Tier-2 swarm summary. */
  addSwarmReport(r: SwarmReport): void {
    this.swarm.push(r)
  }

  /** Free-form run note (e.g. a no-silent-caps caveat). */
  note(msg: string): void {
    this.notes.push(msg)
  }

  /** All divergences recorded so far (for stop-condition checks). */
  all(): readonly Divergence[] {
    return this.divergences
  }

  /**
   * Surface this run's leads in the Playwright HTML report by pushing the
   * headline plus one annotation per ranked finding onto the given TestInfo.
   * The harness files nothing and asserts no app-correctness — annotations are
   * how a GREEN suite still exposes every lead (blocker/major/minor) it found.
   * Returns the built verdict doc. Best-effort: never throws.
   */
  annotate(testInfo: TestInfo): VerdictDoc {
    const doc = this.build()
    try {
      testInfo.annotations.push({ type: "verdict", description: doc.headline })
      for (const f of doc.findings) {
        testInfo.annotations.push({
          type: `lead:${f.severity}`,
          description: `[${f.invariant ?? f.source}] ${f.failureScenario}`,
        })
      }
    } catch {
      /* annotations are best-effort; never fail a run on report decoration */
    }
    return doc
  }

  /** Build the ranked, counted verdict doc. */
  build(): VerdictDoc {
    const counted = this.divergences.filter((d) => d.verdict !== "REFUTED")
    const refuted = this.divergences.filter((d) => d.verdict === "REFUTED")
    const counts = { blocker: 0, major: 0, minor: 0 }
    for (const d of counted) counts[d.severity]++

    const ranked = [...counted].sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]
    )

    const status: VerdictDoc["status"] = counted.length ? "CHANGES-NEEDED" : "CLEAR"
    const headline =
      `${status} · ${counts.blocker} blocker · ${counts.major} major · ${counts.minor} minor`

    return {
      run: this.run,
      target: this.target,
      status,
      headline,
      counts,
      findings: ranked,
      refuted,
      verifiedClean: this.clean,
      swarm: this.swarm.length ? this.swarm : undefined,
      notes: this.notes,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Write the verdict doc as JSON. Defaults under the Playwright output dir when
   * a TestInfo is present, else `agents/.verdicts/`. Returns the file path.
   */
  write(dir?: string): string {
    const doc = this.build()
    const outDir = dir || (this.testInfo?.outputDir ?? join(process.cwd(), "agents", ".verdicts"))
    mkdirSync(outDir, { recursive: true })
    const safe = this.run.replace(/[^a-z0-9._@-]+/gi, "_")
    const file = join(outDir, `verdict-${safe}.json`)
    writeFileSync(file, JSON.stringify(doc, null, 2), "utf8")
    if (this.testInfo) {
      void this.testInfo.attach(`verdict-${safe}.json`, {
        body: JSON.stringify(doc, null, 2),
        contentType: "application/json",
      })
    }
    return file
  }

  private async retainEvidence(d: Divergence): Promise<void> {
    if (!this.testInfo) return
    try {
      await this.testInfo.attach(`divergence-${d.source}-${Date.now()}.json`, {
        body: JSON.stringify(d, null, 2),
        contentType: "application/json",
      })
    } catch {
      /* attachment is best-effort; never fail a run on evidence capture */
    }
  }
}

/** Format a headline line from raw counts (shared with instrument-check). */
export function headlineFrom(counts: { blocker: number; major: number; minor: number }): string {
  const status = counts.blocker + counts.major + counts.minor > 0 ? "CHANGES-NEEDED" : "CLEAR"
  return `${status} · ${counts.blocker} blocker · ${counts.major} major · ${counts.minor} minor`
}
