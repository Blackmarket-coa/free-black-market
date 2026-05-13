"use client"

import { useEffect, useState } from "react"
import { medusaFetch } from "@/lib/config"
import { BugReportModal } from "../BugReportModal/BugReportModal"

type Variant = "link" | "menu-item"

export const BugReportButton = ({
  variant = "link",
  className,
  label = "Report a bug",
}: {
  variant?: Variant
  className?: string
  label?: string
}) => {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    medusaFetch<{ enabled: boolean }>("/store/bug-report/config", { method: "GET" } as any)
      .then((res) => {
        if (!cancelled) setEnabled(res.enabled)
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (enabled === false) return null

  const baseClass =
    variant === "menu-item"
      ? "w-full text-left label-md py-2 hover:text-action transition-colors duration-200"
      : "block label-md hover:text-action transition-colors duration-200 text-left"

  return (
    <>
      <button
        type="button"
        className={`${baseClass} ${className ?? ""}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && <BugReportModal onClose={() => setOpen(false)} />}
    </>
  )
}
