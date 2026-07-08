# Browser-driven e2e agent harness (`e2e/agents/`)

Browser-driven heuristic agents that shop the **live local storefront through the
DOM** and assert commerce invariants. This is the **load-swarm** facet of the
combined browser + load approach: two modes — DOM personas and a load swarm.
It reuses the existing `e2e/` Playwright rig and adds **zero dependencies**
(`@playwright/test` only).

Tier 1 (deterministic personas + oracles + differential + verdict) and the
Tier 2 **skeleton** (stress-invariant signatures, stubbed until fed data) are
built. Tier 3 (LLM agent) is **not** built here.

## The two hard rules

1. **DOM-ONLY personas.** A persona may use **only** `page` / `browser`. It must
   **never** touch Playwright's `request` context or any `/store` `/admin`
   `/vendor` HTTP client. Being unable to cheat via the API is the entire point
   — the agent has to *find the button*. Import the fixture from
   `lib/persona.ts` (`import { test, expect } from "../lib/persona"`); its
   `agent` fixture hands you `{ page, browser }` and nothing else. The one place
   the API is allowed is `lib/differential.ts`, which is **harness-only** and
   must never be imported from a persona.

2. **Local-only, fail-closed.** Every target URL must be loopback
   (`localhost` / `127.0.0.1`). `lib/guard.ts` asserts this before the browser
   is touched and **throws** otherwise (the loopback guard). No metered/hosted/LLM
   calls, ever.

## Run it

```bash
cd e2e
pnpm install                 # already has @playwright/test; no new deps
npx playwright install       # browsers, if not present

pnpm agents:instrument       # verify the instrument — NO stack needed
pnpm agents                  # run the agents project (needs docker stack up)

# --- Tier 2 stress (all additive scripts, no new deps) ---
pnpm test:agents             # run the whole agents project (personas + stress)
pnpm test:agents:stress      # stress layer only — engine smoke runs; live
                             # scenarios are GATED-ON-BUG-01 and self-skip
```

The stack must be healthy for persona runs (see repo `CLAUDE.md`):
`docker compose up -d` → storefront `:3000`, backend `:9000`. Personas default
to the `/us` country segment (the storefront's live routing); the seeded region
is EUR-only, so the region-fallback path is expected to trip — that is a finding
the harness reports, not a harness bug.

Env overrides (all must stay loopback): `STOREFRONT_URL`, `BACKEND_URL`,
`ADMIN_URL`, `VENDOR_URL`, `STORE_PUBLISHABLE_KEY`, `STORE_REGION_ID`.

### Enabling the differential oracle

`lib/differential.ts` is the **only** component that uses a store key, and **no
key is hardcoded**. To enable its read-only browser/API price reconciliation you
must set both:

- `STORE_PUBLISHABLE_KEY` — the storefront's publishable Medusa key (`pk_…`),
  read only from env. Find your local key in `docker-compose.local.yml`.
- `STORE_REGION_ID` — the region to price against (defaults to the seeded local
  region if unset).

When `STORE_PUBLISHABLE_KEY` is **unset/empty** the differential oracle
**degrades to a skip**: it opens no request context, fires no request, logs a
one-line note (`differential oracle skipped: set STORE_PUBLISHABLE_KEY …`), and
its reconstruction methods return empty/no-divergence. No spec fails. The
**DOM-only personas never use the key**, so they run identically either way.

## Layout

| File | Role |
|---|---|
| `lib/guard.ts` | Fail-closed loopback guard + env target/URL + store context. |
| `lib/selectors.ts` | Resilient selectors (role+name → testid → text); explicit Add-to-Cart helper; DOM cart reader. |
| `lib/oracle.ts` | Invariant oracle + `parseMoney`; Tier-1 checks implemented, Tier-2 stress checks decidable-when-fed. |
| `lib/persona.ts` | `Persona` base class (perceive→decide→act→observe loop) + the DOM-only `test`/`agent` fixture. |
| `lib/differential.ts` | **Harness-only** read-only differential oracle (API reconstruction → PLAUSIBLE). |
| `lib/verdict.ts` | Verdict/severity tokens + `VerdictLogger` emitting the verdict doc. |
| `lib/instrument-check.ts` | Golden self-test of the harness logic. |
| `instrument.spec.ts` | Runs the instrument-check (no stack). |
| `stress/swarm.ts` | **Tier 2** deterministic swarm engine (seeded RNG, resource caps, loopback + stub-only guards) + the BUG-01 gate + the `runScenario` honest-skip framework. |
| `stress/scenarios/oversell.ts` | The check-then-write race dimension: `oversell-last-unit`, `coupon-double-redeem`, `payment-replay-idempotency` — GATED-ON-BUG-01 wiring stubs. |
| `stress/scenarios/index.ts` | Scenario registry + `runCombinedSurfaceXStress` (the combined surface×stress flagship runner stub). |
| `stress/stress.spec.ts` | Engine smoke ("verify the instrument" for the swarm — no stack) + the gated live-scenario spec. |
| `stress/combined.spec.ts` | The combined surface×stress flagship: DOM checkout WHILE the swarm floods the last unit — GATED-ON-BUG-01. |

## Writing a persona (Tier 1)

```ts
// e2e/agents/bargain-hunter.spec.ts
import { test, expect } from "./lib/persona"
import { Persona, act, DONE, type Action, type Percept, type PersonaMemory } from "./lib/persona"
import { productLinks, addToCartButton, goToCheckoutControl } from "./lib/selectors"

class BargainHunter extends Persona {
  readonly name = "bargain-hunter"
  readonly goal = "guest buys the cheapest in-stock item via the DOM"

  async decide(p: Percept, m: PersonaMemory): Promise<Action> {
    if (p.url.endsWith("/us") || p.url === this.pageUrlRoot()) {
      return act("open a product", async (page) => { await productLinks(page).first().click() })
    }
    if (p.addToCart.present && p.addToCart.enabled) {
      return act("add to cart", async (page) => { await addToCartButton(page).click() })
    }
    if (/\/cart/.test(p.url)) {
      return act("go to checkout", async (page) => { await goToCheckoutControl(page).click() })
    }
    if (/\/checkout/.test(p.url)) return DONE
    return act("go to cart", async (page) => { await page.goto("/us/cart") })
  }

  private pageUrlRoot() { return (process.env.STOREFRONT_URL || "http://localhost:3000") + "/us" }
}

test("bargain hunter reaches checkout via the DOM", async ({ agent }, testInfo) => {
  const persona = new BargainHunter(agent, { testInfo })
  const result = await persona.run()
  persona.verdict.write(testInfo.outputDir)
  // Tier 1 goal: no blocker-severity divergence survived the run.
  expect(result.divergences.filter((d) => d.severity === "blocker")).toHaveLength(0)
})
```

The base loop stops on: **goal reached** (`goalReached()` true, or `decide`
returns `DONE`) · **stuck** (`stuckThreshold` steps with no screen change, or
`giveUp()`) · **oracle violated** (a `fail` result, e.g. a 5xx page) · **max
steps** · **error**. Server-error (5xx) and region-fallback screens are logged
as divergences automatically (`autoReachabilityChecks`).

## Tier 2 — the Stress layer (`stress/`)

The Stress layer is the **swarm**: N deterministic simulated actors driving the app
at volume, run *alongside* a Surfaces persona (Tier 2). It is
**built + unit-smokeable today**, but the concurrency scenarios are **NOT wired to
run against the live checkout** — they are gated on BUG-01 (below).

### The stress/DOM split (why the swarm may use the API)

DOM personas (`personas/`, `lib/persona.ts`) are **API-blind** — `page`/`browser`
only. The **swarm is different**: it is the **load engine**, so its actors **may**
use Playwright's `request` API context to generate volume. This is allowed **only**
because it lives under `stress/`, is clearly separated from the personas, and honors
every guardrail below. A DOM persona still cannot cheat; the swarm is the flood.

### Local-only caps + stub-only side effects

- **Fail-closed loopback.** `Swarm.create()` refuses to build if the backend target
  is off-loopback (`lib/guard.ts`). Local-only, always.
- **Stub-only.** No real payment gateway — local `pp_system_default` only
  (`LOCAL_PAYMENT_PROVIDER`); a live `sk_live_…` key aborts the build
  (`assertStubbedSideEffects`). Email is a **local no-op** (no SMTP provider), so a
  flood sends **zero** outbound mail. No LLM, no hosted calls.
- **Resource caps, no silent caps.** Actor count / concurrency / duration are clamped
  to `SWARM_CAPS` (`50` / `8` / `60 s`); every clamp or duration-cut is recorded as a
  caveat. Tune within caps via `SWARM_ACTORS`, `SWARM_CONCURRENCY`,
  `SWARM_DURATION_MS`, `SWARM_SEED`.
- **Deterministic.** Seeded per-actor RNG (`mulberry32`) → reproducible parameter
  choices; the *interleaving* across actors stays racy on purpose (that is the test).

### 🔒 The BUG-01 gate (GATED-ON-BUG-01)

The check-then-write scenarios cannot run meaningfully until **BUG-01
(cart-creation 500) is fixed AND inventory is pinned** to a known last-unit count
(the realism gate). The gate is **CLOSED BY DEFAULT**:

```bash
# Opens the gate — set ONLY after the BUG-01 fix lands and is verified locally:
STRESS_BUG01_CLEARED=1 STRESS_INVENTORY_PINNED=1 pnpm test:agents:stress
```

While closed, `runScenario()` **skips** each scenario with a logged
`GATED-ON-BUG-01` caveat (no-silent-caps) and reports **no invariant as held
or broken** — nothing was exercised, so nothing is claimed. Even with the gate
**open**, a scenario whose live contention `task` is **not yet wired** still refuses
to emit a green (`NOT YET WIRED` caveat). The `oversell.ts` scenarios ship their
`observe()` accounting mappers now; the remaining wiring point is each `task` — the
loopback contention itself — fleshed out against the *fixed* checkout.

### What the swarm asserts (the canonical invariants)

`oversell.ts` maps swarm outcomes into the oracle's stress invariants
(`lib/oracle.ts`): **no-oversell · inventory-conserved · no-double-redeem ·
no-double-charge · no-stuck-order**. The combined flagship (`combined.spec.ts`,
`runCombinedSurfaceXStress`) is the payoff: a Bargain-Hunter DOM checkout **while**
the swarm floods the same last unit — also GATED-ON-BUG-01.

## Known bugs the harness independently reproduces (as stuck-reports)

- **BUG-01** — cart POST 500 blocks checkout (reachability oracle → `blocker`).
- **every-PDP 500** — `RangeError: invalid time` on product pages (5xx oracle).
- **`/us`-only region routing** — EUR region, `/us` default → PDP region
  fallback (`region-routing` divergence, `major`).

These are **leads only** — the harness files nothing. Functional findings
route to a GitHub Bug report; security-shaped ones to a private security
advisory. The human is the gate.
