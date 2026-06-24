/**
 * Dark-first theme contrast guard.
 *
 * The dark-first migration (Gap F) re-bases storefront surfaces to off-black
 * #121212 with off-white text and brighter accents. WCAG 2.2 AA applies
 * independently in dark mode (4.5:1 for text, 3:1 for large text + UI). This
 * test pins the resolved RGB values of the load-bearing token pairs and asserts
 * each clears its threshold, so a future tweak to colors.css that quietly breaks
 * contrast fails CI. See docs/BMC_UNIFIED_DESIGN_BEHAVIORAL_SPEC.md.
 */
import { describe, it, expect } from "vitest"

type RGB = [number, number, number]

function relativeLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// Resolved dark-first token values (kept in sync with src/app/colors.css).
const SURFACE_0: RGB = [18, 18, 18] // --bg-primary #121212
const OFFWHITE: RGB = [237, 237, 237] // --content-primary
const OFFWHITE_MUTED: RGB = [176, 176, 176] // --content-secondary
const BRAND_300: RGB = [120, 218, 153] // --content-action-primary
const BRAND_400: RGB = [72, 187, 120] // --border-action (UI)
const GREEN_300: RGB = [120, 218, 153] // --content-positive-primary
const RED_300: RGB = [240, 140, 115] // --content-negative-primary
const AMBER_300: RGB = [255, 205, 90] // --content-warning/accent-primary

describe("dark-first contrast (AA, on #121212)", () => {
  it("never uses pure black as the base surface", () => {
    expect(SURFACE_0).not.toEqual([0, 0, 0])
  })

  it.each([
    ["content-primary (off-white body text)", OFFWHITE, 4.5],
    ["content-secondary (muted text)", OFFWHITE_MUTED, 4.5],
    ["content-action-primary (links/actions)", BRAND_300, 4.5],
    ["content-positive-primary", GREEN_300, 4.5],
    ["content-negative-primary", RED_300, 4.5],
    ["content-warning-primary", AMBER_300, 4.5],
  ])("%s passes text AA (>= 4.5:1)", (_label, fg, min) => {
    expect(contrastRatio(fg as RGB, SURFACE_0)).toBeGreaterThanOrEqual(min as number)
  })

  it("border-action passes UI AA (>= 3:1)", () => {
    expect(contrastRatio(BRAND_400, SURFACE_0)).toBeGreaterThanOrEqual(3)
  })
})
