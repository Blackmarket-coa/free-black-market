import { ModuleProviderExports } from "@medusajs/framework/types"
import MasOidcAuthService from "./service"

const services = [MasOidcAuthService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
