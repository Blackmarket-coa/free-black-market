import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

type SyncLotInventoryInput = {
  lot_id: string;
  product_variant_id: string;
  location_id: string;
};

type SyncResult = {
  synced: boolean;
  inventory_item_id?: string;
  quantity?: number;
  reason?: string;
};

/**
 * Step: Get lot quantity details
 */
const getLotQuantityStep = createStep(
  "get-lot-quantity",
  async (input: SyncLotInventoryInput, { container }) => {
    const query = container.resolve("query");
    const _logger = container.resolve("logger");

    const { data: lots } = await query.graph({
      entity: "lot",
      fields: ["id", "quantity_available", "quantity_reserved", "unit"],
      filters: {
        id: input.lot_id,
      },
    });

    if (!lots || lots.length === 0) {
      throw new Error(`Lot ${input.lot_id} not found`);
    }

    const lot = lots[0] as {
      id: string;
      quantity_available: number;
      quantity_reserved: number;
      unit: string;
    };

    return new StepResponse({
      lot_id: input.lot_id,
      quantity_available: lot.quantity_available,
      quantity_reserved: lot.quantity_reserved,
      unit: lot.unit,
    });
  },
);

/**
 * Step: Update Medusa inventory item levels
 */
const updateInventoryStep = createStep(
  "update-medusa-inventory",
  async (
    input: {
      lot_id: string;
      product_variant_id: string;
      location_id: string;
      quantity_available: number;
      quantity_reserved: number;
    },
    { container },
  ): Promise<StepResponse<SyncResult>> => {
    const inventoryService = container.resolve("inventory") as {
      updateInventoryLevels: (
        data: {
          inventory_item_id: string;
          location_id: string;
          stocked_quantity: number;
          reserved_quantity: number;
        }[],
      ) => Promise<unknown>;
    };
    const query = container.resolve("query");
    const logger = container.resolve("logger");

    // Get inventory item for the variant
    const { data: variantInventory } = await query.graph({
      entity: "product_variant_inventory_item",
      fields: ["inventory_item_id"],
      filters: {
        variant_id: input.product_variant_id,
      },
    });

    if (!variantInventory || variantInventory.length === 0) {
      // No inventory item linked to this variant yet
      logger.warn(
        `No inventory item found for variant ${input.product_variant_id}`,
      );
      return new StepResponse({ synced: false, reason: "no_inventory_item" });
    }

    const inventoryItemId = (
      variantInventory[0] as { inventory_item_id: string }
    ).inventory_item_id;

    // Update the inventory levels
    try {
      await inventoryService.updateInventoryLevels([
        {
          inventory_item_id: inventoryItemId,
          location_id: input.location_id,
          stocked_quantity: input.quantity_available + input.quantity_reserved,
          reserved_quantity: input.quantity_reserved,
        },
      ]);

      logger.info(
        `[Lot Sync Workflow] ${JSON.stringify({ lot_id: input.lot_id, variant_id: input.product_variant_id, location_id: input.location_id, inventory_item_id: inventoryItemId, quantity_available: input.quantity_available, quantity_reserved: input.quantity_reserved, synced: true })}`,
      );

      return new StepResponse({
        synced: true,
        inventory_item_id: inventoryItemId,
        quantity: input.quantity_available,
      });
    } catch (error) {
      logger.error(`Failed to update inventory: ${error}`);
      return new StepResponse({ synced: false, reason: "update_failed" });
    }
  },
);

/**
 * Workflow: Sync lot inventory to Medusa product variant
 *
 * This workflow synchronizes the available quantity from a lot
 * to the linked Medusa product variant's inventory.
 */
export const syncLotInventoryWorkflow = createWorkflow(
  "sync-lot-inventory",
  (input: SyncLotInventoryInput) => {
    const lotData = getLotQuantityStep(input);

    const result = updateInventoryStep({
      lot_id: input.lot_id,
      product_variant_id: input.product_variant_id,
      location_id: input.location_id,
      quantity_available: lotData.quantity_available,
      quantity_reserved: lotData.quantity_reserved,
    });

    return new WorkflowResponse(result);
  },
);

export default syncLotInventoryWorkflow;
