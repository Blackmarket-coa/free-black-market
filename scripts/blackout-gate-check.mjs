#!/usr/bin/env node

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const DEFAULT_POLICY_PATH = 'config/release/blackout-policy.json'

function parseIsoDate(value, fieldName) {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid ISO datetime for ${fieldName}: ${value}`)
  }
  return dt
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      parsed[key] = next
      i += 1
    } else {
      parsed[key] = 'true'
    }
  }
  return parsed
}

function weekdayIndex(d) {
  return d.getUTCDay()
}

function minutesOfDayUtc(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function isWithinRecurringWeekly(windowStart, windowEnd, now) {
  if (weekdayIndex(windowStart) !== weekdayIndex(now)) return false
  const startMinutes = minutesOfDayUtc(windowStart)
  const endMinutes = minutesOfDayUtc(windowEnd)
  const nowMinutes = minutesOfDayUtc(now)
  return nowMinutes >= startMinutes && nowMinutes <= endMinutes
}

function isWithinRecurringMonthly(windowStart, windowEnd, now) {
  if (windowStart.getUTCDate() !== now.getUTCDate()) return false
  const startMinutes = minutesOfDayUtc(windowStart)
  const endMinutes = minutesOfDayUtc(windowEnd)
  const nowMinutes = minutesOfDayUtc(now)
  return nowMinutes >= startMinutes && nowMinutes <= endMinutes
}

function windowAppliesToService(windowObj, service) {
  if (!service) return true
  if (!Array.isArray(windowObj.service_selectors) || windowObj.service_selectors.length === 0) {
    return true
  }
  return windowObj.service_selectors.includes(service)
}

function getMatchingWindows(policy, context) {
  const now = context.now
  const env = context.environment
  const service = context.service

  return policy.windows.filter((windowObj) => {
    if (windowObj.state !== 'active') return false
    if (!windowObj.environments.includes(env)) return false
    if (!windowAppliesToService(windowObj, service)) return false

    const start = parseIsoDate(windowObj.start, `windows[${windowObj.id}].start`)
    const end = parseIsoDate(windowObj.end, `windows[${windowObj.id}].end`)

    if (windowObj.recurrence === 'none') {
      return now >= start && now <= end
    }

    if (windowObj.recurrence === 'weekly') {
      return isWithinRecurringWeekly(start, end, now)
    }

    if (windowObj.recurrence === 'monthly') {
      return isWithinRecurringMonthly(start, end, now)
    }

    return false
  })
}

function findMatchingException(policy, context) {
  const { environment, service, changeType } = context
  if (!changeType) return null

  return policy.exception_rules.find((rule) => {
    if (!rule.environments.includes(environment)) return false
    if (Array.isArray(rule.service_selectors) && rule.service_selectors.length > 0 && !rule.service_selectors.includes(service)) {
      return false
    }
    if (!Array.isArray(rule.change_types) || rule.change_types.length === 0) return false
    return rule.change_types.includes(changeType)
  })
}

function hasRequiredRoles(requiredRoles, providedRoles) {
  if (!requiredRoles.length) return true
  const provided = new Set(providedRoles)
  return requiredRoles.every((role) => provided.has(role))
}

function evaluateDecision(policy, context) {
  const activeWindows = getMatchingWindows(policy, context)
  const exceptionRule = activeWindows.length > 0 ? findMatchingException(policy, context) : null

  const approvalEvidence = {
    required: Boolean(exceptionRule?.requires_override),
    required_approvals: Number(policy.approval.min_approvals),
    provided_approvals: Number(context.approvals),
    required_roles: policy.approval.required_roles,
    provided_roles: context.approverRoles,
    ticket_reference_required: Boolean(policy.approval.ticket_reference_required),
    ticket_reference: context.overrideTicket || null,
    reason_required: Boolean(policy.approval.reason_required),
    reason: context.overrideReason || null,
  }

  if (!activeWindows.length) {
    return {
      allowed: true,
      reason: 'No active blackout windows matched this promotion context.',
      matchedWindows: [],
      exceptionRule: null,
      approvalEvidence,
    }
  }

  if (!exceptionRule) {
    return {
      allowed: false,
      reason: 'Active blackout window matched and no exception rule applies.',
      matchedWindows: activeWindows,
      exceptionRule: null,
      approvalEvidence,
    }
  }

  if (!exceptionRule.requires_override) {
    return {
      allowed: true,
      reason: `Exception rule '${exceptionRule.id}' allows this change type without override approval.`,
      matchedWindows: activeWindows,
      exceptionRule,
      approvalEvidence,
    }
  }

  const approvals = Number(context.approvals)
  const requiredApprovals = Number(policy.approval.min_approvals)
  const approverRoles = context.approverRoles

  const meetsApprovals = Number.isFinite(approvals) && approvals >= requiredApprovals
  const meetsRoles = hasRequiredRoles(policy.approval.required_roles, approverRoles)
  const hasTicket = policy.approval.ticket_reference_required ? Boolean(context.overrideTicket) : true
  const hasReason = policy.approval.reason_required ? Boolean(context.overrideReason) : true

  if (meetsApprovals && meetsRoles && hasTicket && hasReason) {
    return {
      allowed: true,
      reason: `Override approved under exception rule '${exceptionRule.id}'.`,
      matchedWindows: activeWindows,
      exceptionRule,
      approvalEvidence,
    }
  }

  return {
    allowed: false,
    reason: `Exception rule '${exceptionRule.id}' matched, but override evidence is incomplete.`,
    matchedWindows: activeWindows,
    exceptionRule,
    approvalEvidence,
  }
}

function writeEvidence(outputPath, payload) {
  const resolvedPath = resolve(process.cwd(), outputPath)
  mkdirSync(dirname(resolvedPath), { recursive: true })
  writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return resolvedPath
}

function main() {
  const args = parseArgs(process.argv)
  const policyPath = resolve(process.cwd(), args.policy || process.env.BLACKOUT_POLICY_PATH || DEFAULT_POLICY_PATH)

  if (!existsSync(policyPath)) {
    console.error(`❌ Blackout policy file not found: ${policyPath}`)
    process.exit(1)
  }

  const policy = JSON.parse(readFileSync(policyPath, 'utf8'))

  const context = {
    environment: args.environment || process.env.BLACKOUT_TARGET_ENV || 'production',
    service: args.service || process.env.BLACKOUT_SERVICE || '',
    changeType: args['change-type'] || process.env.BLACKOUT_CHANGE_TYPE || '',
    approvals: args.approvals || process.env.BLACKOUT_OVERRIDE_APPROVALS || '0',
    approverRoles: (args['approver-roles'] || process.env.BLACKOUT_OVERRIDE_ROLES || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    overrideTicket: args.ticket || process.env.BLACKOUT_OVERRIDE_TICKET || '',
    overrideReason: args.reason || process.env.BLACKOUT_OVERRIDE_REASON || '',
    now: parseIsoDate(args.now || process.env.BLACKOUT_NOW || new Date().toISOString(), 'now'),
    actor: args.actor || process.env.BLACKOUT_ACTOR || process.env.GITHUB_ACTOR || 'unknown',
    commitSha: args.sha || process.env.BLACKOUT_COMMIT_SHA || process.env.GITHUB_SHA || '',
    runId: args['run-id'] || process.env.BLACKOUT_RUN_ID || process.env.GITHUB_RUN_ID || '',
    sourceRef: args.ref || process.env.BLACKOUT_SOURCE_REF || process.env.GITHUB_REF || '',
  }

  const decision = evaluateDecision(policy, context)
  const decisionRecord = {
    decision_id: randomUUID(),
    evaluated_at: context.now.toISOString(),
    policy_path: policyPath,
    policy_version: policy.policy_version ?? 'unknown',
    schema_version: policy.schema_version ?? 'unknown',
    context: {
      environment: context.environment,
      service: context.service || null,
      change_type: context.changeType || null,
      actor: context.actor,
      commit_sha: context.commitSha || null,
      run_id: context.runId || null,
      source_ref: context.sourceRef || null,
    },
    matched_windows: decision.matchedWindows.map((w) => ({
      id: w.id,
      name: w.name,
      recurrence: w.recurrence,
      environments: w.environments,
    })),
    exception_rule: decision.exceptionRule
      ? {
          id: decision.exceptionRule.id,
          name: decision.exceptionRule.name,
          requires_override: decision.exceptionRule.requires_override,
        }
      : null,
    approval_evidence: decision.approvalEvidence,
    decision: {
      allowed: decision.allowed,
      reason: decision.reason,
    },
  }

  console.log('Blackout gate decision context:')
  console.log(`- policy: ${policyPath}`)
  console.log(`- policy_version: ${policy.policy_version ?? 'unknown'}`)
  console.log(`- environment: ${context.environment}`)
  console.log(`- service: ${context.service || '(global)'}`)
  console.log(`- change_type: ${context.changeType || '(none)'}`)
  console.log(`- actor: ${context.actor}`)
  console.log(`- timestamp: ${context.now.toISOString()}`)

  if (decision.matchedWindows.length > 0) {
    console.log('- matched_windows:')
    for (const windowObj of decision.matchedWindows) {
      console.log(`  - ${windowObj.id} (${windowObj.name})`)
    }
  } else {
    console.log('- matched_windows: none')
  }

  if (decisionRecord.approval_evidence.required) {
    console.log(`- override_approvals: ${decisionRecord.approval_evidence.provided_approvals}/${decisionRecord.approval_evidence.required_approvals}`)
    console.log(`- override_roles: ${decisionRecord.approval_evidence.provided_roles.join(',') || '(none)'}`)
    console.log(`- override_ticket: ${decisionRecord.approval_evidence.ticket_reference || '(none)'}`)
  }

  console.log(`- reason: ${decision.reason}`)

  const outputPath = args.output || process.env.BLACKOUT_DECISION_OUTPUT || ''
  if (outputPath) {
    const written = writeEvidence(outputPath, decisionRecord)
    console.log(`- decision_record: ${written}`)
  }

  if (!decision.allowed) {
    console.error('❌ Promotion denied by centralized blackout gate.')
    process.exit(1)
  }

  console.log('✅ Promotion allowed by centralized blackout gate.')
}

main()
