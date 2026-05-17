# Manual Test Plan: Storefront

Customer-facing web application (`storefront/`). Test against `<STAGING_URL>` unless instructed otherwise.

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts — distinct from the *release blackout windows* concept used elsewhere in this repository.

## Before you start

- Read `TESTING.md` at the repo root.
- Claim the sections you're working on in `#testing-claims` on Blackout Community.
- Have a clean browser session (private/incognito window) so cached auth doesn't mask bugs.
- Test on at least one desktop and one mobile viewport per claimed section.

## Severity guidance

Use these definitions when filling the severity dropdown on the bug report:

- **Critical** — blocks purchase, exposes data, or breaks payment.
- **High** — major feature unusable (search returns nothing, cart loses items).
- **Medium** — feature works but with significant friction or visual breakage.
- **Low** — copy, polish, minor visual inconsistencies.

## Sections

### S1. Browse & discovery
- [ ] Home page loads under 3s on a cold cache.
- [ ] Featured collections render with images and prices.
- [ ] Category navigation shows correct counts and filters.
- [ ] Pagination / infinite scroll behaves correctly at boundaries (first/last page).
- [ ] Empty category state is handled (placeholder copy, not an error).

### S2. Search
- [ ] Single-word search returns relevant results.
- [ ] Multi-word and quoted search behave as expected.
- [ ] Misspellings return fuzzy matches or a "no results" state — not an error.
- [ ] Filters (price, vendor, category) combine correctly and clear individually.
- [ ] Sort options (price asc/desc, newest, relevance) actually change ordering.

### S3. Product detail page (PDP)
- [ ] Image gallery works on mouse, touch, and keyboard navigation.
- [ ] Variant selectors (size, color, etc.) update price, inventory, and image.
- [ ] Out-of-stock variants are clearly disabled.
- [ ] Vendor info, shipping estimates, and return policy are present.
- [ ] Add-to-cart shows confirmation and updates cart count.

### S4. Cart
- [ ] Add, update quantity, and remove items reflect immediately.
- [ ] Cart survives a page reload (logged in and logged out).
- [ ] Cart from one device merges sensibly when logging in on another.
- [ ] Promo / discount codes apply, stack rules behave as documented, and invalid codes show clear errors.
- [ ] Shipping estimate updates with destination.

### S5. Checkout
- [ ] Guest checkout works end-to-end.
- [ ] Logged-in checkout pre-fills saved addresses and payment methods.
- [ ] Card validation rejects bad numbers, expired dates, bad CVV inline (no submit required).
- [ ] Test payment with the staging payment provider succeeds.
- [ ] Order confirmation page and confirmation email both arrive within 60s.
- [ ] Inventory decrements correctly across two concurrent checkouts of the last item.

### S6. Account
- [ ] Sign up, log in, log out work across email/password and any social providers.
- [ ] Password reset email arrives and the link works once.
- [ ] Address book CRUD persists across sessions.
- [ ] Order history shows past orders with correct totals and statuses.
- [ ] Account deletion / data export flow (if applicable) works without orphaning data.

### S7. Returns & support
- [ ] Initiate-return flow from order detail works.
- [ ] Return status updates are visible to the customer.
- [ ] Contact / help links resolve to working pages.

### S8. Accessibility & mobile
- [ ] All interactive elements are reachable by keyboard only.
- [ ] Visible focus states on every interactive element.
- [ ] Screen reader announces page changes (use VoiceOver / NVDA / TalkBack for at least one section).
- [ ] Tap targets ≥ 44px on mobile.
- [ ] No horizontal scroll on viewport widths down to 320px.

### S9. Performance & errors
- [ ] Open browser devtools network tab — note any 4xx/5xx responses on a normal browsing flow.
- [ ] No uncaught console errors on any page in the happy path.
- [ ] Lazy-loaded images don't cause layout shift on slow connections.

## Filing findings

One GitHub bug per finding. At session end, also file a [test session report](../../.github/ISSUE_TEMPLATE/test_session_report.yml) that links to each bug and notes overall impressions.
