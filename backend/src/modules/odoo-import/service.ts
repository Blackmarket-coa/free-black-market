import { MedusaService } from "@medusajs/framework/utils"
import { OdooConnection, OdooImportLog } from "./models"

class OdooImportModuleService extends MedusaService({
  OdooConnection,
  OdooImportLog,
}) {}

export default OdooImportModuleService
