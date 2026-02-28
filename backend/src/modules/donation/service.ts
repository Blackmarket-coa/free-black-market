import { MedusaService } from "@medusajs/framework/utils"
import { DonationBeneficiary, DonationDisbursement, DonationSettings } from "./models"

type DonationAggregate = {
  beneficiary_id: string
  beneficiary_name: string
  total_accrued: number
  total_disbursed: number
  outstanding: number
}

class DonationModuleService extends MedusaService({
  DonationBeneficiary,
  DonationSettings,
  DonationDisbursement,
}) {
  async getOrCreateDefaultSettings() {
    const settings = await this.listDonationSettings({ is_default: true })
    if (settings.length) return settings[0]
    return this.createDonationSettings({ is_default: true })
  }

  async upsertDefaultSettings(data: Record<string, unknown>) {
    const settings = await this.getOrCreateDefaultSettings()
    return this.updateDonationSettings({ id: settings.id, ...data })
  }

  async listBeneficiaries(includeUnverified = true) {
    const beneficiaries = await this.listDonationBeneficiaries()
    return includeUnverified
      ? beneficiaries
      : beneficiaries.filter((b) => b.verification_status === "verified")
  }

  async getTransparencySummary(start: Date, end: Date) {
    const disbursements = await this.listDonationDisbursements()
    const beneficiaries = await this.listDonationBeneficiaries()

    const inRange = disbursements.filter((d) => {
      const createdAt = new Date(d.created_at)
      return createdAt >= start && createdAt <= end
    })

    const byBeneficiary = new Map<string, DonationAggregate>()

    for (const item of inRange) {
      const match = beneficiaries.find((b) => b.id === item.beneficiary_id)
      const current = byBeneficiary.get(item.beneficiary_id) || {
        beneficiary_id: item.beneficiary_id,
        beneficiary_name: match?.name || "Unknown",
        total_accrued: 0,
        total_disbursed: 0,
        outstanding: 0,
      }

      current.total_accrued += Number(item.amount)
      if (item.status === "sent") {
        current.total_disbursed += Number(item.amount)
      }
      current.outstanding = current.total_accrued - current.total_disbursed
      byBeneficiary.set(item.beneficiary_id, current)
    }

    const aggregates = Array.from(byBeneficiary.values())

    return {
      range: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        accrued: aggregates.reduce((acc, i) => acc + i.total_accrued, 0),
        disbursed: aggregates.reduce((acc, i) => acc + i.total_disbursed, 0),
        outstanding: aggregates.reduce((acc, i) => acc + i.outstanding, 0),
      },
      beneficiaries: aggregates,
    }
  }

  async queueBatchDisbursement(periodStart: Date, periodEnd: Date) {
    const settings = await this.getOrCreateDefaultSettings()
    if (settings.settlement_mode !== "ledger_batch") {
      return { skipped: true, reason: "settlement mode is not ledger_batch" }
    }

    const beneficiaries = await this.listBeneficiaries(false)
    const rows = await Promise.all(
      beneficiaries.map((b) =>
        this.createDonationDisbursements({
          beneficiary_id: b.id,
          amount: Number((b.metadata as any)?.accrued_balance || 0),
          currency_code: String((b.metadata as any)?.currency_code || "usd"),
          status: "pending",
          period_start: periodStart,
          period_end: periodEnd,
          metadata: { source: "scheduled_batch" },
        })
      )
    )

    return { skipped: false, count: rows.length }
  }
}

export default DonationModuleService
