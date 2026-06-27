import type { Role } from "@/types"

// Role resolution. In production this comes from the vendor session
// (vendor_session.role); the VITE_PORTAL_ROLE env var is a local-dev shortcut.
export function useRole(): { role: Role; nodeId: string; isHub: boolean } {
  const role: Role = import.meta.env.VITE_PORTAL_ROLE === "hub" ? "hub" : "node"
  const nodeId = import.meta.env.VITE_NODE_ID || "node_ga"
  return { role, nodeId, isHub: role === "hub" }
}
