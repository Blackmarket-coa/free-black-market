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
