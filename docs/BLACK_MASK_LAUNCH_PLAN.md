# Black Mask launch plan — summary, decisions and per-repo steps

Recorded 2026-10-04 from the operator's spec of 2026-10-03. This file turns that
spec into sectional steps for each repository the Black Market Coalition (BMC)
runs, and records what was decided versus what is still a placeholder. Anything
marked **placeholder** is an assumption, not a decision. Nothing here resolves a
legal question; it surfaces them in `docs/legal/checkpoints.md`.

Companion documents: `docs/BMC_SURVIVAL_PROGRAMS.md` (nonprofit parity, Phase 1
in progress), `docs/legal/checkpoints.md` (L1–L31), `docs/AUDIT_DEBT.md`.
In the Blackout repo: `docs/black-mask-chat-panel-and-account-link.md`. In the
Blackstar repo: `ROADMAP.md`.

---

## 1. Summary

Black Mask ships as a **hosted, managed password vault** with a **free privacy
toolkit**, billed through FBM, with an optional minimal Blackout chat panel, on
browser extension, desktop and mobile. It sells one thing — the hosted vault.
Everything else is free: the extension, the eight privacy features, the chat
panel, and bring-your-own-server use. Self-hosters run Vaultwarden for free; the
paying customer wants hosting without managing it. **Encryption is never
paywalled.**

Launch order: Blackout, Black Mask and FBM first. Vending units come later,
funded by income from the existing structure. The paid launch gates on Phase 0
(infrastructure) and Phase 1 (billing and a true product). Chat (Phase 2) and the
differentiators (Phase 3) follow it.

## 2. Decided

- Launch order: Blackout, Black Mask and FBM first; vending later, funded by
  income from the existing structure.
- Free: the extension, the eight privacy features, bring-your-own-server use,
  and the Blackout chat panel. Paid: the hosted vault.
- Payments run through FBM, which **keeps its commission** on Black Mask sales.
  BMC is both seller and platform, so the 3% nets to zero and the ledger stays
  uniform.
- **Fee-first split.** Processing fees come off the gross first; the remainder
  is split 97/3 between seller and BMC, so BMC never absorbs processing.
- **FBM payouts no longer vary by KARMA tier.** KARMA stays as reputation,
  quests and unlocks with no money attached. This is a payout migration and
  counsel reviews it (L27).
- Backup servers are available for Black Mask hosting; the standby is
  active-passive, never two live writers.
- The Blackout chat panel is free for anyone with the extension and a Blackout
  account; a minimal sandbox showing only Canopies, dens and DMs. Links to
  anything else open in Blackout.
- A Blackout account can accept a Black Mask registration, or link to a Black
  Mask account, on request. The user picks how long the link lasts: a timeframe
  or indefinitely, nothing preselected.
- Black Mask must ship on mobile and desktop, not only as a browser extension.
- Sign-up and purchase happen on the web for the mobile apps, as already decided
  for the FBM and Blackout apps.

## 3. Placeholder or proposed, not decided

- The $5/month hosted-vault price and every growth assumption in the revenue
  model.
- Dead drops, a dead man's switch, coalition vaults, and sovereign identity
  across the three products.
- Building the chat panel as a sandboxed embed of the live Blackout client.
- Bundling a Black Mask seat into FBM's $10/month all-access plan.
- Stellar/USDC payment for privacy-minded users (later option; see §5 F11).

## 4. Where this spec changes a standing rule — flagged, not hidden

Three items in the spec collide with rules recorded elsewhere in this repo.
They are recorded as the operator's decisions, with the collision stated.

| Spec item | Standing rule it changes | What was done |
|---|---|---|
| **Flat payouts; KARMA carries no money.** | The survival-programs brief said "KARMA ladder unchanged". The code ties money to tiers today: `backend/src/modules/progression/grower-karma.ts` `GROWER_TIERS` sets `split_pct` 0.60 (Seedling) → 0.62 (Sprout) → 0.65 (Root) → 0.68 (Canopy) → 0.72 (Ancestor), mirrored per node in `backend/src/modules/payout-breakdown/grower-payout.ts` `GROWER_SPLIT_CONFIG` (0.60–0.62) and parity-tested against `packages/bmc-portal-kit/src/tiers.ts`. | Recorded as decided for **money only**: the reputation ladder (tiers, XP, quests, unlocks) is unchanged; the `split_pct` column is what flattens. New checkpoint **L27**. Not implemented yet — it is a payout migration (§5 F7). |
| **A single $10/month all-access plan at 0% commission replaces the tiered plans.** | `docs/BMC_SURVIVAL_PROGRAMS.md` §0.1 records that no such plan exists and lists it as Open Decision 5; the live ladder in `backend/src/modules/vendor-plan/catalog.ts` is free (3%), starter $29 (2.5%), pro $99 (2%), scale $249 (1.5%), internal. `vendor-plan/__tests__/catalog.unit.spec.ts` pins "every plan ≤ 3%" and "the ladder only discounts". | Decision 5 is now **answered: in scope**. The spec calls it an "existing FBM decision"; the code says otherwise, so it is scheduled as work (§5 F8), not described as shipped. |
| **Fee-first split (processing off gross, then 97/3).** | Today the 3% is taken on `order.subtotal` (`backend/src/subscribers/hawala-order-payment.ts`, fee base comment) and processing is a display estimate in `payout-breakdown` (`payment_processing_percent` 2.9% + 30¢). | Recorded as decided; scheduled as a breakdown-math change with its own tests (§5 F6). The flat 3% rate itself does not move. |

## 5. Sectional steps — free-black-market (FBM)

FBM takes the payment and triggers vault provisioning. **Vault login never
depends on FBM being up**; only new sign-ups and renewals wait when FBM is down.

### Phase 1 — billing and provisioning

| # | Step | Where it lands | Notes |
|---|---|---|---|
| F1 | **First-party BMC listing** for the hosted vault, sold by a BMC seller account on the storefront, paid through Stripe (already live on FBM). | Seller + product data; no new module. | The BMC seller is an ordinary seller so the 3% commission applies and nets to zero. Confirm how "first-party" is marked for reporting; `backend/src/shared/plugin-payees.ts` treats "no listing" as not first-party, which is the only first-party notion in code today. |
| F2 | **Confirm recurring consumer subscriptions end to end on the storefront** before promising a date. | `backend/src/api/store/subscriptions/route.ts` exists (create from a cart with `interval` weekly…yearly, `type` csa_share / meal_plan / produce_box / membership / custom); `storefront/src/lib/data/` has **no subscription purchase call** and no storefront page calls `/store/subscriptions`. | So the API exists and the purchase UI does not. A `membership`-type monthly subscription is the natural fit for the vault seat. Unconfirmed until a test-mode run completes. |
| F3 | **Signed provisioning webhook** on order placed / renewed / cancelled / payment failed, sent to the Black Mask provisioning service. | New outbound webhook, modelled on the existing FBM↔Blackout bridge (`backend/src/api/v1/integrations/blackout/link/route.ts` uses a service token / JWT; `lib/blackout-oauth.ts`). HMAC-signed body, idempotency key per order event, retries with backoff. | Payload carries the FBM customer id and plan, never vault secrets. The provisioning service (Black Mask side) creates or invites the vault account; sign-ups are otherwise off. |
| F4 | **Lifecycle rules**: renewals extend; cancellation or failed payment starts a **grace period (length open)**, then read-only access with export. Never quick deletion. | Subscription status machine (`SubscriptionStatus` active / paused / canceled / expired / failed) → webhook events. | Grace length is an open decision; ship it as a setting, not a constant. |
| F5 | **Commission kept on BMC's own sales.** | No code change: the flat 3% default applies to the BMC seller. | Pinned by `vendor-plan/__tests__/catalog.unit.spec.ts`; do not add a 0% override for the BMC seller. |
| F6 | **Fee-first split**: processing fee off the gross first, then 97/3 on the remainder. | `backend/src/modules/payout-breakdown/service.ts` `calculateBreakdown` (fee base and `PAYMENT_PROCESSING` line), `backend/src/subscribers/hawala-order-payment.ts` (fee base). | Behind a flag; real-chain tests, not the two chain stubs (`payout-settings-route.unit.spec.ts`, `consignment-split.unit.spec.ts`), which re-implement the chain and prove nothing. On a $40 order BMC's commission is about 2.9% of gross. Interaction with the 0% donation rule (Phase 1 nonprofit parity, S3): a donation has no BMC share; the org's account bears processing natively on a direct charge. |
| F7 | **Flat payouts migration** — remove money from KARMA tiers. | `progression/grower-karma.ts` `GROWER_TIERS.split_pct`; `payout-breakdown/grower-payout.ts` `GROWER_SPLIT_CONFIG`; `packages/bmc-portal-kit/src/tiers.ts` + `tiers.parity.spec.ts`; `api/store/karma-ladder/route.ts` (public ladder copy); every other tier-linked money path — inventory first: escrow, consignment splits, patronage, `vendor-plan/limits.ts`. | Steps: (1) inventory every read of `split_pct`/tier → money; (2) pick the flat share and confirm **how the 60–72% share is defined** (grower's share of post-platform-fee node net, per `grower-payout.ts` header) — the spec asks for exactly this confirmation; (3) migrate existing balances, pending orders and vendor terms with a dated cut-over; (4) keep tiers for reputation, quests and unlocks only; (5) counsel review (**L27**) before cut-over. Behind a flag until then. |
| F8 | **$10/month all-access plan at 0% commission**, replacing the $29/$99/$249 ladder. | `backend/src/modules/vendor-plan/catalog.ts` and its invariant spec; `vendor-plan/limits.ts`; billing surfaces in vendor-panel. | Open Decision 5 is now answered. Work: add the plan, retire the three paid tiers with a migration path for current subscribers, update the public `/store/fee-schedule` page, and revisit the catalog spec's "ladder only discounts / internal null" semantics so 0% is a plan the ladder can express. The free vendor stays at 3%. |
| F9 | **Mobile apps buy on the web.** | Storefront flow only; no in-app purchase. | Verify current Apple and Google rules on external payment links before any store submission (**L29**). |
| F10 | **Bundle option**: a Black Mask seat inside the $10 plan. | Entitlement grant on the plan. | Not decided. Makes the plan worth more to vendors but cuts standalone subscriptions. Model it before deciding. |
| F11 | **Later: Stellar/USDC payment** for privacy-minded users. | Payment provider. | Accepting USDC *as payment* is a different question from paying vendors in USDC, which Posture A forbids (`docs/POSTURE_A_COMPLIANCE.md`: vendor payout terminates at Stripe ACH, no USDC payouts). Any USDC acceptance must settle to USD before it touches the ledger, and needs its own checkpoint before design. Not scheduled. |
| F12 | **Guardrails on BMC's own house**: Anubis (AI-scraper firewall) and CrowdSec in front of FBM; `security.txt`; publish the extension's permissions on the trust page once the extension ships. | `storefront` headers / infra configs. | Anubis and CrowdSec are MIT. Reverse-proxy placement belongs with the Blackout infra configs (the large header backlog lives there). |

### What FBM does not do in this plan

- Hold vault accounts, vault data or vault keys. FBM holds the order and the
  customer; the provisioning service holds the account mapping.
- Change the 3% default or the plan ladder's "only discounts" rule except as F8
  describes.
- Build dead drops, the dead man's switch or coalition vaults. Those live in the
  Black Mask fork and, for delivery into dens, Blackout.

## 6. Sectional steps — blackout

Phase 2 of the launch. Full detail, with code anchors, is in the Blackout repo
at `docs/black-mask-chat-panel-and-account-link.md`; the summary here is so the
plan reads whole from one place.

| # | Step | Notes |
|---|---|---|
| B0 | **Preconditions** before any Black Mask integration ships: resolve **BO-1** (key-backup `DecryptionError`, `KNOWN_ISSUES.md`); rotate the Blackout bot token; clear the unmerged security-advisory PRs (ten open on 2026-10-03, #927–#941, one per day of upstream advisories); start with text chat because LiveKit voice was failing at the last audit; fix the Squarespace page served at theblackout.app with broken federation delegation. | BO-1 gates "anything that routes trust through Blackout" (`KNOWN_ISSUES.md` BO-1 notes). Do not depend on Blackout's encryption for vault extras until it is fixed. |
| B1 | **Embed route** that renders only Canopies (communities and channels), dens and DMs. No Town Square, Coliseum, Market or feeds. No unread badges by default. | New client route + API scoping. |
| B2 | **CSP**: allow framing of the embed route only from Black Mask origins. | `packages/api/src/middleware/security-headers.ts` sets `frame-ancestors 'none'` and `frame-src 'none'` globally today. The embed route needs a per-route `frame-ancestors` allow-list of Black Mask origins (extension, desktop and mobile webview origins) while every other route keeps `'none'`. Verify with a real response-header check, not by reading the file. |
| B3 | **Sign-in inside the sandbox**; the user picks the session length (a timeframe or indefinitely, nothing preselected). | Session TTL honoured server-side. |
| B4 | **Optional account link**: a signed handshake, like the existing FBM↔Blackout bridge, creates a link record on Blackout's side with a user-chosen duration; expiry enforced on the server; revocable any time from a **link-status screen**. Blackout also **accepts a Black Mask registration**, or links an existing account, on request. | Mirror the FBM link capture shape (`blackoutUserId` + target id, service-token or JWT auth). |
| B5 | **Unlink or expiry** ends the chat session, signs that device out, and (vault side) deletes any recovery key stored in the vault. **The Blackout account is never deleted.** | Server-side device sign-out on link end. |
| B6 | External links from the panel pass through Black Mask's phishing check first; links to other Blackout content open in a normal Blackout tab. | Client behaviour in the embed. |
| B7 | **Phase 3 hooks**: delivery of a dead drop or vault item into a den (the `apps/deaddrop-appservice` exists; the dead-drop spec was not found among confirmed-live features at the last audit); Matrix check-in reminders and M-of-N approval through the governance engine for the dead man's switch; Matrix alerts channel for breach and phishing alerts. | Each follows the paid launch. |
| B8 | **Capacity**: free chat users load Synapse, not the vault server. Watch DL360 headroom. Anubis and CrowdSec in front of Blackout. | Infra configs live in this repo. |
| B9 | **Legal**: check whether age-verification laws and COPPA reach Blackout as it grows (**L31**). | Surface, do not resolve. |

## 7. Sectional steps — Blackstar

Deferred. Nothing in Phases 0–3 touches Blackstar. Recorded in the Blackstar
repo's `ROADMAP.md` so the dependency is visible there:

| # | Step | Notes |
|---|---|---|
| S1 | **Vending stage 3**: Blackstar micro-depots serve as restock points for a vendor-stocked vending network. | Follows the three launches and two earlier vending stages (software on existing machines; three to five own units). |
| S2 | **Enable GitHub Actions** before any vending work relies on CI here. The Actions API reports **0 runs ever** for this repository (re-checked 2026-10-04); nine workflow files have never executed. | A green checkmark here has never meant anything; the first run will surface a backlog. |
| S3 | Blackstar is not deployed; vending stage 2 must stand on its own and not wait on marketplace volume (FBM has 2 vendors and 3 products live). | Dependency, not a task. |

## 8. Sectional steps — Black Mask fork and infrastructure

The Black Mask fork (Bitwarden clients + Vaultwarden) is **not one of the three
repositories this session can read or write**, so these steps are recorded for
the plan's completeness and are owed in that repo.

### Phase 0 — infrastructure (nothing sells until this is live)

1. Deploy Vaultwarden on the DL360 with Docker Compose behind the existing
   Cloudflare Tunnel. Point `vault.blackmask.app` at it (NXDOMAIN today) and make
   it the fork's default server.
2. Standby: run the backup server offsite as an active-passive standby.
   Replicate the database, attachments, keys and config on a schedule. Never two
   live writers.
3. Backups: encrypted and offsite, with a restore test before launch and on a
   schedule after. **Open decision: Postgres or SQLite** for the vault database;
   Postgres makes replication simpler.
4. Failover runbook: how the tunnel or DNS switches to the standby; test it once
   before launch. Any future timers (dead man's switch) must replicate too.
5. Hardening: sign-ups off (accounts only via the billing webhook); admin panel
   behind a token and 2FA; Vaultwarden update cadence; uptime monitoring and
   alerts; `security.txt`.
6. Capacity: free chat users load Synapse, not the vault server.

### Phase 1 — make the product true

Every claim must be backed by working code before launch.

- Tracker blocking: replace the hard-coded list of 20 domains with EasyPrivacy,
  updated on a schedule; check its licence (GPLv3+ or CC BY-SA 3.0+, attribution
  and share-alike) against the fork (**L30**). Skip the DuckDuckGo and
  Disconnect lists (CC BY-NC-SA 4.0, non-commercial) unless licensed
  commercially.
- Phishing: local lists from PhishDestroy `destroylist` (MIT) and `phishunt-feed`
  (CC0), matched on-device so browsing history never leaves it. `urlvet`
  (AGPL-3.0 or commercial) is opt-in only, because sending URLs to a server leaks
  history.
- Password breach check: HIBP Pwned Passwords range API (k-anonymity, free, no
  key). Email breach lookups need a paid key.
- Verify all eight privacy features end to end (privacy dashboard and score,
  persona vault, tracker detection, fingerprint test, data exposure dashboard,
  per-persona containers, phishing protection, AI-generated media detector).
  Relabel or remove any that do not work.
- AI-media detector: check C2PA provenance first (`c2pa-rs`, MIT or Apache-2.0;
  a browser build needs WebAssembly work) and label classifier output as
  probabilistic.
- Premium flag: BMC runs the server, so decide who gets premium-gated features
  such as phishing protection.
- Platforms: store listings for Chrome, Firefox and Edge plus a CI release
  workflow (none exists today); build and sign the Electron desktop app from the
  clients repo; **mobile** — fork Bitwarden's native Android and iOS apps
  (**verify against the repos** that they are separate repos before planning),
  because a Capacitor wrapper cannot provide OS-level autofill. Budget for Apple
  and Google developer accounts, store review of a password manager, and ongoing
  upstream merges.
- Legal and trust: privacy policy, terms and a security contact page; licence
  and trademark check of the Bitwarden fork and any mobile forks (**L28**);
  independent security review before any security marketing.

### Phase 2 — chat panel on every platform

Extension side panel loading the Blackout embed route in a sandboxed frame with
no access to vault data and no navigation; the same embed in a sandboxed
webview screen on desktop and mobile; mobile push notifications out of scope.
Opt-in vault extras once BO-1 is fixed: store the Blackout recovery key in the
vault, prompt for device verification, send a vault item or dead drop into a den.

### Phase 3 — differentiators

Dead drops (extend Bitwarden Send: burn-after-read, send-as-persona, delivery
into a den); dead man's switch (extend emergency access with periodic check-ins
and release of chosen items, encrypted to the recipient on the client, timer
replicated to the standby, grace periods, multiple check-in channels, a use
policy, independent review); coalition vaults (an organisation vault for a
Coalition's shared external-platform accounts); sovereign identity across the
three products; shareable privacy-check links (Challenge Link mechanics); Matrix
alerts. **Open question:** whistleblower-style dead drops or inheritance-style
continuity first — the designs differ.

Canopy Tiers layout: surface (vault search, autofill, privacy score); middle
(tracker blocking, phishing alerts, persona containers); deep (exposure
dashboard, fingerprint test, dead drops, dead man's switch). Keep UI changes
inside the privacy module plus one new tab so upstream security patches merge
cleanly; Bitwarden's extension is Angular and Blackout's client is a Cinny
(React) fork, so reuse the pattern, not the code.

## 9. Decision needed before scheduling

**Gate the paid launch on mobile, or launch on extension, web vault and desktop
first** and point mobile users at the stock Bitwarden apps (set to the Black
Mask server) until Black Mask mobile ships. The second protects the launch date
for a solo developer. Not decided.

## 10. Legal checkpoints this plan adds

Recorded in `docs/legal/checkpoints.md`, status "needs counsel":

- **L27** Flat-payout migration: removing tier-linked payout shares changes
  vendor terms mid-stream (existing balances, pending orders, consignment,
  patronage, escrow).
- **L28** Bitwarden licence and trademark terms for the fork and any mobile
  forks; Vaultwarden hosting terms.
- **L29** App-store rules on external payment links for a web-only purchase
  flow (Apple, Google), and store review of a password manager.
- **L30** EasyPrivacy's GPLv3+ / CC BY-SA 3.0+ terms against the fork; the
  DuckDuckGo and Disconnect lists' non-commercial terms.
- **L31** Age-verification laws and COPPA reaching Blackout as it grows
  (Blackout-side; mirrored in that repo's document).

Already recorded and still relevant: L24 (custody shape), L25 (commercial
co-venturer), L26 (nonprofit-carried pools) — the securities-law review that
gates community capital circles, so they are not a near-term funding source.

## 11. Open decisions (verbatim from the spec)

- [ ] Hosted-vault price (the model assumes $5/month).
- [ ] Gate the paid launch on mobile, or launch on extension, web and desktop
      first with stock Bitwarden apps for mobile.
- [ ] Mobile approach: fork the native Android and iOS apps (recommended) or
      something else.
- [ ] Vault database: Postgres or SQLite.
- [ ] Grace period length after a lapsed payment.
- [ ] Unread indicators or push notifications in the chat panel (none by
      default).
- [ ] Dead drops or the dead man's switch first, and the audience each is built
      for.
- [ ] Bundle a Black Mask seat into FBM's $10/month plan?
- [ ] Confirm the 3% fee on Blackout creator transactions (a model assumption).
- [ ] License the DuckDuckGo and Disconnect tracker lists commercially, or skip
      them.
- [ ] Confirm recurring consumer subscriptions work on the FBM storefront
      (F2: API exists, purchase UI does not).
- [ ] Add the Blackout funnel and app costs to the revenue model, with real
      starting cash and founder draw.

## 12. Revenue model — placeholders, recorded not endorsed

The model (`bmc_revenue_and_vending_model.xlsx`, delivered to the operator
outside this repo) puts base-case monthly revenue at about $1,370 at month 12 and
$2,630 at month 24, about 80% from subscriptions (Black Mask plus the FBM $10
plan), with a 4-unit vending pilot fundable in month 18 under an illustrative
gate (trailing 3-month software cash flow ≥ 1.25× the loan payment, cumulative
cash covers the upfront cash). Every input except the operator's stated figures
is a placeholder: 0.08% monthly conversion at $5, 4 new FBM vendors a month
(40% on the $10 plan, $400 sales each), $350 fixed costs, $0 starting cash, $0
draw. Not yet modelled: the Blackout-to-Black-Mask funnel, the chat-panel
funnel, and mobile/desktop app costs. Financing options named: equipment
financing, the CDFI partner (Self-Help Federal Credit Union), host-location
revenue share, ag and local-food grants (cycles unresearched), and community
capital circles (gated on securities review, not near-term).

## 13. Threat landscape — positioning only, no public claim until code backs it

Phishing as the entry point in 23% of investigated intrusions (up from 7%) and
sub-24-hour weaponisation (Help Net Security); about 900,000 installs of fake
AI-assistant extensions across 20,000+ enterprise tenants (Microsoft Security
Blog); LastPass customer data stolen via a partner, vaults unaffected
(TechCrunch); Discord's revised age check after a 2025 breach exposed 70,000+ ID
images via vendors (Privacy Guides). Deepfake identity fraud and AI agents
breaching systems were headlines only; pages not opened. Guardrails: market
nothing unverified; publish the extension's permissions, keep builds
reproducible, list a security contact; fix BMC's own house first.

## 14. Sources

Opened for the spec on 2026-10-03; recheck licences and figures before launch:
Help Net Security (Microsoft report on AI and attackers); Microsoft Security
Blog (malicious AI-assistant extensions); TechCrunch (LastPass and the Klue
breach); Privacy Guides (Discord's revised age verification); EasyList licence;
DuckDuckGo tracker-blocklists; Disconnect tracking protection; PhishDestroy
destroylist; phishunt-feed; urlvet; HIBP API v3; Anubis; CrowdSec; c2pa-rs;
Fawkes. Headline only, not opened: CNN on the Medicare Australia incident; ASIS
on deepfake identity fraud.

Verified in this repo on 2026-10-04 while writing this file: the vendor-plan
ladder values and their invariant spec; `GROWER_TIERS` and `GROWER_SPLIT_CONFIG`
shares; the `/store/subscriptions` API and the absence of a storefront purchase
call; the FBM↔Blackout link route; Blackout's global `frame-ancestors 'none'`;
Blackout's ten open advisory PRs; Blackstar's zero Actions runs.
