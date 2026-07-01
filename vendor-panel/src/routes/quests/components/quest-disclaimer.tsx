import { Text } from "@medusajs/ui"

/**
 * Honest-UI disclaimer, shown on every quest surface. FBM assembles evidence;
 * the gatekeeper decides. The exact text comes from the quest definition so it
 * always names the real gatekeeper.
 */
export const QuestDisclaimer = ({
  disclaimer,
  guardrail,
}: {
  disclaimer: string
  guardrail?: boolean
}) => {
  return (
    <div className="bg-ui-tag-orange-bg border-ui-tag-orange-border text-ui-tag-orange-text rounded-lg border p-3">
      <Text size="small" weight="plus" className="text-ui-tag-orange-text">
        FBM assembles documentation — it does not decide the outcome.
      </Text>
      <Text size="small" className="text-ui-tag-orange-text mt-1">
        {disclaimer}
      </Text>
      {guardrail ? (
        <Text size="small" className="text-ui-tag-orange-text mt-1">
          Wellness note: only verified credentials are reflected; nothing here
          implies clinical authority.
        </Text>
      ) : null}
    </div>
  )
}
