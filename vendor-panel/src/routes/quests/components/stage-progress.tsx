import { Text, Badge } from "@medusajs/ui"
import { CheckCircleSolid, CircleDottedLine } from "@medusajs/icons"
import type { EvaluatedStage } from "../../../hooks/api/quests"

/**
 * Ordered stage-gate progression. Passed gates show a filled check; the current
 * frontier gate lists what's still missing to unlock it.
 */
export const StageProgress = ({
  stages,
  currentIndex,
}: {
  stages: EvaluatedStage[]
  currentIndex: number
}) => {
  return (
    <div className="flex flex-col gap-3">
      {stages.map((stage, i) => {
        const passed = i < currentIndex
        const isFrontier = i === currentIndex
        return (
          <div key={stage.key} className="flex items-start gap-3">
            <div className="mt-0.5">
              {passed ? (
                <CheckCircleSolid className="text-ui-tag-green-icon" />
              ) : (
                <CircleDottedLine className="text-ui-fg-muted" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Text weight="plus">{stage.label}</Text>
                {passed ? (
                  <Badge size="2xsmall" color="green">
                    Complete
                  </Badge>
                ) : isFrontier ? (
                  <Badge size="2xsmall" color="orange">
                    In progress
                  </Badge>
                ) : (
                  <Badge size="2xsmall" color="grey">
                    Locked
                  </Badge>
                )}
              </div>
              {stage.description ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {stage.description}
                </Text>
              ) : null}
              {isFrontier && stage.missing.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {stage.missing.map((m) => (
                    <li key={m}>
                      <Text size="small" className="text-ui-fg-subtle">
                        {m}
                      </Text>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
