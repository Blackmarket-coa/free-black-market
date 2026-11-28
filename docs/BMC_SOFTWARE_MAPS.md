# BMC Software Maps — Forge Integration

**Updated:** November 27, 2026.
**Status:** Consolidated target software/product ownership maps and cross-app requirements. Source-backed primitives are distinguished from planned migrations. No deployed software, billing, identity authority or runtime protection changed through this document.

Related repository planning references: [Forge product map](https://github.com/Blackmarket-coa/Forge/blob/master/PRODUCT_MAP.md), [FBM app inventory](https://github.com/Blackmarket-coa/free-black-market/blob/main/docs/FBM_MOBILE_APP_PLAN.md), [FBM portal/equipment plan](https://github.com/Blackmarket-coa/free-black-market/blob/main/docs/COMPOSITION_LAYER.md), and [Blackout strategy](https://github.com/Blackmarket-coa/blackout/blob/develop/docs/product/BLACKOUT_APP_PLAN.md). This consolidated map includes the Blackmask and cross-ecosystem ownership views.

## Ecosystem ownership map

| Software | Core authority and everyday use | Forge relationship |
| --- | --- | --- |
| Forge | Complex technical/creative work, customization, advanced integration, infrastructure operation, packaging and publishing | Shared authoring/operations workspace; Projects, Create, Connect, Host, Publish |
| FBM | Commerce, product/order/inventory operations, listing/registry, checkout, entitlements, refunds and settlement | Native links/status; Forge authors sites, integrations, advanced enhancements and app packages against FBM APIs |
| Blackout | Communication, publishing, audiences, communities, live sessions; Coalition and Coliseum remain internal modules | Native participation/go-live; Forge configures hosting/media, authors advanced assets and coordinates technical work |
| Blackmask | Security/privacy operations for individuals, groups and organizations; private Chats/Spaces, identities and separately locked Vault | Native protections and sensitive operations; Forge authors compatible presets/templates and configures authorized infrastructure |
| Blackstar | Logistics execution, eligibility, dispatch/jobs, claims/bids, handoffs and tracking | Preserve its domain service; technical connectors/deployment configuration may be exposed in Forge when supported |

Use existing shared identity/authorization contracts. Blackmask does not become a new identity provider, and a user opening Forge does not gain cross-app administrator privileges. This map does not introduce a new backend, ledger, authentication service, or parallel marketplace.

## Forge software map

| Destination | Mapped capability groups |
| --- | --- |
| Projects | Linked sites/apps/communities/streams/extensions, environments, durable drafts, roles, checkpoints, history |
| Create | Websites/portals, visual components, brand/theme/layout kits, widgets/plugins/assets, overlays, community/game/quest packs, privacy profiles and secure-record templates |
| Connect | FBM Connect and commerce embeds, media/chat embeds, API/SDK/webhooks/RSS, native app links, automations and reusable actions |
| Host | Authorized deployment, supported service catalog, domains/TLS, federation, health/logs/resources, updates, backup/recovery, clone/migration |
| Publish | Shareable previews, test/role/device simulation, package/digest/sign handoff, private/organization/public releases, installers, update rehearsal, version/compatibility and distribution |

Existing foundations: Tauri/Rust desktop app, React frontend, five framework adapters, project/config/build/process/artifact tools, eight extension templates, validation/semver/deterministic packaging, and FBM registry publishing. New visual editors, remote operations, durable drafts and cross-app capability coverage remain planned. All forty research IDs (WP1–WP4, SH1–SH4, CO1–CO4, CL1–CL4, WF1–WF4, RE1–RE4, RB1–RB4, TD1–TD4, SL1–SL4, N81–N84) are retained in the detailed Forge map.

## FBM software map changes

| Native surface | Native everyday use | Advanced Forge surface |
| --- | --- | --- |
| My Website / stall | Website link/status; manage products, orders and fulfillment | Launch/connect site, domains, templates, layout, embeds, preview/deploy, app packaging |
| My Place / equipment / appearance | Survey-driven free setup, select/pin/reorder/apply owned equipment | Author advanced portal builds, visual components, brand kits and themes |
| Creator tools / digital products | Simple upload/listing/campaign/earnings/payout management | Package advanced artifacts, preview, test, publish and deliver custom variants |
| Connected services | Connection status and routine supported actions | API/SDK/webhook setup, automation recipes, mock testing and diagnostics |
| Project/hosting status | Concise status and access to result | Deployment, logs, backups, recovery and migration |

Keep unified buyer/seller/trader direction and ordinary native tasks intact. FBM remains the registry, checkout, entitlement and settlement authority. Reuse Launch/Connect and the existing signed extension delivery contracts.

## Blackout software map changes

| Native surface | Native everyday use | Advanced Forge surface |
| --- | --- | --- |
| Community settings / Hosting | Community participation and authorized status | Self-host/federation setup and maintenance |
| Go live / Stream settings | Select prepared profile, broadcast, moderate and end session | Owncast/OBS, scene kits, keys, simulcast, separate live/archive outputs and diagnostics |
| Share / stream details | Share result and supported prepared embed | External player/chat embedding and origin/access validation |
| Creator tools / Appearance / Coalition | Apply enhancements, contribute assets, use kits and join activities | Author templates, overlays, plugins, sound/game/quest packs, preview and publish |
| Integrations / Privacy | Routine controls and existing privacy surfaces | Forge automation/technical setup; relevant protection operations connect to Blackmask |

Keep audience, contest/reputation rules, private membership and communication scope. Do not infer live position access or change map location consent from a technical setup action. Project collaboration reuses Blackout services instead of adding a competing messenger.

## Blackmask software map changes

| Native surface | Native protection/experience | Advanced Forge surface |
| --- | --- | --- |
| Profile/mask menu → Protection & privacy | Personal and organization protections, status, privacy settings and supported native controls | Create compatible reusable profiles and configure supporting infrastructure |
| Chats | Private communication, consent and audience choice, notification/cover/reveal controls | Technical communication service setup through narrow authorized configuration |
| Spaces / organization settings | Membership, day-to-day private group operation and authorized control | Deploy approved supporting services, create reusable organization/Space kits, configure scoped integrations |
| Vault | Independently lock/unlock, create/use records, selected-item sharing and recovery | Author a secure-record schema/template with synthetic fields; never transfer real vault secrets by default |
| Enhancements / Appearance | Discover/apply compatible owned items | Customize or create templates/themes/tools in Forge and distribute through FBM |
| Hosting / connection status | Show authorized connection/support state | Domains, deployment profiles, logs, backup/recovery and migration of supported infrastructure |

Blackmask houses privacy/security use; Forge houses complex setup and authoring. Preserve the independent Vault boundary, no blanket shared keys/sessions, explicit selected-item sharing, platform-specific protection limits, and essential protection independent of purchases/rewards. Identity personas used for privacy are distinct from removed AI-persona products.

## Shared Forge entry and handoff contract

1. Every applicable app exposes **Forge — Build, customize & host** beside Settings and Privacy in its account/sidebar menu on desktop/mobile. A lightweight native hub lists relevant tools, projects, drafts and status.
2. Add contextual task links; send users to the exact authorized resource/tool rather than a generic homepage. Everyday controls stay native.
3. Each tool declares a stable ID, applicable apps, host/runtime/device support, required role, contextual entry points, launch target, status source and return behavior in a shared capability directory.
4. Preserve task intent and explicitly saved drafts through installation/sign-in, unsupported-device and unavailable-service cases. A browser fallback is offered only for an implemented browser tool.
5. Recheck authorization on arrival. Do not place tokens, stream keys, deployment secrets, private content or Vault material in links. Return to the originating app and refresh status after completion.
6. Retire old advanced routes only after feature parity and the complete handoff/return journey are verified; keep redirects during transition.

## Shared technical and commercial contracts

| Contract | Requirement |
| --- | --- |
| Project/resources | Stable references, owner/team/roles and explicit environment; no implicit blanket administrator scope |
| Artifact/host | Author/license, supported kinds/slots, compatibility, permissions, versioned assets, digest/signature and actual runtime support |
| Delivery | Real file upload/package/publish + correct listing/entitlement + verifiable buyer delivery/install; metadata-only listing creation is insufficient |
| Ownership | Distinguish owned, installed, configured, enabled/equipped, updated, revoked/refunded states; retain valid purchases through unequipping |
| Preview/remix/export | Synthetic data and secret references by default; preserve rights/attribution and audience/privacy boundaries |
| Infrastructure | Services continue when Forge closes; supported backups and tested restore; code rollback is not database recovery |
| Commerce | Processing fees first, flat 3% coalition share; no second Forge fee on the same native marketplace sale |
| Pricing | Optional enhancements/assets follow one-time ownership direction; capacity costs have explicit terms; no new prices/subscription changes assumed |

## Delivery order and verification

1. Shared capability directory, native Forge hubs/context links and durable drafts.
2. Connect/verify the complete artifact pipeline using one theme or declarative widget, including actual buyer delivery, reinstallation and refund behavior.
3. Small starter-kit gallery, schema-driven visual editors, previews/mock data and reviewer access.
4. Hosting health, supported deployment profiles, backup-before-update and restore drills; streaming kit/destination/embed integration.
5. Generated-app signing/install/deep-link/update tests; advanced automation dry runs/history/retry; broader collaborative authoring.

Source findings carried from the session: Forge's parallel recipe flag remains sequential and the UI saves one step; iOS paths hand off to external tooling; no published Forge release was found in the reviewed repository; Blackout creator drafts lack durable persistence in the checked wizard; its ordinary FBM listing adapter carries metadata while bytes require the separately connected signed-bundle path. These are implementation/verification work, not completed migrations.

Maintain planning separately from production evidence. This update changes maps and related product plans only. Existing audits, test results, operational handoffs and release claims retain their original scope and dates.

