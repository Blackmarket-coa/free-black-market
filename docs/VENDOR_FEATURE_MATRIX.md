# Vendor Feature Matrix

This matrix summarizes the current vendor-facing capability set across the platform and highlights delivery status.

**Legend:**
- ✅ Available now
- 🟡 Partial / limited implementation
- 🚧 Planned / not delivered

| Capability | Backend | Vendor Panel | Storefront | Status | Notes / Evidence |
|---|---|---|---|---|---|
| Vendor onboarding and registration | ✅ | ✅ | 🟡 | 🟡 | Signup and vendor-facing entry points exist; fast-track onboarding improvements are still tracked as pending work. |
| Product management | ✅ | ✅ | ✅ | ✅ | Vendor product CRUD is called out as core Vendor Panel functionality and visible in storefront flows. |
| Inventory management | ✅ | ✅ | 🟡 | 🟡 | Inventory is wired as a vendor extension/capability, but broader inventory workflow expansion is still documented as ongoing. |
| Order tracking and fulfillment | ✅ | ✅ | ✅ | ✅ | Vendor Panel explicitly supports order tracking; order lifecycle appears across marketplace surfaces. |
| Store customization / vendor profile | ✅ | ✅ | ✅ | ✅ | Vendor Panel supports store detail updates and storefront exposes vendor experience. |
| Reviews and feedback handling | ✅ | ✅ | ✅ | ✅ | Review handling is listed as a vendor capability and mapped to customer-facing experience. |
| Vendor analytics dashboard | ✅ | ✅ | 🟡 | 🟡 | Analytics is present in vendor UI scope, with additional operational expansion still tracked in planning docs. |
| Vendor extension feature flags (type-specific modules) | ✅ | ✅ | N/A | ✅ | Extension-key runtime wiring completeness is marked complete in the vendor modules/extensions audit. |
| Support center / case management | 🟡 | 🟡 | N/A | 🚧 | Explicitly listed in the build plan as a planned vendor support center deliverable. |
| Vendor invoicing and credits | 🟡 | 🟡 | N/A | 🚧 | Listed in planned capabilities as vendor invoice creation, payment marking, and credit issuance. |
| POS mode (tablet-friendly) | 🟡 | 🟡 | N/A | 🚧 | Included as planned vendor panel capability (`/pos`) with POS workflows. |
| Marketing hub / campaign tooling | 🟡 | 🟡 | N/A | 🚧 | Planned vendor marketing and campaign workflows are documented but not marked complete. |

## Source Documents

- `vendor-panel/README.md`
- `FEATURE_BUILD_PLAN.md`
- `VENDOR_MODULES_EXTENSIONS_AUDIT.md`

## Update Guidance

When updating this matrix, keep statuses aligned with:
1. Released behavior in `vendor-panel`, `backend`, and `storefront` code.
2. Current delivery state in `FEATURE_BUILD_PLAN.md`.
3. Audit/QA evidence in root and `docs/` reports.
