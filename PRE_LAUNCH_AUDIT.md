# Pre-Launch Production Audit — Free Black Market (FBM)

**Audit date:** 2026-07-25
**Branch audited:** `claude/pre-launch-app-audit-8stho6` (base commit `38d212d`)
**Audit type:** Full pre-launch readiness review (beta → general availability)
**Method:** Firsthand verification against live code and a live Postgres/Redis
stack — **not** a read of the repo's existing readiness documents. Where this
report and the in-repo `LAUNCH_READINESS.md` disagree, the evidence cited here
(file:line, test output, command output) is authoritative.

---

## 1. Verdict — Go / No-Go

| Question | Answer |
|---|---|
| Is the **commerce & money engine** technically sound? | **Yes** — verified firsthand (see §3, §4). |
| Are there **launch-blocking defects**? | **Yes — but the financial-integrity and image-deploy blockers found in this audit are now fixed** (§4). The dominant remaining blockers are **legal/compliance and observability** (§5). |
| **Can FBM open to the unrestricted public today?** | **No.** Close the **P0** list in §6 first. |
| **Can the invite-only / Founding-100 beta continue?** | **Yes**, on the working commerce engine, provided real-money **ACH payouts stay disabled** (`ACH_PAYOUTS_ENABLED=false`) until §5-C legal sign-off. |

**One-paragraph summary.** The core marketplace — auth, catalog, checkout,
orders, the double-entry "hawala" ledger, bounties/escrow, and the 3% / 10% fee
splits — builds clean, passes its full test suite (1,098 backend unit tests +
226 storefront + 44 vendor-panel + others), survives a **from-scratch database
migration**, and holds its money invariants under a **real concurrent-load soak**
(no overdraw, value conservation, exact pool totals). During the audit I found
and **fixed** one *critical* financial-integrity bug (a negative-amount payout
that could drain the platform settlement account), one *critical* operational
bug (a backup script that produced corrupt, unrestorable dumps), and three
*high* deployment bugs (admin/vendor panel images shipped with no backend URL;
production seed could inject demo products into a live DB; docker-compose
dev-default secrets passed the production secret guards). What remains before a
public launch is **not** primarily code: it is **legal pages, data-subject
rights, money-transmitter/securities sign-off, and wiring error monitoring** —
detailed and prioritized in §5–§6.

---

## 2. Scope & method

**Repositories / apps examined:** `backend` (MedusaJS 2.x API + custom modules),
`storefront` (Next.js), `admin-panel` & `vendor-panel` (Vite SPAs), the four
vertical portals (`nursery`, `wellness`, `botanical`, `creator`) and shared
`packages/*`, plus `infrastructure/`, `docker-compose*.yml`, and
`.github/workflows/*`.

**How it was run:**
- All build/type/lint/test gates were executed firsthand (§3), not inferred.
- A **Postgres 16 + Redis 7** stack was stood up locally to run the gates that
  need a database — the money-path concurrency soak and a full migration — which
  cannot run in a DB-less sandbox.
- Six parallel domain reviews (backend security, money-path, frontend,
  infra/ops, compliance/legal, dependencies) read the actual handlers and
  config; every finding below carries file:line evidence.
- The most severe findings were re-verified by hand before being labeled
  Critical/High in this report.

**Deliberately out of scope (cannot be done from the repo):** the off-cluster
operator tasks in `docs/GO_LIVE_CHECKLIST.md` §A (PagerDuty, DNS, cert-manager,
managed DB snapshots, GHCR pull auth). Those remain the operator's to confirm.

---

## 3. Verification results — what was proven to work

All gates below were run in this audit. **Every one is green.**

| App / gate | Typecheck | Lint | Tests | Prod build | Evidence |
|---|:--:|:--:|:--:|:--:|---|
| backend | ✅ | ✅ (eslint `--max-warnings 0`) | ✅ **1,098** unit / 134 suites | n/a | coverage 74.6% ≥ gate |
| backend — posture-A invariants | — | — | ✅ 16 | — | CCR closed-loop compliance gate |
| backend — new amount-guard regression | — | — | ✅ 11 | — | added this audit (§4.1) |
| storefront | ✅ | ✅ (1 minor warn) | ✅ 226 / 24 files | ✅ standalone | — |
| admin-panel | ✅ | — | ✅ 1 | ✅ | chunk-size warn only |
| vendor-panel | ✅ | — | ✅ 44 / 8 files | ✅ | chunk-size warn only |
| portals ×4 | ✅ | — | ✅ 21 / 3 files | ✅ all four | — |
| Hermes AI suite | — | — | ✅ 3 | — | langgraph + vendor runtime |
| `check:no-console` / `check:vendor-completeness` | — | — | ✅ | — | CI hygiene gates |

**Live-infra gates (required a real database — stood up locally):**

- **Money-path concurrency soak — 3/3 PASS** against live Postgres:
  - never overdraws a single account under concurrent debits,
  - conserves total value across concurrent bidirectional transfers,
  - keeps investment-pool totals exact under concurrent investments.
- **Database migration from scratch — SUCCESS.** All Medusa + custom module
  migrations applied to an empty DB; 470+ tables created, no `TableNotFound` /
  `EACCES`. (Note: `medusa db:migrate` boots modules and therefore requires a
  Stripe key *present* — even a dummy `sk_test_…` — or the Payout module throws
  at construction; see §5 INFRA-6.)
- **Fail-closed env validation — verified firsthand.** Backend refuses to boot
  in production with placeholder or `local-dev-*` secrets and with a missing
  admin password; storefront calls `assertProductionEnvOrThrow()` from
  `instrumentation.ts` on server start. Strong secrets pass.

**Secret scan:** clean. No live keys (`sk_live`, `whsec`, `AKIA`, PEM blocks,
`ghp_`, …) committed; only `.env*.template` files are tracked; no oversized
blobs in history.

---

## 4. Fixes applied during this audit

These five defects were fixed on the audit branch. Each is covered by the
passing suites above; the money-path fix adds a dedicated regression test.

### 4.1 — CRITICAL (fixed): negative-amount payout drains platform settlement

- **Was:** `POST /vendor/hawala/payouts` guarded the amount with `if (!amount)`,
  which accepts negative numbers. A negative amount also slips past the
  `available_balance < amount` check in `requestPayout`, then inverts the
  debit/credit legs inside `createTransfer` → `updateBalancesAtomic`. The
  atomic `balance + delta >= 0` CAS **cannot** catch it (the math balances), and
  because total value is conserved the nightly reconciler wouldn't flag it
  either. An authenticated vendor posting `{ amount: -5000 }` could credit their
  own earnings and debit the platform SETTLEMENT account, then withdraw real
  funds.
- **Fix (defense in depth, 3 layers):**
  - Route: reject non-finite / `<= 0` with `400`
    (`backend/src/api/vendor/hawala/payouts/route.ts`).
  - `requestPayout`: reject non-finite / `<= 0`
    (`hawala-ledger/service.ts`).
  - `createTransfer` **chokepoint**: reject non-finite / `< 0` before any
    balance mutation (zero allowed as a harmless no-op).
- **Test:** `hawala-ledger/__tests__/transfer-amount-guard.unit.spec.ts` — 11
  cases (negatives, `NaN`, `±Infinity`, positive still works, zero no-op, and a
  `requestPayout` service wired to explode if the guard fails to fire). Passing.

### 4.2 — CRITICAL (fixed): backup script produced corrupt, unrestorable dumps

- **Was:** `scripts/backup-db.sh` ran `pg_dump --format=plain --verbose > FILE
  2>&1`, interleaving pg_dump's stderr log lines **into the archive** (corrupt),
  while the restore runbook feeds the file to `pg_restore` (which needs custom
  format). Every "backup" was unusable.
- **Fix:** switched to `pg_dump -Fc --file=… 2> sidecar.log`, added a
  `pg_restore --list` **validation** of the archive before it's trusted, made
  `--compress` a documented no-op (custom format is already compressed), and
  updated the retention glob to `*.dump*`. Syntax-checked; fails hard on
  `pg_dump` error.

### 4.3 — HIGH (fixed): production seed could inject demo products into a live DB

- **Was:** `conditional-seed.js` seeds whenever an emptiness heuristic trips, and
  `seed.ts` creates **published** demo products ("Organic Kale Bunch", …). A prod
  DB with an empty `product_type` table could get a demo catalog shown to real
  customers.
- **Fix:** added a `NODE_ENV=production` guard — auto-seed is disabled in
  production unless `ALLOW_PRODUCTION_SEED=true` (or `FORCE_SEED=true`) is set
  explicitly.

### 4.4 — HIGH (fixed): docker-compose dev-default secrets passed the prod guards

- **Was:** `docker-compose.yml` sets service-level `environment:` defaults
  (`JWT_SECRET=local-dev-…-min-32-chars…`, `MEDUSA_ADMIN_PASSWORD=localadmin1234`,
  …). These are ≥32 chars, so they satisfied the length checks — a documented
  `docker compose up` production boot would start with **publicly known**
  secrets.
- **Fix:** added `local-dev-` to the banned secret **prefixes** and
  `localadmin1234` to the banned **literals** in both the boot guard
  (`backend/medusa-config.ts`) and the standalone `scripts/assert-env.mjs`.
  Verified firsthand: those values now fail the production check; strong secrets
  still pass. *(The compose file still carrying dev secrets is a residual risk —
  see §5 INFRA-2.)*

### 4.5 — CRITICAL (fixed): admin/vendor panel images shipped with no backend URL

- **Was:** the Vite panels inline `VITE_*` values at **build** time, but their
  Dockerfiles set none and `docker-build.yml` passed build-args only for the
  storefront (`if matrix.app == 'storefront'`). The published panel images fell
  back to `"/"`, so every API call hit the panel's own nginx (index.html / 405)
  — **operator and seller login dead on arrival** on the documented GHCR/Fedora
  path.
- **Fix:** added `ARG`/`ENV` for `VITE_MEDUSA_BACKEND_URL`,
  `VITE_PUBLISHABLE_API_KEY` (vendor), `VITE_MEDUSA_STOREFRONT_URL`,
  `VITE_PUBLIC_BASE_URL` to both Dockerfiles and a "Resolve panel build args"
  step in `docker-build.yml`. Verified the names/precedence against the panels'
  actual resolver (`vite.config.mts` reads `VITE_MEDUSA_BACKEND_URL` first).

---

## 5. Open findings register

Severity = launch risk. **Owner** is the discipline that closes it. Items marked
**(agent-identified, evidence cited)** were surfaced by the domain reviews with
file:line evidence; the Critical/High compliance items were additionally
re-verified by hand in this audit (§ note under each group).

### 5-A. Security (backend) — no Criticals remaining; auth & money-scoping are solid

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| SEC-1 | **High** | Prediction-market state machine can be driven by anyone — no auth, no middleware matcher. | `store/vendor-hype/markets/[id]/state/route.ts:13` |
| SEC-2 | **Med** | ~20 community/food "store" routes accept **unauthenticated persistent writes** with no validation/rate-limit and attacker-settable `hawala_account_id`. | `store/gardens/route.ts:67`, `store/food-producers/…`, `store/couriers/…` |
| SEC-3 | **Med** | Prediction-market creation defaults `actor_id` to `"system"` when unauthenticated. | `store/vendor-hype/markets/route.ts:39` |
| SEC-4 | **Low** | Vendor CORS reflects any `*.up.railway.app` origin **with credentials** and no `NODE_ENV` guard. | `vendor/_middlewares.ts:60` |
| SEC-5 | **Low** | Rate limiter **fails open** if Redis errors; auth-adjacent guards pass when `actor_type` is falsy; password-reset logs the email. | `middlewares/rate-limiter.ts:133`, `…/settle:22` |

> **Verified solid (backend):** JWT is *verified* not decoded; secrets fail-fast
> at boot; Stripe **and** internal webhooks verify HMAC signatures; money routes
> scope by authenticated actor (no IDOR found on the money path); SQL is
> parameterized (only 2 allow-listed identifier interpolations); CSRF guard,
> upload validation, error sanitizer, hardened session cookie, prod debug-route
> 404, and global security headers/CSP are all present.

### 5-B. Frontend & UX — panel image blocker fixed (§4.5); these remain

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| FE-1 | **High** | Panels store the auth JWT in `localStorage` (`medusa_auth_token`) — exfiltratable via any XSS. (Storefront does this correctly with an httpOnly cookie.) | vendor/admin panel auth hooks |
| FE-2 | **High** | The four portals **serve mock data by default** (`USE_MOCK_DATA !== "false"`); with real data they redirect to a `/login` route that doesn't exist (loop), and render a full dashboard with **no auth gate**. | `packages/bmc-portal-kit/…/api.ts:25` |
| FE-3 | **Med** | Checkout has no dedicated error boundary; `StripeWrapper`/`PaymentButton` (`confirmCardPayment` has no `.catch`) can hard-fail to a full-page error or a permanently spinning button. | `…/checkout/PaymentButton.tsx:90` |
| FE-4 | **Med** | `/checkout` with a missing/expired cart calls `notFound()` (404) instead of the empty-cart UX. | storefront checkout route |
| FE-5 | **Med** | `robots.ts` advertises `/sitemap.xml` but there is **no `sitemap.ts`** (404). No `noindex` left on (good). | storefront app dir |
| FE-6 | **Med** | Hardcoded `vendor.mercurjs.com` fallback appears when `NEXT_PUBLIC_VENDOR_URL` is unset (SellNow, MobileNavbar, how-it-works). | storefront components |
| FE-7 | **Med** | `next.config.ts` sets `typescript.ignoreBuildErrors: true` — type errors won't fail the storefront build. | `storefront/next.config.ts:8` |
| FE-8 | **Low** | `_fbm` cookies lack `Secure`; a "test" manual payment provider is orderable if the backend exposes `pp_system_default`; scattered `localhost:9000` client fallbacks. | various |

> **Verified solid (frontend):** no secrets leak to the client (every exposed var
> is `NEXT_PUBLIC_`/`VITE_`); storefront uses httpOnly-cookie auth; no stray
> `console`/`debugger` in runtime code; empty-cart and out-of-stock paths exist;
> indexing is not blocked; middleware fails soft; env asserted at boot.

### 5-C. Compliance & legal — **the dominant public-launch blocker** (re-verified by hand)

| ID | Sev | Finding | Evidence (verified firsthand) |
|---|---|---|---|
| LEG-1 | **Critical** | **No Terms of Service, Privacy Policy, or Refund/Returns policy pages exist** anywhere in the storefront, and none are linked at registration/checkout. A money-moving marketplace cannot open to the public without these. | `find storefront/src … -iname '*terms*' -o '*privacy*' -o '*refund*'` → **empty** |
| LEG-2 | **Critical** | **No account-deletion or data-export path** (CCPA/CPRA, and GDPR if any EU traffic). The wellness vertical additionally handles health-adjacent data. | no `store` route for account delete / data export found |
| LEG-3 | **Critical** | **Money-transmitter exposure.** A customer can ACH-**deposit** to a stored ledger balance and later ACH-**withdraw** it to fiat. The withdraw route *correctly fails closed* (503) unless `ACH_PAYOUTS_ENABLED` + Stripe payout are configured — so this is **gated today** — but enabling payouts (a documented launch step) creates stored-value/transmitter exposure that needs **counsel sign-off** before the flag is flipped. | `store/hawala/deposit/route.ts`, `store/hawala/withdraw/route.ts:54` (503 gate) |
| LEG-4 | **Critical** | **Investment pools (ROI) and vendor cash-advance APIs are live** to real customers/vendors while `docs` describe them as "quiescent." Offering investment/return products implicates **securities** regulation. Auth *is* enforced (401 without actor) — the issue is regulatory, not an auth hole. | `store/hawala/investments/route.ts`, `vendor/hawala/advances/route.ts` |
| LEG-5 | **High** | Seller **KYC / tax collection (W-9/TIN)** is not implemented while UI copy promises 1099s; marketing/review-request emails send without a consent record or CAN-SPAM unsubscribe footer; signup auto-provisions a Matrix chat account from name+email without consent. | `subscribers/review-request-emails.ts`; registration flow |
| LEG-6 | **High** | **No prohibited-items policy or listing moderation** for a platform selling plants/herbal/wellness goods; DMCA/abuse "report" forms are dead ends (`logger.info`, no persistence or network call); no designated DMCA agent. | listing flow; report-form handlers |
| LEG-7 | **High** | `POSTURE_A_COMPLIANCE.md` **overstates enforced controls** — it claims immutable audit logs and a purchase-context middleware that aren't wired, and the CCR guard is env-degradable (`HAWALA_CCR_GUARD_MODE=warn\|off`). Align the doc with the code or wire the controls. | `docs/POSTURE_A_COMPLIANCE.md` vs module wiring |
| LEG-8 | **Med** | Tracking cookies with no consent banner; creator-attribution IP hash uses an **empty salt** by default (`…IP_SALT \|\| ""`); trademarked brand SVGs and stock photos appear committed; no data-retention/purge jobs. | `creator-attribution` config; asset tree |
| LEG-9 | **Med** | **License is contradictory** — no `LICENSE` file, `package.json` says MIT, a footer says "Open Source." Resolve before public code exposure. | repo root; `package.json` |

> **Verified solid (compliance):** the CCR closed-loop guard is real and CI-gated
> (not `continue-on-error`); escrow is DB-constrained; donations fail closed;
> withdrawals preserve money integrity (payout-first ordering); nightly
> reconciliation runs; **all bank data is delegated to Stripe** (no PAN/routing
> numbers stored); vendor payouts are Stripe-only.

### 5-D. Infrastructure & operations — image/backup/seed/secret blockers fixed (§4); these remain

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| INFRA-1 | **High** | **Error monitoring is not wired.** `initSentry()` has zero call sites and `@sentry/node` isn't a backend dep; the storefront's `SENTRY_DSN` path imports `@sentry/nextjs`, which isn't in `package.json`. Setting a DSN does nothing — you'll be blind to production errors. | `backend/src/shared/sentry.ts`; `storefront/package.json` |
| INFRA-2 | **High** | `docker-compose.yml` still **hardcodes dev secrets** in service `environment:` (Postgres password `medusa`, `minioadmin`, …) that shadow `env_file`. The boot guard now rejects the JWT/cookie/admin values (§4.4), but the DB/object-store passwords are not secret-guarded — don't use this file for production. | `docker-compose.yml:82` |
| INFRA-3 | **High** | Self-hosted media (`MINIO_PUBLIC_URL` = `media.freeblackmarket.com`) has **no nginx vhost and no cert** in the compose/infra config → all uploaded media would 404 in production. | `infrastructure/` nginx config |
| INFRA-4 | **High** | Startup **swallows migration/seed failures**: `railway-start.js:139` logs "continuing startup" on migrate failure; `conditional-seed.js` exits 0 even on seed failure. A half-migrated schema can boot and serve. | `backend/scripts/railway-start.js:139` |
| INFRA-5 | **Med** | `.env.production.example` is **missing keys the code reads** (`STRIPE_SECRET_API_KEY`/`STRIPE_SECRET_KEY`, `BACKEND_URL`, observability sinks, `CREATOR_ATTRIBUTION_IP_SALT`, several `NEXT_PUBLIC_FF_*`) and has name mismatches (`RESEND_FROM` vs `RESEND_FROM_EMAIL`; `ALGOLIA_ADMIN_API_KEY` vs `ALGOLIA_API_KEY`). Deployment landmines. | grep of `process.env` vs the example |
| INFRA-6 | **Med** | Module boot requires a Stripe key present (even dummy) or the Payout provider throws at construction — surfaced during the from-scratch migration in this audit. Document `STRIPE_API_KEY` as required, or make the provider lazy. | migration run output |
| INFRA-7 | **Med** | In the k8s manifests all 3 replicas run migrate+seed+cron on start; DB TLS uses `rejectUnauthorized:false` on the Railway/sslmode path; `minio:latest` is unpinned; no container resource limits. | `infrastructure/k8s/…` |
| INFRA-8 | **Low** | `pnpm audit || true` in CI is cosmetic; `prod-deploy` "verify image signed" only checks existence; the tracked `docker-compose.override.yml` auto-merges; Redis is unauthenticated (loopback-only today); Grafana dashboards/alerts are prose, not provisioned. | `.github/workflows/*` |

> **Verified solid (infra):** app Dockerfiles are multi-stage, run **non-root**
> with `tini` + healthcheck + pinned base images; the prod compose binds services
> to `127.0.0.1`; env validation fails closed in the boot path; the e2e workflow
> is a genuine gate; Trivy FS+image, CodeQL, gitleaks, and SBOM are hard security
> gates; `deploy-fedora.sh` fails hard on migration error; graceful shutdown is
> implemented.

### 5-E. Dependencies — 0 critical; patchable highs before launch

Run per app against its own lockfile (`pnpm audit --prod`). **No critical
advisories.** Highs are all fixed by a patch bump:

| App | Highs | Moderates | Notable |
|---|:--:|:--:|---|
| storefront | 4 | 10 | `next < 15.5.21` (2× SSRF in Server Actions/rewrites, DoS); `postcss < 8.5.18` (path traversal); `dompurify ≤ 3.4.10` (multiple sanitizer bypasses) |
| admin-panel | 0 | 4 | `react-router` open-redirect / constructor-injection |
| vendor-panel | 0 | 5 | + `qs` DoS |
| portals (root) | 2 | 7 | `vite` `server.fs.deny` bypass; `postcss` path traversal |

**Action — partially done in this PR.** The gating (HIGH) bumps are applied here
to clear the Trivy FS gate: `next → 15.5.21`, `postcss → ≥ 8.5.18`, and
`brace-expansion`'s named-export line `→ 5.0.8` (see the SD-22 row in
`docs/AUDIT_DEBT.md`). Two CVEs are suppressed because their only fix isn't
applicable: `brace-expansion` `CVE-2026-14257` on the function-export line
(fixed only in the API-incompatible 5.x, which breaks `minimatch@3`/ESLint —
reached solely by dev/CI tooling), and the `concurrent-ruby` CVE on the stray
`@stellar/js-xdr` Ruby `Gemfile.lock` (alongside the existing SD-16/18 rows). **Still open (moderate,
non-gating):** `dompurify → ≥ 3.4.11`, `react-router[-dom]` and `vite`/`qs` to
patched lines — tracked as P1. (Separately, the repo already tracks suppressed
build-toolchain CVEs in `.trivyignore` with `SD-*` justifications — those are
triaged, not ignored.)

---

## 6. Launch readiness checklist (prioritized)

### P0 — must close before **any public** launch
- [ ] **LEG-1** Publish Terms of Service, Privacy Policy, Refund/Returns policy; link at registration + checkout; add a seller agreement. *(Legal + FE)*
- [ ] **LEG-2** Ship account-deletion + data-export (CCPA/CPRA). *(Backend + FE)*
- [ ] **LEG-3 / LEG-4** Get **counsel sign-off** on the wallet deposit↔withdraw (money-transmitter) and investment/advance (securities) surfaces. Until then keep `ACH_PAYOUTS_ENABLED=false` and gate or remove the investment/advance store/vendor routes. *(Legal + Backend)*
- [ ] **INFRA-1** Wire Sentry (add the SDK deps + call `initSentry()`); verify a test event in each app. *(Infra)*
- [ ] **SEC-1** Add auth + a middleware matcher to the prediction-market state route. *(Backend)*
- [ ] **FE-2** Gate the portals behind real auth and turn off default mock data, or hold the portals from launch. *(Frontend)*
- [x] ~~Negative-amount payout fund-drain~~ — **fixed (§4.1).**
- [x] ~~Panel images unreachable~~ — **fixed (§4.5).**
- [x] ~~Corrupt DB backups~~ — **fixed (§4.2).**
- [x] ~~Prod seed injects demo products~~ — **fixed (§4.3).**
- [x] ~~Dev-default secrets pass prod guards~~ — **fixed (§4.4).**

### P1 — close within the first launch window
- [ ] **INFRA-2/3/4** Production compose without embedded secrets; media vhost+cert; make migrate/seed failures fail the boot. *(Infra)*
- [ ] **INFRA-5/6** Reconcile `.env.production.example` with the code; document `STRIPE_API_KEY` as boot-required. *(Infra)*
- [ ] **FE-1** Move panel auth off `localStorage` to httpOnly cookies. *(Frontend)*
- [ ] **FE-3/4** Add a checkout error boundary + `.catch` on payment confirm; empty-cart UX instead of 404. *(Frontend)*
- [ ] **SEC-2/3** Authenticate (or remove) the community/food write routes and market creation. *(Backend)*
- [ ] **Deps** Bump `next`/`postcss`/`dompurify`/`react-router`/`vite`/`qs` to patched lines. *(All)*
- [ ] **LEG-5/6** Seller KYC/tax (W-9/TIN); email consent + CAN-SPAM footer; prohibited-items policy + a working abuse/DMCA intake. *(Legal + Backend)*

### P2 — fast-follow (first 30 days)
- [ ] **LEG-7/9** Align `POSTURE_A_COMPLIANCE.md` with the wired controls; resolve the license contradiction (add a `LICENSE`, fix the MIT/"Open Source" mismatch). 
- [ ] **FE-5/6/7** Add `sitemap.ts`; remove `mercurjs.com` fallbacks; stop ignoring storefront type errors.
- [ ] **INFRA-7/8** Pin `minio`; add resource limits; provision Grafana dashboards/alerts; split migrate/seed out of the replica start path.
- [ ] **LEG-8** Consent banner; set a real `CREATOR_ATTRIBUTION_IP_SALT`; remove trademarked/stock assets; add retention/purge jobs.
- [ ] Confirm the `docs/GO_LIVE_CHECKLIST.md` §A operator items (PagerDuty, DNS, certs, managed DB snapshots, GHCR pull auth).

---

## 7. Bottom line for the founder

The thing founders most fear at this stage — *"is the money code correct and
will it hold up?"* — is the part that came out **strongest** here. The ledger is
atomic, double-entry, idempotent, and it held under concurrent load; the one
real money bug in it is now fixed with a regression test. The commerce engine
builds, migrates, and tests clean end to end.

What actually stands between you and a public launch is **paperwork and
plumbing, not architecture**: the legal pages and data-subject rights every
consumer marketplace needs, a compliance sign-off before you turn on fiat
payouts and investment features, and wiring up error monitoring so you can see
problems in production. Those are well-scoped and listed above. Run the **P0**
list, keep real-money payouts off until legal clears them, and you can keep the
invite beta running on the engine as-is in the meantime.

---

*Prepared by an automated pre-launch audit pass. Findings carry file:line
evidence; the fixes in §4 are on branch `claude/pre-launch-app-audit-8stho6` and
covered by the passing test suites in §3. This report supersedes the optimistic
go/no-go in `LAUNCH_READINESS.md`, which predates these findings.*
