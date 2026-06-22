import { describe, expect, it } from "vitest"
import { getEarconSpec, RATIOS, type EarconKind } from "@/lib/audio/earcons"
import {
  DEFAULT_PREFS,
  normalizePrefs,
} from "@/components/providers/BlackoutEffects/context"

describe("getEarconSpec", () => {
  const kinds: EarconKind[] = ["confirm", "celebrate", "milestone"]

  it("produces at least one tone for every earcon", () => {
    for (const kind of kinds) {
      const spec = getEarconSpec(kind)
      expect(spec.tones.length).toBeGreaterThan(0)
    }
  })

  it("uses a click-free soft attack (>= 20ms) and a release tail", () => {
    for (const kind of kinds) {
      const spec = getEarconSpec(kind)
      expect(spec.attack).toBeGreaterThanOrEqual(0.02)
      expect(spec.release).toBeGreaterThan(0)
    }
  })

  it("keeps fundamentals in a calm, audible band (well below the 2-4kHz alarm zone)", () => {
    for (const kind of kinds) {
      const spec = getEarconSpec(kind)
      for (const tone of spec.tones) {
        expect(tone.freq).toBeGreaterThan(200)
        expect(tone.freq).toBeLessThan(2000)
        expect(tone.duration).toBeGreaterThan(0)
        expect(tone.at).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("builds the celebrate motif from consonant ratios of the fundamental", () => {
    const base = 528
    const spec = getEarconSpec("celebrate", base)
    const freqs = spec.tones.map((t) => t.freq)
    expect(freqs).toContain(base)
    expect(freqs).toContain(base * RATIOS.majorThird)
    expect(freqs).toContain(base * RATIOS.perfectFifth)
  })

  it("retunes to an alternate fundamental (e.g. 432)", () => {
    const spec = getEarconSpec("confirm", 432)
    expect(spec.tones[0].freq).toBe(432)
  })
})

describe("normalizePrefs", () => {
  it("falls back to defaults for non-object input", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs("nope")).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs(42)).toEqual(DEFAULT_PREFS)
  })

  it("defaults all sensory effects to ON", () => {
    expect(DEFAULT_PREFS.soundEnabled).toBe(true)
    expect(DEFAULT_PREFS.lightsEnabled).toBe(true)
  })

  it("keeps valid persisted values and repairs invalid ones", () => {
    const result = normalizePrefs({
      soundEnabled: false,
      lightsEnabled: true,
      nightGrading: true,
      volume: 0.5,
    })
    expect(result).toEqual({
      soundEnabled: false,
      lightsEnabled: true,
      nightGrading: true,
      volume: 0.5,
    })
  })

  it("clamps an out-of-range or non-numeric volume back to the default", () => {
    expect(normalizePrefs({ volume: 5 }).volume).toBe(DEFAULT_PREFS.volume)
    expect(normalizePrefs({ volume: -1 }).volume).toBe(DEFAULT_PREFS.volume)
    expect(normalizePrefs({ volume: "loud" }).volume).toBe(DEFAULT_PREFS.volume)
  })

  it("ignores malformed boolean fields", () => {
    const result = normalizePrefs({ soundEnabled: "yes", nightGrading: 1 })
    expect(result.soundEnabled).toBe(DEFAULT_PREFS.soundEnabled)
    expect(result.nightGrading).toBe(DEFAULT_PREFS.nightGrading)
  })
})
