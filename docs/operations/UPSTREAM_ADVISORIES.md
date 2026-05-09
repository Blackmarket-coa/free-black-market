# Upstream Advisories Feed

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.9 (fork-management posture) and §8.3 (AI-driven security workflow).

This file is the aggregated feed of upstream security advisories that affect the projects BMC carries forks of. It is a tracked artifact: the schema lives here, and the entries are appended below the `<!-- AUTOMATED CONTENT BELOW -->` delimiter by the scheduled aggregation workflow.

The triage workflow that consumes this feed is documented in [`AI_SECURITY_WORKFLOW.md`](./AI_SECURITY_WORKFLOW.md).

## Upstream sources

The aggregation pulls from the following upstream advisory feeds. Each source has a stable URL and a maintainer; if a source goes dark, the feed entry below records the date and the workflow opens a tracking issue.

| Project | Upstream repo | Advisory feed |
|---------|---------------|---------------|
| Cinny | `cinnyapp/cinny` | GitHub Security Advisories + npm audit |
| Synapse | `element-hq/synapse` | GitHub Security Advisories + Matrix Foundation security tracker |
| MedusaJS | `medusajs/medusa` | GitHub Security Advisories + npm audit |
| MercurJS | `mercurjs/mercur` | GitHub Security Advisories + npm audit |
| Fleetbase | `fleetbase/fleetbase` | GitHub Security Advisories (absorbed into FBM logistics module) |

## Entry schema

Each entry is a Markdown subsection under one of the source headings below, using this shape:

```
### <ADVISORY_ID> — <one-line title>

- **Source**: <project name>
- **Severity**: <critical | high | medium | low>
- **Affected versions**: <semver range>
- **Upstream URL**: <link>
- **First aggregated**: <YYYY-MM-DD>
- **BMC fork applicability**: <applicable | not-applicable | requires-human-review>
- **Reasoning**: <one paragraph; why the AI tooling chose this classification>
- **Candidate patch**: <PR link if one exists, otherwise `pending` or `n/a`>
- **Status**: <triaged | patched | acknowledged-not-applicable | open>
- **Last reviewed**: <YYYY-MM-DD>
```

Entries are grouped under one heading per upstream source so that walking the feed by project is straightforward. Within a source, entries are ordered newest-first.

## Classification rules

The AI tooling that classifies each advisory does so against the BMC fork's modifications, not against the upstream code. The three outcomes:

- **applicable** — the affected upstream code path exists in the BMC fork, the advisory's mitigation is non-trivial, and a candidate patch should be generated. The candidate patch lands as a PR with this advisory's ID in the title.
- **not-applicable** — the affected upstream code path has been removed, replaced, or substantially refactored in the BMC fork in a way that defangs the advisory. The reasoning paragraph must cite the fork commit or path that establishes this.
- **requires-human-review** — the AI tooling cannot make a confident determination. This is the residual human-in-the-loop step. The maintainer (or a Stage-4 co-maintainer) reads the advisory and decides applicability manually, then updates this entry to one of the other two outcomes.

The full workflow including how the candidate patch is reviewed and merged is in [`AI_SECURITY_WORKFLOW.md`](./AI_SECURITY_WORKFLOW.md).

## Status lifecycle

```
open → triaged → (applicable: patched | not-applicable: acknowledged-not-applicable)
```

- `open`: just aggregated, not yet classified.
- `triaged`: AI tooling has classified; for `applicable` advisories a candidate patch may already be queued.
- `patched`: PR for the candidate patch has merged on the BMC fork.
- `acknowledged-not-applicable`: classification has been reviewed (either by AI tooling and merged automatically, or by human review).

Entries are **never deleted**. A patched advisory remains in the feed for audit history. The aggregation workflow appends new entries; it does not modify existing ones.

## Aggregation workflow expectations

The scheduled GitHub Action that populates this file lives at `.github/workflows/upstream-advisories.yml` (lands separately). Its responsibilities:

1. On a daily schedule, fetch new advisories from each upstream source listed above.
2. For each advisory not already present in this file, append an entry under the appropriate source heading with `Status: open` and `BMC fork applicability: requires-human-review` as the safe default.
3. Open a PR (do not push directly to the default branch).
4. Tag the PR with `security`, `automated`, and the source project's label.

The classification step (moving entries from `open` to `triaged`) is handled by the AI security workflow described in [`AI_SECURITY_WORKFLOW.md`](./AI_SECURITY_WORKFLOW.md), which runs as a separate workflow against the open entries.

## Initial state

The feed below is empty until the aggregation workflow runs for the first time. Manual entries that pre-date the workflow can be added under the source headings using the schema above.

<!-- AUTOMATED CONTENT BELOW -->

### Cinny

_No entries yet._

### Synapse

_No entries yet._

### MedusaJS

_No entries yet._

### MercurJS

_No entries yet._

### Fleetbase

_No entries yet._
