import type { z } from "zod"
import type { EditProductMediaSchema, ProductCreateSchema } from "@routes/products/product-create/constants"

export type ProductCreateSchemaType = z.infer<typeof ProductCreateSchema>

export type EditProductMediaSchemaType = z.infer<typeof EditProductMediaSchema>
