import { ServiceContractStatus } from "./models/service-contract"

/**
 * The client-drivable service-contract transitions. The `openContractForApprovedApp`
 * path (application → ACTIVE contract) already exists; these move the contract
 * through the rest of its lifecycle.
 */
export type ServiceContractTransition =
  | "start"
  | "deliver"
  | "accept"
  | "dispute"
  | "cancel"

/** Who is allowed to drive a given transition. */
type TransitionRole = "provider" | "client" | "either"

type TransitionRule = {
  role: TransitionRole
  from: ReadonlyArray<string>
  to: ServiceContractStatus
}

/**
 * Per-transition rules. `provider` = the contract's `service_seller_id`,
 * `client` = the contract's `vendor_id` (the buyer-seller who owns the program).
 */
export const CONTRACT_TRANSITIONS: Record<ServiceContractTransition, TransitionRule> = {
  start: {
    role: "provider",
    from: [ServiceContractStatus.ACTIVE],
    to: ServiceContractStatus.IN_PROGRESS,
  },
  deliver: {
    role: "provider",
    from: [ServiceContractStatus.ACTIVE, ServiceContractStatus.IN_PROGRESS],
    to: ServiceContractStatus.DELIVERED,
  },
  accept: {
    role: "client",
    from: [ServiceContractStatus.DELIVERED],
    to: ServiceContractStatus.ACCEPTED,
  },
  dispute: {
    role: "either",
    from: [
      ServiceContractStatus.ACTIVE,
      ServiceContractStatus.IN_PROGRESS,
      ServiceContractStatus.DELIVERED,
    ],
    to: ServiceContractStatus.DISPUTED,
  },
  cancel: {
    role: "client",
    from: [ServiceContractStatus.ACTIVE, ServiceContractStatus.IN_PROGRESS],
    to: ServiceContractStatus.CANCELED,
  },
}

export type TransitionableContract = {
  id: string
  status: string
  service_seller_id: string
  vendor_id: string
}

export type ContractRole = "provider" | "client"

export type TransitionEvaluation =
  | { ok: true; role: ContractRole; to: ServiceContractStatus }
  | {
      ok: false
      code: "not_found" | "not_participant" | "forbidden_role" | "invalid_state"
      message: string
    }

/** The actor's role on the contract, or null if not a party. */
export function contractRole(
  contract: TransitionableContract,
  actorSellerId: string
): ContractRole | null {
  if (actorSellerId && contract.service_seller_id === actorSellerId) {
    return "provider"
  }
  if (actorSellerId && contract.vendor_id === actorSellerId) {
    return "client"
  }
  return null
}

/**
 * Pure authorization + state check for a contract transition. Returns the
 * resolved actor role + target status on success, or a typed error the route
 * maps to HTTP (not_found→404, not_participant/forbidden_role→403,
 * invalid_state→409).
 */
export function evaluateContractTransition(args: {
  contract: TransitionableContract | null | undefined
  actorSellerId: string
  transition: ServiceContractTransition
}): TransitionEvaluation {
  const { contract, actorSellerId, transition } = args
  const rule = CONTRACT_TRANSITIONS[transition]

  if (!contract) {
    return { ok: false, code: "not_found", message: "Contract not found" }
  }

  const role = contractRole(contract, actorSellerId)
  if (!role) {
    return {
      ok: false,
      code: "not_participant",
      message: "Not a party to this contract",
    }
  }

  const roleAllowed =
    rule.role === "either" || rule.role === role
  if (!roleAllowed) {
    const who = rule.role === "provider" ? "the service provider" : "the client"
    return {
      ok: false,
      code: "forbidden_role",
      message: `Only ${who} can ${transition} this contract`,
    }
  }

  if (!rule.from.includes(contract.status)) {
    return {
      ok: false,
      code: "invalid_state",
      message: `Cannot ${transition} a contract in status ${contract.status}`,
    }
  }

  return { ok: true, role, to: rule.to }
}
