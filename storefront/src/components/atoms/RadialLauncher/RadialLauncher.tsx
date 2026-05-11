"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { computeRadialPosition, type RadialConfig } from "./radial"

export type RadialLauncherItem = {
  /** Stable key for React rendering. */
  key: string
  /** Short label rendered under the icon. */
  label: string
  /** Destination href. External links can pass `target="_blank"` via `linkProps`. */
  href: string
  /** ReactNode for the icon — typically an inline SVG. */
  icon: ReactNode
  /** Optional aria-label override. Defaults to `label`. */
  ariaLabel?: string
}

interface RadialLauncherProps {
  items: RadialLauncherItem[]
  /** Pixel distance from the FAB centre to each item. Defaults to 96. */
  radius?: number
  /**
   * Arc start/sweep in degrees (math convention: 0° = +X / right,
   * 90° = +Y / up). Defaults to a wide upper fan: startAngle 135,
   * sweepAngle -90 (i.e. from 135° down through 45°).
   */
  startAngle?: number
  sweepAngle?: number
  /** Tailwind classes on the outer wrapper. Defaults position to bottom-center, mobile-only. */
  className?: string
  /** ariaLabel for the toggle button. */
  toggleLabel?: string
}

/**
 * Mobile-first radial launcher.
 *
 * A floating FAB that, when tapped, fans `items` along an arc. Tap an
 * item to navigate; tap the FAB again, the scrim, or press Escape to
 * close. Click-outside also closes.
 *
 * The component is presentation-only — pass it any list of items via
 * props. See `MobileLauncher.tsx` for the configured mount used by the
 * storefront's `(main)` layout.
 *
 * Default geometry: 5 items along a 90° arc fanning upward from the
 * FAB. Radius 96px keeps items reachable with one thumb while leaving
 * a small visual gap from the FAB itself.
 */
export function RadialLauncher({
  items,
  radius = 96,
  startAngle = 135,
  sweepAngle = -90,
  className,
  toggleLabel = "Open quick navigation",
}: RadialLauncherProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const node = containerRef.current
      if (!node) return
      if (e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false)
      }
    }
    window.addEventListener("pointerdown", onPointer)
    return () => window.removeEventListener("pointerdown", onPointer)
  }, [open])

  const cfg: RadialConfig = { count: items.length, radius, startAngle, sweepAngle }

  return (
    <div
      ref={containerRef}
      className={cn(
        // Mobile-only, bottom-center, above BackToTop's z-index.
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:hidden",
        className
      )}
      data-state={open ? "open" : "closed"}
    >
      {/* Scrim: only renders when open; sits behind the items but above page content. */}
      {open && (
        <div
          aria-hidden={true}
          className="fixed inset-0 -z-10 bg-black/20"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="relative">
        {/* Items: rendered absolutely positioned around the centre button. */}
        {items.length > 0 &&
          items.map((item, idx) => {
            const pos = computeRadialPosition(idx, cfg)
            const tx = pos.x
            const ty = -pos.y // CSS y points down
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-label={item.ariaLabel ?? item.label}
                onClick={() => setOpen(false)}
                tabIndex={open ? 0 : -1}
                className={cn(
                  "absolute left-1/2 top-1/2",
                  "flex flex-col items-center justify-center",
                  "w-14 h-14 -ml-7 -mt-7",
                  "bg-white text-gray-900 rounded-full shadow-md border border-gray-200",
                  "transition-all duration-200 ease-out",
                  open
                    ? "opacity-100 pointer-events-auto"
                    : "opacity-0 pointer-events-none"
                )}
                style={{
                  transform: open
                    ? `translate(${tx}px, ${ty}px) scale(1)`
                    : "translate(0px, 0px) scale(0.5)",
                  transitionDelay: open ? `${idx * 25}ms` : "0ms",
                }}
              >
                <span className="w-6 h-6">{item.icon}</span>
                <span className="text-[10px] leading-tight mt-0.5">{item.label}</span>
              </Link>
            )
          })}

        {/* Centre toggle. */}
        <button
          type="button"
          aria-label={toggleLabel}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "relative z-10 w-14 h-14 rounded-full shadow-lg",
            "flex items-center justify-center",
            "bg-green-600 text-white",
            "hover:bg-green-700 transition-colors"
          )}
        >
          <span
            className={cn(
              "block w-5 h-5 transition-transform duration-200",
              open ? "rotate-45" : "rotate-0"
            )}
            aria-hidden={true}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="10" y1="3" x2="10" y2="17" strokeLinecap="round" />
              <line x1="3" y1="10" x2="17" y2="10" strokeLinecap="round" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}
