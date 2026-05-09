# AI-Driven Security and Dependency Update Workflow

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.9 (fork-management posture) and §8.3 (workflow definition).

The fork-management posture in §2.9 commits BMC to maintaining its modified forks of Cinny, Synapse, MedusaJS, MercurJS, and the absorbed Fleetbase rather than tracking upstream. The risk this creates is that BMC carries the burden of security maintenance across substantial codebases. The mitigation is the AI-driven security and dependency update workflow described here.

The workflow is the operational answer to "how does a solo maintainer keep five forked projects current on security and dependency hygiene?" The answer is: AI tooling does the bulk of the triage and patching, with a residual human-in-the-loop step that bounds the risk of bad classifications.

## The four-step workflow

```
[1] Aggregation        →  [2] Classification  →  [3] Patch generation  →  [4] Maintainer review
    (UPSTREAM_ADVISORIES.md)  (applicable / NA /     (PR per applicable    (merge or defer;
     entries appended)        requires-review)        advisory)              dependency-update
                                                                             flow runs in parallel)
```

### Step 1 — Aggregation

A scheduled job pulls advisories from upstream sources and appends entries to [`UPSTREAM_ADVISORIES.md`](./UPSTREAM_ADVISORIES.md) using the schema documented there. Default classification on aggregation is `requires-human-review` so that nothing slips through unreviewed.

This step is **automation, not AI**. It produces a clean queue of advisories without making judgments.

### Step 2 — Classification

For each advisory at status `open`, AI tooling reads the advisory and the BMC fork in question and classifies it as one of:

- **applicable** — affected code path is present in the BMC fork; mitigation should be applied.
- **not-applicable** — affected code path is absent (removed, replaced, or substantially modified) in the BMC fork.
- **requires-human-review** — classification is ambiguous.

The classification step writes a reasoning paragraph that cites the fork commits, file paths, or removed-component references that establish its choice. The reasoning lives in the advisory entry; if the maintainer disagrees with a classification later, they have something concrete to point at.

**What "ambiguous" means in practice:** if the affected upstream file exists in the fork but has been modified, AI tooling should classify as `requires-human-review` rather than guessing. Confidence is asymmetric: a confident `not-applicable` is acceptable when the upstream file is fully absent or replaced; a confident `applicable` is acceptable when the upstream file is verbatim.

### Step 3 — Patch generation

For advisories classified `applicable`, AI tooling produces a candidate patch on a feature branch named `security/<advisory-id>`. The PR description must:

- Identify the upstream advisory ID and link the upstream URL.
- Describe the mitigation in one paragraph.
- List the BMC fork files modified and the upstream files those correspond to.
- Note any tests added or modified.
- Confirm CI is passing on the branch before requesting review.

Patches are **never auto-merged**. The PR sits awaiting maintainer review.

### Step 4 — Maintainer review

The maintainer (or a Stage-4 co-maintainer per [`CO_MAINTAINER_ONBOARDING.md`](./CO_MAINTAINER_ONBOARDING.md)) reviews each candidate patch. Review criteria:

- The advisory and the mitigation are real (not a hallucination).
- The patch matches the advisory's mitigation, not a different one.
- The patch passes CI including SAST (CodeQL) and dependency review.
- The patch does not introduce unrelated changes.

After merge, the corresponding entry in [`UPSTREAM_ADVISORIES.md`](./UPSTREAM_ADVISORIES.md) is updated to `Status: patched` with the merge SHA recorded.

For advisories classified `requires-human-review`, the maintainer reads the advisory and re-classifies as `applicable` or `not-applicable`. If `applicable`, the maintainer can either write the patch directly or trigger Step 3 manually for the AI tooling to take a second pass with the human classification as input.

## Dependency-update flow

The dependency-update flow follows the same four steps with one substitution: **Step 1** ingests dependency-bot output (Renovate or Dependabot) instead of upstream advisories, and **Step 2** classifies updates by risk rather than applicability:

- **patch / lockfile-only** — auto-PR, AI-reviewed, maintainer merge.
- **minor / behavioral** — AI-classified for breaking-change risk, PR if low risk, defer if high risk.
- **major** — always `requires-human-review`. The maintainer decides whether to take the major bump now, defer to a later milestone, or pin and document why.

Dependency PRs land at `deps/<package>-<version>` branches.

## Why this is acceptable

Three properties make this workflow tolerable for security-sensitive work:

1. **Asymmetric trust.** The workflow trusts AI tooling for triage and candidate patches but never for merging. The maintainer is in the loop on every code change.
2. **Citable reasoning.** Every classification produces a reasoning paragraph in the advisory entry. A wrong classification is detectable later because the reasoning is on record.
3. **Default-pessimistic on ambiguity.** The default classification on aggregation is `requires-human-review`, and the AI tooling is instructed to prefer `requires-human-review` over guessing. This shifts the failure mode from "we silently shipped a bad patch" to "we have a queue of advisories awaiting review."

## When the workflow breaks down

The workflow breaks down in three scenarios; each has an explicit response.

- **AI tooling consistently misclassifies a class of advisory.** Audit a sample of recent classifications, find the pattern, and add a per-source instruction (e.g. "for Synapse advisories, always check `synapse/handlers/federation_event.py` regardless of upstream path") to the AI tooling's classification prompt.
- **The advisory queue grows faster than the maintainer can review.** This is the bus-factor scenario the §7 work mitigates. Onboard a Stage-4 co-maintainer earlier; share the review load. Alternatively, narrow the upstream sources if some are producing high-volume low-relevance advisories.
- **A merged candidate patch turns out to be wrong (regression, incomplete fix, introduced new bug).** Treat it as an incident per [`runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md) and write a postmortem per [`runbooks/POSTMORTEM_TEMPLATE.md`](../runbooks/POSTMORTEM_TEMPLATE.md). The postmortem revises this workflow doc if the failure mode is generalizable.

## Cross-references

- [`UPSTREAM_ADVISORIES.md`](./UPSTREAM_ADVISORIES.md) — the queue this workflow consumes.
- [`CO_MAINTAINER_ONBOARDING.md`](./CO_MAINTAINER_ONBOARDING.md) — Stage-4 co-maintainers can run Step 4.
- [`runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md), [`runbooks/POSTMORTEM_TEMPLATE.md`](../runbooks/POSTMORTEM_TEMPLATE.md) — invoked when a merged patch fails.
- [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §2.9 — the fork-management posture this workflow supports.
