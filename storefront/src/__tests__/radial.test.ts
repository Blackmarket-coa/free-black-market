import { describe, expect, it } from "vitest"
import {
  computeRadialPosition,
  toTranslate,
  validateRadialConfig,
} from "@/components/atoms/RadialLauncher/radial"

describe("radial: validateRadialConfig", () => {
  it("accepts a minimal valid config", () => {
    expect(() => validateRadialConfig({ count: 1, radius: 50 })).not.toThrow()
  })

  it("rejects non-positive count", () => {
    expect(() => validateRadialConfig({ count: 0, radius: 50 })).toThrow(/count/)
    expect(() => validateRadialConfig({ count: -1, radius: 50 })).toThrow(/count/)
  })

  it("rejects non-integer count", () => {
    expect(() => validateRadialConfig({ count: 1.5, radius: 50 })).toThrow(/count/)
  })

  it("rejects non-positive or non-finite radius", () => {
    expect(() => validateRadialConfig({ count: 3, radius: 0 })).toThrow(/radius/)
    expect(() => validateRadialConfig({ count: 3, radius: -5 })).toThrow(/radius/)
    expect(() => validateRadialConfig({ count: 3, radius: NaN })).toThrow(/radius/)
  })

  it("rejects non-finite angle inputs", () => {
    expect(() =>
      validateRadialConfig({ count: 3, radius: 50, startAngle: NaN })
    ).toThrow(/startAngle/)
    expect(() =>
      validateRadialConfig({ count: 3, radius: 50, sweepAngle: Infinity })
    ).toThrow(/sweepAngle/)
  })
})

describe("radial: computeRadialPosition geometry", () => {
  it("places a single item at startAngle exactly", () => {
    // startAngle = 0 (along +X axis), radius 100 -> (100, 0)
    expect(computeRadialPosition(0, { count: 1, radius: 100, startAngle: 0 })).toEqual({
      x: 100,
      y: 0,
    })
    // startAngle = 90 (along +Y axis), radius 100 -> (0, 100)
    expect(computeRadialPosition(0, { count: 1, radius: 100, startAngle: 90 })).toEqual({
      x: 0,
      y: 100,
    })
  })

  it("with 2 items, occupies both endpoints of the sweep", () => {
    // 0..90, 2 items -> at 0° and 90°
    const a = computeRadialPosition(0, {
      count: 2,
      radius: 100,
      startAngle: 0,
      sweepAngle: 90,
    })
    const b = computeRadialPosition(1, {
      count: 2,
      radius: 100,
      startAngle: 0,
      sweepAngle: 90,
    })
    expect(a).toEqual({ x: 100, y: 0 })
    expect(b).toEqual({ x: 0, y: 100 })
  })

  it("with 3 items, the middle item lands at the midpoint of the sweep", () => {
    // 0..90, 3 items -> at 0°, 45°, 90°
    const mid = computeRadialPosition(1, {
      count: 3,
      radius: 100,
      startAngle: 0,
      sweepAngle: 90,
    })
    expect(mid.x).toBeCloseTo(70.711, 2)
    expect(mid.y).toBeCloseTo(70.711, 2)
  })

  it("defaults to startAngle=180, sweepAngle=90 (upper-left quadrant)", () => {
    // 180..270, 1 item -> at 180° -> (-radius, 0)
    expect(computeRadialPosition(0, { count: 1, radius: 60 })).toEqual({ x: -60, y: 0 })
    // 180..270, 2 items -> at 180° and 270°
    expect(computeRadialPosition(0, { count: 2, radius: 60 })).toEqual({ x: -60, y: 0 })
    const second = computeRadialPosition(1, { count: 2, radius: 60 })
    expect(second.x).toBeCloseTo(0, 5)
    expect(second.y).toBeCloseTo(-60, 5)
  })

  it("rejects out-of-range indices", () => {
    expect(() =>
      computeRadialPosition(-1, { count: 3, radius: 50 })
    ).toThrow(/index/)
    expect(() =>
      computeRadialPosition(3, { count: 3, radius: 50 })
    ).toThrow(/index/)
    expect(() =>
      computeRadialPosition(0.5, { count: 3, radius: 50 })
    ).toThrow(/index/)
  })
})

describe("radial: toTranslate", () => {
  it("inverts y for CSS coordinates (y-down)", () => {
    expect(toTranslate({ x: 30, y: 40 })).toBe("30px, -40px")
    expect(toTranslate({ x: -50, y: 0 })).toBe("-50px, 0px")
  })
})
