import { z } from "zod";

export const restaurantSchema = z.object({
  name: z.string(),
  handle: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
  image_url: z.string().optional(),
});
const stringOrStrings = z.union([z.string().min(1), z.string().min(1).array().min(1)]);

/**
 * The whole query surface of `GET /restaurants`. Strict: an unknown key is
 * refused, and each value is a plain string or a list of them, never the
 * nested object the query-string parser builds from `a[b]=c` (a relation
 * filter) or `a[$like]=c` (an operator).
 */
export const restaurantListQuerySchema = z
  .object({
    currency_code: z.string().regex(/^[A-Za-z]{3}$/).optional(),
    id: stringOrStrings.optional(),
    handle: stringOrStrings.optional(),
    is_open: z.enum(["true", "false"]).optional(),
  })
  .strict();
