import { Button, Heading, Text } from "@medusajs/ui"
import { useMemo, useState } from "react"

import { MultiQuestionCard } from "../playbook-picker/question-cards"
import {
  ALL_PLAYBOOKS,
  PLAYBOOK_BLURBS,
  PLAYBOOK_DISPLAY_NAMES,
  RESOURCE_GROUPS,
  recommendPlaybookFromResources,
  type ResourceKey,
} from "../playbook-picker/recommend-from-resources"
import type { Recommendation, PlaybookId } from "../playbook-picker/recommend"

export type ResourceQuizResult = {
  recipe_id: PlaybookId
  resources: ResourceKey[]
  recommended_recipe_id: PlaybookId
  overridden: boolean
}

type ResourceQuizProps = {
  /** Initial playbook for sellers re-running the quiz. */
  initial?: PlaybookId
  /** Pre-selected resources when re-running. */
  initialResources?: ResourceKey[]
  /** Called when the user confirms a playbook. */
  onComplete: (result: ResourceQuizResult) => void
  /** Optional cancel handler. */
  onCancel?: () => void
}

type Phase = "questions" | "reveal" | "override"

export function ResourceQuiz({
  initial,
  initialResources,
  onComplete,
  onCancel,
}: ResourceQuizProps) {
  const totalGroups = RESOURCE_GROUPS.length
  const [groupIndex, setGroupIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>("questions")
  const [selected, setSelected] = useState<ResourceKey[]>(initialResources ?? [])
  const [overrideChoice, setOverrideChoice] = useState<PlaybookId | null>(
    initial ?? null
  )

  const recommendation: Recommendation = useMemo(
    () => recommendPlaybookFromResources(selected),
    [selected]
  )

  const stepNumber = phase === "questions" ? groupIndex + 1 : totalGroups

  const toggle = (value: ResourceKey) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  const handleNext = () => {
    if (phase !== "questions") return
    if (groupIndex < totalGroups - 1) {
      setGroupIndex((i) => i + 1)
    } else {
      setPhase("reveal")
    }
  }

  const handleBack = () => {
    if (phase === "override") {
      setPhase("reveal")
    } else if (phase === "reveal") {
      setPhase("questions")
      setGroupIndex(totalGroups - 1)
    } else if (groupIndex > 0) {
      setGroupIndex((i) => i - 1)
    }
  }

  const handleConfirm = () => {
    const chosen = overrideChoice ?? recommendation.playbook
    onComplete({
      recipe_id: chosen,
      resources: selected,
      recommended_recipe_id: recommendation.playbook,
      overridden: chosen !== recommendation.playbook,
    })
  }

  const group = RESOURCE_GROUPS[groupIndex]

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto p-6">
      <div className="w-full mb-6">
        <div className="flex items-center justify-between text-xs text-ui-fg-subtle">
          <span>
            Step {stepNumber} of {totalGroups}
          </span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-ui-fg-subtle hover:text-ui-fg-base underline"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="h-1.5 w-full rounded-full bg-ui-bg-base-pressed mt-2 overflow-hidden">
          <div
            className="h-full bg-ui-fg-interactive transition-all"
            style={{ width: `${(stepNumber / totalGroups) * 100}%` }}
          />
        </div>
      </div>

      <Heading level="h1" className="text-center mb-1">
        What do you have?
      </Heading>
      <Text size="small" className="text-ui-fg-subtle text-center mb-6">
        Tell us what you're bringing and we'll suggest the right setup. You can
        change it at any time.
      </Text>

      {phase === "questions" && (
        <MultiQuestionCard<ResourceKey>
          title={group.title}
          subtitle={group.subtitle}
          options={group.options}
          values={selected}
          onToggle={toggle}
        />
      )}

      {phase === "reveal" && (
        <div className="flex flex-col items-center w-full gap-y-4">
          <div className="text-center">
            <Text size="small" className="text-ui-fg-subtle">
              Based on what you have, we recommend:
            </Text>
          </div>

          <div className="w-full p-6 rounded-lg border-2 border-ui-fg-interactive bg-ui-bg-interactive-hover text-center">
            <Heading level="h2" className="text-2xl mb-2">
              {PLAYBOOK_DISPLAY_NAMES[recommendation.playbook]}
            </Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {recommendation.reason}
            </Text>
          </div>

          <button
            type="button"
            onClick={() => setPhase("override")}
            className="text-sm text-ui-fg-subtle hover:text-ui-fg-base underline"
          >
            See other options
          </button>
        </div>
      )}

      {phase === "override" && (
        <div className="flex flex-col w-full gap-y-3">
          <Text size="small" className="text-ui-fg-subtle text-center">
            Pick any setup. You can change it later from settings.
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {ALL_PLAYBOOKS.map((id) => {
              const isSelected = (overrideChoice ?? recommendation.playbook) === id
              const isRecommended = id === recommendation.playbook
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOverrideChoice(id)}
                  className={
                    "relative flex flex-col p-3 rounded-lg border-2 transition-all text-left text-sm " +
                    (isSelected
                      ? "border-ui-fg-interactive bg-ui-bg-interactive-hover"
                      : "border-ui-border-base bg-ui-bg-field hover:border-ui-fg-muted")
                  }
                >
                  <span className="font-semibold">{PLAYBOOK_DISPLAY_NAMES[id]}</span>
                  <span className="text-xs text-ui-fg-muted mt-0.5 leading-relaxed">
                    {PLAYBOOK_BLURBS[id]}
                  </span>
                  {isRecommended && (
                    <span className="text-xs text-ui-fg-interactive mt-1">
                      Recommended for you
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between w-full mt-8">
        <Button
          type="button"
          variant="secondary"
          onClick={handleBack}
          disabled={phase === "questions" && groupIndex === 0}
        >
          Back
        </Button>

        {phase === "questions" && (
          <Button type="button" onClick={handleNext}>
            {groupIndex < totalGroups - 1 ? "Next" : "See recommendation"}
          </Button>
        )}

        {(phase === "reveal" || phase === "override") && (
          <Button type="button" onClick={handleConfirm}>
            {phase === "override" &&
            overrideChoice &&
            overrideChoice !== recommendation.playbook
              ? `Confirm ${PLAYBOOK_DISPLAY_NAMES[overrideChoice]}`
              : "Confirm"}
          </Button>
        )}
      </div>
    </div>
  )
}
