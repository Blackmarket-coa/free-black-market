import { clx } from "@medusajs/ui"
import type { ReactNode } from "react"

type Option<T extends string> = {
  value: T
  label: string
  description: string
  emoji?: string
}

type QuestionProps<T extends string> = {
  title: string
  subtitle: string
  options: Option<T>[]
  value: T | null
  onSelect: (value: T) => void
  children?: ReactNode
}

/**
 * Reusable single-question card. Each of the three picker questions
 * (size / governance / offering) renders one of these.
 */
export function QuestionCard<T extends string>({
  title,
  subtitle,
  options,
  value,
  onSelect,
}: QuestionProps<T>) {
  return (
    <div className="flex flex-col gap-y-4 w-full">
      <div className="text-center">
        <h2 className="text-ui-fg-base text-xl font-semibold">{title}</h2>
        <p className="text-ui-fg-subtle text-sm mt-1">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={clx(
                "relative flex items-start gap-x-3 p-4 rounded-lg border-2 transition-all text-left",
                "hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2",
                selected
                  ? "border-ui-fg-interactive bg-ui-bg-interactive-hover"
                  : "border-ui-border-base bg-ui-bg-field hover:border-ui-fg-muted"
              )}
            >
              {option.emoji && (
                <span className="text-2xl leading-none" aria-hidden="true">
                  {option.emoji}
                </span>
              )}
              <span className="flex flex-col">
                <span
                  className={clx(
                    "text-sm font-semibold",
                    selected
                      ? "text-ui-fg-interactive"
                      : "text-ui-fg-base"
                  )}
                >
                  {option.label}
                </span>
                <span className="text-xs text-ui-fg-muted mt-0.5 leading-relaxed">
                  {option.description}
                </span>
              </span>
              {selected && (
                <svg
                  className="absolute top-3 right-3 w-5 h-5 text-ui-fg-interactive"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
