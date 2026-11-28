# FBM software map for Blackout live commerce

**Added:** November 28, 2026  
**Status:** Planned cross-app completion requirements. Existing integration documentation remains evidence only for its stated source paths and dates; this map does not enable billing, declare working cashout or implement new endpoints.

The [Blackout live participation map](https://github.com/Blackmarket-coa/blackout/blob/14d2db501197f93130cd24a4cf3797739ba902bc/docs/features/BLACKOUT_LIVE_PARTICIPATION_FEATURE_MAP.md) defines thirteen live-room capabilities. This FBM-side companion maps money, ownership and delivery responsibilities without duplicating the room or introducing another wallet. Read alongside the [existing Blackout integration contract](contracts/blackout-integration.md), [mobile app plan](FBM_MOBILE_APP_PLAN.md) and [monetization direction](FBM_MONETIZATION_PLAN.md).

## Software and surface ownership

| Capability | FBM authority and surface | Other app responsibility | Completion gap |
| --- | --- | --- | --- |
| LIVE-05 tips and visual gifts | Eligible transaction, disclosed recipient/cost, checkout, capture, receipt, refund/dispute and settlement | Blackout owns the gift choice and session presentation | Verify a complete checkout-to-recipient journey; request creation is not captured payment |
| LIVE-06 Perks and LIVE-08 gift goals | Financial record/event for a supported paid contribution; correlation to the agreed purpose | Blackout owns eligibility, room counter and authorized effect execution | Version and verify event contract; duplicate delivery cannot duplicate counters or effects |
| LIVE-02/03 extra time/speak-next and LIVE-07 drop/revive | Disclosed finite paid interaction only where the approved format permits it | Blackout owns timed grants, queue and opt-in entertainment seat rules | No financial event directly invokes moderation or bypasses room permissions |
| LIVE-09 missions and LIVE-11 recognition | Fulfill an eligible native product entitlement where supported; preserve scoped ownership | Blackout owns completion evidence, channel/growth points and contribution standing | Do not treat watch telemetry as payment, verified learning or confirmed viewing |
| LIVE-10 community/creator joining | Fulfill an explicitly priced finite access product if offered | Blackout owns actual group membership and role checks | Following/joining is not payment; recurring memberships require a separate explicit policy decision |
| LIVE-13 recorded participation | Current valid support, goods, content unlocks, services or workshop offers under actual terms | Blackout preserves historical contest results and disables expired stage effects | Old capture events never execute into a new session or replay |
| Forge-authored overlays/templates | Existing listing, license, order, entitlement and actual artifact delivery contracts | Forge authors/tests packages; Blackout consumes compatible assets | Metadata-only listing creation is not delivery; verify install, reinstallation and refund behavior |

LIVE-01/04/12 panel operation, chat and audience counters have no new FBM authority. Blackmask remains responsible for applicable personal privacy and private coordination. Blackstar retains eligible physical fulfillment if a separate physical order is made; this plan creates no transport feature or delivery workflow.

## Payment to effect contract

The proposed journey is disclosed offer → authorized checkout → verified capture → durable event → Blackout authorization/goal update → one permitted effect → visible result or resolution. Distinguish payment pending, captured, effect pending, applied, expired, failed, refunded/disputed and settled. A browser success screen or gift animation cannot independently establish capture or available payout.

Define event identity, version, source transaction, recipient, offer/effect configuration reference, room/format reference, amount/currency, lifecycle state and time. These are contract requirements, not already implemented field/API names. Minimize private metadata and verify authenticated service delivery. Keep identifiers stable and implement idempotency, durable delivery/retry, reconciliation and out-of-order handling with the existing service owners.

Blackout must recheck current role, participant acceptance, live-room state and target availability. A valid payment cannot restore a banned member, enable camera/microphone, buy eligible votes or alter factual findings. Publish terms for expired turns, full queues, absent targets, ended rooms and failed effects before charging, with a defined cancellation/refund or other disclosed resolution path. A refund does not erase historical events; reconcile it without granting the effect again.

## Commercial and ownership invariants

- Preserve processing-fees-first and the established flat 3% coalition fee for applicable sales; rank/KARMA does not change it. Do not stack an additional Blackout or Forge fee on the same sale.
- Map gifts/tips, purchases, project fundraising and third-party beneficiary contributions to their actual transaction policies. This plan does not declare a universal net payout rate or apply sale rules indiscriminately to donations.
- Show the full cost, currency, recipient, deductions, agreed collaborator shares, pending versus available proceeds, and actual payout timing. Creator receipts and restricted beneficiary funds are not BMC revenue.
- Optional enhancements retain one-time ownership direction. Historical subscription support in the integration contract is not approval for new recurring fan clubs or platform tiers.
- Preserve separate channel points, growth XP, FBM credit, money and entitlements. No universal spendable balance is introduced. Free speaker requests, privacy, reporting and accessibility remain available.
- Paid products require actual supported delivery. Owned, installed, configured and equipped remain distinct; refunds/revocation follow the disclosed product terms without deleting unrelated records.

## Delivery and acceptance

First reconcile current source/configuration with the [integration contract](contracts/blackout-integration.md) and select one eligible transaction type. Complete one supported gift/support transaction and receipt, then a permitted finite effect and a product-reward delivery; expand goals and recorded participation afterward.

Before release, verify identity/recipient mapping, checkout cancellation and capture failure, duplicate and out-of-order callbacks, concurrent contributions, reconnect/retry, target departure, room closure, expiry, denied action, refunds/chargebacks, collaborator splits where supported, payout reconciliation and actual buyer delivery. Test mobile/browser return to the intended Blackout room. Do not deploy, change production flags or migrate historical billing through this documentation work.

Advanced technical connector configuration lives in Forge. Blackout, FBM and Blackmask handoffs carry only authorized references with a scoped authenticated handoff; never put payment credentials, private room content or Vault secrets into project files or public URLs.
