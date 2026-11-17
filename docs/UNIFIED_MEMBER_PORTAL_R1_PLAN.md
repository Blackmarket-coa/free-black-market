# Plan: the unified member portal in `/user` (packages 0, 0a and 1, plus the first slice of 2 and 3)

> **Status:** draft implementation plan, 2026-11-17. Written from the code at `b29db1db` by a read-only planning pass, after the owner's decision of the same day (start the unified member portal in the storefront's `/user`; the vertical portals stay as they are; see `docs/AUDIT_DEBT.md` SD-153). Nothing in it is built yet; each phase lands as its own reviewed unit with a ledger row.

I read everything at commit `b29db1db`. I ran no tests, no build and no database. Wherever I say "by reading", I read the code but didn't run it.

## 0. Summary

- **Where the owner's decision sits in the plan's numbering.** "Survey → build preview → configured portal → one real task" is package **0a** plus a thin cut of **2** and **3**. This first release is called R1 below. **Package 0** must be done before rollout. **Package 1** is only a contract for R1, because R1 sells no paid equipment.
- **Identity.**
  - The customer token is the member session.
  - Seller capabilities use the storefront's **existing** seller cookie, `_fbm_seller_jwt`. It is minted by asking for the password again, and only for the **same login** (`auth_identity_id` must match).
  - A new customer-only route reads the login's store link with the vendor gate's rule (SD-144).
  - There is no token exchange.
- **The real task: "Open your stall".** The member files a seller application from their build. It goes through the most-reviewed door in the repo, and approval then sets up the store automatically (playbook and feature defaults).
- **Shared packages: don't reuse** `bmc-portal-kit` or `bmc-ui` in the storefront. This amends plan line 360.
- **Naming.** In backend code, "member" already means Mercur's seller-team member (ids starting `mem_`). New code should be named **portal**: `/store/portal/*`, a `portal-build` module, and the flag `FF_UNIFIED_PORTAL_V1`.

## 1. What the code says that changes the plan

1. **The storefront already has a seller session; the scout missed it.**
   - `storefront/src/lib/data/cookies.ts` defines `_fbm_seller_jwt`: httpOnly, lasts 1 day, separate from `_medusa_jwt`.
   - `storefront/src/lib/data/vendor-auth.ts`:
     - `sellerLogin` calls `/auth/seller/emailpass` from the server and refuses to store a token without `seller_id`.
     - `refreshSellerSession` renews it in the last 6 hours.
     - `retrieveSellerSession` only reads.
   - `storefront/src/lib/data/vendor-orders.ts` makes server-side `/vendor/orders` calls.
   - The `(vendor)` route group has an orders inbox and a `VendorSessionKeeper`.
   - Mercur's CORS on `/vendor/*` excludes the storefront origin, so seller calls must stay on the server.
2. **Customer sessions die after 24 hours.** Medusa 2.14.2 defaults `jwtExpiresIn` to `"1d"`, and `backend/medusa-config.ts` sets nothing. The `_medusa_jwt` cookie lives 7 days and nothing refreshes it. `/auth/token/refresh` keeps the incoming token's actor type, so it can never turn a customer token into a seller token.
3. **One shared limit on sign-ins.** Every `POST /auth/*` (sign-in, refresh, filing) falls under `authRateLimiter`: 20 per minute, keyed by IP. All storefront traffic comes from the Next server's address (SD-58, open). So every password check, filing and refresh comes out of the same budget as every shopper's login and sign-up.
4. **SD-50 is open.** No migration adds `character_sheet.raw_*`, so on a database built from the migrations no character sheet can be created. R1 must not use `/store/character` or XP.
5. **Most seller tools are broken today.**
   - SD-145: vendor routes key their data by member id instead of store id. This covers cottage-food, nursery, production-costs, quests and funds through `quests/_helpers.ts getSellerId`.
   - SD-146: 17 vendor-panel files call the backend without a token. This breaks cottage food, farm, invoicing, POS and digital products.
   - SD-49 and SD-51: nursery and farm GET requests write rows.
   - R1 hides all of these. Plates (cottage food plus costing) sits on SD-145's routes and should fix SD-145 for them first.
6. **SD-140: email verification can't work**, so every seller is approved by an admin. Yet `register-request` still answers "Check your email and open the verification link…" (`backend/src/api/shared/seller-registration.ts:288`).
7. **Playbooks.**
   - `playbook_assignment` is unique by `seller_id`.
   - `assign-playbook` throws when the playbook isn't in the registry table (`backend/src/workflows/assign-playbook.ts:58-62`), and approval logs that as a warning and carries on.
   - The pure helpers don't touch the database: `recommendPlaybookFromResources`, `PLAYBOOK_RECIPES`, `unionFeatureKeys`.
8. **Drift between copies.**
   - `POST /vendor/playbook/assign` accepts 10 resource keys (`RESOURCE_KEYS`, `backend/src/api/vendor/playbook/assign/route.ts:48`). Registration accepts 13. The launch wizard's re-run sends `resources` (`vendor-panel/src/components/onboarding/launch-wizard.tsx:418-422`), so any re-run that picks goods, creativity or capital gets a 400.
   - Both recommenders explain their pick with "You said solo and you decide" and "member subscriptions", although the resource quiz asks neither.
   - The storefront's `PlaybookSignature` lists 10 playbooks and has no `creator`.
9. **How one login holds two roles.**
   - Medusa tokens carry `auth_identity_id` and the full `app_metadata`.
   - One login can hold both `customer_id` and `seller_id`.
   - Approval writes `app_metadata: { seller_id }` (`backend/src/shared/seller-approval-service.ts:497-502`). Medusa's repository merges JSON fields on update (`mergeObjectProperties: true`), so `customer_id` survives. No spec pins this.
   - The storefront refuses a shopper profile to a login that is only a vendor (`profileRefusal`, SD-126).
   - `resolveLinkedStore` in `backend/src/shared/linked-store.ts` already classifies a login's store link with SD-144's rule.
10. **`GET /auth/seller/registration-status` is unsafe to build on.** It verifies a token without checking its actor type, and the GET can rewrite the login's link (`backend/src/shared/seller-registration.ts:125-166, 446-459`).
11. **No token leaks between users today.** On the server the JS SDK has no localStorage and falls back to storing nothing (`nostore`), so `sdk.auth.login` keeps no token between requests. The SDK must never be configured with `jwtTokenStorageMethod: "memory"` on the server, or tokens would leak across users.
12. **Packages.**
    - `bmc-portal-kit/src/api.ts` reads `import.meta.env` when it loads.
    - Its axios client is cookie-only, uses `baseURL: "/api"` (the Vite proxy), and sends any 401 to the vendor login page.
    - `USE_MOCK_DATA` is on by default in development, so its data layer returns mock data.
    - Its peer dependencies are React 18 and date-fns 3; the storefront uses React 19 and date-fns 4.
    - `bmc-ui` imports portal-kit's entry point (which loads `api.ts`) and `react-router-dom`.
    - The storefront is its own pnpm workspace root, and its Docker build context is `storefront/`. Together the two packages are about 1,100 lines.

## 2. Packages and R1 scope

| Package | In R1 |
|---|---|
| 0, capability reconciliation | A feature register limited to R1, plus read-only readiness queries. Gates rollout. |
| 0a, session and builder contract | Fully: portal context, survey, build save/preview/apply, same-login seller step-up. |
| 1, equipment and pricing | Contract only: who is the authority for each capability, shadow reports, billing inventory. R1 reads existing authorities and never sells or prompts a purchase. |
| 2 and 3, host and vertical slice | `/user` home composed from the build, `/user/build`, `/user/stall`, one real task. Compact view (see question 3). |

## 3. Identity and session

**Who signs in to `/user`.**
- Customer logins only, through the sign-in SD-126 just fixed. `login()` and `signup()` stay unchanged.
- A login that is only a vendor is still refused until the owner decides (question 1). The proposed change: a password-confirmed "Use this login to shop too" action that calls the existing `createProfileAndRefresh`. `login-shared.ts` already keeps a shared login when the shopper account is deleted.
- Someone with two logins (a customer email and a different seller email) is **not merged** in R1. The plan says never to merge accounts automatically; verified linking comes later.

**How each token is held and refreshed.**

| Cookie | Holds | Set by | Life | Refresh |
|---|---|---|---|---|
| `_medusa_jwt` | Customer JWT (1 day) | `login`, `signup` | Cookie 7 days | New `refreshCustomerSession` in the last 6 hours, called by a keeper mounted in the `/user` layout only, to limit use of the shared limit |
| `_fbm_seller_jwt` | Seller JWT (1 day) | `sellerLogin`, or the new step-up (same login only) | 1 day | Existing `refreshSellerSession` |
| `_fbm_portal_since` (new, httpOnly) | When the keeper first ran | The keeper | — | Never moves. Refusing refresh after 7 days gives an **absolute cap** on both keepers. Today a seller token can be refreshed forever. |

- A refreshed token is stored only if it names the same `auth_identity_id` and has a non-empty `actor_id`. This is SD-126's rule: decide from the token before storing it.
- Why not raise `jwtExpiresIn`? It is global, so it would also give payout-capable seller tokens a 7-day life.

**How a member who sells reaches seller capabilities without the vendor panel's token.**
1. `GET /store/portal/context` (customer token) says whether the login's store link is `none`, `live`, `removed`, `unmatched` or `closed`. It reuses `resolveLinkedStore` and `resolveSellerActor`, so it agrees with the gate.
2. If the store is `live`, the member clicks "Open stall tools" and types their password once. The server action `sellerStepUp` then:
   - calls `POST /auth/seller/emailpass` with `login.email` from the context;
   - checks that the returned token's `auth_identity_id` matches the customer token's;
   - stores the token in `_fbm_seller_jwt`.
3. Seller calls go server-to-server with that bearer, as `vendor-orders.ts` already does. The vendor panel's token is never touched.

I chose **asking for the password when needed** over minting a seller token at shopper login. It keeps payout-capable tokens short-lived and limited to people who use them, leaves SD-126's `login()` alone, and halves the cost to the shared limit. Minting at login can be revisited after R1.

**Safety, given SD-126 and SD-144.**
- Each request carries one bearer. Customer calls read only `getAuthHeaders`; seller calls read only `getSellerAuthHeaders`. They live in separate modules, and a test checks this.
- A seller token without an actor (unregistered) is never stored.
- No route trusts a seller id sent by the client, and nothing exchanges one token for another.
- `/user` ignores a seller cookie for a different login (for example one left by `/vendor` on a shared device) and offers "sign that account out".
- Portal sign-out and account deletion also run `sellerLogout()` when the seller session is for the same login. This detaches push notifications too, and is flag-gated (question 5). Otherwise a shared device keeps an orders inbox that shows buyers' addresses.
- Logins that use the Blackout MAS provider have no email-and-password identity, so stall actions show as unavailable for them.

## 4. The survey (character creation)

**Where it lives.**
- `/[locale]/(main)/user/build`. Sign-in is required in R1; anonymous drafts come later.
- Each step saves a server draft with `PUT /store/portal/build`, so the member can go back, resume across devices, and skip (the portal works with no build).

**What it asks.** Only what R1 uses. Pickup/delivery, budget and location are not asked; the plan asks those at the action that needs them.

| Step | Answers | Ids |
|---|---|---|
| Your direction | One main goal, optional others | `get_needs_met`, `grow_or_make`, `offer_services`, `trade_goods`, `organize`, `help_others` |
| Your resources | Multiple choice; "none yet" or "not sure" are valid | The **existing 13 `ResourceKey`s**, with friendlier labels (`land` reads as "Kitchen, land or growing space") plus a `resources_unsure` flag |
| How you'll take part | Time: `little`, `some`, `lots`, `unsure`. If a selling goal is chosen: `solo` or `with_others` | Survey-only fields |
| Your starting build | Server-computed preview | — |
| Enter the market | Optional character name, then Accept | — |

**How answers map to capabilities.**
- Everyone gets `market.browse`, `exchanges.buying`, `messages`, `wishlist` and `build`.
- Any selling goal adds `stall.status` and a seller recommendation from `recommendPlaybookFromResources`, unchanged. The next action depends on the store link:
  - no store → `stall.apply`;
  - application pending → `stall.application`;
  - live store → `stall.open_tools`;
  - `unmatched` → the existing `LINK_NEEDS_SUPPORT` message.
- A transportation answer lists "Carry deliveries" as *later*. No opt-in is sent in R1; setting it up stays in the vendor panel's Settings.

**Reuse, not replace.**
- The survey is a **superset of the registration survey's data contract**: the 13 resource keys, 11 playbook ids, `roles` and `recommended_playbook`. So filing forwards exactly those fields, and nothing is asked twice. Goals and participation never leave the portal.
- Use the **pure** playbook code on the backend; don't use the `playbook` table, `playbook_assignment` (keyed by seller) or the vendor-panel recommender.
- The **backend** computes the preview, so there is no third copy of the recommender.
- New `explain.ts` writes reasons from the answers actually given, with no assumptions about group size or governance and no subscription wording.
- The vendor panel's registration quiz stays as it is in R1.

## 5. Build preview, capability adapter, configured `/user`

**Capability states** (computed by a pure resolver in the storefront):
- `available` (and through which actor)
- `needs_step_up`
- `pending`
- `suggested` (needs an action, such as applying)
- `unavailable` (with a reason: `flag_off`, `not_linked`, `store_suspended`, `needs_support`, `blocked_by_ledger`)

**Inputs:** portal context (backend facts) + applied build + whether a same-login seller session exists + storefront flags.

**Render rules:**
- `/user` shows destinations in the order the build set.
- `available` items show live data or an honest empty state.
- `needs_step_up`, `pending` and `suggested` items show as action cards.
- `unavailable` items show only if the build asked for them; everything else is hidden.
- Buying, orders, messages and settings **never** depend on the context route. If it fails, the current page renders with a notice, using the same ok/failed result pattern as `vendor-orders.ts`.

**Backend reads and writes per capability.**

| Capability | Reads / writes | Exists? | Auth |
|---|---|---|---|
| Market | `/store/products`, categories | Yes | Publishable key |
| Buying | `/store/orders`, `/store/customers/me` | Yes | Customer |
| Messages, wishlist | Existing | Yes | Customer |
| Build | `GET`/`PUT /store/portal/build`, `POST /store/portal/build/apply` | **New** | Customer bearer |
| Stall status | `GET /store/portal/context` | **New** (registration-status is unsuitable) | Customer bearer |
| Apply to sell | `POST /auth/seller/emailpass` → `POST /auth/seller/register-request` | Yes, hardened (SD-127/137/138/139/142) | Password → unregistered seller bearer |
| Open stall tools | `POST /auth/seller/emailpass` | Yes | Password |
| Selling | `/vendor/orders`, ship / mark delivered | Yes, already in the storefront | `_fbm_seller_jwt`, through the vendor gate |
| Listings, settings | Vendor panel | Yes | Deep link only in R1 |
| Cottage food, nursery, farm, costing, quests, XP, node operator | — | Blocked by SD-145, 146, 49, 51, 50, flags, plans, or the open Blackstar decision | **Hidden** |

**Auth model for the new routes** (`/store/portal/context`, `/store/portal/build`, `/store/portal/build/apply`):
- Middleware order, modelled on the hawala wallet entry: `requireFeatureFlagMiddleware("UNIFIED_PORTAL_V1")` first (404 `feature_disabled` before auth spends anything), then `authenticate("customer", "bearer")`, then a per-actor limiter (`actorPathRateLimitKey`: 120 per minute; apply 10 per minute).
- Bearer only, because the storefront never creates Medusa sessions.
- No ids in the path ("me" only), so there is no existence oracle. Missing or wrong actor gets 401. A stale revision gets 409. Invalid input gets 400.
- Input uses strict zod schemas with capped arrays. Logs never contain answers.

**Context projection** (pinned by an allowlist test):
- `login.email`: the caller's own emailpass address.
- `store`: kind, name, handle, store_status, role, playbook recipe, and UI feature keys from a new `effectiveFeatureKeysForSeller` in `extension-keys.ts` that mirrors the vendor panel's resolution.
- `application`: status and `submitted_at`, matched with `isSellerRequestType`.
- `build`: summary only.
- Nothing about other members, payouts or Stripe.

**Apply.**
- The server recomputes the preview for that revision.
- What the member accepted must be a subset of what the preview allows.
- It writes an immutable `portal_build_version` with an idempotency key plus a fingerprint of the request (ADR-0002). The same key with the same body returns the same version; the same key with a different body gets 409.
- R1's apply writes **only** the portal composition: no store, no entitlements. Rebuilding therefore loses nothing.

## 6. The one real task: "Open your stall"

**Flow.**
1. On `/user/stall` the member gives a store name, their name and their password.
2. Server action:
   - signs in as seller (`/auth/seller/emailpass`);
   - checks the login matches;
   - sends `register-request` with name, member, `playbook`, `roles`, `recommended_playbook` and `resources`, and with no `vendor_type`, no node-operator opt-in and no goals;
   - throws the token away.
3. Response handling:
   - 201 or 200 shows "Application received; an organizer reviews new stalls". This replaces the backend's check-your-email text while SD-140 is open.
   - 409 or 400 shows the backend's own message.
   - 429 says to wait a minute.
   - A wrong password says so.
4. `/user` shows "pending", and buying still works.
5. An admin approves. Approval links the login (keeping `customer_id`), assigns the playbook and, for several roles, writes the feature union.
6. On the next visit, the store shows as live and the member can open stall tools; Selling shows the in-app inbox.

**Why this task.**
- The plan names it: line 100 ("draft an offer and start the appropriate seller setup from My stall") and journey 4.
- It makes 0a's acceptance testable: "buying remains usable while selling is pending".
- It adds **no new filing route**.
- The survey's answers already have a real consumer: approval configures the store automatically.
- It tests the riskiest part first (one login, two roles).
- It serves the pilot's supply side, and hits no legal gate.

Buyer-only builds get an existing market link as their next step. "Save a private need" (new private data, matching later) is the R2 candidate.

**R1 gates:**
- The playbook registry seed fix is live (`SELECT count(*) FROM playbook` = 11).
- SD-144's pre-deploy query has been run.

## 7. Shared packages

**Recommendation: don't reuse them in the storefront.**
- **Cost of not reusing:** about one day to write four or five small primitives in the storefront's own atoms and molecules. Nothing in `packages/*` or the four legacy portals changes, so `portals:typecheck` and `portals:test` stay green (line 522).
- **Cost of splitting into a framework-free core plus a Vite adapter:** the split itself is small (about a day, including untangling `bmc-ui` from react-router and from portal-kit's entry point). Consuming it from the storefront is what costs 3 to 5 days, with risk under CLAUDE.md rules 6 and 7:
  - the storefront's Docker build context would have to move to the repo root (Dockerfile COPY lines, `.dockerignore`, the `SECURITY_REFRESH` ARG);
  - a `file:` dependency, `transpilePackages`, and the override-coverage guard;
  - React 18 vs 19 peer conflicts.
- **What it would buy:** about 100 lines of format helpers. The rest doesn't fit: KARMA grower tiers, which conflict with "KARMA doesn't change payouts"; an AuthGate built for vendor cookies; a data layer that defaults to mocks.
- **What to share instead:** the backend API, plus decision code that runs on the backend.
- Record this as a ledger decision row and amend plan line 360. Revisit only when vendor-panel screens move into the storefront, as a fetch-injected, auth-per-call API contract package.

## 8. Phases

### C0. Contract (S)
`docs/contracts/unified-portal-v1.md`: JSON shapes for context, build and apply; capability ids; states. Agreeing these first unblocks the backend and storefront work in parallel.

### P0. Capability and deployment reconciliation (M; operator time)

**Files:**
- `docs/audits/feature-register.csv`, using the columns and states in `FBM_AI_FIRST_AUDIT_AND_REPAIR_PLAN.md` §3. About 20 rows, limited to R1's capabilities and the hidden ones, each with evidence.
- `docs/audits/unified-portal-r1-readiness.md`.
- `scripts/portal-readiness.sql`, read-only. It covers:
  - the playbook seed;
  - whether `character_sheet.raw_*` exists;
  - SD-144's `REFUSED_SELLER_ID_LINKS_SQL`;
  - counts of logins with both roles and with vendor only (this sizes question 1);
  - the backlog of pending `request` rows of the seller types;
  - `vendor_plan_assignment` by plan and interval;
  - customers who don't use email and password.
- Use SQL files rather than `medusa exec` with flags (SD-82).

**Tests:** none; this is evidence.

**Risk:** source alone treated as proof. The rule is that nothing is marked VERIFIED_* without running-stack evidence.

### P0a backend (critical path)

**B1: module and vocabulary (M).**
- Add `UNIFIED_PORTAL_V1` to `backend/src/shared/feature-flags.ts`.
- Export `RESOURCE_KEYS` from `backend/src/modules/playbook/recommend-from-resources.ts`, and use it in `api/vendor/register/validators.ts` and `api/vendor/playbook/assign/route.ts`. This fixes the 10-vs-13 drift.
- New `backend/src/modules/portal-build/`:
  - `index.ts` exports `PORTAL_BUILD_MODULE`; always import the key, never type it.
  - `models/portal-build.ts`: one row per `customer_id` (unique) with draft revision, draft answers and applied version.
  - `models/portal-build-version.ts`: immutable snapshots, unique on (customer, version) and (customer, idempotency key).
  - Migration, `service.ts`, `vocabulary.ts`, `decide.ts`, `explain.ts`.
  - No `bigNumber` columns.
  - Import from `playbook/recipes` and `playbook/features` directly, not from the module index.
- Register the module in `backend/medusa-config.ts`.
- Add two `delete` entries to `backend/src/lib/customer-data-registry.ts`.

**B2: context (M).**
- `backend/src/shared/portal-context.ts`.
- `effectiveFeatureKeysForSeller` in `backend/src/shared/extension-keys.ts`.
- `backend/src/api/store/portal/context/route.ts`.

**B3: build routes (M).**
- `backend/src/api/store/portal/build/route.ts`
- `backend/src/api/store/portal/build/apply/route.ts`
- `backend/src/api/store/portal/validators.ts`
- Entries in `backend/src/api/middlewares.ts`.
- Two limiters in `backend/src/shared/rate-limiter.ts`.

**Unit tests:**
- `decide`, `explain`, `vocabulary`: zero resources, mixed goals, several roles, no subscription wording, deterministic output.
- `portal-context`: every link kind.
- `effectiveFeatureKeysForSeller`: null array gives defaults; an array of only plugin slugs gives all off.
- The playbook assign route accepts goods, creativity and capital.
- Vocabulary parity with a storefront file it reads, as `hours-framing.unit.spec.ts` already does.
- `nested-middleware-auth.unit.spec.ts`: flag first, and the new limiters with their budgets.

**Integration specs on Postgres:**
- `integration-tests/http/store-portal-context.spec.ts`:
  - flag off gives 404 before auth;
  - anonymous, seller or unregistered token gives 401;
  - shopper only, pending application, live owner by seller-id link, invited member acting as itself, removed member, closed store, unmatched;
  - for each case, **agreement** with `/vendor/sellers/me` using that login's seller token;
  - the projection allowlist.
- `store-portal-build.spec.ts`: validation, 409 on revision conflict, deterministic preview, idempotent replay, mismatched replay gives 409, only the caller's own build is visible.
- `portal-seller-application.spec.ts`:
  - a customer files with their own password, and status goes to pending;
  - approval keeps **both** `customer_id` and `seller_id` (pins the merge);
  - customer and seller sign-in both work afterwards;
  - context shows live with the playbook and feature union;
  - cart and `/me` work during pending.
  - Budget the auth-limit spend, as `store-signup-session.spec.ts` does.
- `module-schema-drift` and `customer-data-registry` specs must pass without growing their known-drift lists.

**Gates:** `medusa build`, then `tsc --noEmit`, lint, unit tests, `check:no-console`.

**Risks:**
- The context route drifting from SD-144. Mitigated by reusing its functions and by the agreement spec.
- Exposing more data than intended. Mitigated by the allowlist.
- The JSON column turning into a free-form store. Mitigated by strict schemas.
- The registry not being seeded. Mitigated by in-code recipes plus the rollout gate.

### P0a storefront

**S1: sessions (M).**
- `seller-token.ts` becomes generic claims helpers: `auth_identity_id`, a same-login check, the absolute cap.
- `cookies.ts`: the `_fbm_portal_since` cookie.
- New `lib/data/session.ts` with `refreshCustomerSession`.
- `vendor-auth.ts`: `sellerStepUp`, and the cap in `refreshSellerSession`.
- `customer.ts`: the same-login seller sign-out in `signout` and `deleteCustomerAccount`, flag-gated.
- `components/providers/PortalSessionKeeper.tsx`.

**S2: data layer (M).** `lib/data/portal.ts` ("use server"): `retrievePortalContext`, `retrievePortalBuild`, `savePortalDraft`, `applyPortalBuild`, `openStallTools`, `applyToSell`. All return ok/failed results.

**S3: resolver (S).** Pure modules: `lib/portal/{types,capabilities,survey-vocabulary}.ts`.

**S4: UI (L).**
- Pages: `app/[locale]/(main)/user/{layout,page}.tsx` (branch on the flag), `user/build/page.tsx`, `user/stall/page.tsx`.
- `components/sections/Portal/*`: home, character card, survey, preview, destinations, stall status, apply form, step-up form.
- `UserNavigation.tsx`.

**S5: flag (S).** `lib/feature-flags.ts` `unifiedPortal`; ARG and ENV in `storefront/Dockerfile`; build-arg in `.github/workflows/docker-build.yml`. `check:panel-feature-flags` enforces this.

**Vitest tests:**
- Token claims, refresh window and cap.
- `portal.test.ts`:
  - refuses a token for a different login;
  - never stores an unregistered token;
  - sends only the allowed filing fields;
  - maps 201, 200, 409, 429, 401 and 403;
  - recovers from a 409 draft conflict;
  - generates an idempotency key.
- `capabilities.test.ts` with fixtures: shopper; pending; live without session; live with a same-login session; a seller cookie for another login; removed; closed; unmatched; flag off.
- A spec that the server SDK has no memory token storage.
- `use-server-exports.spec.ts` already guards the new module.

**Gates:** typecheck, lint, vitest, `qa:internal-links`.

**E2E (recommended):** `e2e/tests/member-portal.spec.ts`.

**Risks:** the token-mixing, shared-device, step-up and shared-limit (SD-58) items described in sections 1 and 3.

### P1. Equipment ownership and pricing contract (M; not on R1's critical path; can run alongside)

**Files:**
- `docs/contracts/equipment-authority-v1.md`. A matrix covering:
  - every writer of `enabled_extensions` (six code paths);
  - entitlement grants (customer and seller; plugin grants are best-effort, W3-4);
  - `vendor.*` plan gates (`requirePlanFeature`, 402);
  - feature flags and playbook defaults;
  - the R1 rule: read only; show only free or already-authorized capabilities; no purchase or upgrade prompts.
- `scripts/equipment-authority-shadow.sql`, read-only: compares the plugin slugs in `enabled_extensions` with active seller entitlements `plugin:<slug>` (the precondition for W3-4).
- A billing inventory through `portal-readiness.sql`.
- An `acquisition` field on each capability in the registry.
- A one-time version-rights model, with a backfill and rollback plan, as a document.

**Later, before package 5:** the backfill, flipping the authority, and the pricing migration.

**Risks:**
- A migration that turns off current vendor tools (the problem of null vs an array of only slugs).
- Live recurring billing (the plan's open decision).

### R1 rollout (S–M)

- Staging with both flags on, and the P0 checklist passing.
- Run the journeys by hand in a browser.
- Then the pilot. If needed, a customer group can act as a cohort gate.
- The flag fails closed: if the backend answers `feature_disabled`, the storefront renders today's `/user`.

### Ledger rows to add (SD-149 onward; take the numbers when writing)

- Customer sessions end at 24 hours despite the 7-day cookie, and there is no refresh.
- The seller keeper refreshes without an absolute lifetime.
- `/vendor/playbook/assign` refuses goods, creativity and capital. Fixed in B1.
- Drift in reason text and vocabulary across the three surfaces (social-form and subscription wording; storefront has no `creator`).
- `registration-status` doesn't check actor type and writes on a GET (low; by reading).
- **Decision:** no reuse of portal-kit or bmc-ui in the storefront (amends plan line 360).
- **Decision:** the session model, the "portal" naming, and deferring two-login linking.
- One row for each implementation PR, as the convention requires.
- Notes on existing rows:
  - SD-140: the 201 message is misleading.
  - SD-145: Plates depends on it.
  - SD-50: the portal does not use XP.

## 9. Order, sizes, parallel work

Sizes: S is about 1 day, M is 2 to 4 days, L is 5 or more. Add about 40% for this repo's independent review rounds.

**Critical path:** C0 → B1 → (B2 alongside B3) → S2 → S4 → staging. That is about 3 to 4 weeks with two or three people working in parallel, or about 5 to 6 weeks for one.

**In parallel after C0:**
- P0
- B1
- S1
- S3, built against fixtures
- S2, built against a mocked `medusaFetch`
- P1

The identity spec runs after B2. Rollout waits for P0, the seed fix and the owner's answers.

## 10. Open questions for the owner

1. **Vendor-only logins.** May an existing vendor login add a shopper profile to the same login, password-confirmed and behind the flag, so it can enter `/user`? This partly reverses SD-126's refusal. Without it, pilot suppliers stay in the vendor panel during R1.
2. **The real task.** Confirm "Open your stall" as R1's real task, with admin approval while SD-140 is open. Buyer builds get a market link; "save a private need" comes next.
3. **Game view.** Can R1 ship in the compact view, with the scene in the next package? Or must R1 include a minimal scene? Plan line 490 puts the first slice in game view.
4. **SD-58.** Approve the fix (forward the visitor's address in a header signed with a shared secret) before the cohort grows, or accept the shared 20-per-minute limit for the pilot?
5. **Sessions.** Customer token refresh inside `/user` with a 7-day absolute cap (the same cap for the seller keeper). Portal sign-out also signing out a same-login seller session on that device, which changes how the in-app vendor surface behaves.

Defaults that need no decision unless the owner objects: two-login linking is deferred, the survey doesn't ask about delivery opt-in, R1 shows no XP, and the survey requires sign-in.

### Critical files for implementation
- `storefront/src/lib/data/vendor-auth.ts` (with `storefront/src/lib/data/cookies.ts`)
- `storefront/src/app/[locale]/(main)/user/page.tsx`
- `backend/src/shared/linked-store.ts` (with `backend/src/shared/seller-actor.ts`)
- `backend/src/api/shared/seller-registration.ts`
- `backend/src/api/middlewares.ts`