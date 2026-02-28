import { MedusaContainer } from "@medusajs/framework/types"
import { SUPPLIER_FORWARDING_MODULE } from "../modules/supplier-forwarding"
import SupplierForwardingModuleService from "../modules/supplier-forwarding/service"

export default async function supplierForwardingRetries(container: MedusaContainer) {
  const service = container.resolve<SupplierForwardingModuleService>(SUPPLIER_FORWARDING_MODULE)
  await service.processRetries()
}

export const config = {
  name: "supplier-forwarding-retries",
  schedule: "*/5 * * * *",
}
