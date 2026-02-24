import {
	FBM_HERMES_MASTER_SYSTEM_PROMPT,
	FBM_HERMES_MASTER_SYSTEM_PROMPT_TEXT,
} from '../prompts/system.prompt'

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export type ToolSchema = {
	readonly action: string
	readonly required: readonly string[]
	readonly properties: Readonly<Record<string, PrimitiveType>>
	readonly additionalProperties: boolean
	readonly destructive?: boolean
}

export type ToolCall = {
	action: string
	parameters: Record<string, unknown>
}

export type ValidationResult = {
	readonly ok: boolean
	readonly errors: readonly string[]
}

export type DestructiveConfirmationState = {
	readonly explicitIntentInCurrentThread: boolean
	readonly impactSummarized: boolean
	readonly explicitConfirmationTurn: boolean
	readonly scopeChangedAfterConfirmation: boolean
	readonly reconfirmedAfterScopeChange: boolean
}

export type LangGraphSupervisorEntrypoint = {
	readonly model: 'Hermes 4.3'
	readonly systemPrompt: string
	readonly toolSchemas: readonly ToolSchema[]
	validateToolCall(toolCall: ToolCall): ValidationResult
	canExecuteDestructiveAction(
		action: string,
		confirmation: DestructiveConfirmationState,
	): ValidationResult
}

const DEFAULT_DESTRUCTIVE_ACTIONS = new Set<string>([
	'delete_product',
	'change_payout_details',
	'issue_refund',
	'remove_vendor',
	'import_products_overwrite',
])

const hasType = (value: unknown, type: PrimitiveType): boolean => {
	if (type === 'array') {
		return Array.isArray(value)
	}

	if (type === 'object') {
		return typeof value === 'object' && value !== null && !Array.isArray(value)
	}

	return typeof value === type
}

export const buildLangGraphSupervisorEntrypoint = (
	toolSchemas: readonly ToolSchema[],
): LangGraphSupervisorEntrypoint => {
	const schemaByAction = new Map(toolSchemas.map((schema) => [schema.action, schema]))

	return {
		model: 'Hermes 4.3',
		systemPrompt: FBM_HERMES_MASTER_SYSTEM_PROMPT,
		toolSchemas,
		validateToolCall(toolCall: ToolCall): ValidationResult {
			const errors: string[] = []
			const schema = schemaByAction.get(toolCall.action)

			if (!schema) {
				return {
					ok: false,
					errors: [`Tool action is not registered: ${toolCall.action}`],
				}
			}

			for (const requiredField of schema.required) {
				if (!(requiredField in toolCall.parameters)) {
					errors.push(`Missing required parameter: ${requiredField}`)
				}
			}

			for (const [key, value] of Object.entries(toolCall.parameters)) {
				const expectedType = schema.properties[key]
				if (!expectedType) {
					if (!schema.additionalProperties) {
						errors.push(`Unexpected parameter: ${key}`)
					}
					continue
				}

				if (!hasType(value, expectedType)) {
					errors.push(
						`Invalid type for ${key}: expected ${expectedType}, received ${typeof value}`,
					)
				}
			}

			return {
				ok: errors.length === 0,
				errors,
			}
		},
		canExecuteDestructiveAction(
			action: string,
			confirmation: DestructiveConfirmationState,
		): ValidationResult {
			const errors: string[] = []
			const schema = schemaByAction.get(action)
			const isDestructive =
				Boolean(schema?.destructive) || DEFAULT_DESTRUCTIVE_ACTIONS.has(action)

			if (!isDestructive) {
				return { ok: true, errors }
			}

			if (!confirmation.explicitIntentInCurrentThread) {
				errors.push('Destructive action requires explicit intent in current thread')
			}
			if (!confirmation.impactSummarized) {
				errors.push('Destructive action requires impact summary before execution')
			}
			if (!confirmation.explicitConfirmationTurn) {
				errors.push('Destructive action requires explicit confirmation turn')
			}
			if (
				confirmation.scopeChangedAfterConfirmation &&
				!confirmation.reconfirmedAfterScopeChange
			) {
				errors.push('Scope changed after confirmation; re-confirmation is required')
			}

			return {
				ok: errors.length === 0,
				errors,
			}
		},
	}
}

export const LANGGRAPH_SUPERVISOR_ENTRYPOINT_PROMPT =
	FBM_HERMES_MASTER_SYSTEM_PROMPT_TEXT
