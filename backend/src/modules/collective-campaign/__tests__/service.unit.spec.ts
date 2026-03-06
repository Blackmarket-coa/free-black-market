import CollectiveCampaignModuleService from "../service"
import { BackingMode, CampaignStatus, CampaignType, PurchaseOrderStatus } from "../models"

describe("CollectiveCampaignModuleService", () => {
  it("createPurchaseOrdersFromMaterialLines is idempotent when purchase orders already exist", async () => {
    const existingOrders = [{ id: "po_existing" }]
    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", campaign_type: CampaignType.PRODUCTION_RUN, status: CampaignStatus.FUNDED },
      ]),
      listPurchaseOrders: jest.fn().mockResolvedValue(existingOrders),
      listMaterialLineItems: jest.fn(),
      createPurchaseOrders: jest.fn(),
      updateCampaigns: jest.fn(),
    }

    const result = await CollectiveCampaignModuleService.prototype.createPurchaseOrdersFromMaterialLines.call(
      ctx,
      "cc_1"
    )

    expect(result).toEqual(existingOrders)
    expect(ctx.listMaterialLineItems).not.toHaveBeenCalled()
    expect(ctx.createPurchaseOrders).not.toHaveBeenCalled()
    expect(ctx.updateCampaigns).not.toHaveBeenCalled()
  })

  it("recovers and returns existing purchase orders when concurrent create races", async () => {
    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", campaign_type: CampaignType.PRODUCTION_RUN, status: CampaignStatus.FUNDED },
      ]),
      listPurchaseOrders: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "po_after_race" }]),
      listMaterialLineItems: jest.fn().mockResolvedValue([
        {
          id: "li_1",
          supplier_url: "https://supplier.example/item",
          line_total_estimate: 250,
          auto_purchase_supported: true,
        },
      ]),
      createPurchaseOrders: jest.fn().mockRejectedValue(new Error("duplicate key value violates unique constraint")),
      updateCampaigns: jest.fn(),
    }

    const result = await CollectiveCampaignModuleService.prototype.createPurchaseOrdersFromMaterialLines.call(
      ctx,
      "cc_1"
    )

    expect(result).toEqual([{ id: "po_after_race" }])
    expect(ctx.updateCampaigns).not.toHaveBeenCalled()
  })

  it("creates purchase orders and updates campaign status when none exist", async () => {
    const lineItems = [
      {
        id: "li_1",
        supplier_url: "https://supplier.example/item",
        line_total_estimate: 250,
        auto_purchase_supported: true,
      },
    ]

    const ctx: any = {
      listCampaigns: jest.fn().mockResolvedValue([
        { id: "cc_1", campaign_type: CampaignType.PRODUCTION_RUN, status: CampaignStatus.FUNDED },
      ]),
      listPurchaseOrders: jest.fn().mockResolvedValue([]),
      listMaterialLineItems: jest.fn().mockResolvedValue(lineItems),
      createPurchaseOrders: jest.fn().mockResolvedValue([{ id: "po_1" }]),
      updateCampaigns: jest.fn().mockResolvedValue(undefined),
    }

    const result = await CollectiveCampaignModuleService.prototype.createPurchaseOrdersFromMaterialLines.call(
      ctx,
      "cc_1"
    )

    expect(ctx.createPurchaseOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        campaign_id: "cc_1",
        material_line_item_id: "li_1",
        status: PurchaseOrderStatus.AUTO_EXECUTED,
      }),
    ])
    expect(ctx.updateCampaigns).toHaveBeenCalledWith({
      id: "cc_1",
      status: CampaignStatus.SOURCING,
    })
    expect(result).toEqual([{ id: "po_1" }])
  })

  it("rolls back campaign and created line items when line item creation fails", async () => {
    const ctx: any = {
      createCampaign: jest.fn().mockResolvedValue({ id: "cc_rollback" }),
      addMaterialLineItem: jest
        .fn()
        .mockResolvedValueOnce({ id: "li_1" })
        .mockRejectedValueOnce(new Error("supplier ingest failed")),
      listCampaigns: jest.fn().mockResolvedValue([]),
      listMaterialLineItems: jest.fn().mockResolvedValue([{ id: "li_1" }]),
      deleteMaterialLineItems: jest.fn().mockResolvedValue(undefined),
      deleteCampaigns: jest.fn().mockResolvedValue(undefined),
    }

    await expect(
      CollectiveCampaignModuleService.prototype.createCampaignWithMaterialLineItems.call(ctx, {
        campaign: {
          vendor_id: "vendor_1",
          name: "Campaign",
          description: "Test",
          campaign_type: CampaignType.PRODUCTION_RUN,
          maker_fee: 10,
        },
        material_line_items: [
          {
            item_name: "cotton",
            supplier_url: "https://supplier.example/cotton",
            unit_cost_at_listing: 5,
            quantity_per_full_campaign: 10,
          },
          {
            item_name: "dye",
            supplier_url: "https://supplier.example/dye",
            unit_cost_at_listing: 3,
            quantity_per_full_campaign: 5,
          },
        ],
      })
    ).rejects.toThrow("supplier ingest failed")

    expect(ctx.listMaterialLineItems).toHaveBeenCalledWith({ campaign_id: "cc_rollback" })
    expect(ctx.deleteMaterialLineItems).toHaveBeenCalledWith("li_1")
    expect(ctx.deleteCampaigns).toHaveBeenCalledWith("cc_rollback")
  })

  it("updates to FUNDED and triggers PO creation when backing hits goal", async () => {
    const ctx: any = {
      listCampaigns: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "cc_1",
            campaign_goal: 100,
            return_cap_multiplier: 2,
            status: CampaignStatus.ACTIVE,
          },
        ])
        .mockResolvedValueOnce([{ id: "cc_1", status: CampaignStatus.ACTIVE }]),
      createBackings: jest.fn().mockResolvedValue([{ id: "b_1" }]),
      listBackings: jest.fn().mockResolvedValue([
        { mode: BackingMode.PRE_ORDER, amount: 100 },
      ]),
      updateCampaigns: jest.fn().mockResolvedValue(undefined),
      createPurchaseOrdersFromMaterialLines: jest.fn().mockResolvedValue([]),
    }

    await CollectiveCampaignModuleService.prototype.addBacking.call(ctx, {
      campaign_id: "cc_1",
      backer_id: "backer_1",
      mode: BackingMode.PRE_ORDER,
      amount: 100,
    })

    expect(ctx.updateCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cc_1", total_backed_amount: 100 })
    )
    expect(ctx.updateCampaigns).toHaveBeenCalledWith({ id: "cc_1", status: CampaignStatus.FUNDED })
    expect(ctx.createPurchaseOrdersFromMaterialLines).toHaveBeenCalledWith("cc_1")
  })
})
