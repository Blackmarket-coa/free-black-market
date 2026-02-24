import { readFileSync } from 'node:fs'

const promptFile = 'services/ai-orchestrator/prompts/system.prompt.ts'
const content = readFileSync(promptFile, 'utf8')

const requiredClauses = [
  'You operate in exactly two mutually exclusive modes.',
  'Explicit no-mixing rule: never combine conversational text and tool JSON in one response.',
  'You may ONLY call tools defined in the registry exposed at runtime.',
  'Never fabricate IDs, foreign keys, or references.',
  'Destructive-action confirmation requirements:',
  'You cannot bypass permission validation.',
  'Hermes 4.3 JSON compliance rule: tool-mode output must remain schema-safe and machine-parseable.',
]

for (const clause of requiredClauses) {
  if (!content.includes(clause)) {
    throw new Error(`Missing required clause: ${clause}`)
  }
}

const singleActionExample = `{
  "action": "tool_name",
  "parameters": { "placeholder": true }
}`

const multiActionExample = `[
  { "action": "tool_a", "parameters": { "placeholder": 1 } },
  { "action": "tool_b", "parameters": { "placeholder": 2 } }
]`

JSON.parse(singleActionExample)
JSON.parse(multiActionExample)

console.log('Hermes prompt validation checks passed.')
