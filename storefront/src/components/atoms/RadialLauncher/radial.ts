/**
 * Radial-launcher positioning math.
 *
 * A radial launcher is a centre button that, when open, fans out a row
 * of items along an arc. The math here turns (index, count, radius,
 * startAngle, sweepAngle) into the (x, y) offset for each item — pure
 * functions so they can be exercised in unit tests without a DOM.
 *
 * Coordinate convention: y points *up* (mathematical), so a negative
 * `y` in callers' Tailwind transforms means "above centre". The
 * `toTranslate()` helper inverts that for CSS where y points down.
 */

export type RadialConfig = {
  /** Total number of items to lay out. Must be ≥ 1. */
  count: number
  /** Pixel distance from centre to each item. */
  radius: number
  /**
   * Starting angle in degrees. 0° = +X axis (right), 90° = +Y axis (up
   * in math convention). Default 180° (the leftmost point on the FAB,
   * sweeping upward).
   */
  startAngle?: number
  /**
   * Total arc swept in degrees. With `count = 5` and `sweepAngle = 90`
   * the items land at 5 evenly-spaced angles from startAngle to
   * startAngle + 90. Default 90.
   */
  sweepAngle?: number
}

export type Position = {
  x: number
  y: number
}

export function validateRadialConfig(cfg: RadialConfig): void {
  if (!Number.isInteger(cfg.count) || cfg.count < 1) {
    throw new Error(`RadialConfig.count must be a positive integer; got ${cfg.count}`)
  }
  if (!Number.isFinite(cfg.radius) || cfg.radius <= 0) {
    throw new Error(`RadialConfig.radius must be a positive number; got ${cfg.radius}`)
  }
  if (cfg.startAngle !== undefined && !Number.isFinite(cfg.startAngle)) {
    throw new Error(`RadialConfig.startAngle must be a finite number; got ${cfg.startAngle}`)
  }
  if (cfg.sweepAngle !== undefined && !Number.isFinite(cfg.sweepAngle)) {
    throw new Error(`RadialConfig.sweepAngle must be a finite number; got ${cfg.sweepAngle}`)
  }
}

/**
 * Compute the (x, y) offset for a single item at `index` of `count`,
 * relative to the radial centre. Inputs are validated; bad inputs
 * throw rather than producing NaN.
 *
 * Spacing rule: with N items, the items occupy N evenly-spaced angles
 * within [startAngle, startAngle + sweepAngle]. For N = 1 the item
 * lands at startAngle. For N ≥ 2 the items include both endpoints.
 */
export function computeRadialPosition(
  index: number,
  cfg: RadialConfig
): Position {
  validateRadialConfig(cfg)
  if (!Number.isInteger(index) || index < 0 || index >= cfg.count) {
    throw new Error(
      `index must be an integer in [0, count); got ${index} for count ${cfg.count}`
    )
  }

  const startAngle = cfg.startAngle ?? 180
  const sweepAngle = cfg.sweepAngle ?? 90

  let angleDeg: number
  if (cfg.count === 1) {
    angleDeg = startAngle
  } else {
    angleDeg = startAngle + (sweepAngle * index) / (cfg.count - 1)
  }

  const rad = (angleDeg * Math.PI) / 180
  const x = Math.cos(rad) * cfg.radius
  const y = Math.sin(rad) * cfg.radius

  return { x: roundTo(x, 3), y: roundTo(y, 3) }
}

/**
 * Convert a math-convention (y-up) position into a CSS translate()
 * string (y-down). Use as `transform: translate(${toTranslate(...)})`.
 */
export function toTranslate(pos: Position): string {
  return `${pos.x}px, ${-pos.y}px`
}

function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(value * f) / f
}
