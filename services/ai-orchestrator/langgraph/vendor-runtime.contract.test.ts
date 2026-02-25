import test from "node:test";
import assert from "node:assert/strict";

import { buildLangGraphSupervisorEntrypoint } from "./supervisor-agent.entrypoint";
import { VENDOR_SAFE_TOOL_SCHEMAS } from "./vendor-tool-registry";

test("accepts valid vendor onboarding tool payload", () => {
  const entrypoint = buildLangGraphSupervisorEntrypoint(
    VENDOR_SAFE_TOOL_SCHEMAS,
  );

  const result = entrypoint.validateToolCall({
    action: "create_vendor",
    parameters: {
      business_name: "Acme Farms",
      contact_email: "owner@acme.test",
      country_code: "US",
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("rejects missing required product fields", () => {
  const entrypoint = buildLangGraphSupervisorEntrypoint(
    VENDOR_SAFE_TOOL_SCHEMAS,
  );

  const result = entrypoint.validateToolCall({
    action: "create_product",
    parameters: {
      title: "Draft Product",
      currency_code: "usd",
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("Missing required parameter: description"));
  assert.ok(result.errors.includes("Missing required parameter: price"));
});

test("rejects destructive delete without confirmation gate", () => {
  const entrypoint = buildLangGraphSupervisorEntrypoint(
    VENDOR_SAFE_TOOL_SCHEMAS,
  );

  const result = entrypoint.canExecuteDestructiveAction("delete_product", {
    explicitIntentInCurrentThread: true,
    impactSummarized: false,
    explicitConfirmationTurn: false,
    scopeChangedAfterConfirmation: false,
    reconfirmedAfterScopeChange: false,
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.includes(
      "Destructive action requires impact summary before execution",
    ),
  );
  assert.ok(
    result.errors.includes(
      "Destructive action requires explicit confirmation turn",
    ),
  );
});
