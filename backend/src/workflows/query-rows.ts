/**
 * Narrow a `useQueryGraphStep` result where it enters a workflow (W3-7).
 *
 * ## The problem this exists for
 *
 * `useQueryGraphStep` types its rows as the full generated entity — `Order`
 * has a hundred and some fields, `Product` sixty — and inside a workflow every
 * field is a `T | WorkflowData<T>` union. Any SDK construct that consumes such
 * a row (`transform`, a second `when`, `WorkflowResponse`) has to compare
 * `(T | WorkflowData<T>)[]` against `((T | WorkflowData<T>) & T)[]`, and on
 * these entities that exhausts the compiler's comparison depth:
 *
 *     TS2321: Excessive stack depth comparing types ...
 *
 * ## Why the cut has to be here and not at the use site
 *
 * The comparison happens when the reference is *typed*, not when it is used, so
 * a cast at the point of use is too late — clearing the error at a `transform`
 * simply moved the identical error onto the `WorkflowResponse` two lines later.
 * Narrowing once, where the rows enter, is what actually removes it.
 *
 * ## Why this was invisible
 *
 * The error only exists when `.medusa/` generated types are present. CI's
 * `Lint & Type Check` job runs `tsc --noEmit` on a fresh checkout without
 * them, and `medusa build` does not report it either, so these sat unnoticed
 * across eleven workflow files. Finding them was the precondition for W3-7:
 * the typecheck job could not start generating types until they were fixed,
 * and clearing the first two revealed a third and a fourth, because TypeScript
 * caps how many of these it reports per compilation.
 *
 * ## What it does and does not change
 *
 * Nothing, at runtime. This is a type-only cast: the row object still carries
 * every field the query asked for, so a workflow that serializes one to an HTTP
 * response returns exactly what it did before. What narrows is the compiler's
 * view — so name the fields the workflow actually reads, and check the callers
 * before narrowing a row that reaches a `WorkflowResponse`.
 *
 * ## Use
 *
 *     const { data: orders } = asRows<{ id: string; items?: Item[] }>(
 *       useQueryGraphStep({ entity: "order", fields: [...], filters: { id } })
 *     )
 *
 * Call `.config({ name })` on the step before wrapping, not after.
 */

/**
 * A queried row narrowed to `T`, with the rest of the entity's fields still
 * present at runtime but unenumerated. The index signature is what keeps this
 * honest: the row really does carry more than `T`.
 */
export type QueryRow<T extends object> = T & { [key: string]: unknown }

export function asRows<T extends object>(step: unknown): {
  data: Array<QueryRow<T>>
} {
  return step as { data: Array<QueryRow<T>> }
}
