# Incident Response

**Last validated:** 2026-05-06

## Severity matrix

| SEV | Description | Examples | Target ack | Target mitigate |
|----:|-------------|----------|-----------:|----------------:|
| SEV1 | Site down / data loss / payment outage / security breach in progress | All storefront 5xx; backend `/health/ready` failing > 5 min; suspected exfil | 5 min | 60 min |
| SEV2 | Major degradation; one app or critical flow unavailable | Checkout fails for all users; admin login broken; > 10 % error rate | 15 min | 4 hours |
| SEV3 | Partial degradation; non-critical feature broken | Search down; one fulfillment provider down | 1 hour | 1 business day |
| SEV4 | Cosmetic / single-user / no business impact | Layout glitch on one page; one user reports an issue | next business day | next sprint |

## First-responder checklist

1. **Acknowledge** in `#freeblackmarket-alerts` Slack within the SEV target.
2. **Open an incident channel** `#inc-<short-slug>`. Pin a status template (see below) at the top.
3. **Page secondary** for SEV1/SEV2 via the on-call rotation defined in `docs/runbooks/ON_CALL.md`.
4. **Contain.** If a deployment caused the incident, run `Deploy → Production` with the previous tag (see `DEPLOYMENT.md`). If a feature flag caused it, flip it off.
5. **Diagnose.** Pull the last 1 h of logs and traces from the relevant service. Run `kubectl describe pod`, `kubectl logs --previous`, and check the OTel dashboard for traffic-shape changes.
6. **Communicate.** Post a status update every 30 min for SEV1, every hour for SEV2.
7. **Resolve.** Restate the customer impact, what changed, and how the team confirmed mitigation.
8. **Post-mortem.** Within 5 business days for SEV1/SEV2. Use the template at `docs/runbooks/POSTMORTEM_TEMPLATE.md` (created on first incident).

## Status template

```
INCIDENT: <one-line description>
SEV: <1-4>
START: <UTC timestamp>
SCOPE: <which services/users>
IMPACT: <what users see>
NEXT UPDATE: <UTC timestamp>
COMMANDER: <name>
```

## Communications

| Audience | Channel | Cadence |
|----------|---------|---------|
| Engineering | `#inc-*` Slack channel | every 30 min (SEV1) / hourly (SEV2) |
| Leadership | `#leadership` Slack DM | at containment + at resolution |
| Customers | status page (https://status.freeblackmarket.com) | within 30 min of detection |
| Partners (vendors) | vendor email list | only if vendor-facing |

## Escalation

- Primary on-call → Secondary on-call → Engineering manager → CTO. Escalate one rung if an ack is missed by the SEV target.
- For security incidents, also notify the security lead immediately. Do not delete logs or evidence.

## Post-incident actions

- File any follow-up engineering work as GitHub issues under the `incident` label.
- Update `docs/AUDIT_DEBT.md` if the incident exposed a piece of debt that was previously deferred.
- Update relevant runbooks if the response procedure was unclear or wrong.
