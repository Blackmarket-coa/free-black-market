import { MedusaService } from "@medusajs/framework/utils"
import { SellSignup } from "./models"

class SellSignupModuleService extends MedusaService({
  SellSignup,
}) {}

export default SellSignupModuleService
