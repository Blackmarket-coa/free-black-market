import { cn } from "@/lib/utils"
import {
  isPlaybookId,
  PLAYBOOK_LABELS,
  type PlaybookId,
} from "./signatures"

interface PlaybookSignatureProps {
  /** Playbook id; unknown values render nothing. */
  playbook: PlaybookId | string | null | undefined
  /** Pixel size for both width and height. Defaults to 24. */
  size?: number
  /** Accessible label. Defaults to the playbook's display name. */
  "aria-label"?: string
  /** Tailwind classes applied to the outer SVG. */
  className?: string
  /** If true, the SVG renders as decorative (aria-hidden). */
  decorative?: boolean
}

/**
 * Per-playbook visual signature, rendered inline as SVG.
 *
 * Color is inherited via `currentColor`, so wrap in a span/div with a
 * text color class to recolor (e.g. `<span className="text-primary">
 * <PlaybookSignature playbook="atelier" /></span>`).
 *
 * Glyph design — each must be visually distinct at 16 × 16 (badge size)
 * and read as a line drawing on any background:
 *   stall    — market tent over a counter
 *   atelier  — a small easel with a canvas
 *   grove    — three trees with trunks
 *   workshop — a hammer
 *   commons  — three overlapping rings
 *   cycle    — a circular arrow
 *   kitchen  — a pot with steam rising
 *   harvest  — a wheat sheaf bound at the base
 *   hub      — a centre node with four cardinal spokes
 *   service  — a clock face (services are time-billed)
 */
export function PlaybookSignature({
  playbook,
  size = 24,
  className,
  decorative,
  ...rest
}: PlaybookSignatureProps) {
  if (!isPlaybookId(playbook)) return null
  const label = rest["aria-label"] ?? PLAYBOOK_LABELS[playbook]

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      className={cn("inline-block shrink-0", className)}
    >
      {renderShapes(playbook)}
    </svg>
  )
}

function renderShapes(playbook: PlaybookId) {
  switch (playbook) {
    case "stall":
      return (
        <>
          <polygon points="24,8 6,24 42,24" />
          <rect x="8" y="24" width="32" height="16" />
          <line x1="8" y1="32" x2="40" y2="32" />
        </>
      )
    case "atelier":
      return (
        <>
          <line x1="24" y1="6" x2="14" y2="42" />
          <line x1="24" y1="6" x2="34" y2="42" />
          <line x1="16" y1="34" x2="32" y2="34" />
          <rect x="14" y="10" width="20" height="16" />
        </>
      )
    case "grove":
      return (
        <>
          <circle cx="14" cy="20" r="7" />
          <circle cx="34" cy="20" r="7" />
          <circle cx="24" cy="13" r="7" />
          <line x1="14" y1="27" x2="14" y2="40" />
          <line x1="34" y1="27" x2="34" y2="40" />
          <line x1="24" y1="20" x2="24" y2="40" />
          <line x1="6" y1="40" x2="42" y2="40" />
        </>
      )
    case "workshop":
      return (
        <>
          <rect x="14" y="8" width="20" height="10" />
          <line x1="24" y1="18" x2="24" y2="42" />
          <line x1="14" y1="13" x2="34" y2="13" />
        </>
      )
    case "commons":
      return (
        <>
          <circle cx="16" cy="22" r="9" />
          <circle cx="32" cy="22" r="9" />
          <circle cx="24" cy="32" r="9" />
        </>
      )
    case "cycle":
      return (
        <>
          <path d="M 38 24 a 14 14 0 1 0 -4 10" />
          <polyline points="30,34 34,34 34,30" />
        </>
      )
    case "kitchen":
      return (
        <>
          <path d="M 8 20 L 40 20 L 36 40 L 12 40 Z" />
          <line x1="6" y1="20" x2="42" y2="20" />
          <line x1="18" y1="8" x2="18" y2="16" />
          <line x1="30" y1="8" x2="30" y2="16" />
        </>
      )
    case "harvest":
      return (
        <>
          <line x1="24" y1="8" x2="24" y2="40" />
          <line x1="16" y1="14" x2="24" y2="22" />
          <line x1="32" y1="14" x2="24" y2="22" />
          <line x1="12" y1="22" x2="24" y2="30" />
          <line x1="36" y1="22" x2="24" y2="30" />
          <line x1="16" y1="40" x2="32" y2="40" />
        </>
      )
    case "hub":
      return (
        <>
          <circle cx="24" cy="24" r="5" />
          <line x1="24" y1="10" x2="24" y2="19" />
          <line x1="24" y1="29" x2="24" y2="38" />
          <line x1="10" y1="24" x2="19" y2="24" />
          <line x1="29" y1="24" x2="38" y2="24" />
          <circle cx="24" cy="8" r="2" fill="currentColor" />
          <circle cx="24" cy="40" r="2" fill="currentColor" />
          <circle cx="8" cy="24" r="2" fill="currentColor" />
          <circle cx="40" cy="24" r="2" fill="currentColor" />
        </>
      )
    case "service":
      return (
        <>
          <circle cx="24" cy="24" r="16" />
          <line x1="24" y1="24" x2="24" y2="14" />
          <line x1="24" y1="24" x2="32" y2="28" />
          <circle cx="24" cy="24" r="1.5" fill="currentColor" />
        </>
      )
  }
}
