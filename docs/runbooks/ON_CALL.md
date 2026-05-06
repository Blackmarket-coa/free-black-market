# On-Call Rotation

**Last validated:** 2026-05-06

## Schedule

- One primary and one secondary on-call rotate weekly (Mon 09:00 UTC handoff).
- Schedule lives in PagerDuty (or your provider) under the **Free Black Market** service. The published schedule URL belongs in `#freeblackmarket-oncall` channel topic.

## Coverage

| Window | Primary responsibilities |
|--------|--------------------------|
| Business hours (Mon–Fri 09:00–17:00 local) | Acknowledge alerts within 5 min; triage SEV3/SEV4. |
| After-hours / weekends | Acknowledge SEV1/SEV2 within 5/15 min per `INCIDENT_RESPONSE.md`. SEV3/SEV4 may wait until next business day. |

## Handoff procedure

Outgoing on-call posts a handoff message to `#freeblackmarket-oncall` covering:

1. Open incidents (link each `#inc-*` channel).
2. Recent alerts that fired but didn't escalate.
3. Active flags or temporary mitigations (e.g. "kill switch X is on").
4. Anything pending for the new on-call (PRs, tickets, vendor escalations).

Incoming on-call confirms by replying to the handoff message.

## Escalation tree

```
Alert fires
   │
   ▼
Primary on-call (5 min ack window)
   │  miss?
   ▼
Secondary on-call (5 min ack window)
   │  miss?
   ▼
Engineering manager
   │  miss?
   ▼
CTO
```

PagerDuty re-pages on every ack-window miss.

## Tools the on-call needs

- Cluster access (`kubectl`, kubeconfig provisioned for both staging and production).
- GHCR pull access for image debugging.
- Sentry, Grafana, log-aggregation read access.
- GitHub `repo:write` to revert deploys.
- Status page edit permissions.

If you're newly on-call and missing any of the above, escalate to the engineering manager **before** your shift starts.

## Compensation

Track on-call hours in the team's tracking spreadsheet. After-hours pages are compensated per company policy.
