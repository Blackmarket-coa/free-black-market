# Custom Modules

FBM's backend logic lives in 79 custom Medusa modules in this directory —
commerce verticals (restaurant, rental, ticketing, digital products,
subscriptions), the cooperative-economy substrate (playbook, listing-type,
hawala-ledger, asset-graph), creator commerce, community systems
(governance, progression, quests), integrations (WooCommerce, Odoo,
Printful, MinIO, Resend/SMTP), and platform infrastructure (tenancy,
entitlements, webhooks, embed keys).

**The full inventory — one row per module with purpose, key routes/jobs, and
doc links — is [`docs/MODULE_CATALOG.md`](../../../docs/MODULE_CATALOG.md).**
Keep it updated when adding or materially changing a module.

Conventions:

- Every module has an `index.ts` exporting its definition and a `service.ts`
  with its main service; data models live in `models/`, tests in
  `__tests__/`.
- Anything that moves money must honor the invariants in
  [`docs/POSTURE_A_COMPLIANCE.md`](../../../docs/POSTURE_A_COMPLIANCE.md)
  and route value movement through `hawala-ledger` rather than moving it
  directly.
- Generic how-to for writing a Medusa module:
  <https://docs.medusajs.com/learn/fundamentals/modules>
