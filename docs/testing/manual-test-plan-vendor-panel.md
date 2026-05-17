# Manual Test Plan: Vendor Panel

Seller-facing dashboard (`vendor-panel/`). Test against `<STAGING_URL>/vendor` unless instructed otherwise.

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts — distinct from the *release blackout windows* concept used elsewhere in this repository.

## Before you start

- Read `TESTING.md` at the repo root.
- Request a test vendor account in `#testing-claims` on Blackout Community — vendor self-signup may be gated.
- Have at least one customer-side session ready (private browser window) to verify changes are visible on the storefront.

## Severity guidance

- **Critical** — vendor cannot list, fulfill, or get paid; money or inventory data corrupted.
- **High** — major workflow blocked; reports incorrect; customer-visible vendor data wrong.
- **Medium** — workaround exists; UI confusing; non-critical extension fails.
- **Low** — copy, polish, layout.

## Sections

### V1. Signup & onboarding
- [ ] New vendor signup → email verification → first-login walkthrough works end-to-end.
- [ ] Required onboarding fields (legal name, payout method, tax info, shipping origin) actually block "go live" until complete.
- [ ] KYC / verification status reflects accurately after admin approval.

### V2. Listing creation
- [ ] Create a simple product (one variant). It appears on the storefront within 1 minute.
- [ ] Create a product with multiple variants, options, and per-variant images.
- [ ] Bulk image upload preserves order and shows progress.
- [ ] Validation: missing required fields, oversized images, unsupported formats — all show inline errors.
- [ ] Drafts save automatically and can be resumed from another device.

### V3. Inventory
- [ ] Manual stock edit reflects on storefront immediately.
- [ ] CSV / bulk inventory import (if available) handles malformed rows gracefully.
- [ ] Low-stock and out-of-stock thresholds trigger the expected notifications.

### V4. Orders & fulfillment
- [ ] New customer order appears in vendor orders within 30s.
- [ ] Mark as shipped, with tracking number, reflects on customer-side order page.
- [ ] Partial fulfillment of a multi-line order behaves correctly.
- [ ] Cancellation and return flows complete and update both vendor and customer views.

### V5. Payouts & financials
- [ ] Earnings dashboard totals match the sum of completed orders minus fees.
- [ ] Payout history shows expected entries with dates and amounts.
- [ ] CSV export of earnings opens cleanly and totals match the dashboard.
- [ ] Tax / fee breakdown is itemized and matches the marketplace fee policy.

### V6. Vendor extensions
- [ ] Each configured extension key (see `docs/VENDOR_EXTENSION_DEFINITION_OF_DONE.md`) is reachable from the vendor panel.
- [ ] Extension save/load round-trips persist values across sessions.
- [ ] Removing an extension config doesn't leave the listing in a broken state.

### V7. Permissions & multi-user
- [ ] Inviting a teammate sends an email and lands them on a working invite-accept page.
- [ ] Role permissions (admin, manager, viewer) actually enforce on attempted actions.
- [ ] Removing a teammate revokes their session and access.

### V8. Notifications
- [ ] In-panel notifications appear for new orders, refunds, payouts.
- [ ] Email notifications match in-panel notifications and don't double-send.

## Filing findings

One GitHub bug per finding. Link to the specific vendor extension key (if applicable) and to the test plan section number.
