/**
 * Partner directory — a code-config registry, not a Medusa module: no table,
 * no service, nothing to migrate. `GET /store/partners` reads it; the quest
 * definitions read it for gatekeeper links. If it ever needs per-region
 * entries an operator edits without a deploy, seed it into a table the way
 * `opportunity-engine/startup-guides` is; the shape here is the seed.
 */
export * from "./types"
export * from "./catalog"
