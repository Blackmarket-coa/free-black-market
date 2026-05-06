import { MedusaService } from "@medusajs/framework/utils"
import { InferTypeOf } from "@medusajs/framework/types"
import {
  ProductArchetype,
  ProductArchetypeAssignment,
  ProductArchetypeCode,
} from "./models"

export type ProductArchetypeType = InferTypeOf<typeof ProductArchetype>
export type ProductArchetypeAssignmentType = InferTypeOf<typeof ProductArchetypeAssignment>

class ProductArchetypeService extends MedusaService({
  ProductArchetype,
  ProductArchetypeAssignment,
}) {
  /**
   * Assign an archetype to a product by archetype code.
   *
   * Idempotent: if an assignment already exists for the product, the
   * archetype reference is updated to the new code. The archetype row
   * for the supplied code must already exist (seeded via migrations).
   */
  async assignArchetypeByCode(
    productId: string,
    code: ProductArchetypeCode
  ): Promise<ProductArchetypeAssignmentType> {
    const [archetype] = await this.listProductArchetypes({ code })
    if (!archetype) {
      throw new Error(`ProductArchetype with code '${code}' not found`)
    }

    const [existing] = await this.listProductArchetypeAssignments({
      product_id: productId,
    })

    if (existing) {
      const [updated] = await this.updateProductArchetypeAssignments([
        { id: existing.id, archetype_id: archetype.id },
      ])
      return updated
    }

    const [created] = await this.createProductArchetypeAssignments([
      { product_id: productId, archetype_id: archetype.id },
    ])
    return created
  }

  /**
   * Resolve the archetype currently assigned to a product, if any.
   */
  async getArchetypeForProduct(
    productId: string
  ): Promise<ProductArchetypeType | null> {
    const [assignment] = await this.listProductArchetypeAssignments({
      product_id: productId,
    })
    if (!assignment) return null

    const [archetype] = await this.listProductArchetypes({
      id: assignment.archetype_id,
    })
    return archetype ?? null
  }
}

export default ProductArchetypeService
