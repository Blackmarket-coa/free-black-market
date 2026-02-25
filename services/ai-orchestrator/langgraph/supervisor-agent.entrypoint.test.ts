import assert from 'node:assert/strict'
import test from 'node:test'

import { FBM_HERMES_MASTER_SYSTEM_PROMPT } from '../prompts/system.prompt'
import {
	LANGGRAPH_SUPERVISOR_ENTRYPOINT_PROMPT,
	buildLangGraphSupervisorEntrypoint,
} from './supervisor-agent.entrypoint'

const toolSchemas = [
	{
		action: 'create_product',
		required: ['title', 'price'],
		properties: {
			title: 'string',
			price: 'number',
			description: 'string',
		},
		additionalProperties: false,
	},
	{
		action: 'issue_refund',
		required: ['order_id', 'amount'],
		properties: {
			order_id: 'string',
			amount: 'number',
		},
		additionalProperties: false,
		destructive: true,
	},
] as const

test('injects canonical Hermes prompt in LangGraph supervisor entrypoint', () => {
	assert.equal(LANGGRAPH_SUPERVISOR_ENTRYPOINT_PROMPT, FBM_HERMES_MASTER_SYSTEM_PROMPT)

	const entrypoint = buildLangGraphSupervisorEntrypoint(toolSchemas)
	assert.equal(entrypoint.systemPrompt, FBM_HERMES_MASTER_SYSTEM_PROMPT)
})

test('accepts schema-conformant tool call payloads', () => {
	const entrypoint = buildLangGraphSupervisorEntrypoint(toolSchemas)
	const result = entrypoint.validateToolCall({
		action: 'create_product',
		parameters: {
			title: 'Fresh Apples',
			price: 5.99,
			description: 'Locally sourced produce',
		},
	})

	assert.equal(result.ok, true)
	assert.deepEqual(result.errors, [])
})

test('rejects missing required fields, extra keys, and type mismatch', () => {
	const entrypoint = buildLangGraphSupervisorEntrypoint(toolSchemas)
	const missingRequired = entrypoint.validateToolCall({
		action: 'create_product',
		parameters: {
			title: 'Missing Price',
		},
	})
	assert.equal(missingRequired.ok, false)
	assert.match(missingRequired.errors.join(' | '), /Missing required parameter: price/)

	const extraAndTypeMismatch = entrypoint.validateToolCall({
		action: 'create_product',
		parameters: {
			title: 'Bad Payload',
			price: '5.99',
			not_in_schema: true,
		},
	})
	assert.equal(extraAndTypeMismatch.ok, false)
	assert.match(
		extraAndTypeMismatch.errors.join(' | '),
		/Invalid type for price: expected number, received string/,
	)
	assert.match(extraAndTypeMismatch.errors.join(' | '), /Unexpected parameter: not_in_schema/)
})

test('enforces destructive-action confirmation regression rules', () => {
	const entrypoint = buildLangGraphSupervisorEntrypoint(toolSchemas)

	const denied = entrypoint.canExecuteDestructiveAction('issue_refund', {
		explicitIntentInCurrentThread: true,
		impactSummarized: true,
		explicitConfirmationTurn: false,
		scopeChangedAfterConfirmation: false,
		reconfirmedAfterScopeChange: false,
	})
	assert.equal(denied.ok, false)
	assert.match(denied.errors.join(' | '), /explicit confirmation turn/)

	const scopeChangedNotReconfirmed = entrypoint.canExecuteDestructiveAction(
		'issue_refund',
		{
			explicitIntentInCurrentThread: true,
			impactSummarized: true,
			explicitConfirmationTurn: true,
			scopeChangedAfterConfirmation: true,
			reconfirmedAfterScopeChange: false,
		},
	)
	assert.equal(scopeChangedNotReconfirmed.ok, false)
	assert.match(scopeChangedNotReconfirmed.errors.join(' | '), /re-confirmation is required/)

	const approved = entrypoint.canExecuteDestructiveAction('issue_refund', {
		explicitIntentInCurrentThread: true,
		impactSummarized: true,
		explicitConfirmationTurn: true,
		scopeChangedAfterConfirmation: false,
		reconfirmedAfterScopeChange: false,
	})
	assert.equal(approved.ok, true)
})


test('rejects non-object parameters and prototype-only required keys', () => {
	const entrypoint = buildLangGraphSupervisorEntrypoint(toolSchemas)

	const nonObjectParameters = entrypoint.validateToolCall({
		action: 'create_product',
		parameters: null as unknown as Record<string, unknown>,
	})
	assert.equal(nonObjectParameters.ok, false)
	assert.match(nonObjectParameters.errors.join(' | '), /Tool parameters must be a JSON object/)

	const prototypeBackedParameters = Object.create({ title: 'Prototype Title', price: 9.99 })
	const prototypeBypassAttempt = entrypoint.validateToolCall({
		action: 'create_product',
		parameters: prototypeBackedParameters as Record<string, unknown>,
	})
	assert.equal(prototypeBypassAttempt.ok, false)
	assert.match(prototypeBypassAttempt.errors.join(' | '), /Missing required parameter: title/)
	assert.match(prototypeBypassAttempt.errors.join(' | '), /Missing required parameter: price/)
})
