# Storefront Audit Report

**Date:** 2026-02-02
**Scope:** `/storefront/src/` directory
**Summary:** This audit reviews the storefront Next.js application for security posture, data-fetching patterns, type safety, and code quality issues. The assessment surfaced medium-severity type safety gaps and a small set of TODOs, alongside low-severity logging and observability concerns.

---

## Executive Summary

The storefront is a feature-rich Next.js app with solid structure and defensive HTML sanitization for user-generated content. The main weaknesses are widespread `any` usage, console logging in production pathways, and a handful of TODOs indicating incomplete behavior.

| Category | Severity | Issues Found |
|----------|----------|--------------|
| Type Safety | Medium | 158 uses of `any` in runtime code |
| Incomplete Features | Medium | 4 TODO markers |
| Console Statements | Low | 54 console.log/warn/error statements in production code |
| Configuration Logging | Low | Server logs include publishable key prefix and backend URL |

---

## Critical Issues

No critical issues identified in this audit.

---

## Medium Severity Issues

### 1. Type Safety Gaps

**158 instances of `any`** were found across data helpers, API adapters, and UI components.

Hotspots include:
- Pricing helpers (`src/lib/helpers/get-product-price.ts`, `src/lib/helpers/get-seller-product-price.ts`)
- Cart, orders, and reviews data access (`src/lib/data/*`)
- Order return and shipping UI components (`src/components/sections/OrderReturnSection/*`, `src/components/sections/CartShippingMethodsSection/*`)

**Recommendation:** Prioritize replacing `any` in data-fetching modules and shared helpers with explicit Medusa or storefront interfaces to reduce runtime errors and improve developer tooling.

---

### 2. Incomplete Features (TODOs)

**4 TODO markers** indicate unfinished behavior:

| Feature | Location | Description |
|---------|----------|-------------|
| Order list pagination | `src/app/[locale]/(main)/user/orders/page.tsx` | Pagination TODO in order history view |
| Cart data shape handling | `src/lib/data/cart.ts` | TODO: pass POJO instead of form entity |
| Sell signup flow | `src/app/[locale]/(main)/sell/page.tsx` | TODO: integrate with signup API |
| Order details status source | `src/components/organisms/OrderDefails/OrderDetails.tsx` | TODO: verify status source |

**Recommendation:** Track these TODOs in a backlog and resolve the order history pagination and sell signup integration first, as they have direct user-facing impact.

---

## Low Severity Issues

### 3. Console Statements in Production Code

**54 console statements** exist in runtime code, including network error logging and debug output in UI components.

Notable locations:
- Request wrappers and data handlers (`src/lib/config.ts`, `src/lib/data/*`)
- Server/middleware logs (`src/middleware.ts`, `src/app/[locale]/(main)/page.tsx`)
- UI sections for vendor lists and messaging (`src/components/sections/*`)

**Recommendation:** Replace `console.*` calls with a centralized logger with environment gating to prevent noisy logs in production.

---

### 4. Configuration Logging

Startup logs expose the backend URL and a publishable key prefix (`src/lib/config.ts`). While the publishable key is public, logging it (even partially) can leak operational details in shared logs.

**Recommendation:** Guard configuration logs behind a development-only check or remove them for production builds.

---

## Security Audit

### User-Generated HTML Sanitization

The storefront uses `DOMPurify` to sanitize seller descriptions and product details before rendering with `dangerouslySetInnerHTML`, reducing XSS risk in those areas.

**Potential Improvements**
1. **Centralize sanitization** to reduce the chance of a future unsafe rendering bypass.
2. **Audit CMS/JSON-LD inputs** for any HTML sources that bypass sanitization (most JSON-LD uses `JSON.stringify`, which is safe).

---

## Architecture Observations

### Strengths

1. Clear separation of UI sections, molecules, and data access modules.
2. Server-first patterns in Next.js for metadata and data fetching.
3. Existing sanitization for HTML content.

### Areas for Improvement

1. Replace pervasive `any` usage with shared types.
2. Standardize logging and error reporting.
3. Convert TODOs into tracked backlog items.

---

## Recommendations Summary

### Short-term Actions (Medium Priority)
1. Reduce `any` usage in data helpers and key UI components.
2. Resolve TODOs in order history pagination and sell signup flow.

### Long-term Actions (Low Priority)
1. Implement centralized logging with environment gating.
2. Remove or gate configuration logging in production.
3. Expand automated tests around order returns and cart flows.

---

## Files Reviewed

- `src/lib/config.ts`
- `src/lib/data/*`
- `src/lib/helpers/*`
- `src/components/sections/OrderReturnSection/*`
- `src/components/sections/CartShippingMethodsSection/*`
- `src/app/[locale]/(main)/user/orders/page.tsx`
- `src/app/[locale]/(main)/sell/page.tsx`

---

*Report generated as part of the storefront audit - February 2026*

---

## Addendum — May 2026 — Unified retail/marketplace presentation (§5.1)

The storefront now ships an explicit retail vs marketplace presentation split per AGGRESSIVE_OPERATIONS_GUIDE.md §1.1. Same listing data, different chrome:

- `src/lib/listing/presentation.ts` — pure `selectPresentation()` selector. Inputs: `routeKind`, storefront context, seller handle, optional coalition-membership flag. Outputs: `"retail"` or `"marketplace"`.
- `src/components/sections/ProductDetailsPage/ProductDetailsPage.tsx` — accepts a `presentation` prop. Marketplace renders the "More from this seller" section; retail omits it.
- `src/app/[locale]/(main)/products/[handle]/page.tsx` — `routeKind: "products"`, defaults to marketplace.
- `src/app/[locale]/(main)/shop/[handle]/page.tsx` — `routeKind: "shop"`, defaults to retail. Coalition-storefront-context cookie still forces marketplace.
- `src/app/[locale]/(main)/shop/page.tsx` — public retail landing.

Tests: `src/__tests__/presentation.test.ts` covers the seven branches of the selector.

This addendum closes the §5.1 unified-presentation workstream; downstream styling work on the retail browse experience is deferred to differentiation milestone.

---

## Addendum — May 2026 — Capacitor / in-app webview embed (§5.1)

The storefront now accepts embedding from the Blackout Capacitor wrapper per AGGRESSIVE_OPERATIONS_GUIDE.md §2.8. Origin-allowlisted, opt-in only:

- `src/lib/runtime/embed-context.ts` — `detectEmbedContext(headers)` returns `{ isEmbedded, origin, isAllowedOrigin }` based on the `X-FBM-Embed-Origin` header and the `BLACKOUT_EMBED_ALLOWED_ORIGINS` env var.
- `src/middleware.ts` — `applyEmbedHeaders` swaps `X-Frame-Options: SAMEORIGIN` for `Content-Security-Policy: frame-ancestors <origin>` when (and only when) the request comes from an allowlisted embed origin.
- `src/app/api/auth/embed-bootstrap/route.ts` — POST endpoint accepting a Blackout-issued JWT, sets `_medusa_jwt` cookie scoped to the webview session. JWS verification deferred until Blackout publishes the signing pubkey to pin.
- `.env.production.example` — `BLACKOUT_EMBED_ALLOWED_ORIGINS` slot added.

Tests: `src/__tests__/embed-context.test.ts` covers the detector's six branches.

Runbook: `docs/runbooks/STOREFRONT_CAPACITOR_EMBED.md` documents the handshake, allowlist, bootstrap, manual test path, and known limitations.
