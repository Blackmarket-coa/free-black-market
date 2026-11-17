# Plates pilot (South Carolina): implementation plan

> **Status:** draft implementation plan, 2026-11-17. Written from the code at `b29db1db` by a read-only planning pass, after the owner's decisions of the same day (build Plates for South Carolina first, with sourced, dated rules signed off before launch; costing in every plan with its flags on; see `docs/AUDIT_DEBT.md` SD-152). Nothing in it is built yet; each phase lands as its own reviewed unit with a ledger row. The two SCDA source PDFs are archived in `docs/sources/us-sc/`.

This is a read-only plan; I edited nothing. It is based on HEAD b29db1db, the three in-flight branches (`fix/p1-vendor-store-id`, `fix/p1-panel-session-client`, and the uncommitted `fix/p1-sd63-schema-drift` worktree) and the two SCDA PDFs.

## 1. What I found beyond the scout (each one changes the plan)

1. **SD-145 makes `getSellerId` async.** On `fix/p1-vendor-store-id`, `backend/src/api/vendor/quests/_helpers.ts` changes it. Every new vendor route must `await getSellerId(req)`. If the production flags are switched on before SD-145 is deployed, batches and cost lines get keyed by member id.
2. **SD-146 pins the exact list of `lib/sdk` importers.** The list is `SDK_IMPORTERS` in `vendor-panel/src/lib/sdk.spec.tsx` on that branch. New panel code should either put its data hooks in `routes/cottage-food/_shared.tsx`, which is already on the list, or use `fetchQuery` from `lib/client`. `fetchQuery` only does GET, POST and DELETE, so every new update route should be POST.
3. **The SD-63 worktree adds `fromMinorUnits()`** to `backend/src/shared/minor-units.ts`. Plates should use it as its only cents-to-major-units conversion.
4. **No demand post can be inserted on a migrated database until SD-63 lands.** `demand_post` is in `KNOWN_DRIFT` in `backend/integration-tests/http/module-schema-drift.spec.ts`. Until then, "open requests" reads 0 everywhere.
5. **Every price trend in any database is synthetic.** The only writer of `price_observation` is `backend/src/scripts/seed-opportunity-engine.ts`.
6. **"Related coalitions" are not related.** `/store/opportunities/:subject` returns the first 8 public cooperatives, with no subject or region filter (`[subject]/route.ts:61-74`).
7. **Label-to-product links are unchecked.** `POST /vendor/cottage-food/labels` stores `body.product_id` without checking ownership (`labels/route.ts:63`), and PATCH cannot set it at all. Once a buyer surface reads labels by product, a seller could attach allergens to another seller's product. The fix is `productSellerIds` / `sellerOwnsProduct` in `backend/src/shared/product-sellers.ts`.
8. **How the panel creates products.** It posts to `POST /vendor/seller-products` (`vendor-panel/src/hooks/api/products.tsx:437-461`). That route takes major units and any `status`, and runs through `enforceListingTypeAllowed`. If the seller link fails it only logs a warning, which leaves an orphan product.
9. **Why clearing the timezone fails silently.** `sanitizeProfileInput` turns "" into `null`, and `timezone` is NOT NULL, so the save returns 500. `useSaveProfile` (`_shared.tsx:193`) has no `onError`.
10. **Why expiry dates are a day early.** Date-only input is stored at UTC midnight. The panel's `formatDate` (`_shared.tsx:216`) formats in local time, so US sellers see the day before. The backend's `expiryView` floors milliseconds, so it can say "expired" on the evening before.
11. **Tests that will fail by design** once the plan feature goes to every plan:
    - `catalog.unit.spec.ts:59-63` ("free featureless")
    - `plan-gate-coverage.unit.spec.ts:99-104` ("free clear of every gated feature")
    - `addons.unit.spec.ts:47-56` (the undercut check where embed_pack covers starter)
    - `shared/__tests__/vendor-charge-execution.unit.spec.ts:462` and `shared/__tests__/vendor-addons.unit.spec.ts:89-92` (grower_pack's two keys)
12. **Reviewer columns trip the customer-data registry.** The walk in `backend/src/lib/__tests__/customer-data-registry.unit.spec.ts:179-208` flags any column ending in `_user_id` or `_by`. Reviewer columns need `NOT_A_CUSTOMER_ID` entries; `wholesale_application.reviewed_by` is the precedent.
13. **The `quantity` string bug only shows on a migrated database.** `production_cost_entry.quantity` is `model.number()` over a NUMERIC column. The module test runner builds its schema from the model, so it sees an integer column; only the HTTP runner on migrations reproduces the string.
14. **The cottage-food non-blocking spec covers new routes automatically.** It walks every file under `src/api` whose path contains `cottage-food`. It fails on `status(402|403|409)` and on the word "exceed", even in a comment. It also bans method names starting `is`/`can`/`check`/`validate` and `throw new MedusaError` inside the module.
15. **Module keys are unguessable.** `OPPORTUNITY_ENGINE_MODULE` is `"opportunity_engine"` (snake case, unlike the others), `COTTAGE_FOOD_MODULE` is `"cottageFoodModuleService"`, `PRODUCTION_COSTING_MODULE` is `"productionCostingModuleService"`, `DEMAND_POOL_MODULE` is `"demandPoolModuleService"`. Import them everywhere, including test mocks.
16. **State names already exist in the panel.** `vendor-panel/src/lib/data/country-states.ts` uses ISO 3166-2 codes (`"US-SC": "South Carolina"`).

### The two PDFs as read
- **Fact sheet:** "Home-Based Food Production (Cottage Law)", CPD Form #2210, dated 5/1/26. It is one page, its footer reads agriculture.sc.gov/retail-food-safety, and it cites SC Law 44-1-143 and Regulation 61-25. sha256 `b19c9924721c9219b54f6c859e4733b97e8ad86caa7b29c13df0d8647fe7712c`.
- **FAQ:** "Are you interested in selling food out of your home?", two pages. No date or form number is printed; the file name says 2025. URL (from W01): https://agriculture.sc.gov/wp-content/uploads/2025/07/RF_SellingFoodFromHomeFAQ2025.pdf. sha256 `f1f6d6f95464188b0cbf261731f562422823dced8eda993fd7a7faeb34a3ef61`.

**Traps the seed must avoid:**
- **FAQ page 2 is a different legal path.** It lists exemptions from the *Retail Food Establishment permit* (jams, jellies, vinegars, popcorn), not foods allowed under the home-based law. Seeding it as cottage food would assert something neither source says.
- **The fact sheet's allowed list is partial.** Its footnote points to the "Home-based Food Production Law Guidance" for a fuller list. A food missing from the list is "not covered by our sources", not "not allowed".
- **The Home-based Food ID is not stated to be optional.** Neither PDF says it is optional or how to get one; they only say the label may carry it instead of the name and address.
- **Gaps in both PDFs:**
  - no effective date
  - no annual cap
  - nothing on a food-handler card
  - nothing on online orders, shipping or delivery within SC
- **The statement uses a typographic apostrophe** ("CAROLINA’S"). Store it verbatim.
- **The copies sit in the session scratchpad,** which can be cleared. Archive them durably, for example under `docs/sources/us-sc/` with the hashes above.

## 2. Cross-cutting decisions
- **Jurisdiction codes:** ISO 3166-2 (`US-SC`) everywhere.
- **One new backend flag, `FF_PLATES_V1`,** with a panel twin `VITE_FF_PLATES_V1` wired the way `scripts/check-panel-feature-flags.mjs` requires: reader, Dockerfile ARG and ENV, and a `docker-build.yml` echo.
  - It gates `/vendor/plates/*` (404 when off) and every rule-driven change to cottage-food vendor and store responses. With the flag off, those responses are byte-identical to today.
  - It does **not** gate the admin rule routes, because sign-off has to happen before launch.
  - It does not gate the product, cart and checkout display of seller-declared text and allergens.
  - Costing keeps its own two flags, which go on.
- **Never blocks a sale:**
  - rules are information only
  - nothing touches cart or checkout
  - no 402, 403 or 409 under any `cottage-food` path
  - foods that are not allowed produce advisories, never refusals
- **Who sees which rules:** buyers see reviewed rule text only. Sellers see drafts with a badge. Admins see everything.
- **No made-up numbers:**
  - no default ingredient prices
  - no composite score in Plates
  - a failed query is `null` with status `unavailable`, never 0
- **Posture A is untouched.** No CCR and no ledger writes; costing only imports pure fee functions.
- **Independent pricing (W04).** Show public list-price ranges and the seller's own cost-based floor. Never share one seller's costs, and never suggest a common price.

## Phase 0: preconditions (not Plates work)
- **SD-145 (`fix/p1-vendor-store-id`)**: merged, deployed, and its rekey script run, before anyone switches the production flags on.
- **SD-146 (`fix/p1-panel-session-client`)**: merged before any panel phase. Until then the cottage-food pages send no token.
- **SD-63 (`fix/p1-sd63-schema-drift`)**: merged before Phases 5, 7 and 10. It provides `fromMinorUnits` and the demand-post columns. The launches fix needs `demand_post`'s `raw_*` columns, so it should cover this; confirm when it lands.
- **`fix/p1-checkout-storefront`**: merged before Phase 11. It touches `checkout/page.tsx`, `CartReview.tsx` and `ProductDetailsPage.spec.tsx`.
- **`fix/p0-checkout-backend`**: edits `backend/src/api/middlewares.ts`, so Plates matchers will need a rebase.
- **`fix/p0-onboarding-backend`**: the worktree is empty today; check it before Phase 9 touches the launch wizard.

## Phase 1: Costing in every plan, flags on (M, about 2 days)

**Files**
- `backend/src/modules/vendor-plan/catalog.ts`
  - Add `UNIVERSAL_FEATURE_KEYS = ["vendor.production_ledger"]`.
  - Add the key to `free`, `starter` and `pro`; scale, all_access and internal already carry every key.
  - Update the plan descriptions.
- `backend/src/modules/vendor-plan/addons.ts`
  - grower_pack becomes `["vendor.nursery"]`, with new copy and the same price.
  - `addonUndercutsPlan` compares against plan keys minus the universal keys, so the embed_pack-vs-starter guard keeps working.
  - A new rule: no pack may grant a universal key.
- `backend/src/api/middlewares.ts:1413-1428`
  - Keep both `requirePlanFeature("vendor.production_ledger")` gates. Reverting the catalog line then restores the paywall.
- `backend/src/modules/production-costing/service.ts` and the three `production-costs` routes
  - Add a `toCostEntryDTO` that coerces `quantity` and the amounts with `Number()`. Do not change the column.
- READMEs for production-costing and production-ledger.
- `backend/.env.template`: add the two flags as comments.

**Operator steps**
- Set `FF_PRODUCTION_LEDGER_V1=true` and `FF_PRODUCTION_COSTING_V1=true` in staging, then production, after SD-145.
- Re-run `seed-vendor-plans.ts`.
- Attach the output of `audit-vendor-plan-coverage.ts` to the PR.

**Tests**
- Update the five unit specs listed in §1.11:
  - "free carries exactly the universal keys"
  - "every plan carries every universal key"
  - "no pack grants a universal key"
  - the undercut check still fires
- New HTTP spec on Postgres: `backend/integration-tests/http/production-costing-every-plan.spec.ts`
  - A `planCode: "free"` seller, created with `createAuthenticatedSeller`, makes a batch and a cost line and reads the rollup: 200.
  - `typeof quantity === "number"`. This fails before the fix.
  - A second runner with the flags unset gets 404.

**Risks**
- Switching flags on before SD-145.
- The denormalized `vendor_plan` rows are stale until re-seeded. Gates read the catalog, so they are correct regardless.
- The plan cache has a 30-second TTL.
- The Production Ledger nav item appears for every `hasProducts` seller.
- With quests on, the quest substrate starts reading production data (`vendor-quest/substrate/build.ts:361`).

**Ledger:** PL-1.

## Phase 2: Jurisdiction-rule store, SC drafts, sign-off API (L, about 7 days)

**New module `backend/src/modules/jurisdiction-rules/`**
- `index.ts` with `JURISDICTION_RULES_MODULE = "jurisdictionRulesModuleService"`
- `service.ts`, `README.md`
- `models/{jurisdiction-source,jurisdiction-rule,jurisdiction-coverage}.ts`
- `migrations/Migration20261118CreateJurisdictionRules.ts`
- `us-jurisdictions.ts`: 50 states plus DC, ISO codes, and `normalizeUsJurisdiction("SC" | "S.C." | "South Carolina" | "us-sc") -> "US-SC" | null`
- `content-hash.ts`, `coverage.ts` (pure)
- `seeds/us-sc-home-based-food.ts`
- Register it in `backend/medusa-config.ts`.

**Data model**
- `jurisdiction_source`:
  - `jurisdiction_code`, `issuer`, `title`, `url`
  - `document_id`, `document_date` (nullable), `document_date_note`
  - `retrieved_at`, `content_sha256`, `archive_ref`, `notes`
- `jurisdiction_rule`: append-only versions.
  - Identity and content: `jurisdiction_code`, `program` (`home_based_food`), `rule_key`, `version`, `kind` (requirement, permission, prohibition, fact, not_stated), `value` (json), `display_text`, `citations` (json list of `{source_id, locator, quote}`, at least one, checked on write), `effective_from` (nullable), `effective_note`.
  - Review: `review_status` (draft or reviewed), `content_sha256`, `reviewed_by_user_id`, `reviewer_name`, `reviewed_at`, `review_note`.
  - History: `superseded_by_rule_id`, `superseded_at`, `withdrawn_at`, `withdrawn_by_user_id`, `withdrawn_reason`.
  - Indexes:
    - unique on (code, program, key, version)
    - partial unique "one live reviewed version per key"
    - partial unique "one pending draft per key"
  - The reviewed version stays live while a correction is pending.
- `jurisdiction_coverage`: one row per (code, program) with `status` (not_covered, draft, covered, withdrawn), `required_rule_keys` and `status_changed_at`.
  - A state with no row is `not_covered`.
  - The service sets `covered` only when every required key has a live reviewed version.
- After the seed, the database is the source of truth; the fixture is only version 1.

**Service methods**
- `getRuleView(code, program, { includeDrafts })`
- `createDraftVersion`, `withdrawRule`, `recomputeCoverage`
- `markReviewed`: a single conditional `UPDATE … WHERE id=$1 AND review_status='draft' AND content_sha256=$2 RETURNING *`. It runs in the same transaction that supersedes the previous reviewed version and recomputes coverage. Content fields are never updated after creation.

**Seed:** `backend/src/scripts/seed-jurisdiction-rules.ts`
- Run by the operator and idempotent.
- It inserts the two sources with their hashes and 16 draft v1 rules, and sets coverage to `draft`.
- It never touches reviewed rows or review fields.
- The 16 rules are below. FS is the fact sheet. "Required" means a reviewed version is needed for coverage, which applies to all 16; a reviewed `not_stated` row is the reviewer confirming the absence.

| rule_key | kind | draft text | citation |
|---|---|---|---|
| permit.retail_food_permit | fact | No SCDA retail food permit is required | FS "What is home-based food production?"; FAQ p.1 |
| label.producer_identity | requirement | Name and address of the operation, or the SCDA Home-based Food ID number | FS Labeling 1 |
| label.product_name | requirement | The standard name of the product | FS Labeling 2 |
| label.ingredients | requirement | Ingredients in descending order of predominance by weight | FS Labeling 3 |
| label.statement | requirement | Verbatim, all capitals, contrasting colour: PROCESSED AND PREPARED BY A HOME-BASED FOOD PRODUCTION OPERATION THAT IS NOT SUBJECT TO SOUTH CAROLINA’S FOOD SAFETY REGULATIONS. | FS Labeling 4 |
| claims.health | prohibition | No health claims | FS Labeling |
| allergens.declaration | requirement | Name each major allergen, or include a disclaimer that the food may contain any major allergen (nine listed) | FS Allergens |
| allergens.tree_nut_type | requirement | Name the specific tree nut | FS Allergens |
| foods.allowed | permission | The fact sheet's seven items, marked as a partial list, plus the FAQ's general description (baked goods without cream fillings, candies, cookies, most breads; made and packaged in the home kitchen) | FS list and footnote; FAQ p.1 |
| foods.not_allowed | prohibition | Time/temperature-controlled foods, bottled beverages, cheesecake, charcuterie boards, hot sauce and BBQ sauce, finfish, crustacean shellfish; making them requires a permit | FS; Allergens † |
| sales.area | requirement | Within South Carolina | FS |
| sales.channels | permission | Direct to consumers, or to retail stores (original packaging, store posts the sign); restaurants only with an SCDA variance | FS |
| tcs.permit_path | fact | Meals need a permit; a shared-use kitchen under Reg. 61-25 ch. 9-5 is one route | FAQ p.2 |
| sales.annual_cap | not_stated | Neither source names a cap | — |
| food_handler.certificate | not_stated | Neither source mentions one | — |
| sales.online_delivery | not_stated | Neither source addresses online orders, shipping or delivery | — |

The FAQ page 2 exemption list is recorded in the FAQ's source note as a different program and is not seeded.

**Admin routes (no flag; admin-only)**
- `backend/src/api/admin/jurisdiction-rules/route.ts`: GET list with history, POST a new draft version.
- `[id]/route.ts`: GET.
- `[id]/review/route.ts`: POST with body `{ expected_content_sha256, note? }`.
  - The reviewer is taken from `auth_context.actor_id` through the user module, never from the body.
  - The reviewer must be on an allowlist in env `JURISDICTION_RULE_REVIEWER_EMAILS`. If the variable is unset, nobody can review.
  - A stale hash gets 409; an admin not on the list gets 403.
- `[id]/withdraw/route.ts`.
- `backend/src/api/admin/jurisdiction-sources/route.ts` and `backend/src/api/admin/jurisdiction-coverage/route.ts`.
- All typed with zod; `no-explicit-any` is an error in `src/api/admin/**`.

**Vendor routes (flag-gated)**
- `backend/src/api/vendor/plates/jurisdictions/route.ts`: every state with its coverage.
- `backend/src/api/vendor/plates/jurisdictions/[code]/route.ts`: the live rules with source, document id and date, effective date ("not stated" when null), review status, reviewer and date. Drafts are marked.

**Flag:** `PLATES_V1: "FF_PLATES_V1"` in `backend/src/shared/feature-flags.ts`, and a `/vendor/plates*` matcher with `requireFeatureFlagMiddleware("PLATES_V1")`.

**Registry:** add `NOT_A_CUSTOMER_ID` entries for `jurisdiction_rule.reviewed_by_user_id` and `jurisdiction_rule.withdrawn_by_user_id` ("an admin user").

**Tests**
- Unit:
  - normalizer table
  - hash canonicalisation
  - coverage function
  - fixture shape (every rule has a citation, a quote or a not_stated kind, draft status, no reviewer)
  - `plates-flag.unit.spec.ts`, following `customer-wallet-flag.unit.spec.ts`
  - the updated registry spec
- Module integration (`moduleIntegrationTestRunner`):
  - versioning
  - the partial unique indexes
  - a reviewed row cannot change
- HTTP on migrated Postgres, `jurisdiction-rules-signoff.spec.ts`:
  - running the seed twice gives the same rows
  - an admin not on the allowlist gets 403
  - a stale hash gets 409
  - a reviewer named in the body is ignored
  - coverage reads covered only after all 16 keys are reviewed
  - withdrawing a rule drops coverage back
  - vendor routes get 404 with the flag off
- `module-schema-drift.spec.ts` must stay green without growing `KNOWN_DRIFT`.

**Risks**
- Paraphrase drift: every rule keeps its verbatim quote alongside the display text.
- The FAQ page 2 conflation and the partial allowed list (see §1).
- Allowlist misconfiguration: unset means nobody can review.
- Two reviewers at once: handled by the atomic update.
- Typing the module key by hand instead of importing it.

**Ledger:** PL-2.

## Phase 3: Admin review screen (M, about 3 days)

**Files**
- `admin-panel/src/routes/jurisdiction-rules/{rule-list,rule-detail}/`
  - The list groups rules by state and program, shows coverage, and per rule shows status, source document and date, reviewer and date.
  - The detail shows the text, quote and source link with its hash, "Effective date: not stated", version history and diff. Its actions are Mark reviewed (a typed confirmation naming the document, which sends the hash), Propose correction and Withdraw.
- `admin-panel/src/hooks/api/jurisdiction-rules.tsx`, in the pattern of `hooks/api/disputes.tsx`
- `admin-panel/src/types/jurisdiction-rule.ts`
- `admin-panel/src/dashboard-app/routes/get-route.map.tsx`
- `admin-panel/src/components/layout/main-layout/main-layout.tsx`: a "Jurisdiction rules" nav entry

**Tests**
- Vitest: the review request carries the hash; drafts and reviewed rules render correctly; the confirmation is required.
- Optional mocked Playwright spec in the style of `e2e/tests/admin-disputes.spec.ts`.

**Risks:** stale approvals (covered by the hash) and accidental clicks (covered by the typed confirmation).

**Ledger:** PL-3.

## Phase 4: Seller jurisdiction on the cottage-food profile (S, about 1 day)

**Files**
- `backend/src/modules/cottage-food/models/profile.ts`: add `jurisdiction_code` (nullable, indexed).
- A migration for it.
- `backend/src/api/vendor/cottage-food/_helpers.ts`: on write, derive the code from `state_code` with `normalizeUsJurisdiction`, and keep `state_code` as the seller typed it.
- An operator-run backfill script, `src/scripts/backfill-cottage-food-jurisdiction.ts`.

**Tests**
- A unit test of the derivation.
- An HTTP backfill spec: idempotent, an unparseable state stays null, `state_code` is untouched.

**Risks:** a seller can declare the wrong state, which is consistent with the self-declared model.

**Ledger:** PL-4.

## Phase 5: Recipe costing with fees, spoilage and fulfilment (L, about 6 days)

**Why new tables rather than reusing batches**
- A batch records what was actually made, and it feeds quest totals (`production-ledger/service.ts getProductionSummary`).
- `production_cost_entry.production_batch_id` is NOT NULL.
- A recipe disguised as a batch would inflate production totals and mix plans with actual costs in `GET /vendor/production-costs`.
- Recipes still reuse `costing.ts`, because `rollupCosts` accepts any `CostLine`.

**Models** in `backend/src/modules/production-costing/models/`
- `production-recipe.ts`:
  - identity: `seller_id`, `name`, `product_id` (nullable; ownership-checked), `jurisdiction_code`, `suggestion_key`
  - yield: `yield_qty` (nullable, meaning unknown), `yield_unit_label`
  - pricing inputs: `spoilage_percent`, `fulfilment_cents_per_unit`, `units_per_order` (default 1), `target_margin_percent`
  - other: `currency_code`, `notes`
- `production-recipe-line.ts`:
  - `seller_id`, `recipe_id`, `position`, `category`, `source` (existing enums), `label`
  - money and quantity: `quantity` (bigNumber), `unit` (g, kg, oz, lb, ml, l, tsp, tbsp, cup, each, hour, minute, other), `unit_amount_cents`, `amount_cents` (bigNumber), `is_cash_outlay`
  - label inputs: `price_note` (where the price came from), `on_label`, `allergens` (json)
- A migration that includes a `raw_*` column for every bigNumber.

**Pure functions in `backend/src/modules/production-costing/costing.ts`**
- `costPerSoldUnitCents`, `orderNetCents`, `minimumPriceForMarginCents`, `pricingAtPrice`.
- `orderIngredientsByWeight`: uses g, kg, oz and lb only, and returns null if any ingredient line has a non-weight unit.
- They import the pure `percentOfCents`, `processingEstimateCents` and `legacyPlatformFeeCents` from `payout-breakdown/fee-first.ts`, so the costing uses the same arithmetic as settlement.
- The rule the price search follows (this is the part that matters):
  ```
  C = ceil(unit_cost / (1 - s)) + f            // cost per unit sold
  proc = fee_first ? processingEstimateCents(u*P, p, F) : 0
  comm = fee_first ? percentOfCents(max(0, u*P - proc), c) : legacyPlatformFeeCents(u*P, c)
  suggested(m) = smallest integer P with 100*((u*P - proc - comm) - u*C) >= m*u*P
  ```
  Here s is spoilage, f is fulfilment per unit, u is units per order, c is the commission percent, and p and F are the processing percent and fixed fee. Search upward from the closed-form estimate; rounding can make net income dip by a cent, so a binary search is not safe.

**Fee context**
- Add `resolveSellerFeeContext(container, sellerId)` to `backend/src/shared/platform-fee.ts`.
- Model: fee-first or "absorbed", depending on `feeFirstSplitEnabled()`.
- Commission: the percent and its source from `resolveSellerPlatformFee`.
- Processing: percent and fixed fee from `PayoutBreakdownService.getDefaultConfig()`. If that read fails, fall back to `DEFAULT_PROCESSING_*` and say so in the response.

**Routes** (matcher `/vendor/production-recipes*` with `PRODUCTION_COSTING_V1` and `vendor.production_ledger`)
- `backend/src/api/vendor/production-recipes/route.ts`: GET, POST
- `[id]/route.ts`: GET, POST to update, DELETE
- `[id]/lines/route.ts`: POST replaces all lines
- `[id]/costing/route.ts`: GET, accepting overrides for margin, spoilage, fulfilment, units per order and `price_cents`
- `_helpers.ts`: zod schemas; a recipe that is not yours is 404; product linking uses `sellerOwnsProduct`

**Costing response**
- Cost:
  - full cost, cash and in-kind amounts, and totals by category
  - unit cost, and cost per sold unit after spoilage
- Prices:
  - break-even prices (cash only, and full cost)
  - suggested prices at the target margin and at `DEFAULT_TARGET_MARGINS`
  - per-unit processing, commission, net and margin, and the same at `price_cents`
- For product creation: `amount_major`, computed with `fromMinorUnits`.
- Context: `fee_context`, and `assumptions[]` (spoilage definition, the fixed fee spread over u units, processing on shipping and tax not modelled, labour counted at the seller's own rate).

**Batch rollup:** `rollup/route.ts` and `getBatchCosting` return fee-aware `suggested_prices`, keep the old numbers as `suggested_prices_before_fees`, and add `fee_context`. No screen calls the rollup today.

**Tests**
- Unit, `pricing.unit.spec.ts`:
  - thousands of random inputs checked against a brute-force minimum
  - net income checked against `computeFeeFirstSplit(...).sellers[0].sellerNetCents`, and against `u*P - legacyPlatformFeeCents` when processing is absorbed
  - spoilage, fulfilment, unknown yield, margins out of range
  - ingredient ordering by weight
- Module integration: lines persist, and NUMERIC quantities come back as numbers.
- HTTP spec `production-recipes-costing.spec.ts`:
  - another seller's recipe is 404
  - linking another seller's product is refused
  - a seller's `custom_platform_fee_percent` override is used
  - the fee model changes with `FF_FEE_FIRST_SPLIT_V1` (a second runner)

**Risks**
- Divergence from settlement arithmetic (pinned by the parity test).
- The processing assumptions above.
- Sellers reading the suggestion as a market price. The copy should say it is a floor from their own costs.
- Recipes are private to the seller (404 for anyone else).

**Ledger:** PL-5.

## Phase 6: Cottage food reads the rules (L, about 7 days)

**Files**
- Models:
  - `backend/src/modules/cottage-food/models/profile.ts`: add `registration_id`, `label_identity` (name_address or registration_id), `show_registration_id_publicly`.
  - `models/label.ts`: add `allergen_details` (json, for example `{tree_nuts:["pecans"]}`), `registration_id_snapshot`, `jurisdiction_code_snapshot`, `rule_snapshot` (rule ids, versions and review status at creation).
  - A migration for both.
- `service.ts`: each method takes a rule view as an argument instead of resolving another module.
  - `createLabelForSeller(…, ruleView?)` snapshots the reviewed statement and the identity.
  - `renderLabel(id, ruleView?)` builds the missing list from the rules and reports drift from the rule version the label was made under.
  - `getComplianceSnapshot(…, ruleView?)` adds rule advisories as plain strings.
  - `expiryView` compares the date-only value with today in the seller's timezone.
  - No verdict-style method names.
- Routes:
  - `api/vendor/cottage-food/_helpers.ts`: drop a blank or invalid timezone (check it with `Intl`); sanitise the new fields.
  - New `api/vendor/cottage-food/_rules.ts`: builds the rule view, only when the flag is on.
  - New `api/vendor/cottage-food/_checklist.ts`.
  - Updated `profile/route.ts`, `onboarding/route.ts`, `compliance/route.ts`.
  - `labels/route.ts` and `labels/[id]/route.ts`: `product_id` is checked with `sellerOwnsProduct` (404 if not yours, never 403); they also accept `allergen_details`.
- Store:
  - New batched `backend/src/api/store/cottage-food/disclosures/route.ts`, at most 50 ids, published products only. Its shape is `{products:{id:{seller_id, allergens[{key,label,detail}]}}, sellers:{id:{operation_type, business_name, address|null, jurisdiction{code,coverage}, statement{text, source{title,document_id,document_date,url}, reviewed_at}|null, seller_wording, sales_area, channels}}}`. Write "more than 50" in comments, never "exceed".
  - Update `producers/[handle]/disclosure/route.ts`: when the flag is on and the seller is in SC, no permit lines.
- Module README: decision 1 ("ships no state-law table") changes to "reviewed rules for covered states; seller declarations everywhere else". The rule that it never blocks a sale stays.

**Behaviour for SC with the flag on**
- Labels:
  - The label prints the reviewed statement verbatim. A draft statement is never auto-printed; the seller gets a "Copy wording" action that puts it in their own disclosure field.
  - The label prints name and address, or the ID line, and never "Permit #".
  - The label prints the tree-nut species, and the missing list includes the address or ID, and the species.
- Checklist:
  - It follows the rules: label identity, ingredients by weight, allergens and species, statement, the not-allowed foods, SC-only sales.
  - It drops the permit, cap and food-handler items.
- Advisories:
  - cooked meals or other time/temperature-controlled foods (TCS)
  - the out-of-state toggle switched on
  - fish or shellfish chosen as an allergen
  - a permit number entered
- Dashboard: the cap and food-handler rows read "not stated by SC sources" with the source.
- States not covered: today's behaviour plus `jurisdiction:{coverage:"not_covered"}`, with softer copy ("if your state issues a permit…").

**Tests**
- Unit:
  - golden label text for an uncovered state, identical to today
  - SC rendering
  - the checklist and advisories
  - date-only expiry and timezone handling
  - the non-blocking contract stays green
- HTTP, `cottage-food-jurisdiction-rules.spec.ts`:
  - flag-off responses match goldens captured from main
  - SC with reviewed rules versus draft rules
  - a foreign product id is refused on POST and PATCH
- HTTP, `store-cottage-food-disclosures.spec.ts`:
  - published products only
  - reviewed statements only
  - the address is withheld unless the seller opted in
  - no meters or ledger figures
  - unknown ids are left out

**Risks**
- The non-blocking guards (§1.14).
- Keeping flag-off responses byte-identical.
- Snapshot semantics: a printed label must keep reading as printed.

**Ledger:** PL-6. It also records the unchecked `product_id`, the timezone 500 and the expiry off-by-one as fixed.

## Phase 7: Suggestions endpoint (M, about 4 days)

**Files**
- `backend/src/lib/plates/suggestions.ts` (pure), `signals.ts` (I/O), `food-catalog.ts`
  - The catalog maps each allowed-food key to category names and title keywords. That mapping is stated to sellers as an assumption.
- `backend/src/modules/opportunity-engine/_signals.ts`
  - Add new helpers that return `{status: measured|insufficient_data|unavailable, value|null, n, truncated, as_of, scope}`.
  - `gatherCategorySignals` stays unchanged until Phase 8.
- `backend/src/api/vendor/plates/suggestions/route.ts`: `?jurisdiction=US-SC`.

**Response**
- The jurisdiction and its coverage, and the rules behind the suggestions (with source, review status and date).
- One entry per allowed food, each with:
  - the rule that allows it, and its caveats
  - demand evidence, split by type:
    - open requests in SC versus requests with no region
    - prior sales of comparable SC listings over 90 days
    - wishlist saves (national, and labelled so)
    - modelled estimate: "not modelled"
  - competition: SC listings and distinct sellers
  - price range: min, median and max list price, in cents, from SC listings by sellers whose `jurisdiction_code` is US-SC; marked "measured" only when n is at least 5 from at least 2 sellers
  - assumptions, including "pack sizes vary"
- A not-allowed list with sources.
- `unknowns`:
  - cap
  - food handler
  - online and delivery
  - local ingredient availability: "not connected yet"
- No composite score.
- An uncovered state returns `not_covered` and no suggestions.

**Opportunity-engine signals: keep, fix or drop**
- **Keep, fixed:**
  - Open demand posts (`_signals.ts:60-85`): null on failure; SC and no-region counted separately; truncation reported. Needs SD-63.
  - Wishlist count (`:87-105`): filter in the query or report the sample size; null on failure; labelled "national, expressed interest".
  - Listings and distinct sellers (`:107-147`): scoped to SC sellers; truncation reported. The `ceil(listings/3)` fallback is dropped and becomes null.
- **Drop for Plates:**
  - bounty dollars (marketing money, not demand)
  - startup cost from guides (no food guides exist; the old neutral 0.5 that read as "Medium")
  - the composite score and bands
  - the price trend (synthetic)

**Tests**
- Unit:
  - there is no composite field
  - a failed read is "unavailable", never 0, using a scope keyed by the imported module constants
  - drafts are flagged, and the not-allowed list and unknowns are present
- HTTP, `plates-suggestions.spec.ts`:
  - n=2 gives "insufficient data"
  - n=5 gives a measured range, and $4.50 reads as 450
  - listings from other states are excluded
  - SC and no-region posts are counted separately
  - seed observations are ignored
  - flag off gives 404

**Risks**
- Drift on `demand_post` until SD-63 lands.
- Coarse categories ("Prepared Foods"), stated as an assumption.
- Small n.
- Query cost; cache per state if needed.

**Ledger:** PL-7.

## Phase 8: The opportunity engine stops presenting unknowns as known (M, about 3 days; runs in parallel)

**Files**
- `_scoring.ts`: when any input is null, the composite and bands are null or "Unknown". No data no longer scores 4.0.
- `_signals.ts`: the public paths switch to the Phase 7 helpers.
- `service.ts`: `getPriceTrend` excludes `source = "seed"` and reports `sources` and how many synthetic rows it excluded.
- A migration making the four score columns on `opportunity_score` nullable; `recompute-opportunity-scores.ts`.
- Store and seller routes:
  - `src/api/store/opportunities/route.ts`
  - `[subject]/route.ts`: drop or relabel `related_coalitions`
  - `src/api/store/price-tracker/route.ts`
  - `src/api/v1/seller/economic-intelligence/trends/route.ts`
  - `src/api/v1/seller/growth/suggestions/route.ts`
- `seed-opportunity-engine.ts`: refuses to run in production without an explicit opt-in, and tags rows `metadata.synthetic`.
- Consumers, in the same PR:
  - `storefront/src/app/[locale]/(main)/opportunities/page.tsx`
  - `[subject]/page.tsx`
  - `storefront/src/lib/data/discovery.ts`
  - `vendor-panel/src/routes/growth/growth.tsx`: `h.opportunity_score.toFixed` would crash on null

**Tests**
- `scoring.unit.spec.ts` updates.
- `opportunity-engine-honesty.spec.ts`.
- The storefront and panel render null as "Unknown".

**Ledger:** PL-8.

## Phase 9: Panel cottage-food fixes and rule-aware pages (M, about 4 days)

**Files**
- `vendor-panel/src/hooks/navigation/use-vendor-navigation.tsx`: add "Cottage food" with Profile, Sales log and Labels, shown for `hasProducts || hasMenu`; plus its spec.
- `routes/cottage-food/_shared.tsx`:
  - types for the new fields
  - a UTC `formatDate` for date-only fields
  - `onError` on saves
  - hooks for label detail, the product picker and jurisdictions
- `profile/page.tsx`:
  - a state select from `lib/data/country-states.ts`
  - a select of IANA timezones (US zones first)
  - for SC: no permit, food-handler or meal-cap prompts; a Home-based Food ID field; the statement with its review badge; the rule shown next to the out-of-state toggle; a caveat on "Cooked meals"
- `labels/page.tsx`:
  - tree-nut species
  - a product picker
  - a statement preview
  - saved labels become links
- New `labels/[id]/index.ts` and `page.tsx`: edit, mark reviewed, refresh the snapshot, link a product, print, delete.
- `page.tsx` (dashboard): the rule checklist; no permit or handler rows for SC.
- `providers/router-provider/route-map.tsx`.
- `components/onboarding/launch-wizard.tsx`: in the cottage-food step, a state select and the SC fields.
- A shared `routes/cottage-food/_rule-badge.tsx`.
- Keep data access in `_shared.tsx` so SD-146's importer list does not change.

**Tests**
- Vitest:
  - navigation
  - clearing the timezone sends nothing and errors show a toast
  - dates render in UTC
  - the label detail flows
  - SC rendering against mocked fetches

**Ledger:** PL-9.

## Phase 10: Panel Plates desk (L, about 7 days)

**Files**
- `vendor-panel/src/routes/plates/{index.ts,page.tsx}`: the state list. Covered states come first; every other state reads "Not covered yet".
- `routes/plates/[jurisdiction]/{index.ts,page.tsx}`: the rules with sources, the suggestions with their evidence and assumptions, the not-allowed list and the unknowns. "Cost this" creates a recipe.
- `routes/plates/recipes/[id]/{index.ts,page.tsx}`:
  - The cost lines with a price note on each, plus yield, spoilage, fulfilment, units per order and margin.
  - A live breakdown, the break-even prices and the market range or "insufficient data".
  - The "Create draft product" step:
    - It calls the existing `useCreateProduct`, which posts to `/vendor/seller-products`, with `status:"draft"`, `prices:[{amount: amount_major, currency_code:"usd"}]` and a default option and variant.
    - It then creates the label: ingredients ordered by weight when that can be computed (otherwise the seller's order, with a prompt), allergens from the line tags (confirmed by the seller), tree-nut species, and the `product_id`.
    - It links the recipe to the product and opens the product edit page.
    - Linking is idempotent and can be retried.
- `routes/plates/_components/{data-status,assumptions,price-breakdown,cost-lines-editor,draft-product-form}.tsx`.
- `vendor-panel/src/hooks/api/plates.ts`, using `fetchQuery`.
- `lib/phase0-feature-flags.ts`, `vendor-panel/Dockerfile` and `.github/workflows/docker-build.yml` (PANELARGS block) for `VITE_FF_PLATES_V1`.
- Route map, and a "Plates" nav item: `showFor: flag && hasProducts`, `requiresPlanFeature: "vendor.production_ledger"`.
- Optional, after SD-63: a "Launch it" hand-off to `/launch-business` pre-filled with the price in cents, which is that route's contract.

**Tests**
- Vitest:
  - the draft request has `status:"draft"` and `amount: 8.5` for 850 cents
  - the label POST carries `product_id`
  - the rule badge renders
  - "insufficient data" copy appears
  - the nav respects the flag
- `scripts/check-panel-feature-flags.mjs` passes.

**Risks**
- An orphan product if the seller link fails. Confirm the product appears in `/vendor/products` before linking.
- `enforceListingTypeAllowed` returning 400; surface its message.
- Mixing up major and minor units.

**Ledger:** PL-10.

## Phase 11: Storefront disclosure and allergens where buyers buy (M, about 3 days)

**Files**
- `storefront/src/lib/data/cottage-food.ts`: add `getHomeKitchenDisclosures(productIds)`.
- `components/molecules/HomeKitchenDisclosure/HomeKitchenDisclosure.tsx`:
  - a product-level `ProductHomeKitchenNotice`
  - a compact `SellerHomeKitchenNote`
  - "Made in South Carolina" in place of "Permitted in"
  - the reviewed statement verbatim, with the source title and date but no reviewer name
  - seller wording labelled "In the maker's words"
- `components/organisms/ProductDetails/ProductDetails.tsx`.
- `components/sections/Cart/Cart.tsx`, `components/organisms/CartItems/CartItems.tsx`, `components/cells/CartItemsProducts` (`AllergenChips` per item).
- `components/sections/CartReview/{CartReview,CartItems}.tsx`, `app/[locale]/(checkout)/checkout/page.tsx`: when the shipping state is not SC, show an advisory for SC sellers. It is display-only and never blocks.

**Tests**
- Vitest:
  - the statement renders verbatim
  - nothing renders when the response is null
  - a draft is never shown (the backend contract)
  - species are shown
  - checkout notices
  - an addition to `ProductDetailsPage.spec.tsx`

**Ledger:** PL-11.

## Phase 12: Launch (S)

1. Archive the PDFs.
2. Run the seed in production.
3. Set `JURISDICTION_RULE_REVIEWER_EMAILS`.
4. The owner or the named reviewer reviews all 16 rules, and coverage reads covered.
5. Walk journey 9 on staging.
6. Set `FF_PLATES_V1=true` on the backend first, then the `VITE_FF_PLATES_V1` repo variable and rebuild the panel.
7. Verify in production.
8. Update the docs: `docs/FBM_UNIFIED_MEMBER_PORTAL_PLAN.md:548` (decisions taken) and the rows at `docs/IMPLEMENTATION_STATUS_AND_COST_REDUCTION.md:52-53,119`.
9. Add the ledger closure (PL-12).

**Rollback:** switch the flags off. The data stays, and reviewed rules remain.

## Order, sizes and parallel work

Sizes use the ledger's key: S ≤1 day, M 2–5 days, L >1 week.

- **Lane A (money):** P1 (M), then P5 (L), then P10 (L, shared with lane C).
- **Lane B (rules and data):** P2 (L), then P4 (S), then P6 (L) and P7 (M), which can run in parallel after P4.
- **Lane C (frontends):** P8 (M, from day one), P3 (M, after P2's API), P9 (M, after P6), P11 (M, after P6 and the checkout branch), and P10 together with lane A.
- **Critical path:** P2 → P4 → P7 → P10 → P12, about 20 working days with P5 alongside.
- **Total:** about 50 engineer-days, or 4–5 weeks with three people.
- Agree the API contracts for `/vendor/plates/*`, `/vendor/production-recipes/*` and `/store/cottage-food/disclosures` first, so the frontends can build against mocks.
- Every backend phase runs:
  - `npx medusa build`, then `npx tsc --noEmit`
  - `pnpm lint`
  - `pnpm test:unit`
  - the named `test:integration:http` specs
  - `pnpm test:posture-a` (unaffected, but still run)
  - root `pnpm check:vendor-completeness`

## Ledger section to add to `docs/AUDIT_DEBT.md`

Add "## PL — Plates food pilot, South Carolina (2026-11-17)". Its intro gives both owner decisions and states that jurisdiction-driven behaviour sits behind `FF_PLATES_V1` and never blocks a sale.

Rows:
- PL-1 to PL-12, one per phase as above. PL-5 records the change in the rollup's `suggested_prices` meaning. PL-2 records why FAQ page 2 was excluded and the two hashes.
- **Open findings recorded but not fixed here:**
  - `/vendor/seller-products` leaves an orphan product when the seller link fails.
  - The botanical overview reports an undeclared cap as 0 (`api/vendor/botanical/compliance/overview/route.ts:87`).
  - The vendor-quest compliance tracker expects a permit from SC sellers (quests are off).
  - `admin/wholesale-application/[id]/approve` takes `reviewed_by` from the request body; that is the pattern not to copy.

## Open questions for the owner (kept to the minimum)

1. **Who is the named reviewer besides you, and which admin login should be allowed to sign off?** This sets `JURISDICTION_RULE_REVIEWER_EMAILS`. The build does not wait for it; the sign-off does.
2. **What about online orders and delivery within SC?** Neither PDF addresses online orders, shipping or delivery within SC, and FBM is an online marketplace. Do you want to launch showing "not addressed by our sources", or first add and review the SCDA Home-based Food Production Law Guidance (which the fact sheet itself cites for the full food list) and/or SC Code §44-1-143?
3. **Defaults I'll assume unless you say otherwise:**
   - Grower Tools becomes nursery-only at its current price.
   - No outside price or demand data at launch: FBM's own listings and requests only, otherwise "insufficient data".
   - Buyers see the source and review date, not the reviewer's name.

### Critical Files for Implementation
- backend/src/modules/cottage-food/service.ts
- backend/src/modules/production-costing/costing.ts
- backend/src/modules/vendor-plan/catalog.ts
- backend/src/modules/opportunity-engine/_signals.ts
- backend/src/api/middlewares.ts