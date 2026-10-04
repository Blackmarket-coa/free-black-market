# Free Black Market — working notes for Claude

Multi-vendor marketplace on **MedusaJS v2 + MercurJS**. pnpm workspaces, TypeScript,
Node >= 22, pnpm 11.28.4 (pinned via `packageManager`).

Scale, so you calibrate: 98 backend modules, 702 API routes, 432 spec files.
You cannot hold this repo in your head. Read before you assume.

---

## The rules that cost the most to relearn

### 1. Two typecheckers. Neither covers the other. Run BOTH.

```bash
cd backend
npx medusa build      # covers src/**, and the strict generated query.graph filters
npx tsc --noEmit      # covers __tests__/**, which medusa build EXCLUDES
```

CI's `Lint & Type Check` job runs both, in that order, and a change can pass one
and fail the other. This has bitten repeatedly:

- `medusa build` **excludes `__tests__`**, so a type error you introduce in a spec
  file is invisible to it.
- `tsc --noEmit` misses the generated `query.graph` filter types unless `.medusa/`
  already exists on disk.

To reproduce a cold CI run (no `.medusa/` present):

```bash
mv .medusa /tmp/mg && npx tsc --noEmit; mv /tmp/mg .medusa
```

The complement bites too: a **stale** `.medusa/` makes `tsc` invent errors that do not
exist. On 2026-10-01 it reported `SellerMetadata` missing `node_operator_opt_in` in
`src/api/vendor/node-operator/route.ts` against a three-week-old generated type, in a
change whose diff contained no `.ts` file at all. Run them in CI's order — `medusa
build` first, which regenerates the types, then `tsc` — before believing either.

### 2. Module registration keys are unguessable. Import them.

The key a module registers under has **no derivable relationship** to its directory
name. Five real examples from `src/modules/`:

| Directory | Constant | Actual key |
|---|---|---|
| `food-distribution` | `FOOD_DISTRIBUTION_MODULE` | `"foodDistribution"` |
| `order-cycle` | `ORDER_CYCLE_MODULE` | `"orderCycleModuleService"` |
| `booking` | `BOOKING_MODULE` | `"booking"` |
| `hawala-ledger` | `HAWALA_LEDGER_MODULE` | `"hawalaLedger"` |
| `demand-pool` | `DEMAND_POOL_MODULE` | `"demandPoolModuleService"` |

Never hand-type the string — `import { X_MODULE } from "../../modules/x"`.

**The failure mode is silent and worse than a crash.** A test that mocks
`container.resolve("orderCycle")` when the real key is `"orderCycleModuleService"`
does not fail — it exercises the *fallback* path and passes, while the code under
test is never run. A green suite that proves nothing. The same applies to
`ContainerRegistrationKeys.PG_CONNECTION` (its value is `"__pg_connection__"`,
not `"pg_connection"`) — import the constant.

### 3. Posture A is a legal boundary, not a preference.

`docs/POSTURE_A_COMPLIANCE.md` and `src/modules/hawala-ledger/posture-a-guard.ts`.

FBM operates under FinCEN's payment-processor exemption
(31 CFR 1010.100(ff)(5)). That holds only while:

1. Coalition Credits (CCR) never convert to cash.
2. CCR moves only in a goods-or-services purchase context (cart, order,
   refund-of-order, payout-of-order).
3. No balance-holding outside that purchase→payout context.

**Vendor payout always terminates at Stripe ACH to a US bank account. No USDC
payouts to vendors.** Crossing these lines makes FBM a Money Services Business
under FinCEN's 2019 CVC guidance — a licensing problem, not a code review comment.

The guard lives in the **service layer**, deliberately, not in a workflow hook:
hooks can be bypassed, the service layer is the only place that can reliably
refuse to write. Keep it there. `pnpm test:posture-a` runs the invariants.

### 4. `no-explicit-any` is ratcheted, not global.

`backend/eslint.config.mjs`. Globally **off** (~1,215 `any` across ~401 files is
tracked debt, not this PR's problem). Set to **error** for:

- `src/api/admin/**`
- `src/api/v1/seller/**`
- `src/api/vendor/**`

with `src/api/vendor/me/**`, `src/api/vendor/printful/**`, and all vendor
`__tests__`/`*.spec.ts` turned back off. New code in the ratcheted trees must be
typed. Don't widen the exclusions to make a lint error go away.

### 5. TS2321 "Excessive stack depth comparing types"

Caused by a `useQueryGraphStep` row typed as a whole generated entity: any SDK
construct then compares `(T | WorkflowData<T>)[]` against
`((T | WorkflowData<T>) & T)[]` and the checker blows its budget.

**Narrowing at the use site does not work** — the comparison happens where the
reference is *typed*, not where it's used. Cut it where rows enter, with
`asRows<T>()` from `src/workflows/query-rows.ts`. Note TypeScript caps how many
of these it reports per compilation, so fixing one can reveal others.

### 6. Dependency overrides live in `pnpm-workspace.yaml`, not `package.json`

pnpm 11 stopped reading `pnpm.overrides` in `package.json`. Nearly every override
pins a CVE fix, so a silently-dropped one reintroduces the vulnerability **while
every gate stays green** (Trivy reads the lockfile, and the lockfile would simply
claim the old version was always intended).

Two guards: `scripts/check-override-coverage.mjs` asserts every override actually
binds in the resolved lockfile, and installs must **never** pass
`--ignore-workspace` — that flag makes pnpm ignore the file entirely with no warning.

There are **six** workspace roots with their own lockfile and override block, not four:
root, `backend`, `storefront`, `admin-panel`, `vendor-panel` and `mobile`. `mobile` was
missing from that script's `DEFAULT_ROOTS` until 2026-10-01 while Trivy scanned its
lockfile like any other — a pin there was shipped unasserted. A new root needs adding to
both places or it is unguarded.

**And a green Trivy gate is not a clean tree.** Trivy's pnpm parser excludes dev
dependencies, so the gate speaks only for production paths. On 2026-10-01 the gate read
0 HIGH while a full OSV sweep of the same six lockfiles found ~20 fixed HIGH/CRITICAL
advisories (one CRITICAL) still present in dev-only paths — see SD-28. Defensible, but
do not quote "0 HIGH" as evidence of anything wider than what Trivy actually looks at.

A permissive range is not a bump. `>=0.35.0` happily resolves to the vulnerable
`0.35.3`; pin what you mean, and caret-bound it so a bare `>=` doesn't drag in an
unreviewed major.

### 7. A security step inside a cached layer is not a security step.

Learned the expensive way (SD-26, `docs/AUDIT_DEBT.md`). Every runtime stage ends
with `apt-get upgrade -y` / `apk upgrade`, under a comment explaining it closes
the window before the base tag is rebuilt. It never ran: `docker-build.yml` builds
with `cache-from/to: type=gha,mode=max`, so the layer was restored on every build
and the upgrade executed exactly once, ever. Images shipped with frozen package
versions while the Dockerfile claimed to be patching them.

Fixed with `ARG SECURITY_REFRESH` declared in each runtime stage and **referenced
inside the RUN** (BuildKit only invalidates on an ARG that is actually *used*),
fed a UTC date by CI. If you touch the Dockerfiles, keep that ARG wired.

Generalise it: when a step's whole purpose is to be non-deterministic, check
whether something upstream is making it deterministic.

---

## Access control for community reads

`backend/src/shared/community-read-access.ts` is the single place the D10-5 ruling
is written down. Use it; don't re-derive per-handler:

`actorId` · `actorIsAnyOf` · `actorIsGardenMember` · `forbidden` ·
`actorOwnsProducer` · `actorOwnsCourier` · `actorMayReadDelivery`

`forbidden()` always returns **403**, never 404. That's deliberate: with
enumerable ids, a 404-vs-403 split is an existence oracle that maps the id space.
One code for both says nothing.

If a guard breaks an existing test, give the test an entitled caller — do not
weaken the guard.

## Customer data

`src/lib/customer-data-registry.ts` enumerates every table holding customer data
with an explicit `delete` / `anonymise` / `retain` and a required `basis`.
`src/lib/customer-erasure.ts` reads it for both export and deletion. A unit test
walks `src/modules/**` and fails when a new customer-referencing table isn't
registered — if that test fails, add the entry, don't silence it.

---

## Commands

```bash
# backend/
pnpm lint                      # eslint src --max-warnings 0
pnpm typecheck                 # tsc --noEmit
pnpm test:unit                 # jest unit
pnpm test:unit:ci              # + coverage floor
pnpm test:integration:http     # needs a DB
pnpm test:integration:modules
pnpm test:posture-a            # CCR closed-loop invariants
pnpm build                     # medusa build

# root/
pnpm check:vendor-completeness
pnpm check:no-console
pnpm portals:typecheck && pnpm portals:lint
```

CI (`.github/workflows/ci.yml`) additionally runs `qa:internal-links`,
`i18n:validate`, a money-path concurrency soak over the hawala-ledger and
demand-pool specs, and `scripts/release_validation.sh`.

## Layout

`backend/` (Medusa) · `storefront/` (Next.js) · `admin-panel/` · `vendor-panel/` ·
`{nursery,wellness,botanical,creator}-portal/` · `packages/*` (incl. `portal-kit`) ·
`services/ai-orchestrator/` (Hermes/LangGraph).

Docker: backend and storefront run `node:22-bookworm-slim`; both panels run
`nginx:1.31-alpine` with `apk upgrade` **scoped to libuuid** on purpose — nginx and
its modules come from NGINX Packaging (F5), not Alpine main, so a bare `apk upgrade`
would move nginx off the pinned tag.

## Debt and decisions

`docs/AUDIT_DEBT.md` is the ledger — every row carries what was found, what was
done, and *why*, including the reasoning that turned out to be wrong. Read the
relevant row before re-opening an area. Add a row rather than fixing silently;
the reasoning is the artifact, not just the diff.

---

## Working conventions

- **Verify, don't assume.** Package index, live registry API, real DB version —
  this repo has burned several hours on plausible-but-wrong assumptions. If a
  claim can be checked, check it before writing it down.
- **A passing test that exercises a fallback is worse than a failing one.** When a
  test passes on the first try, confirm it actually reaches the code you think.
- **Don't report "done" on a gate you didn't watch go green.** CI is the test.
- Never disable TLS verification or unset `HTTPS_PROXY`.
