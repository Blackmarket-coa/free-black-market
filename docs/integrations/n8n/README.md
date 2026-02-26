# Hermes n8n workflow (drag-and-drop import)

Use `hermes-vendor-runtime.workflow.json` to import a production-ready n8n gateway for the Hermes vendor runtime.

## What this workflow includes

- Webhook ingress for Hermes tool-mode payloads (`tool_call` + optional `confirmation`).
- Action routing for all currently supported vendor-safe actions:
  - `create_vendor`
  - `create_product`
  - `delete_product`
- Parameter schema validation that mirrors backend Hermes supervisor constraints.
- Destructive-action confirmation gating for `delete_product`.
- Forwarding to backend `POST /vendor/hermes/runtime` with vendor auth header support.
- Consistent JSON responses (instead of node execution crashes) for:
  - envelope validation errors,
  - unknown actions,
  - action-level schema/confirmation errors,
  - backend passthrough responses.

## Railway deployment (n8n with workers)

If you’re deploying n8n on Railway, use Railway’s n8n-with-workers template:

- https://railway.com/deploy/n8n-with-workers

This workflow is compatible with worker mode because it is webhook-driven and stateless.

### Recommended n8n environment variables

- `HERMES_BACKEND_URL` (default in workflow: `http://localhost:9000/vendor/hermes/runtime`)
- `HERMES_VENDOR_AUTH_HEADER` (example: `Bearer <seller-jwt-or-session-token>`)

For Railway/public deployment, also ensure your n8n webhook base URL is set correctly (for example with `WEBHOOK_URL`) so external callers can reach the webhook endpoint.

## Import steps

1. In n8n, open **Workflows → Import from File**.
2. Select `docs/integrations/n8n/hermes-vendor-runtime.workflow.json`.
3. Save the workflow.
4. Configure `HERMES_BACKEND_URL` and `HERMES_VENDOR_AUTH_HEADER` in your n8n environment.
5. Activate the workflow.
6. Send `POST` requests to the generated webhook URL.

## Example request

```json
{
  "tool_call": {
    "action": "create_product",
    "parameters": {
      "title": "Draft product",
      "description": "Hermes generated draft",
      "price": 19.99,
      "currency_code": "usd",
      "inventory_quantity": 10
    }
  }
}
```

## Example validation-error response

```json
{
  "statusCode": 400,
  "ok": false,
  "mode": "tool",
  "errors": ["Missing required parameter: currency_code"]
}
```
