/**
 * The fields of an update that were actually given.
 *
 * Medusa's generated update writes every key it is handed, and MikroORM
 * refuses `undefined` for a required property ("You must pass a non-undefined
 * value to the property name of entity EnterpriseFee"). A route that passed
 * each body field through, given or not, therefore answered 500 to every
 * partial update: measured on Postgres for enterprise fees and for the farm
 * profile, harvests and lots. An omitted field now means unchanged; `null`
 * still clears a nullable one.
 */
export function definedFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>
}
