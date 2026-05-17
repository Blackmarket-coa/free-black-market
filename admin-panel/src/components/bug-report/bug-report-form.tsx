import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024

const formSchema = z.object({
  summary: z.string().min(5, "Please write at least 5 characters").max(200),
  description: z.string().min(10, "Please describe what happened (10+ characters)").max(8000),
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

export type BugReportSubmitter = (payload: {
  summary: string
  description: string
  category?: string
  includeDiagnostics: boolean
  diagnostics?: {
    userAgent?: string
    appVersion?: string
    pathname?: string
  }
  screenshot?: { filename: string; contentBase64: string }
}) => Promise<{ url: string; number: number }>

export const BugReportForm = ({
  title = "Report a bug",
  subtitle = "We'll file this directly to the public GitHub issue tracker.",
  submit,
}: {
  title?: string
  subtitle?: string
  submit: BugReportSubmitter
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ url: string; number: number } | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
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

  const includeDiagnostics = watch("includeDiagnostics")

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
      setScreenshot({ filename: file.name, contentBase64, size: file.size })
    } catch {
      setScreenshotError("Could not read this file")
    }
  }

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    try {
      const diagnostics = data.includeDiagnostics
        ? {
            userAgent: navigator.userAgent,
            pathname: window.location.pathname,
          }
        : undefined
      const result = await submit({
        summary: data.summary.trim(),
        description: data.description.trim(),
        category: data.category?.trim() || undefined,
        includeDiagnostics: data.includeDiagnostics,
        diagnostics,
        screenshot: screenshot
          ? { filename: screenshot.filename, contentBase64: screenshot.contentBase64 }
          : undefined,
      })
      setDone(result)
      toast.success("Bug report sent", {
        description: `Tracking as issue #${result.number}`,
      })
    } catch (err: any) {
      toast.error("Bug report failed", {
        description: err?.message || "Could not send your report",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading>Thanks for the report!</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            We&apos;ve filed issue #{done.number} on GitHub. You can follow along here:
          </Text>
        </div>
        <div className="px-6 py-4 flex items-center gap-3">
          <a
            href={done.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ui-fg-interactive hover:underline"
          >
            View on GitHub →
          </a>
          <Button
            variant="secondary"
            onClick={() => {
              setDone(null)
              reset()
              setScreenshot(null)
            }}
          >
            Send another
          </Button>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>{title}</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          {subtitle}
        </Text>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-4 space-y-4">
        <div>
          <Label>Summary</Label>
          <Input {...register("summary")} placeholder="Short description of what's broken" />
          {errors.summary && (
            <Text size="small" className="text-ui-fg-error mt-1">
              {errors.summary.message}
            </Text>
          )}
        </div>

        <div>
          <Label>What happened?</Label>
          <Textarea
            rows={6}
            {...register("description")}
            placeholder="Steps to reproduce, what you expected, what actually happened"
          />
          {errors.description && (
            <Text size="small" className="text-ui-fg-error mt-1">
              {errors.description.message}
            </Text>
          )}
        </div>

        <div>
          <Label>Category (optional)</Label>
          <Input {...register("category")} placeholder="e.g. checkout, inventory, login" />
        </div>

        <div>
          <Label>Screenshot (optional, max 2 MB)</Label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleScreenshot(e.target.files?.[0] ?? null)}
            className="block text-sm mt-1"
          />
          {screenshot && (
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {screenshot.filename} ({Math.round(screenshot.size / 1024)} KB)
            </Text>
          )}
          {screenshotError && (
            <Text size="small" className="text-ui-fg-error mt-1">
              {screenshotError}
            </Text>
          )}
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="bug-report-include-diagnostics"
            checked={includeDiagnostics}
            onCheckedChange={(checked) => setValue("includeDiagnostics", checked === true)}
          />
          <Label htmlFor="bug-report-include-diagnostics" className="cursor-pointer">
            <Text size="small">
              Include diagnostic info (browser, current page).
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              Tokens and emails are scrubbed server-side.
            </Text>
          </Label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={submitting} isLoading={submitting}>
            Send report
          </Button>
        </div>
      </form>
    </Container>
  )
}
