"use client"

import { Card } from "@/components/atoms/Card/Card"
import { useBlackoutEffects } from "@/components/providers"
import { Divider, Heading, Label, Switch, Text } from "@medusajs/ui"

type ToggleRow = {
  key: "soundEnabled" | "lightsEnabled" | "nightGrading"
  label: string
  description: string
}

const ROWS: ToggleRow[] = [
  {
    key: "soundEnabled",
    label: "Sound",
    description:
      "Play soft, calm tones to acknowledge orders, milestones, and other positive moments.",
  },
  {
    key: "lightsEnabled",
    label: "Lights",
    description:
      "Show a gentle warm glow on positive moments. Respects your system's reduced-motion setting.",
  },
  {
    key: "nightGrading",
    label: "Warm night mode",
    description:
      "Shift the interface toward a warmer, lower-strain palette that's easier on the eyes.",
  },
]

/**
 * Account-settings controls for the calm tone + light experience layer.
 * Effects are ON by default; everything here lets a person dial them back.
 */
export const BlackoutEffectsSettings = () => {
  const { prefs, setPref, celebrate } = useBlackoutEffects()

  return (
    <>
      <Card className="bg-secondary p-4 flex justify-between items-center mt-8">
        <Heading level="h2" className="heading-sm uppercase">
          Effects &amp; Sound
        </Heading>
      </Card>
      <Card className="p-0">
        {ROWS.map((row, i) => (
          <div key={row.key}>
            <div className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <Label htmlFor={`fx-${row.key}`} className="label-lg text-primary">
                  {row.label}
                </Label>
                <Text className="label-md text-secondary mt-1">
                  {row.description}
                </Text>
              </div>
              <Switch
                id={`fx-${row.key}`}
                checked={prefs[row.key]}
                onCheckedChange={(checked) => {
                  setPref(row.key, checked)
                  // A quick confirmation so a person hears/sees the effect they
                  // just enabled (no cue when switching something off).
                  if (checked && row.key !== "nightGrading") {
                    celebrate("confirm")
                  }
                }}
              />
            </div>
            {i < ROWS.length - 1 && <Divider />}
          </div>
        ))}

        <Divider />
        <div className="p-4">
          <Label htmlFor="fx-volume" className="label-lg text-primary">
            Sound volume
          </Label>
          <Text className="label-md text-secondary mt-1 mb-3">
            How loud the confirmation tones are.
          </Text>
          <input
            id="fx-volume"
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={prefs.volume}
            disabled={!prefs.soundEnabled}
            onChange={(e) => setPref("volume", Number(e.target.value))}
            onMouseUp={() => prefs.soundEnabled && celebrate("confirm")}
            className="w-full max-w-xs accent-[rgb(var(--brand-500))] disabled:opacity-50"
            aria-label="Sound volume"
          />
        </div>
      </Card>
    </>
  )
}
