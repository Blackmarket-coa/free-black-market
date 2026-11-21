# FBM December launch: business baseline, reuse, and readiness

**Updated:** November 21, 2026

**Status:** Founder-confirmed business direction plus a scoped source audit and proposed backlog. No application, billing, permissions, dependency, CI configuration, or deployment changes are made by this document. December 31 is a target, not a guaranteed store-approval date.

**Companions:** [App plan](FBM_MOBILE_APP_PLAN.md) · [Shared game/creator commerce](FBM_COALITION_GAME_AND_CREATOR_COMMERCE_PLAN.md) · [Implementation inventory](FBM_MOBILE_IMPLEMENTATION_INVENTORY.md) · [Unified portal](FBM_UNIFIED_MEMBER_PORTAL_PLAN.md) · [Mobile shell/build guide](../mobile/README.md).

## 1. Confirmed business and launch inputs

| Input | Founder direction / evidence boundary |
|---|---|
| Audience | Approximately 26,000 social followers; several groups expected to join at launch. Participant counts, geography, actual offerings, conversion, and repeat usage are not established. |
| Stage | Not launched. Followers and expected groups are acquisition opportunities, not demonstrated demand or revenue. |
| First useful experience | Exploration leading to local buying, selling, and trading. Initial creator products include quests and digital storefronts. |
| Community-built world | Open geographic publishing: a running storyboard of reviews, recommendations, hidden discoveries, aligned businesses, discreet organizations, location-linked music, and place-associated networks. This revises any earlier assumption that all digital publication must be limited to approved venues. |
| Visibility and placement | Open digital publishing does not grant property rights, authorize physical access, endorse a business, expose private groups, or confer edit rights over another party's canonical place record. Define public/personal/group-private layers and preserve applicable privacy/reporting controls. |
| Creator products | Artists can sell copies of original work; supported purchased items can also be transferred. Define license, copy, transfer, recipient access, and modification rules separately. This decision does not establish a working transfer service. |
| User opportunities | Pass business/service opportunities to users wherever practicable. Users can contribute or sell extensions. Community work can be voluntary/gameplay-incentivized or a community-funded paid role; critical responsibilities still need accountable coverage. |
| Platform fee | Preserve processing-fees-first and the flat 3% sales commission. Do not add a duplicate Blackout or other ecosystem transaction cut. |
| Existing enhancements | The founder states all current BMC one-time enhancements are his work. First-party product proceeds accrue to the founder/BMC, subject to transaction costs/refunds and operating expenses; no outside creator royalty is assumed. Distinguish these from user product proceeds and the platform fee. |
| Entity and power | BMC is an LLC owned solely by the founder. He wants broad community power/ownership while retaining control over the 3% fee. Participation, governance, product ownership, revenue rights, and equity arrangements still need separate definition; this is not an implemented ownership transfer. |
| Current cost | $250/month covers all current expenses, including the founder's stated tooling/services total. Storage has no current charge; capacity, terms, backup/egress, and growth costs remain unverified. |
| Spending capacity | Founder can spend $1,000/month. Working planning assumption: total ceiling including the $250 baseline, leaving $750 headroom; this interpretation is not an additional budget authorization. |
| Development | Founder using Claude Code 20x on Windows/Linux. No additional paid engineering capacity or delivery velocity is established. |
| Accounts/devices | Founder reports organization accounts for both stores, an iPhone, and access to Android testing. Signing permissions, certificates, application records, and console readiness are not independently verified. |
| Target | Working public web launch and public availability in both app stores by December 31, 2026; operating costs covered. |

At a fully retained 3% fee, $250/month requires about $8,334 in monthly eligible sales base **after processing-fee deduction**. A $1,000 expense level would require about $33,334 on the same basis. Allocations, fee refunds, losses, or higher expenses increase the requirement. First-party enhancement contribution reduces the amount needed from fees. These are arithmetic scenarios, not forecasts; do not substitute sales volume or restricted community budgets for platform income.

## 2. Reuse FBM's app and Forge first

FBM source baseline: `8cfad3db9272115a56923b7b37397b4062f590c0` on the app-plan branch; application baseline remains the November 20 inventory's reviewed main. Forge source reviewed: `c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c` on `master`. Reads were scoped to framework, authoring, publishing, and release paths; no Forge build or live publication was run.

| Capability | Existing source | Remaining integration / verification |
|---|---|---|
| FBM mobile host | Committed Capacitor iOS/Android projects, storefront bridge, app links, push hooks, version tooling. | Preserve existing app IDs, session/deep-link behavior, and native configuration. Connect completed portal/world journeys rather than regenerate a replacement shell. |
| Android automation | FBM workflow syncs Capacitor, builds a debug APK and an unsigned release APK, and uploads the debug artifact. | Signed store AAB, upload configuration, actual device journeys, and store submission remain distinct checks. An unsigned APK is not a published release. |
| iOS project | Xcode project and entitlements exist. No iOS workflow was found in FBM's workflow directory. | Choose and verify a macOS/Xcode build-and-sign path, then TestFlight/device and submission validation. Windows/Linux can remain the authoring environment. |
| Forge Capacitor adapter | Detects standalone/root and `capacitor/` targets; runs Android APK/AAB commands and iOS add/sync/open commands. | FBM's target is nested at `mobile/`: open that as a target or define a tested explicit project mapping. Do not assume repository-root detection finds it. |
| Forge config editing | Recognizes TypeScript Capacitor config for build detection but edits JSON only. | Preserve FBM's `capacitor.config.ts`; no silent conversion. Its generator proposes Capacitor 8 while FBM uses 7; reuse does not authorize an automatic dependency upgrade. |
| Forge dependency commands | Framework helper uses `npm install` when dependencies are absent. FBM mobile declares pnpm and has a committed pnpm lockfile. | Preserve FBM's package-manager/lockfile contract before routing builds through Forge; do not create a second lockfile/install authority. |
| Forge iOS path | Capacitor adapter ends with `cap sync ios` and `cap open ios`. | This opens Xcode; it does not implement archive/export, signing, TestFlight upload, or an iOS build on Linux. |
| Forge release workflow | macOS/Linux/Windows matrix builds Forge's own Tauri desktop installers/updater. | Its macOS runner is reusable infrastructure evidence, not an existing FBM iOS release workflow. A mobile-specific workflow still needs implementation/configuration. |
| Extension authoring | Forge has eight starter templates, shared manifest validation, deterministic hashes, and reproducible asset ZIP packaging. | Reuse this foundation for supported creator products; quest/storefront/game-pack manifests, editors, previews, compatibility, moderation, and runtime consumers must be defined and tested. Existing coalition-kit templates are not a completed quest engine. |
| FBM publishing | Forge client creates/updates listings and invokes FBM publication/signing; asset kinds require a hosted bundle URL/hash. | Verify actual authenticated publish, signatures, bytes, entitlements, install/application, refunds, transfers, and seller settlement. Free storage alone does not connect the upload/delivery path. |
| Creator access | Forge IPC enforces paid-license gates on extension publishing and plugin browsing. | Decide the community-access policy and reconcile gates with the one-time model. Do not assume creator publishing is free or remove paid rights without a migration decision. |

Forge's TypeScript config detector can report a target ready without parsing the actual TS values; that status is not proof of valid signing, remote URL, payment behavior, or release readiness. Its current README/DEPLOYMENT statements about release history are source statements, not independently refreshed release-history evidence.

## 3. Build path from Windows/Linux

Keep FBM's existing Capacitor host as the application. Use Forge where it adds target management, authoring, validation, packaging, and publish/build orchestration. Use an explicitly configured macOS/Xcode runner for iOS archive/sign/export and distribution; do not treat Forge as a replacement for Apple's build toolchain.

GitHub documents macOS-hosted runners and certificate/provisioning-profile installation for Xcode builds. Candidate implementation: a separate reviewed iOS workflow using the appropriate supported Xcode image, environment approvals where applicable, restricted signing credentials, controlled artifacts, and TestFlight delivery. No runner, secret, paid service, workflow dispatch, or store submission is configured by this audit. Verify actual runner access/cost against the budget before adoption.

Reviewed references: [Apple Xcode requirements](https://developer.apple.com/xcode/system-requirements/) · [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) · [Xcode signing in GitHub Actions](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications).

## 4. Prioritized December backlog

P0 means a gate for the declared launch path, not proof every item can be completed within the target window. Run build/distribution preparation alongside application work.

| Priority | Work | Acceptance evidence |
|---|---|---|
| P0 | Record actual launch revision, services/flags, participating groups, locations, available offerings, and responsible release/support operators. | Reproducible environment and real seed activity; no fabricated inventory or matches. |
| P0 | Reconcile survey and persistence. Assignment route accepts ten keys while the quiz offers thirteen; `goods`, `creativity`, and `capital` fail that route's allowlist. | Registration and re-run save all supported answers; reload/resume works; no paid installation or delivery enrollment inferred. |
| P0 | Reuse role recommendations/feature union for a saved starter portal, then a real first action. | Member/organization scope, preview/apply/rebuild, free/owned tools, and full private draft persistence. Existing wizard milestone save is not a created/saved product. |
| P0 | Complete the first exploration → quest/storefront → local sale or trade journey. | Authorized map data, real publication/update/removal, exact agreed terms, stock reservation, handoff, cancellation, and recovery. Verify general direct trade rather than assume demand-pool barter supplies it. |
| P0 | Verify money flows and existing enhancement ownership. | Processing-first fixed 3%, no duplicate fee, first-party versus creator proceeds, capture/refund/payout, restored one-time rights; legacy recurring/expiring access migrated safely. |
| P0 | Connect Forge to FBM's existing mobile target and establish signed builds. | Path/package-manager/version compatibility, signed Android AAB, signed iOS archive/export, real iPhone/Android results, matching app identity/version. |
| P0 | Validate the native commerce and identity boundary. | Actual storefront/region and physical-versus-digital payment handling; session/cart handoff; restore/refund; no reliance on device language or unconditional Android link-out as policy evidence. |
| P0 | Verify permissions and operational recovery. | Account lifecycle/deletion, reporting/moderation, access control, review/demo access, weak network/resume, support ownership, backups/recovery, and applicable release disclosures. Native location/camera flows need explicit implementation and permission checks; current shell declarations do not prove them. |
| P0 for paid creator launch | Complete one quest/storefront artifact through authoring → preview → rights → publish → payment → owned bytes → compatible application → seller settlement. | Close metadata-only payload, durable draft, content association, authorization/identifier, delivery, and runtime gaps applicable to this path. Validate original-copy sale and supported transfer separately. |
| P1 | Expand community roles, open storyboard layers, music/network experiences, reusable creator templates. | Each real task/product has scope, audience, rights/terms, funding when paid, acceptance, and a functioning consumer. Do not expose unsupported editors or earning promises. |
| Separate game gate | Evaluate/adopt upstream components and deliver collection/cooperation/optional AR in the shared plan's phases. | Original assets, authoritative/replay-safe state, optional permissions, physical-device evidence. A wrapper or Forge bundle is not a working game. |

The founder's desired quest/storefront/local exchange capabilities remain launch requirements. If an item is not feasible, record the scope decision explicitly rather than silently replace the launch with a decorative map or empty wrapper.

## 5. Target schedule and measurement

| Target window | Reviewable result |
|---|---|
| November 21–27 | Pin source/environment; validate reuse mappings; prioritize blockers; establish signing/build access and real launch-group commitments. |
| November 28–December 4 | Device-testable builds and first useful portal/exploration journey; begin invited group testing. |
| December 5–11 | Real quest/storefront/exchange and applicable creator delivery evidence; correct defects and measure support work. |
| December 12–18 | Submit acceptable release candidates as soon as ready; verify production configuration, disclosures, support, and restoration. |
| December 19–31 | Resolve review findings, production verification, and release with rollback. Store approval timing remains external. |

Measure successful onboarding-to-action, useful published quests/storefronts, completed exchanges, repeat participation, creator/producer net earnings, retained platform revenue, support hours, and total operating costs. Attribute follower-to-signup-to-active-to-purchase separately; do not forecast a conversion rate without evidence. Keep community-restricted project money outside the shared operating-income assumption.

## 6. Evidence and audit limits

- Eight existing FBM mobile version-tooling tests passed on November 21 using `node --test mobile/test/*.test.mjs`. They check version parsing/updating and iOS/Android version agreement; they do not compile or exercise either app.
- No native archive/build, credentials inspection, live payment, production journey, Forge build/test suite, store console session, or device test was performed in this pass.
- Earlier backend/schema/auth defects and delivery gaps retain their prior status until individually rechecked; source modules and green general CI are not release certification.

Forge source references at the reviewed revision: [Capacitor adapter](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/frameworks/capacitor.rs), [framework resolution/install helpers](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/frameworks/mod.rs), [IPC/gates](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/ipc.rs), [extension templates](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/extension_scaffold.rs), [manifest validation](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/extension_manifest.rs), [packaging](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/extension_package.rs), [FBM client](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/src-tauri/src/backend/fbm_client.rs), [desktop release workflow](https://github.com/Blackmarket-coa/Forge/blob/c2318d1df8c04146a1ed9471c5cbdf67ca1fb74c/.github/workflows/release.yml).
