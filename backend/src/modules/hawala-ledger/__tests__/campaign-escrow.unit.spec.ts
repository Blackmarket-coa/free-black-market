import HawalaLedgerModuleService from "../service"

// Prototype-call unit tests (no DB): every campaign escrow move must flow
// through createTransfer with a deterministic idempotency key, and integer
// cents at the boundary are converted to major units (cents / 100).
describe("HawalaLedgerModuleService campaign escrow wrappers", () => {
  const wallet = { id: "acc_wallet" }
  const escrow = { id: "acc_escrow" }

  const accountLister = (accounts: Record<string, any[]>) =>
    jest.fn(async (filter: { account_type: string }) => accounts[filter.account_type] ?? [])

  describe("openCampaignBackingEscrow", () => {
    it("throws when amountCents <= 0", async () => {
      const ctx: any = { listLedgerAccounts: jest.fn(), createTransfer: jest.fn() }

      for (const amountCents of [0, -100]) {
        await expect(
          HawalaLedgerModuleService.prototype.openCampaignBackingEscrow.call(ctx, {
            campaignId: "cc_1",
            backingId: "b_1",
            backerCustomerId: "cus_1",
            amountCents,
          })
        ).rejects.toThrow("amountCents must be > 0")
      }
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    })

    it("moves backer wallet -> campaign escrow with deterministic key and cents/100 amount", async () => {
      const ctx: any = {
        listLedgerAccounts: accountLister({ USER_WALLET: [wallet], ESCROW: [escrow] }),
        getOrCreateCampaignEscrow:
          HawalaLedgerModuleService.prototype["getOrCreateCampaignEscrow"],
        createAccount: jest.fn(),
        createTransfer: jest.fn().mockResolvedValue({ id: "le_1" }),
      }

      const entry = await HawalaLedgerModuleService.prototype.openCampaignBackingEscrow.call(ctx, {
        campaignId: "cc_1",
        backingId: "b_1",
        backerCustomerId: "cus_1",
        amountCents: 2550,
      })

      expect(entry).toEqual({ id: "le_1" })
      expect(ctx.createAccount).not.toHaveBeenCalled()
      expect(ctx.createTransfer).toHaveBeenCalledTimes(1)
      expect(ctx.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debit_account_id: "acc_wallet",
          credit_account_id: "acc_escrow",
          amount: 25.5,
          entry_type: "TRANSFER",
          idempotency_key: "campaign-backing-b_1",
          reference_id: "cc_1",
        })
      )
    })

    it("creates the backer wallet and campaign escrow accounts when missing", async () => {
      const created: any[] = []
      const ctx: any = {
        listLedgerAccounts: accountLister({}),
        getOrCreateCampaignEscrow:
          HawalaLedgerModuleService.prototype["getOrCreateCampaignEscrow"],
        createAccount: jest.fn(async (data: any) => {
          created.push(data)
          return { id: `acc_${data.account_type}` }
        }),
        createTransfer: jest.fn().mockResolvedValue({ id: "le_1" }),
      }

      await HawalaLedgerModuleService.prototype.openCampaignBackingEscrow.call(ctx, {
        campaignId: "cc_1",
        backingId: "b_1",
        backerCustomerId: "cus_1",
        amountCents: 100,
      })

      expect(created).toEqual([
        expect.objectContaining({
          account_type: "USER_WALLET",
          owner_type: "CUSTOMER",
          owner_id: "cus_1",
        }),
        expect.objectContaining({
          account_type: "ESCROW",
          owner_type: "SYSTEM",
          owner_id: "cc_1",
        }),
      ])
      expect(ctx.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debit_account_id: "acc_USER_WALLET",
          credit_account_id: "acc_ESCROW",
          amount: 1,
        })
      )
    })
  })

  describe("refundCampaignBackingEscrow", () => {
    it("throws when amountCents <= 0", async () => {
      const ctx: any = { listLedgerAccounts: jest.fn(), createTransfer: jest.fn() }

      await expect(
        HawalaLedgerModuleService.prototype.refundCampaignBackingEscrow.call(ctx, {
          campaignId: "cc_1",
          backingId: "b_1",
          backerCustomerId: "cus_1",
          amountCents: 0,
          reason: "campaign failed",
        })
      ).rejects.toThrow("amountCents must be > 0")
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    })

    it("throws when the campaign has no escrow account", async () => {
      const ctx: any = {
        listLedgerAccounts: accountLister({ USER_WALLET: [wallet] }),
        createTransfer: jest.fn(),
      }

      await expect(
        HawalaLedgerModuleService.prototype.refundCampaignBackingEscrow.call(ctx, {
          campaignId: "cc_1",
          backingId: "b_1",
          backerCustomerId: "cus_1",
          amountCents: 100,
          reason: "campaign failed",
        })
      ).rejects.toThrow("No escrow account for campaign cc_1")
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    })

    it("moves escrow -> backer wallet as a REFUND with deterministic key", async () => {
      const ctx: any = {
        listLedgerAccounts: accountLister({ USER_WALLET: [wallet], ESCROW: [escrow] }),
        createTransfer: jest.fn().mockResolvedValue({ id: "le_refund" }),
      }

      await HawalaLedgerModuleService.prototype.refundCampaignBackingEscrow.call(ctx, {
        campaignId: "cc_1",
        backingId: "b_1",
        backerCustomerId: "cus_1",
        amountCents: 2550,
        reason: "campaign failed",
      })

      expect(ctx.createTransfer).toHaveBeenCalledTimes(1)
      expect(ctx.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          debit_account_id: "acc_escrow",
          credit_account_id: "acc_wallet",
          amount: 25.5,
          entry_type: "REFUND",
          idempotency_key: "campaign-refund-b_1",
        })
      )
    })
  })

  describe("releaseCampaignEscrow", () => {
    const releaseCtx = () => {
      const transfers: any[] = []
      return {
        transfers,
        ctx: {
          listLedgerAccounts: accountLister({ ESCROW: [escrow] }),
          getOrCreateSellerEarnings: jest.fn().mockResolvedValue({ id: "acc_seller" }),
          getOrCreateSystemAccount: jest.fn().mockResolvedValue({ id: "acc_platform" }),
          createTransfer: jest.fn(async (data: any) => {
            transfers.push(data)
            return { id: `le_${transfers.length}` }
          }),
        } as any,
      }
    }

    it("throws when amountCents <= 0", async () => {
      const { ctx } = releaseCtx()

      await expect(
        HawalaLedgerModuleService.prototype.releaseCampaignEscrow.call(ctx, {
          campaignId: "cc_1",
          vendorSellerId: "vendor_1",
          amountCents: -1,
        })
      ).rejects.toThrow("amountCents must be > 0")
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    })

    it("throws when platformFeeCents >= amountCents", async () => {
      const { ctx } = releaseCtx()

      await expect(
        HawalaLedgerModuleService.prototype.releaseCampaignEscrow.call(ctx, {
          campaignId: "cc_1",
          vendorSellerId: "vendor_1",
          amountCents: 100,
          platformFeeCents: 100,
        })
      ).rejects.toThrow("platformFeeCents")
      expect(ctx.createTransfer).not.toHaveBeenCalled()
    })

    it("produces seller + fee legs that sum to the escrowed total", async () => {
      const { ctx, transfers } = releaseCtx()

      const result = await HawalaLedgerModuleService.prototype.releaseCampaignEscrow.call(ctx, {
        campaignId: "cc_1",
        vendorSellerId: "vendor_1",
        amountCents: 10000,
        platformFeeCents: 300,
      })

      expect(transfers).toHaveLength(2)
      expect(transfers[0]).toEqual(
        expect.objectContaining({
          debit_account_id: "acc_escrow",
          credit_account_id: "acc_seller",
          amount: 97,
          idempotency_key: "campaign-release-cc_1",
        })
      )
      expect(transfers[1]).toEqual(
        expect.objectContaining({
          debit_account_id: "acc_escrow",
          credit_account_id: "acc_platform",
          amount: 3,
          idempotency_key: "campaign-release-fee-cc_1",
        })
      )
      // Legs must sum to the escrowed total (major units).
      expect(transfers[0].amount + transfers[1].amount).toBe(100)
      expect(result.release_entry).toEqual({ id: "le_1" })
      expect(result.fee_entry).toEqual({ id: "le_2" })
    })

    it("skips the fee leg entirely when platformFeeCents is 0", async () => {
      const { ctx, transfers } = releaseCtx()

      const result = await HawalaLedgerModuleService.prototype.releaseCampaignEscrow.call(ctx, {
        campaignId: "cc_1",
        vendorSellerId: "vendor_1",
        amountCents: 10000,
      })

      expect(transfers).toHaveLength(1)
      expect(transfers[0].amount).toBe(100)
      expect(ctx.getOrCreateSystemAccount).not.toHaveBeenCalled()
      expect(result.fee_entry).toBeNull()
    })
  })
})
