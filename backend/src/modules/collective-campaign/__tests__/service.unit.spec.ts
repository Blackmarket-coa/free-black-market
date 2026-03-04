import CollectiveCampaignModuleService from "../service"
import { CampaignStatus, CampaignType, PurchaseOrderStatus } from "../models"

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
})
