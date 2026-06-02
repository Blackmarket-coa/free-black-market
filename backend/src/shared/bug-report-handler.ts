import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { getGitHubService } from "./github-service"
import { createLogger } from "./logger"

const logger = createLogger("BugReport")

export type BugReportSource = "storefront" | "vendor-panel" | "admin-panel"

const SOURCE_SCOPE_LABEL: Record<BugReportSource, string> = {
  "storefront": "storefront",
  "vendor-panel": "vendor-panel",
  "admin-panel": "admin-panel",
}

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024 // 2 MB

export const bugReportSchema = z.object({
  summary: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(8000),
  category: z.string().trim().min(1).max(60).optional(),
  includeDiagnostics: z.boolean().default(false),
  diagnostics: z
    .object({
      userAgent: z.string().max(500).optional(),
      appVersion: z.string().max(120).optional(),
      pathname: z.string().max(500).optional(),
      consoleTail: z.string().max(8000).optional(),
    })
    .optional(),
  screenshot: z
    .object({
      filename: z.string().min(1).max(120),
      contentBase64: z.string().min(1),
    })
    .optional(),
})

export type BugReportInput = z.infer<typeof bugReportSchema>

/**
 * Remove tokens/secrets that might appear in pasted console output before
 * the body is posted to a public GitHub issue.
 */
export function sanitizeDiagnosticText(text: string): string {
  if (!text) return text
  let out = text

  // Authorization: Bearer xxx
  out = out.replace(/(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
  // Bearer xxx (loose)
  out = out.replace(/\b(bearer)\s+[A-Za-z0-9._-]{12,}/gi, "$1 [redacted]")
  // access_token=xxx, refresh_token=xxx, id_token=xxx, api_key=xxx (kv pairs)
  out = out.replace(
    /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|x-medusa-access-token|secret|password)\s*[:=]\s*"?[A-Za-z0-9._\-+/=]+"?/gi,
    "$1=[redacted]",
  )
  // JWT-like strings: header.payload.signature
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
  // Cookie: header values
  out = out.replace(/\b(cookie)\s*[:=]\s*[^\n;]+/gi, "$1: [redacted]")
  // Email addresses
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")

  return out
}

function buildIssueBody(args: {
  input: BugReportInput
  source: BugReportSource
  extraContext?: Record<string, string | undefined>
  screenshotUrl?: string
}): string {
  const { input, source, extraContext, screenshotUrl } = args

  const sections: string[] = []
  sections.push(`## Summary\n${input.summary}`)
  sections.push(`## Description\n${input.description}`)

  const meta: string[] = [`- **Source**: \`${source}\``]
  if (input.category) {
    meta.push(`- **Category**: ${input.category}`)
  }
  if (extraContext) {
    for (const [k, v] of Object.entries(extraContext)) {
      if (v) meta.push(`- **${k}**: ${v}`)
    }
  }
  sections.push(`## Source\n${meta.join("\n")}`)

  if (input.includeDiagnostics && input.diagnostics) {
    const d = input.diagnostics
    const lines: string[] = []
    if (d.appVersion) lines.push(`- App version: ${d.appVersion}`)
    if (d.userAgent) lines.push(`- User agent: ${d.userAgent}`)
    if (d.pathname) lines.push(`- Pathname: ${d.pathname}`)
    if (lines.length > 0) {
      sections.push(`## Diagnostic info (user opted in)\n${lines.join("\n")}`)
    }
    if (d.consoleTail) {
      const scrubbed = sanitizeDiagnosticText(d.consoleTail)
      sections.push(`### Console tail\n\`\`\`\n${scrubbed}\n\`\`\``)
    }
  }

  if (screenshotUrl) {
    sections.push(`## Screenshot\n![screenshot](${screenshotUrl})`)
  }

  sections.push(
    `---\n_This report was submitted via the in-app bug reporter. ` +
      `Reporter identity is not attached for privacy reasons._`,
  )

  return sections.join("\n\n")
}

function decodeScreenshotBytes(b64: string): Buffer {
  const stripped = b64.replace(/^data:[^;]+;base64,/i, "")
  return Buffer.from(stripped, "base64")
}

export interface BugReportHandlerOptions {
  source: BugReportSource
  /** Extra label or context resolver invoked per-request, e.g. to add seller-scoped labels. */
  extraLabels?: (req: MedusaRequest) => string[]
  extraContext?: (req: MedusaRequest) => Record<string, string | undefined>
}

export function isFeatureEnabled(): boolean {
  const flag = process.env.BUG_REPORT_ENABLED
  if (flag === undefined) return true
  return flag.toLowerCase() !== "false"
}

export function createBugReportHandler(options: BugReportHandlerOptions) {
  return async function bugReportHandler(req: MedusaRequest, res: MedusaResponse) {
    if (!isFeatureEnabled()) {
      res.status(404).json({ message: "Not found", type: "not_found" })
      return
    }

    let input: BugReportInput
    try {
      input = bugReportSchema.parse(req.body)
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Validation failed",
          type: "invalid_data",
          errors: error.issues,
        })
        return
      }
      throw error
    }

    if (input.screenshot) {
      const bytes = decodeScreenshotBytes(input.screenshot.contentBase64)
      if (bytes.byteLength === 0) {
        res.status(400).json({
          message: "Screenshot is empty or not valid base64",
          type: "invalid_data",
        })
        return
      }
      if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
        res.status(413).json({
          message: `Screenshot exceeds the ${Math.round(MAX_SCREENSHOT_BYTES / 1024 / 1024)}MB limit`,
          type: "payload_too_large",
        })
        return
      }
    }

    const github = getGitHubService()
    if (!github) {
      res.status(503).json({
        message: "Bug reporting is not configured on this server",
        type: "service_unavailable",
      })
      return
    }

    let screenshotUrl: string | undefined
    if (input.screenshot) {
      try {
        const stripped = input.screenshot.contentBase64.replace(/^data:[^;]+;base64,/i, "")
        const uploaded = await github.uploadScreenshot(stripped, input.screenshot.filename)
        screenshotUrl = uploaded.rawUrl
      } catch (error) {
        logger.warn("Screenshot upload failed; continuing without it", { error: String(error) })
      }
    }

    const extraContext = options.extraContext?.(req)
    const body = buildIssueBody({
      input,
      source: options.source,
      extraContext,
      screenshotUrl,
    })

    const labels = [
      "bug",
      "user-report",
      `source:${options.source}`,
      SOURCE_SCOPE_LABEL[options.source],
      ...(options.extraLabels?.(req) ?? []),
    ]

    try {
      const result = await github.createIssue({
        title: input.summary,
        body,
        labels,
      })
      logger.info("Bug report issue created", {
        source: options.source,
        issue: result.number,
      })
      res.status(201).json({ url: result.url, number: result.number })
    } catch (error) {
      logger.error("Failed to create bug report issue", error, { source: options.source })
      res.status(502).json({
        message: "Failed to create issue on GitHub",
        type: "bad_gateway",
      })
    }
  }
}

export function createBugReportConfigHandler() {
  return function handler(_req: MedusaRequest, res: MedusaResponse) {
    const enabled = isFeatureEnabled() && !!getGitHubService()
    res.json({ enabled })
  }
}
