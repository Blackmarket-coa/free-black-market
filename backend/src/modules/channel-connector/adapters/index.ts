import { faireAdapter } from "./faire-adapter"
import type { ChannelAdapter } from "../types"

/**
 * The adapter registry.
 *
 * Same shape as `supplier-forwarding/adapters/` — a lookup by id, so adding a
 * channel is one entry here plus one file, and nothing else in the system
 * needs to learn about it.
 *
 * Returns `null` for an unknown id rather than throwing. A stored connection
 * naming a channel this build no longer ships is a real state (a rollback, a
 * withdrawn integration), and it should surface as "this channel is
 * unavailable" rather than as a 500 on the vendor's channel list.
 */
const REGISTRY: Record<string, ChannelAdapter> = {
  [faireAdapter.id]: faireAdapter,
}

export function getChannelAdapter(id: string): ChannelAdapter | null {
  return REGISTRY[id] ?? null
}

export function registeredChannelIds(): string[] {
  return Object.keys(REGISTRY)
}

export { FaireChannelAdapter, faireAdapter } from "./faire-adapter"
