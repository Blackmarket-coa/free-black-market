/**
 * Calm earcon synthesizer (Web Audio API, no dependencies).
 *
 * Earcons are short, non-verbal sounds used to acknowledge an interaction.
 * These are deliberately designed to be *pleasant and unobtrusive* rather than
 * attention-grabbing, following well-established psychoacoustic guidance:
 *
 *  - Consonant, simple-ratio intervals (octave 2:1, perfect fifth 3:2, major
 *    third 5:4) read as "harmonious / resolved" rather than tense.
 *  - Fundamentals sit in the ~500-1000 Hz range so the tone is clearly audible
 *    without parking energy in the 2-4 kHz band the ear finds most "alarming".
 *  - Soft attack (>= 20 ms) and gentle exponential release avoid the click /
 *    startle of an abrupt gate.
 *  - Sine / triangle oscillators keep the spectral centroid low (warm, not
 *    metallic or buzzy).
 *  - Master gain is low by default — a quiet confirmation, not a slot machine.
 *
 * The synth is SSR-safe (every entry point no-ops when `window` /
 * `AudioContext` is unavailable) and the `AudioContext` is created lazily on
 * first use so we respect browser autoplay policies (it should be triggered
 * from a user gesture or an event that follows one).
 */

export type EarconKind = "confirm" | "celebrate" | "milestone"

/** Consonant interval ratios relative to a fundamental. */
export const RATIOS = {
  unison: 1,
  majorThird: 5 / 4,
  perfectFifth: 3 / 2,
  octave: 2,
} as const

/** A single tone within an earcon, expressed declaratively so it is testable. */
export type Tone = {
  /** Frequency in Hz. */
  freq: number
  /** Start offset from the earcon trigger, in seconds. */
  at: number
  /** Sustained duration in seconds (excludes the release tail). */
  duration: number
  /** Peak gain for this voice, 0..1 (scaled by the master volume). */
  gain?: number
  type?: OscillatorType
}

export type EarconSpec = {
  tones: Tone[]
  /** Attack ramp in seconds (>= 0.02 to stay click-free). */
  attack: number
  /** Release tail in seconds. */
  release: number
}

/**
 * Build the declarative spec for an earcon. Pure (no audio side effects) so the
 * acoustic design can be unit-tested.
 *
 * @param kind   Which earcon to render.
 * @param baseHz Fundamental frequency. Defaults to a warm 528 Hz. Passing 432
 *               simply retunes the fundamental — offered as an honest option,
 *               with no health claims attached.
 */
export function getEarconSpec(kind: EarconKind, baseHz = 528): EarconSpec {
  const attack = 0.025
  const release = 0.4

  switch (kind) {
    case "confirm":
      // A single, soft resolved tone — the everyday acknowledgement.
      return {
        attack,
        release,
        tones: [{ freq: baseHz, at: 0, duration: 0.16, gain: 1, type: "sine" }],
      }

    case "celebrate":
      // A gentle rising motif: fundamental -> major third -> perfect fifth.
      return {
        attack,
        release,
        tones: [
          { freq: baseHz, at: 0, duration: 0.16, gain: 0.9, type: "sine" },
          {
            freq: baseHz * RATIOS.majorThird,
            at: 0.12,
            duration: 0.16,
            gain: 0.8,
            type: "sine",
          },
          {
            freq: baseHz * RATIOS.perfectFifth,
            at: 0.24,
            duration: 0.28,
            gain: 0.85,
            type: "sine",
          },
        ],
      }

    case "milestone":
      // A fuller "bloom": a fifth chord that opens into the octave above.
      return {
        attack: 0.03,
        release: 0.6,
        tones: [
          { freq: baseHz, at: 0, duration: 0.5, gain: 0.7, type: "sine" },
          {
            freq: baseHz * RATIOS.perfectFifth,
            at: 0.06,
            duration: 0.46,
            gain: 0.55,
            type: "sine",
          },
          {
            freq: baseHz * RATIOS.octave,
            at: 0.18,
            duration: 0.42,
            gain: 0.6,
            type: "triangle",
          },
        ],
      }
  }
}

let sharedContext: AudioContext | null = null

/** Lazily create (and resume) a shared AudioContext. SSR-safe. */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null

  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext

  if (!Ctor) return null

  if (!sharedContext) {
    try {
      sharedContext = new Ctor()
    } catch {
      return null
    }
  }

  // Autoplay policies can leave the context "suspended" until a gesture.
  if (sharedContext.state === "suspended") {
    void sharedContext.resume().catch(() => undefined)
  }

  return sharedContext
}

export type PlayOptions = {
  /** Master volume 0..1. Defaults low so the cue stays calm. */
  volume?: number
  /** Override the fundamental frequency (e.g. 432). */
  baseHz?: number
}

/**
 * Play an earcon. No-ops silently when audio is unavailable or volume <= 0.
 */
export function playEarcon(kind: EarconKind, opts: PlayOptions = {}): void {
  const { volume = 0.18, baseHz } = opts
  if (volume <= 0) return

  const ctx = getAudioContext()
  if (!ctx) return

  const spec = getEarconSpec(kind, baseHz)
  const now = ctx.currentTime

  // A shared master bus keeps the overall level under control.
  const master = ctx.createGain()
  master.gain.value = Math.min(Math.max(volume, 0), 1)
  master.connect(ctx.destination)

  for (const tone of spec.tones) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = tone.type ?? "sine"
    osc.frequency.value = tone.freq

    const start = now + tone.at
    const peak = tone.gain ?? 1
    const sustainEnd = start + tone.duration
    const stop = sustainEnd + spec.release

    // Soft attack -> sustain -> gentle exponential release (click-free).
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(peak, start + spec.attack)
    gain.gain.setValueAtTime(peak, sustainEnd)
    gain.gain.exponentialRampToValueAtTime(0.0001, stop)

    osc.connect(gain)
    gain.connect(master)
    osc.start(start)
    osc.stop(stop + 0.02)
  }
}
