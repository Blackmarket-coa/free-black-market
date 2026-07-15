# Custom Workflows

Medusa workflows composing multi-step, compensatable operations across
modules. (Generic how-to:
<https://docs.medusajs.com/learn/fundamentals/workflows>.)

Inventory by area:

- **Vendor/seller lifecycle**: `assign-playbook`, `create-seller-metadata`,
  `send-vendor-accepted-notification`, `send-customer-accepted-notification`,
  `user/`
- **Products & catalog**: `launch-product`, `launch-sponsorship`,
  `product-feed/`, `sync-lot-inventory`
- **Digital products**: `create-digital-product`,
  `create-digital-product-order`, `fulfill-digital-order`,
  `delete-product-digital-products`
- **Ticketing & venues**: `create-ticket-product`, `create-venue`,
  `complete-cart-with-tickets`, `verify-ticket-purchase`
- **Rentals**: `rental/`
- **Subscriptions**: `subscription/`
- **Collective commerce**: `collective-purchase/` (demand pools),
  `bargaining/`, `governance/` (proposals/votes)
- **Farm & food**: `harvest/` (allocate/claim), `food-distribution/`
  (delivery lifecycle), `restaurant/`
- **Delivery**: `delivery/` (create/claim/handle/update by drivers)
- **Volunteering**: `volunteer/` (log/verify hours)
- **POS**: `pos/`
- **Imports & integrations**: `woocommerce-import/`, `odoo-import/`,
  `printful/`
- **Shared plumbing**: `hooks/` (workflow hooks, e.g. cart credit
  reservations), `steps/` (reusable steps)

For module context behind each workflow, see
[`docs/MODULE_CATALOG.md`](../../../docs/MODULE_CATALOG.md).
