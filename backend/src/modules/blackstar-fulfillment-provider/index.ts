import { ModuleProviderExports } from "@medusajs/framework/types"
import BlackstarFulfillmentProviderService from "./service"

const services = [BlackstarFulfillmentProviderService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
