"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button, Checkbox, Input, Textarea } from "@/components/atoms"
import { medusaFetch } from "@/lib/config"
import { getConsoleTail, installConsoleBuffer } from "@/lib/console-buffer"
import { toast } from "@/lib/helpers/toast"
import { cn } from "@/lib/utils"
import { Modal } from "../Modal/Modal"

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024 // 2 MB

const formSchema = z.object({
  summary: z
    .string()
    .min(5, "Please write at least 5 characters")
    .max(200, "Keep the summary under 200 characters"),
  description: z
    .string()
    .min(10, "Please describe what happened (10+ characters)")
    .max(8000, "Description is too long"),
  category: z.string().optional(),
  includeDiagnostics: z.boolean().default(false),
})

type FormData = z.infer<typeof formSchema>

type Screenshot = {
  filename: string
  contentBase64: string
  size: number
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("Unexpected reader output"))
        return
      }
      resolve(result.replace(/^data:[^;]+;base64,/, ""))
    }
    reader.readAsDataURL(file)
  })
}

export const BugReportModal = ({ onClose }: { onClose: () => void }) => {
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done">("idle")
  const [issueUrl, setIssueUrl] = useState<string | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      summary: "",
      description: "",
      category: "",
      includeDiagnostics: false,
    },
  })

  useEffect(() => {
    installConsoleBuffer()
  }, [])

  const includeDiagnostics = watch("includeDiagnostics")
  const summary = watch("summary")
  const description = watch("description")

  const diagnostics = useMemo(() => {
    if (typeof window === "undefined") return undefined
    return {
      userAgent: navigator.userAgent,
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
      pathname: window.location.pathname,
      consoleTail: getConsoleTail() || undefined,
    }
  }, [includeDiagnostics])

  const payloadPreview = useMemo(() => {
    const base: Record<string, unknown> = {
      summary,
      description,
      includeDiagnostics,
    }
    if (includeDiagnostics) base.diagnostics = diagnostics
    if (screenshot) {
      base.screenshot = { filename: screenshot.filename, contentBase64: "<base64 omitted>" }
    }
    return JSON.stringify(base, null, 2)
  }, [summary, description, includeDiagnostics, diagnostics, screenshot])

  const handleScreenshot = async (file: File | null) => {
    setScreenshotError(null)
    if (!file) {
      setScreenshot(null)
      return
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotError("Screenshot must be 2 MB or smaller")
      return
    }
    try {
      const contentBase64 = await readFileAsBase64(file)
      setScreenshot({
        filename: file.name,
        contentBase64,
        size: file.size,
      })
    } catch {
      setScreenshotError("Could not read this file")
    }
  }

  const onSubmit = async (data: FormData) => {
    setSubmitState("submitting")
    try {
      const body = {
        summary: data.summary.trim(),
        description: data.description.trim(),
        category: data.category?.trim() || undefined,
        includeDiagnostics: data.includeDiagnostics,
        diagnostics: data.includeDiagnostics ? diagnostics : undefined,
        screenshot: screenshot
          ? { filename: screenshot.filename, contentBase64: screenshot.contentBase64 }
          : undefined,
      }
      const result = await medusaFetch<{ url: string; number: number }>("/store/bug-report", {
        method: "POST",
        body,
      } as any)
      setIssueUrl(result.url)
      setSubmitState("done")
      toast.success({
        title: "Bug report sent",
        description: `Tracking as issue #${result.number}`,
      })
    } catch (err: any) {
      setSubmitState("idle")
      const message =
        err?.message?.includes?.("429") || err?.status === 429
          ? "Too many reports right now — please try again later."
          : "Could not send your report. Please try again."
      toast.error({ title: "Bug report failed", description: message })
    }
  }

  if (submitState === "done" && issueUrl) {
    return (
      <Modal heading="Report a bug" onClose={onClose}>
        <div className="px-4 pb-5 text-center">
          <h4 className="heading-lg uppercase">Thanks for the report!</h4>
          <p className="max-w-[466px] mx-auto mt-4 text-lg text-secondary">
            We&apos;ve filed an issue on GitHub. You can follow along here:
          </p>
          <a
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline label-md mt-3 inline-block"
          >
            View on GitHub →
          </a>
        </div>
        <div className="border-t px-4 pt-5">
          <Button className="w-full py-3 uppercase" onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal heading="Report a bug" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="px-4 pb-5 space-y-4">
          <label className="label-sm block">
            <p className={cn(errors.summary && "text-negative")}>Summary</p>
            <Input
              {...register("summary")}
              placeholder="Short description of what's broken"
              className={cn(errors.summary && "border-negative")}
            />
            {errors.summary && (
              <p className="label-sm text-negative">{errors.summary.message}</p>
            )}
          </label>

          <label className="label-sm block">
            <p className={cn(errors.description && "text-negative")}>What happened?</p>
            <Textarea
              rows={6}
              {...register("description")}
              placeholder="Steps to reproduce, what you expected, what actually happened"
              className={cn(errors.description && "border-negative")}
            />
            {errors.description && (
              <p className="label-sm text-negative">{errors.description.message}</p>
            )}
          </label>

          <label className="label-sm block">
            <p>Screenshot (optional, max 2 MB)</p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleScreenshot(e.target.files?.[0] ?? null)}
              className="block text-sm mt-1"
            />
            {screenshot && (
              <p className="text-secondary mt-1">
                {screenshot.filename} ({Math.round(screenshot.size / 1024)} KB)
              </p>
            )}
            {screenshotError && (
              <p className="label-sm text-negative">{screenshotError}</p>
            )}
          </label>

          <label className="label-sm flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={includeDiagnostics}
              onChange={(e) =>
                setValue("includeDiagnostics", (e.target as HTMLInputElement).checked)
              }
            />
            <span>
              Include diagnostic info (browser, page, last 50 console lines).
              <br />
              <span className="text-secondary">
                Helps debugging. Tokens and emails are scrubbed before posting.
              </span>
            </span>
          </label>

          <details className="text-sm">
            <summary className="cursor-pointer text-secondary">
              Preview what will be sent
            </summary>
            <pre className="mt-2 p-3 bg-tertiary/20 rounded-sm whitespace-pre-wrap break-all text-xs max-h-48 overflow-auto">
              {payloadPreview}
            </pre>
          </details>
        </div>

        <div className="border-t px-4 pt-5 flex gap-2">
          <Button
            type="button"
            variant="tonal"
            className="flex-1 py-3 uppercase"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitState === "submitting"}
            className="flex-1 py-3 uppercase"
          >
            {submitState === "submitting" ? "Sending…" : "Send report"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
