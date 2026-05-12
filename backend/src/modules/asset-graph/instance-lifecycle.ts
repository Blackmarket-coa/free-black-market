/**
 * ProjectInstance lifecycle.
 *
 * The matcher (matcher.ts) emits MatchProposals; this file is what
 * happens when one is accepted. A ProjectInstance is the deployment
 * of a manifest in a specific place with a specific operator and
 * member set — it's the object that actually corresponds to a
 * running vertical (a tool library, a nursery, a repair café series).
 *
 * Two state machines:
 *
 *   MatchProposal:
 *     pending → accepted    (operator accepts; instance is created)
 *     pending → declined    (operator rejects)
 *     pending → expired     (matcher rerun supersedes; not handled here)
 *
 *   ProjectInstance:
 *     <new> → draft         (rare; used when an operator wants to
 *                            stage an instance before going live)
 *     <new> → active        (default for accepted proposals)
 *     active → paused       (temporary suspend; reactivate restores)
 *     paused → active       (reactivate)
 *     active → archived     (terminal; instance ends)
 *     paused → archived     (terminal; instance ends)
 *     draft → active        (publish a staged draft)
 *     draft → archived      (delete a staged draft)
 *
 *   archived is terminal. Any other transition throws.
 *
 * The pure functions in this file own state-transition validation and
 * payload computation. The service in service.ts orchestrates: it
 * fetches the proposal + linked declarations, calls
 * `computeInstancePayload`, persists the new instance, marks the
 * proposal accepted, and returns both rows.
 *
 * Idempotency: accepting an already-accepted proposal throws. Same
 * for declining a non-pending proposal. Callers who want at-least-
 * once semantics should either catch the invalid-transition error or
 * check state before calling.
 *
 * Out of scope for v0.1:
 *
 *   - Geography assignment on the instance. Requires choosing one
 *     declaration's geography or computing a centroid; deferred.
 *
 *   - Re-validation at accept time. If a declaration referenced by
 *     the proposal has been revoked since the matcher ran, accept
 *     proceeds with the stale list. v0.2 should add a freshness
 *     check or auto-refresh path.
 *
 *   - Cross-instance coordination (e.g. "this operator already runs
 *     the tool-library manifest in this geography; don't allow a
 *     second instance"). The schema permits multiple instances of
 *     the same manifest by the same operator; policy belongs at a
 *     higher layer.
 */

import type { ManifestSlug } from "./manifests"

/**
 * MatchProposal state. Mirrors the model's TEXT column; the type is
 * authoritative (the model stores any string today, but the lifecycle
 * functions only accept these).
 */
export type ProposalState = "pending" | "accepted" | "declined" | "expired"

export type ProposalAction = "accept" | "decline" | "expire"

/**
 * ProjectInstance state. Mirrors `project_instance.state`.
 *
 *   draft     — staged, not yet visible to participants.
 *   active    — running.
 *   paused    — temporarily suspended; reactivatable.
 *   archived  — terminal; no further transitions.
 */
export type InstanceState = "draft" | "active" | "paused" | "archived"

export type InstanceAction = "publish" | "pause" | "reactivate" | "archive"

export class InvalidTransitionError extends Error {
  constructor(
    public readonly entity: "proposal" | "instance",
    public readonly from: string,
    public readonly action: string
  ) {
    super(
      `Invalid ${entity} transition: cannot ${action} from state '${from}'`
    )
    this.name = "InvalidTransitionError"
  }
}

/**
 * Validate-and-apply a proposal state transition. Pure; no I/O.
 * Throws on invalid combinations so callers can never silently
 * bypass the state machine.
 */
export const transitionProposalState = (
  current: ProposalState,
  action: ProposalAction
): ProposalState => {
  if (current !== "pending") {
    throw new InvalidTransitionError("proposal", current, action)
  }
  switch (action) {
    case "accept":
      return "accepted"
    case "decline":
      return "declined"
    case "expire":
      return "expired"
  }
}

/**
 * Validate-and-apply an instance state transition. Pure; no I/O.
 *
 * Ground rules:
 *   - draft can publish (→ active) or archive.
 *   - active can pause or archive.
 *   - paused can reactivate (→ active) or archive.
 *   - archived is terminal.
 */
export const transitionInstanceState = (
  current: InstanceState,
  action: InstanceAction
): InstanceState => {
  if (current === "archived") {
    throw new InvalidTransitionError("instance", current, action)
  }
  switch (action) {
    case "publish":
      if (current !== "draft") {
        throw new InvalidTransitionError("instance", current, action)
      }
      return "active"
    case "pause":
      if (current !== "active") {
        throw new InvalidTransitionError("instance", current, action)
      }
      return "paused"
    case "reactivate":
      if (current !== "paused") {
        throw new InvalidTransitionError("instance", current, action)
      }
      return "active"
    case "archive":
      // draft, active, and paused can all archive.
      return "archived"
  }
}

/**
 * Minimal proposal shape consumed by `computeInstancePayload`. The
 * full DB model has audit columns and the score field; this names
 * only what the lifecycle reads.
 */
export type LifecycleProposal = {
  manifest_slug: string
  member_id: string
  declaration_ids: string[]
}

/** Minimal declaration shape consumed by `computeInstancePayload`. */
export type LifecycleDeclaration = {
  id: string
  member_id: string
}

/**
 * Compute the ProjectInstance payload that an `accept` action
 * produces. Returns the create-payload only — persistence is the
 * service layer's job.
 *
 * member_ids combines the proposed operator with every distinct
 * member whose declaration appears in the proposal's
 * declaration_ids. Operator is deduplicated and sorted to give a
 * deterministic result regardless of input order.
 *
 * `state` defaults to 'active'. Pass `state: 'draft'` to stage an
 * instance without going live.
 */
export const computeInstancePayload = (
  proposal: LifecycleProposal,
  declarations: ReadonlyArray<LifecycleDeclaration>,
  options: { state?: "draft" | "active" } = {}
): {
  manifest_slug: string
  operator_member_id: string
  member_ids: string[]
  state: "draft" | "active"
} => {
  const declIds = new Set(proposal.declaration_ids)
  const members = new Set<string>([proposal.member_id])
  for (const d of declarations) {
    if (declIds.has(d.id)) {
      members.add(d.member_id)
    }
  }
  return {
    manifest_slug: proposal.manifest_slug,
    operator_member_id: proposal.member_id,
    member_ids: [...members].sort(),
    state: options.state ?? "active",
  }
}

/**
 * Compile-time guard: the manifest slug stored on a proposal must be
 * a known catalog slug. Pure; the type narrowing is the value.
 */
export const asManifestSlug = (
  slug: string,
  knownSlugs: ReadonlyArray<ManifestSlug>
): ManifestSlug => {
  if (!(knownSlugs as ReadonlyArray<string>).includes(slug)) {
    throw new Error(
      `Proposal references unknown manifest slug '${slug}'. ` +
        `Known slugs: ${knownSlugs.join(", ")}`
    )
  }
  return slug as ManifestSlug
}
