import type {
  QuestDefinition,
  VendorSubstrate,
  QuestEvaluation,
  EvaluatedStage,
  EvaluatedRequirement,
  RequirementStatus,
  DomainFieldKey,
} from "./types"

/**
 * The generic quest engine.
 *
 * Everything here is a PURE function of `(definition, substrate)`. There is no
 * reference to any quest key, vendor vertical, or physical-goods concept — the
 * FSA loan quest and a wellness-practitioner quest run through the exact same
 * code. This is the property the "no FSA / no physical-goods branching" test
 * asserts. Domain-optional substrate fields that are `null` degrade a
 * requirement to `unavailable`, never crash the evaluation.
 */

/** Is a domain-optional field present on the substrate? */
export function hasDomainField(
  substrate: VendorSubstrate,
  field: DomainFieldKey
): boolean {
  return substrate[field] != null
}

function evaluateRequirement(
  req: QuestDefinition["requirements"][number],
  substrate: VendorSubstrate
): EvaluatedRequirement {
  let status: RequirementStatus

  if (req.tag === "vendor-supplied" || req.tag === "outside-fbm") {
    // Never auto-satisfied — FBM must not fabricate these. They are checklist
    // items surfaced to the vendor with links.
    status = "checklist"
  } else {
    // platform / assisted: check needed domain fields first.
    const missingField = (req.needs ?? []).find(
      (f) => !hasDomainField(substrate, f)
    )
    if (missingField) {
      status = "unavailable"
    } else if (req.satisfied) {
      status = req.satisfied(substrate) ? "satisfied" : "unsatisfied"
    } else {
      status = "satisfied"
    }
  }

  return {
    key: req.key,
    label: req.label,
    tag: req.tag,
    status,
    note: req.note,
  }
}

/**
 * Evaluate a vendor's substrate against a quest definition.
 *
 * Stage gates are ordered; a vendor's `current_stage_index` is the number of
 * leading gates that are open (contiguous from the first). The final gate being
 * open makes the packet available (when the quest defines one).
 */
export function evaluateQuest(
  definition: QuestDefinition,
  substrate: VendorSubstrate
): QuestEvaluation {
  const orderedGates = [...definition.stageGates].sort((a, b) => a.order - b.order)

  const stages: EvaluatedStage[] = orderedGates.map((gate) => ({
    key: gate.key,
    label: gate.label,
    order: gate.order,
    open: safeBool(() => gate.unlocks(substrate)),
    missing: safeList(() => gate.missing(substrate)),
  }))

  // Count leading contiguous open gates.
  let current = 0
  for (const s of stages) {
    if (s.open) current++
    else break
  }

  const finalGateOpen = stages.length > 0 && stages[stages.length - 1].open
  const currentKey = current > 0 ? stages[current - 1].key : null

  const requirements = definition.requirements.map((r) =>
    evaluateRequirement(r, substrate)
  )

  return {
    quest_key: definition.key,
    stages,
    current_stage_index: current,
    current_stage_key: currentKey,
    final_gate_open: finalGateOpen,
    // A packet is only "available" when the quest has one AND the final gate is
    // open. Internal-unlock quests (no packetTemplate) never produce a packet.
    packet_available: !!definition.packetTemplate && finalGateOpen,
    requirements,
  }
}

// A misbehaving definition predicate must never crash the whole evaluation.
function safeBool(fn: () => boolean): boolean {
  try {
    return !!fn()
  } catch {
    return false
  }
}

function safeList(fn: () => string[]): string[] {
  try {
    return fn() ?? []
  } catch {
    return []
  }
}
