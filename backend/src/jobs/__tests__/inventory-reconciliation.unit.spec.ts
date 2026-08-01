/**
 * Inventory reconciliation job — §3 inventory.low emission.
 *
 * The vendor for a low-stock SKU is resolved through the module link
 * inventory_item ⇄ product_variant, then variant → product → seller (the
 * old code read a seller id from inventory-item metadata, which never
 * exists, so nothing ever emitted). Items whose seller cannot be resolved
 * are skipped without failing the run.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import inventoryReconciliationJob from "../inventory-reconciliation";
import { WOOCOMMERCE_IMPORT_MODULE } from "../../modules/woocommerce-import";
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks";

type GraphArg = {
  entity: string;
  fields?: string[];
  filters?: Record<string, unknown>;
};

const makeContainer = ({
  inventoryItems = [],
  lots = [],
  variantLinks = [],
  wooConnections = [],
}: {
  inventoryItems?: Array<Record<string, unknown>>;
  lots?: Array<Record<string, unknown>>;
  variantLinks?: Array<Record<string, unknown>>;
  wooConnections?: Array<Record<string, unknown>>;
} = {}) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const webhooks = { emitBlackout: jest.fn(async () => ({ id: "whd_1" })) };
  const wooService = {
    listWooCommerceConnections: jest.fn(async () => wooConnections),
  };
  const query = {
    graph: jest.fn(async ({ entity }: GraphArg) => {
      if (entity === "inventory_item") return { data: inventoryItems };
      if (entity === "lot") return { data: lots };
      if (entity === "product_variant_inventory_item") {
        return { data: variantLinks };
      }
      throw new Error(`unexpected graph entity: ${entity}`);
    }),
  };
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger;
      if (key === ContainerRegistrationKeys.QUERY) return query;
      if (key === WOOCOMMERCE_IMPORT_MODULE) return wooService;
      if (key === MARKETPLACE_WEBHOOKS_MODULE) return webhooks;
      throw new Error(`unexpected resolve: ${key}`);
    },
  } as unknown as MedusaContainer;
  return { container, logger, webhooks, query };
};

describe("inventory reconciliation job — inventory.low", () => {
  const origThreshold = process.env.FBM_INVENTORY_LOW_THRESHOLD;
  beforeEach(() => {
    delete process.env.FBM_INVENTORY_LOW_THRESHOLD;
  });
  afterAll(() => {
    if (origThreshold === undefined) {
      delete process.env.FBM_INVENTORY_LOW_THRESHOLD;
    } else {
      process.env.FBM_INVENTORY_LOW_THRESHOLD = origThreshold;
    }
  });

  it("emits inventory.low with the seller resolved through the variant link", async () => {
    const { container, logger, webhooks, query } = makeContainer({
      inventoryItems: [
        { id: "iitem_1", sku: "SKU-1", stocked_quantity: 3, reserved_quantity: 0 },
      ],
      variantLinks: [
        {
          inventory_item_id: "iitem_1",
          variant: { product: { seller: { id: "seller_1" } } },
        },
      ],
    });

    await inventoryReconciliationJob(container);

    expect(webhooks.emitBlackout).toHaveBeenCalledTimes(1);
    expect(webhooks.emitBlackout).toHaveBeenCalledWith(
      "inventory.low",
      {
        vendorId: "seller_1",
        sku: "SKU-1",
        title: "SKU-1",
        remaining: 3,
        threshold: 5,
      },
      { eventId: "inventory.low:iitem_1:3" },
    );

    // one batched link query, filtered to the low-stock item ids
    const linkCall = query.graph.mock.calls
      .map((call) => call[0] as GraphArg)
      .find((arg) => arg.entity === "product_variant_inventory_item");
    expect(linkCall).toBeDefined();
    expect(linkCall?.fields).toEqual([
      "inventory_item_id",
      "variant.product.seller.id",
    ]);
    expect(linkCall?.filters).toEqual({ inventory_item_id: ["iitem_1"] });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips low-stock items whose seller cannot be resolved", async () => {
    const { container, logger, webhooks } = makeContainer({
      inventoryItems: [
        // link row exists but carries no seller
        { id: "iitem_1", sku: "SKU-1", stocked_quantity: 1, reserved_quantity: 0 },
        // no link row at all
        { id: "iitem_2", sku: "SKU-2", stocked_quantity: 2, reserved_quantity: 0 },
        // resolvable seller but no sku
        { id: "iitem_3", sku: null, stocked_quantity: 0, reserved_quantity: 0 },
      ],
      variantLinks: [
        { inventory_item_id: "iitem_1", variant: { product: { seller: null } } },
        {
          inventory_item_id: "iitem_3",
          variant: { product: { seller: { id: "seller_3" } } },
        },
      ],
    });

    await inventoryReconciliationJob(container);

    expect(webhooks.emitBlackout).not.toHaveBeenCalled();
    // skipping is silent — the run still completes without errors
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("neither emits nor queries the link when no item is at/below the threshold", async () => {
    const { container, webhooks, query } = makeContainer({
      inventoryItems: [
        { id: "iitem_1", sku: "SKU-1", stocked_quantity: 100, reserved_quantity: 0 },
        // reserved > stocked => negative remaining is drift, not "low"
        { id: "iitem_2", sku: "SKU-2", stocked_quantity: 1, reserved_quantity: 5 },
      ],
    });

    await inventoryReconciliationJob(container);

    expect(webhooks.emitBlackout).not.toHaveBeenCalled();
    const linkCall = query.graph.mock.calls
      .map((call) => call[0] as GraphArg)
      .find((arg) => arg.entity === "product_variant_inventory_item");
    expect(linkCall).toBeUndefined();
  });

  it("honors FBM_INVENTORY_LOW_THRESHOLD", async () => {
    process.env.FBM_INVENTORY_LOW_THRESHOLD = "1";
    const { container, webhooks } = makeContainer({
      inventoryItems: [
        { id: "iitem_1", sku: "SKU-1", stocked_quantity: 3, reserved_quantity: 0 },
        { id: "iitem_2", sku: "SKU-2", stocked_quantity: 1, reserved_quantity: 0 },
      ],
      variantLinks: [
        {
          inventory_item_id: "iitem_1",
          variant: { product: { seller: { id: "seller_1" } } },
        },
        {
          inventory_item_id: "iitem_2",
          variant: { product: { seller: { id: "seller_2" } } },
        },
      ],
    });

    await inventoryReconciliationJob(container);

    expect(webhooks.emitBlackout).toHaveBeenCalledTimes(1);
    expect(webhooks.emitBlackout).toHaveBeenCalledWith(
      "inventory.low",
      expect.objectContaining({
        vendorId: "seller_2",
        sku: "SKU-2",
        remaining: 1,
        threshold: 1,
      }),
      { eventId: "inventory.low:iitem_2:1" },
    );
  });
});
