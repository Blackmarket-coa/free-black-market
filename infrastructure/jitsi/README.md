# Jitsi Meet on Railway (Recommended: `jitsi/docker-jitsi-meet`)

This project should use **[`jitsi/docker-jitsi-meet`](https://github.com/jitsi/docker-jitsi-meet)** as the base for Railway deployment.

> **Status: not deployed, not wired in.** Jitsi is not part of the production
> stack (`docker-compose.prod.yml` / `scripts/deploy-fedora.sh`), and no FBM
> app code references it. This directory is a deployment recipe only.

## Why this is the best option

Between:
- `Blackmarket-coa/jitsi-meet`
- `jitsi/docker-jitsi-meet`

the official `jitsi/docker-jitsi-meet` stack is the safest production choice because it is maintained by the Jitsi team, receives regular security/runtime updates, and has the canonical service split (`web`, `prosody`, `jicofo`, `jvb`) needed for stable conference routing.

---

## Railway deployment model

Deploy Jitsi as **4 Railway services** in one project:

1. `jitsi-web` (public)
2. `jitsi-prosody` (private)
3. `jitsi-jicofo` (private)
4. `jitsi-jvb` (private + UDP 10000 support when available)

Use the service definitions from `docker-compose.yml` in this directory as your source of truth for image versions and env vars.

> Note: Railway does not run Docker Compose directly in production; create one Railway service per container and copy each service's `image`, env vars, and mounts.

---

## Required environment variables

Start from `.env.railway.template` in this folder and configure:

- `PUBLIC_URL` → public HTTPS URL of `jitsi-web`
- `ENABLE_LETSENCRYPT=0` (Railway handles TLS)
- secure values for:
  - `JICOFO_AUTH_PASSWORD`
  - `JVB_AUTH_PASSWORD`
  - `JIGASI_XMPP_PASSWORD`
  - `JIBRI_RECORDER_PASSWORD`
  - `JIBRI_XMPP_PASSWORD`

For media quality on hosted platforms, tune:
- `JVB_STUN_SERVERS`
- optional `JVB_ADVERTISE_IPS` (if you have a static egress/IP setup)

---

## FBM chat integration notes

There is no Rocket.Chat in this repo. FBM chat is Matrix: the backend
provisions users and rooms on the Blackout Synapse homeserver
(`backend/src/shared/matrix-service.ts`) and hands out auto-login tokens for
an embedded Element Web client through `/store/chat`, `/vendor/chat` and
`/admin/chat`.

Nothing connects that chat to this Jitsi stack today. Using Jitsi for calls
would mean configuring the Element Web / Synapse deployment (which lives with
Blackout, outside this repo) to point at your Jitsi domain; no FBM
application code is involved.
