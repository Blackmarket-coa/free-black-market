# Manual Test Plan: Admin Panel

Operator dashboard (`admin-panel/`). Requires staff-level credentials — request in `#testing-claims` on Blackout Community.

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts — distinct from the *release blackout windows* concept used elsewhere in this repository. The "blackout window" section below tests the *release* sense of the word.

## Before you start

- Read `TESTING.md` at the repo root.
- Coordinate destructive operations (approvals, payouts, bans) with `#testing-claims` so they don't disrupt other testers.
- Have a vendor-side and customer-side session ready to verify that admin actions take effect.

## Severity guidance

- **Critical** — admin action causes data loss, double payout, or exposes data.
- **High** — admin workflow blocks operations (can't approve vendors, can't process refunds).
- **Medium** — workaround exists; metrics inaccurate; reporting broken.
- **Low** — copy, polish, layout.

## Sections

### A1. Authentication & access control
- [ ] Admin login requires MFA (if configured) and rejects bypass attempts.
- [ ] Session timeout occurs at the expected interval.
- [ ] Role-based access blocks lower-privilege admins from staff-only actions.
- [ ] Audit log records every privileged action with actor, target, timestamp.

### A2. Vendor approvals
- [ ] Pending vendor queue shows the correct list, ordered by submission time.
- [ ] Approve / reject actions update vendor status and send the expected emails.
- [ ] Reject with reason captures the reason in the audit log and shows it to the vendor.

### A3. Moderation
- [ ] Flagged listings appear in the moderation queue with the reporter info.
- [ ] Takedown action removes the listing from storefront within 60s.
- [ ] Restore action returns the listing intact.
- [ ] Bulk moderation actions confirm before executing and report per-item results.

### A4. Payout operations
- [ ] Vendor payout schedule reflects the configured cadence.
- [ ] Manual payout trigger requires explicit confirmation.
- [ ] Failed payouts are visible with reason and retry option.
- [ ] Payout reports reconcile against vendor-side earnings.

### A5. Release blackout windows
*Note: this section tests the **release blackout** concept (see `docs/blackout_centralized_build_work_order.md`), not Blackout Community.*
- [ ] Configured blackout windows show in the admin schedule view.
- [ ] Deploy / migration controls are disabled during an active blackout window.
- [ ] Override flow (with reason capture) is gated to a specific role.
- [ ] Blackout-end notifications fire on schedule.

### A6. Reporting & analytics
- [ ] GMV, order count, refund rate dashboards match raw query exports.
- [ ] Date range filters apply correctly across all widgets.
- [ ] CSV / PDF export of any report opens cleanly.

### A7. Customer support actions
- [ ] Customer lookup by email, order id, or vendor returns within 2s.
- [ ] Refund (full and partial) from admin reflects on storefront order detail.
- [ ] Account disable / re-enable propagates to all sessions for that user.

### A8. System health
- [ ] Health / status page shows live service indicators.
- [ ] Background job queue depth is visible and matches the actual queue.
- [ ] Recent errors / exception feed is accessible without leaving the panel.

## Filing findings

One GitHub bug per finding. For audit-sensitive issues (data exposure, privilege escalation), file via [GitHub Security Advisory](../../SECURITY.md), not a public bug report.
