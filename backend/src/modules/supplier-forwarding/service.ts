import { MedusaService } from "@medusajs/framework/utils"
import {
  ForwardingAttempt,
  ForwardingAttemptStatus,
  ManualFulfillmentStatus,
  ManualFulfillmentUpdate,
  SupplierContactMethod,
  SupplierProfile,
} from "./models"
import { SupplierApiForwardingPayload, SupplierForwardingAdapter } from "./adapters/types"
import { V1DefaultSupplierForwardingAdapter } from "./adapters/v1-default-adapter"

const MAX_FORWARDING_RETRIES = 3

class SupplierForwardingModuleService extends MedusaService({
  SupplierProfile,
  ForwardingAttempt,
  ManualFulfillmentUpdate,
}) {
  private readonly adapter: SupplierForwardingAdapter = new V1DefaultSupplierForwardingAdapter()

  async forwardOrder(order: any) {
    const supplierId = order?.metadata?.supplier_id

    if (!supplierId) {
      return null
    }

    const [profile] = await this.listSupplierProfiles({ supplier_id: supplierId, is_active: true })
    if (!profile) {
      throw new Error(`No active supplier profile found for ${supplierId}`)
    }

    const payload: SupplierApiForwardingPayload = {
      order_id: order.id,
      supplier_id: supplierId,
      email: order.email,
      items: (order.items || []).map((item: any) => ({ title: item.title, quantity: item.quantity })),
      shipping_address: order.shipping_address,
      metadata: order.metadata || null,
    }

    const attempt = await this.createForwardingAttempts({
      order_id: order.id,
      supplier_id: supplierId,
      status: ForwardingAttemptStatus.PENDING,
      payload,
    })

    try {
      if (profile.contact_method === SupplierContactMethod.EMAIL) {
        return this.updateForwardingAttempts({ id: attempt.id, status: ForwardingAttemptStatus.FORWARDED, forwarded_at: new Date() })
      }

      if (profile.contact_method === SupplierContactMethod.API) {
        if (!profile.api_base_url) {
          throw new Error("Supplier API forwarding requires api_base_url")
        }

        await this.adapter.forwardOrder(payload, {
          apiBaseUrl: profile.api_base_url,
          apiKey: profile.api_key,
        })

        return this.updateForwardingAttempts({ id: attempt.id, status: ForwardingAttemptStatus.FORWARDED, forwarded_at: new Date() })
      }

      return this.createManualFulfillmentUpdates({
        order_id: order.id,
        supplier_id: supplierId,
        status: ManualFulfillmentStatus.PENDING,
        notes: "Manual fulfillment required by supplier profile",
      })
    } catch (e) {
      return this.markForwardingFailure(attempt.id, e instanceof Error ? e.message : "Unknown forwarding error")
    }
  }

  async markForwardingFailure(attemptId: string, error: string) {
    const attempt = await this.retrieveForwardingAttempt(attemptId)
    const retryCount = (attempt.retry_count || 0) + 1
    const deadLetter = retryCount >= MAX_FORWARDING_RETRIES

    return this.updateForwardingAttempts({
      id: attemptId,
      retry_count: retryCount,
      last_error: error,
      status: deadLetter ? ForwardingAttemptStatus.DEAD_LETTER : ForwardingAttemptStatus.RETRYING,
      next_retry_at: deadLetter ? null : new Date(Date.now() + retryCount * 5 * 60 * 1000),
    })
  }

  async processRetries() {
    const attempts = await this.listForwardingAttempts({ status: ForwardingAttemptStatus.RETRYING })
    const now = new Date()

    for (const attempt of attempts) {
      if (attempt.next_retry_at && new Date(attempt.next_retry_at) > now) {
        continue
      }

      const payload = attempt.payload as SupplierApiForwardingPayload
      const [profile] = await this.listSupplierProfiles({ supplier_id: attempt.supplier_id, is_active: true })
      if (!profile || profile.contact_method !== SupplierContactMethod.API || !profile.api_base_url) {
        await this.markForwardingFailure(attempt.id, "Retry skipped: supplier API profile unavailable")
        continue
      }

      try {
        await this.adapter.forwardOrder(payload, {
          apiBaseUrl: profile.api_base_url,
          apiKey: profile.api_key,
        })

        await this.updateForwardingAttempts({
          id: attempt.id,
          status: ForwardingAttemptStatus.FORWARDED,
          forwarded_at: new Date(),
        })
      } catch (e) {
        await this.markForwardingFailure(attempt.id, e instanceof Error ? e.message : "Retry failed")
      }
    }
  }
}

export default SupplierForwardingModuleService
