import { Octokit } from "@octokit/rest"
import { createAppAuth } from "@octokit/auth-app"
import { ulid } from "ulid"
import { createLogger } from "./logger"

const logger = createLogger("GitHub")

export interface CreateIssueInput {
  title: string
  body: string
  labels?: string[]
}

export interface CreateIssueResult {
  url: string
  number: number
}

export interface UploadScreenshotResult {
  rawUrl: string
  path: string
}

type AuthMode = "app" | "pat"

interface ParsedRepo {
  owner: string
  repo: string
}

function parseRepo(value: string | undefined): ParsedRepo {
  if (!value) {
    throw new Error("GITHUB_ISSUE_REPO is not set (expected 'owner/repo')")
  }
  const [owner, repo] = value.split("/")
  if (!owner || !repo) {
    throw new Error(`GITHUB_ISSUE_REPO must be 'owner/repo', got '${value}'`)
  }
  return { owner, repo }
}

function decodePrivateKey(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
    return trimmed.replace(/\\n/g, "\n")
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8")
    if (decoded.includes("BEGIN") && decoded.includes("PRIVATE KEY")) {
      return decoded
    }
  } catch {
    // fall through
  }
  throw new Error("GITHUB_APP_PRIVATE_KEY must be a PEM string or base64-encoded PEM")
}

export class GitHubService {
  private octokit: Octokit
  private repo: ParsedRepo
  private mode: AuthMode

  constructor(opts: {
    octokit: Octokit
    repo: ParsedRepo
    mode: AuthMode
  }) {
    this.octokit = opts.octokit
    this.repo = opts.repo
    this.mode = opts.mode
  }

  get authMode(): AuthMode {
    return this.mode
  }

  get repoSlug(): string {
    return `${this.repo.owner}/${this.repo.repo}`
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    const { data } = await this.octokit.rest.issues.create({
      owner: this.repo.owner,
      repo: this.repo.repo,
      title: input.title,
      body: input.body,
      labels: input.labels,
    })
    return { url: data.html_url, number: data.number }
  }

  /**
   * Upload a screenshot to the repo at bug-report-assets/{date}/{id}-{name}
   * and return its raw.githubusercontent.com URL for embedding in issue bodies.
   */
  async uploadScreenshot(
    contentBase64: string,
    filename: string,
  ): Promise<UploadScreenshotResult> {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const id = ulid().toLowerCase()
    const path = `bug-report-assets/${today}/${id}-${safeName}`

    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.repo.owner,
      repo: this.repo.repo,
      path,
      message: `chore(bug-report): upload screenshot ${id}`,
      content: contentBase64,
    })

    // Prefer the default branch raw URL from the commit response when available.
    const sha = data.content?.sha
    const branch = data.commit?.tree?.sha ? undefined : undefined // placeholder; we use HEAD
    const rawUrl = sha
      ? `https://raw.githubusercontent.com/${this.repo.owner}/${this.repo.repo}/HEAD/${path}`
      : `https://raw.githubusercontent.com/${this.repo.owner}/${this.repo.repo}/HEAD/${path}`

    return { rawUrl, path }
  }
}

let cachedService: GitHubService | null = null
let cacheKey: string | null = null

function buildCacheKey(): string {
  return [
    process.env.GITHUB_APP_ID || "",
    process.env.GITHUB_APP_INSTALLATION_ID || "",
    process.env.GITHUB_PAT ? "pat" : "",
    process.env.GITHUB_ISSUE_REPO || "",
  ].join("|")
}

export function getGitHubService(): GitHubService | null {
  const repoEnv = process.env.GITHUB_ISSUE_REPO
  if (!repoEnv) {
    return null
  }

  const hasApp =
    !!process.env.GITHUB_APP_ID &&
    !!process.env.GITHUB_APP_PRIVATE_KEY &&
    !!process.env.GITHUB_APP_INSTALLATION_ID
  const hasPat = !!process.env.GITHUB_PAT

  if (!hasApp && !hasPat) {
    return null
  }

  const key = buildCacheKey()
  if (cachedService && cacheKey === key) {
    return cachedService
  }

  try {
    const repo = parseRepo(repoEnv)

    if (hasApp) {
      const privateKey = decodePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!)
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: process.env.GITHUB_APP_ID,
          privateKey,
          installationId: Number(process.env.GITHUB_APP_INSTALLATION_ID),
        },
      })
      cachedService = new GitHubService({ octokit, repo, mode: "app" })
      cacheKey = key
      logger.info("GitHub service initialized (app auth)", { repo: `${repo.owner}/${repo.repo}` })
      return cachedService
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_PAT })
    cachedService = new GitHubService({ octokit, repo, mode: "pat" })
    cacheKey = key
    logger.info("GitHub service initialized (PAT)", { repo: `${repo.owner}/${repo.repo}` })
    return cachedService
  } catch (error) {
    logger.error("Failed to initialize GitHub service", error)
    return null
  }
}

export function resetGitHubServiceForTests(): void {
  cachedService = null
  cacheKey = null
}
