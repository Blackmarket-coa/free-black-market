# Post-mortem: <one-line description>

| Field | Value |
|-------|-------|
| Incident ID | `inc-YYYYMMDD-<slug>` |
| Severity | SEV1 / SEV2 / SEV3 |
| Detected at | `YYYY-MM-DD HH:MM` UTC |
| Resolved at | `YYYY-MM-DD HH:MM` UTC |
| Duration | _XX min_ |
| Author | `@github-handle` |
| Reviewers | `@reviewer1`, `@reviewer2` |

This template is referenced from `docs/runbooks/INCIDENT_RESPONSE.md`. SEV1 and SEV2 incidents must produce a completed post-mortem within **5 business days** of resolution. Copy this file to `docs/postmortems/inc-YYYYMMDD-<slug>.md` and fill it in.

## 1. Summary

One paragraph. What happened, who saw it, when it ended. Written so a board member could understand it.

## 2. Customer impact

- **Audience(s) affected**: shoppers / vendors / admins / partners.
- **Number affected**: estimate from the OTel error rate × traffic, or count of distinct user IDs in errored sessions.
- **Functional impact**: what they couldn't do (browse, check out, withdraw, log in, …).
- **Financial impact**: failed checkouts × AOV, or chargebacks, or SLA credits owed.
- **Trust impact**: any external comms (status page, Twitter, vendor email)?

## 3. Timeline

All times in UTC. One row per state change.

| Time | Event | Source |
|------|-------|--------|
| HH:MM | First user report in `#support`. | Slack |
| HH:MM | Alert fired: `backend 5xx > 1% for 5m`. | PagerDuty |
| HH:MM | Primary on-call ack. | PagerDuty |
| HH:MM | `#inc-<slug>` opened. | Slack |
| HH:MM | Hypothesis 1: bad migration → discarded after `kubectl rollout history` showed no recent change. | Slack thread |
| HH:MM | Hypothesis 2: DB connection pool exhausted → confirmed by Grafana DB pool dashboard. | Grafana |
| HH:MM | Mitigation deployed: `kubectl scale deployment/backend --replicas=6`. | kubectl |
| HH:MM | Error rate back to baseline. | OTel |
| HH:MM | Status page set to "operational". | statuspage.io |
| HH:MM | Incident closed. | Slack |

## 4. Detection

- **How was the incident detected?** Alert / user report / proactive dashboard scan / external monitoring.
- **Time-to-detect**: from first impacted user → first ack.
- **What signal fired?** Quote the alert rule and link to the dashboard.
- **Was the signal sufficient?** If not, what should have fired sooner?

## 5. Root cause

State the **single** technical cause, in one paragraph. If you find yourself listing more than one cause, separate them: one root cause, the rest are contributing factors (next section).

Include code links (`backend/src/.../foo.ts:42`) and the offending commit / image tag where applicable.

## 6. Contributing factors

Bullet list of things that, by themselves, would not have caused the outage but that made it more likely or harder to recover. Examples:

- The deployment ran ahead of a planned DB migration.
- The runbook for "DB pool exhausted" linked to a Grafana dashboard that no longer existed.
- The on-call had not been onboarded to the relevant alert.

## 7. What went well

Concrete acts of competence — not "team rallied". Example:

- Primary acked within 90 s, well under the SEV1 5-min target.
- The K8s rollback was a single-command reversal because we ship one image per deploy.

## 8. What didn't

- Time-to-mitigate exceeded the SEV1 60-min target by NN minutes.
- The `/health/ready` probe did not catch the DB-pool exhaustion because it does not measure pool checkout latency.
- No alert existed for "publishable-key cache thrash"; we only learned about it post-incident.

## 9. Action items

| # | Action | Owner | Due | Tracking |
|---|--------|-------|-----|----------|
| 1 | Add a `db_pool_checkout_p99` Grafana panel with an alert at 200 ms. | _name_ | YYYY-MM-DD | `gh-issue-NNN` |
| 2 | Update `runbooks/INCIDENT_RESPONSE.md` to point to the new dashboard. | _name_ | YYYY-MM-DD | `gh-issue-NNN` |
| 3 | Onboard the secondary on-call to the DB-pool alert. | _name_ | YYYY-MM-DD | `gh-issue-NNN` |
| 4 | Add a load-test scenario that exercises the DB pool. | _name_ | YYYY-MM-DD | `gh-issue-NNN` |

Action items are tracked in GitHub issues with the `incident` label. The post-mortem is closed only when every row above has a linked issue (open or closed).

## 10. Lessons / patterns

What general pattern does this incident teach?

- Have we shifted any debt out of `docs/AUDIT_DEBT.md` into the immediate workload as a result?
- Have we ratcheted any runbook? Note the PR.
- Is there a class of failure we should chaos-test (Toxiproxy, Litmus)?

## Appendix: command output (optional)

Pasting the actual `kubectl describe pod`, log excerpts, or query plans is welcome — but truncate to the relevant N lines and put them under headings so the post-mortem stays scannable.
