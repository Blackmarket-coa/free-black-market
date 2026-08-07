import { Button, Heading, Text } from "@medusajs/ui"
import { useMemo, useState } from "react"

import { QuestionCard } from "./question-cards"
import {
  ALL_PLAYBOOKS,
  PLAYBOOK_DISPLAY_NAMES,
  recommendPlaybook,
  type GovernanceAnswer,
  type OfferingAnswer,
  type PickerAnswers,
  type Recommendation,
  type SizeAnswer,
} from "./recommend"
import type { Playbook } from "../../../providers/playbook-provider"
import { usePlaybookProgressions } from "../../../hooks/api/playbook"

type PickerStep = "size" | "governance" | "offering" | "reveal" | "override"

/**
 * A one-line note on the reveal step about where this playbook commonly leads.
 *
 * Deliberately small and deliberately worded: it names the shapes people move
 * into later, and says plainly that staying put is normal. The risk with
 * showing a ladder during onboarding is implying the first rung is the lesser
 * choice — Stall is not a starter tier, it is a permanent, complete answer.
 *
 * Renders nothing at all when there is nothing to say (a terminal playbook, or
 * a failed fetch). An empty strip beats a spinner in a decision flow.
 */
const WhereThisCanLead = ({
  playbook,
}: {
  playbook: Exclude<Playbook, "default">
}) => {
  const { data } = usePlaybookProgressions({ from: playbook })

  const names = useMemo(() => {
    const seen = new Set<string>()
    for (const edge of data?.progressions ?? []) {
      seen.add(edge.to_display_name)
    }
    return Array.from(seen)
  }, [data])

  if (!names.length) {
    return null
  }

  return (
    <div className="w-full rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        Where people go from here
      </Text>
      <Text size="xsmall" className="text-ui-fg-subtle mt-1">
        Some vendors later move into {names.join(", ")} — usually when what they
        can make, or how many of them there are, outgrows the setup they started
        with. You can change playbook any time from settings.
      </Text>
      <Text size="xsmall" className="text-ui-fg-muted mt-1">
        Plenty never do, and that's not a smaller way to use FBM.
      </Text>
    </div>
  )
}

type PlaybookPickerResult = {
  recipe_id: Exclude<Playbook, "default">
  answers: PickerAnswers
  recommended_recipe_id: Exclude<Playbook, "default">
  overridden: boolean
}

type PlaybookPickerProps = {
  /** Initial playbook for sellers re-running the picker. */
  initial?: Exclude<Playbook, "default">
  /** Called when the user confirms a playbook. */
  onComplete: (result: PlaybookPickerResult) => void
  /** Optional cancel handler. */
  onCancel?: () => void
}

const SIZE_OPTIONS: { value: SizeAnswer; label: string; description: string; emoji?: string }[] = [
  { value: "solo", label: "Just me", description: "Solo seller, one decision-maker", emoji: "🌱" },
  { value: "small", label: "2 to 12 of us", description: "A small affinity group or working circle", emoji: "🌿" },
  { value: "medium", label: "13 to 50", description: "A larger co-op or community organization", emoji: "🌳" },
  { value: "federation", label: "50+ or a federation", description: "Many vendors networked together", emoji: "🌲" },
]

const GOVERNANCE_OPTIONS: { value: GovernanceAnswer; label: string; description: string; emoji?: string }[] = [
  { value: "i_decide", label: "I decide", description: "Solo or owner-led decisions", emoji: "🪨" },
  { value: "informal_agreement", label: "We agree informally", description: "Talk it out, find consensus", emoji: "🌾" },
  { value: "circles", label: "We use circles", description: "Sociocratic / Holacracy-style rounds", emoji: "🌀" },
  { value: "elected_reps", label: "Elected reps", description: "Members elect representatives", emoji: "🗳️" },
  { value: "federation_council", label: "Federation council", description: "Nodes send delegates to a council", emoji: "🕸️" },
]

const OFFERING_OPTIONS: { value: OfferingAnswer; label: string; description: string; emoji?: string }[] = [
  { value: "make_or_grow", label: "Things I make or grow", description: "Crafts, food, art, goods", emoji: "🎨" },
  { value: "services", label: "Services on my time", description: "Bookable sessions, retainers", emoji: "⏰" },
  { value: "subscription_or_season", label: "Subscription or season", description: "CSA shares, seasonal boxes", emoji: "🌽" },
  { value: "kitchen_food", label: "Restaurant or kitchen", description: "Meals, takeout, pop-ups", emoji: "🍲" },
  { value: "harvest_pool", label: "Shared harvest pool", description: "Community garden output", emoji: "🌻" },
  { value: "aggregator", label: "Aggregating other vendors", description: "Federation / hub of vendors", emoji: "🪺" },
]

const stepProgressIndex: Record<PickerStep, number> = {
  size: 1,
  governance: 2,
  offering: 3,
  reveal: 3,
  override: 3,
}

export function PlaybookPicker({ initial, onComplete, onCancel }: PlaybookPickerProps) {
  const [step, setStep] = useState<PickerStep>("size")
  const [size, setSize] = useState<SizeAnswer | null>(null)
  const [governance, setGovernance] = useState<GovernanceAnswer | null>(null)
  const [offering, setOffering] = useState<OfferingAnswer | null>(null)

  const answers: PickerAnswers | null = useMemo(() => {
    if (!size || !governance || !offering) return null
    return { size, governance, offering }
  }, [size, governance, offering])

  const recommendation: Recommendation | null = useMemo(() => {
    if (!answers) return null
    return recommendPlaybook(answers)
  }, [answers])

  const [overrideChoice, setOverrideChoice] = useState<Exclude<Playbook, "default"> | null>(
    initial ?? null
  )

  const handleNext = () => {
    if (step === "size" && size) setStep("governance")
    else if (step === "governance" && governance) setStep("offering")
    else if (step === "offering" && offering) setStep("reveal")
  }

  const handleBack = () => {
    if (step === "governance") setStep("size")
    else if (step === "offering") setStep("governance")
    else if (step === "reveal") setStep("offering")
    else if (step === "override") setStep("reveal")
  }

  const handleConfirm = () => {
    if (!answers || !recommendation) return
    const chosen = overrideChoice ?? recommendation.playbook
    onComplete({
      recipe_id: chosen,
      answers,
      recommended_recipe_id: recommendation.playbook,
      overridden: chosen !== recommendation.playbook,
    })
  }

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto p-6">
      <div className="w-full mb-6">
        <div className="flex items-center justify-between text-xs text-ui-fg-subtle">
          <span>Step {stepProgressIndex[step]} of 3</span>
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
            style={{ width: `${(stepProgressIndex[step] / 3) * 100}%` }}
          />
        </div>
      </div>

      <Heading level="h1" className="text-center mb-1">
        Pick your playbook
      </Heading>
      <Text size="small" className="text-ui-fg-subtle text-center mb-6">
        Three questions, then we'll suggest a playbook. You can switch at any time.
      </Text>

      {step === "size" && (
        <QuestionCard<SizeAnswer>
          title="How many of you are there?"
          subtitle="The size of your group shapes how decisions get made."
          options={SIZE_OPTIONS}
          value={size}
          onSelect={setSize}
        />
      )}

      {step === "governance" && (
        <QuestionCard<GovernanceAnswer>
          title="How do you decide things?"
          subtitle="There's no wrong answer — pick what matches reality."
          options={GOVERNANCE_OPTIONS}
          value={governance}
          onSelect={setGovernance}
        />
      )}

      {step === "offering" && (
        <QuestionCard<OfferingAnswer>
          title="What are you offering?"
          subtitle="The shape of your offering picks the playbook with the right tools."
          options={OFFERING_OPTIONS}
          value={offering}
          onSelect={setOffering}
        />
      )}

      {step === "reveal" && recommendation && (
        <div className="flex flex-col items-center w-full gap-y-4">
          <div className="text-center">
            <Text size="small" className="text-ui-fg-subtle">
              Based on your answers, we recommend:
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

          <WhereThisCanLead playbook={recommendation.playbook} />

          <button
            type="button"
            onClick={() => setStep("override")}
            className="text-sm text-ui-fg-subtle hover:text-ui-fg-base underline"
          >
            See other options
          </button>
        </div>
      )}

      {step === "override" && recommendation && (
        <div className="flex flex-col w-full gap-y-3">
          <Text size="small" className="text-ui-fg-subtle text-center">
            Pick any playbook. You can change it later from settings.
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {ALL_PLAYBOOKS.map((id) => {
              const selected = (overrideChoice ?? recommendation.playbook) === id
              const isRecommended = id === recommendation.playbook
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOverrideChoice(id)}
                  className={
                    "relative flex flex-col p-3 rounded-lg border-2 transition-all text-left text-sm " +
                    (selected
                      ? "border-ui-fg-interactive bg-ui-bg-interactive-hover"
                      : "border-ui-border-base bg-ui-bg-field hover:border-ui-fg-muted")
                  }
                >
                  <span className="font-semibold">{PLAYBOOK_DISPLAY_NAMES[id]}</span>
                  {isRecommended && (
                    <span className="text-xs text-ui-fg-interactive mt-0.5">
                      Recommended for your answers
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
          disabled={step === "size"}
        >
          Back
        </Button>

        {(step === "size" || step === "governance" || step === "offering") && (
          <Button
            type="button"
            onClick={handleNext}
            disabled={
              (step === "size" && !size) ||
              (step === "governance" && !governance) ||
              (step === "offering" && !offering)
            }
          >
            Next
          </Button>
        )}

        {(step === "reveal" || step === "override") && (
          <Button type="button" onClick={handleConfirm}>
            {step === "override" && overrideChoice && overrideChoice !== recommendation?.playbook
              ? `Confirm ${PLAYBOOK_DISPLAY_NAMES[overrideChoice]}`
              : "Confirm"}
          </Button>
        )}
      </div>
    </div>
  )
}
