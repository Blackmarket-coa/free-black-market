import { MedusaService } from "@medusajs/framework/utils"
import { Pathway } from "./models"
import {
  PATHWAY_TEMPLATES,
  getPathwayTemplate,
  type PathwayTemplate,
} from "./catalog/pathway-templates"

export interface ActivatePathwayInput {
  template_id: string
  /** Maker's own name for the line; defaults to the template name. */
  name?: string
  batch_number_prefix?: string
  default_cure_time_days?: number
  counts_toward_cottage_food_limit?: boolean
}

/**
 * Botanical Vertical service.
 *
 * Owns a maker's activated production pathways and serves the built-in pathway
 * template catalog. Independently adoptable — no quest dependency; core carries
 * no botanical assumptions.
 */
class BotanicalModuleService extends MedusaService({
  Pathway,
}) {
  /** The built-in pathway template catalog (static reference data). */
  listTemplates(): PathwayTemplate[] {
    return PATHWAY_TEMPLATES
  }

  getTemplate(id: string): PathwayTemplate | undefined {
    return getPathwayTemplate(id)
  }

  /** A maker's active pathways, newest first. */
  async listActivePathwaysForMaker(makerId: string) {
    return this.listPathways(
      { maker_id: makerId, is_active: true },
      { order: { created_at: "DESC" } }
    )
  }

  /**
   * Activate a pathway for a maker from a built-in template. The template
   * supplies the compliance framework, output category, and defaults; the
   * caller may override the name, batch prefix, cure time, and cottage-food
   * flag from the configure step.
   */
  async activatePathwayFromTemplate(makerId: string, input: ActivatePathwayInput) {
    const template = getPathwayTemplate(input.template_id)
    if (!template) {
      throw new Error(`Unknown pathway template: ${input.template_id}`)
    }

    const prefix = (input.batch_number_prefix ?? template.batch_number_prefix ?? "")
      .toUpperCase()
      .slice(0, 4)

    return this.createPathways({
      maker_id: makerId,
      template_id: template.id,
      name: input.name?.trim() || template.name,
      output_category: template.output_category,
      compliance_framework_id: template.compliance_framework_id,
      is_active: true,
      shelf_life_min_days: template.shelf_life_min_days ?? null,
      shelf_life_max_days: template.shelf_life_max_days ?? null,
      shelf_life_note: template.shelf_life_note ?? null,
      default_cure_time_days:
        input.default_cure_time_days ?? template.default_cure_time_days ?? null,
      requires_ph_testing: template.requires_ph_testing,
      ph_threshold: template.ph_threshold ?? null,
      coa_required_for_wholesale: template.coa_required_for_wholesale ?? false,
      counts_toward_cottage_food_limit:
        input.counts_toward_cottage_food_limit ??
        template.counts_toward_cottage_food_limit,
      batch_number_prefix: prefix || null,
      production_status_labels: template.production_status_labels ?? null,
      material_category_labels: template.material_category_labels ?? null,
      yield_unit_options: template.yield_unit_options ?? null,
    })
  }
}

export default BotanicalModuleService
