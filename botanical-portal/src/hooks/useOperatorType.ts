import type { OperatorType } from "@/types"

// Operator-type resolution. In production this comes from the vendor session;
// the VITE_OPERATOR_TYPE env var is a local-dev shortcut. A "collective" is a
// shared production house that aggregates several makers (unlocks /makers and
// /pool-splits); a "maker" is a single producer.
export function useOperatorType(): {
  operatorType: OperatorType
  isCollective: boolean
  nurseryNodeId: string
} {
  const operatorType: OperatorType =
    import.meta.env.VITE_OPERATOR_TYPE === "collective" ? "collective" : "maker"
  const nurseryNodeId = import.meta.env.VITE_NURSERY_NODE_ID || ""
  return { operatorType, isCollective: operatorType === "collective", nurseryNodeId }
}
