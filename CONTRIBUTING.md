# Contributing to Free Black Market (FBM)

Thanks for helping improve Free Black Market, a cooperative multi-vendor
commerce platform built on MedusaJS.

## Quick Start

1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the applications you need:
   ```bash
   cd backend && pnpm dev
   cd admin-panel && pnpm dev
   cd vendor-panel && pnpm dev
   cd storefront && pnpm dev
   ```
   Vertical portals have root-level shortcuts, e.g. `pnpm nursery-portal:dev`
   (see `README.md` for the full list).
4. Create a feature branch:
   ```bash
   git checkout -b feat/short-description
   ```

## Development Workflow

- Keep changes focused and scoped to one concern.
- Prefer small, reviewable pull requests.
- Update docs when behavior or architecture changes.
- Add or update tests for logic changes.
- For new vendor extension keys, complete `docs/VENDOR_EXTENSION_DEFINITION_OF_DONE.md`.

## Quality Checks

Run applicable checks before opening a PR:

```bash
pnpm --filter backend test
pnpm --filter storefront test
pnpm --filter admin-panel lint
pnpm --filter vendor-panel lint
```

If a check cannot run in your environment, document why in the PR.

### On the backend, `tsc --noEmit` is not the whole typecheck

`npx tsc --noEmit` in `backend/` passes on code that `medusa build` rejects.
The Medusa CLI **generates** `.medusa/types/query-entry-points.d.ts` as the
first step of a build, and that file is what gives `query.graph()` its real
types — most importantly `RemoteQueryFilters`, which accepts only **direct
fields of the entity being filtered**. Without those generated types, `filters`
is loose and a nested relation filter type-checks fine:

```ts
// passes `tsc --noEmit`; fails `medusa build` with TS2322
filters: { orders: { id: order.id } }

// ask the same question from the other side instead
entity: "order", fields: ["order_set.cart_id"], filters: { id: order.id }
```

A fresh checkout has no `.medusa/` at all, so this is the default state, not an
edge case. Before pushing backend changes that touch `query.graph`, run:

```bash
cd backend && npx medusa build     # generates types, then compiles
```

CI used to reproduce this split — `Lint & Type Check` ran `tsc --noEmit`
without generating types, so only the slower `Build backend` job caught it, and
you found out minutes later than you needed to. **Closed 2026-09-13 (W3-7):**
that job now runs `medusa build` before `tsc --noEmit`, so the generated types
exist and the fast job catches these. It costs about 35 seconds.

**You need both checks, because neither covers the other.**

| | covers `src/**` | covers `src/**/__tests__/**` | strict `query.graph` filters |
| --- | --- | --- | --- |
| `npx medusa build` | yes | **no** — the build tsconfig excludes tests | yes (it generates them) |
| `npx tsc --noEmit` | yes | yes | no, unless `.medusa/` happens to exist |

So a type error in a spec file passes `medusa build`, and a bad `query.graph`
filter passes `tsc --noEmit`. Run both:

```bash
cd backend
npx medusa build      # generates types, compiles src (not tests)
npx tsc --noEmit      # compiles everything including tests
pnpm lint
```

That ordering used to come with a caveat: **after** a build, `tsc --noEmit`
saw the generated `.medusa/` and reported `TS2321: Excessive stack depth`
errors that neither the build nor CI did. **All of them are fixed** — the
precondition for the CI change above, since the job could not generate types
and stay green while they existed. Both sequences are now clean, and anything
`tsc` prints is real.

Four workflow files carried them, not the two originally recorded:
`create-digital-product-order`, `rental/upsert-rental-config`,
`complete-cart-with-tickets` and `rental/add-to-cart-with-rental`. TypeScript
caps how many of these it reports per compilation, so clearing the first two
revealed the rest — if you ever see one again, fix it and re-run rather than
assuming it is the last.

The cause and the fix are one pattern, written up in
`backend/src/workflows/query-rows.ts`: a `useQueryGraphStep` row is typed as
the whole generated entity, and any SDK construct consuming it compares
`(T | WorkflowData<T>)[]` against `((T | WorkflowData<T>) & T)[]`, which on
`Order` or `Product` runs out of comparison depth. **Narrow where the rows
enter the workflow, with `asRows<{...}>(...)`, not where they are used** — the
comparison happens when the reference is typed, so a cast at the use site just
moves the error a few lines down. The cast is type-only; the row still carries
every field at runtime.

To reproduce the old CI job (no generated types), move `.medusa/` aside:

```bash
mv .medusa /tmp/medusa-generated && npx tsc --noEmit; mv /tmp/medusa-generated .medusa
```

## Commit Guidelines

- Use clear, imperative commit messages.
- Reference issue IDs when applicable.
- Keep unrelated changes out of the same commit.

## Pull Request Expectations

A good PR includes:

- Summary of what changed and why.
- Screenshots/videos for UI changes.
- Test evidence (commands + result).
- Migration or rollout notes if needed.

Use `.github/PULL_REQUEST_TEMPLATE.md` when opening your PR.

If you are a crowdsourced contributor recruited via the Blackout Community platform, include your Blackout Community handle in the PR body so the payout system can attribute the fix to you. Link the issue your PR closes with `Closes #N`.

## Crowdsourced Testing & Bounties

We run an external crowdsourced testing program for manual exploratory testing, production-readiness validation, and a security bounty. Engineers can also pick up triaged bugs for bounty fixes.

- Program overview and tester onboarding: `TESTING.md`
- Security disclosure and bounty scope: `SECURITY.md` and `docs/testing/security-bounty-scope.md`
- Manual test plans: `docs/testing/`

Recruitment, chat, and payouts are coordinated on the Blackout Community platform (external — distinct from the *release blackout windows* concept in `docs/blackout_centralized_build_work_order.md`).

## Reporting Bugs and Requesting Features

Please use:

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`

Include reproduction details, expected behavior, and environment info.

## Security Reporting

Do **not** open public issues for sensitive vulnerabilities. See `SECURITY.md` for the full disclosure policy and `docs/testing/security-bounty-scope.md` for the bounty program scope.

Report privately via a [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository.

## Code of Conduct

Participation in this project is governed by `CODE_OF_CONDUCT.md`.
