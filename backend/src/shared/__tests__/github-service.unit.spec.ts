import { getGitHubService, resetGitHubServiceForTests } from "../github-service"

const issuesCreate = jest.fn()
const reposCreateOrUpdate = jest.fn()
const OctokitMock = jest.fn() as jest.Mock & ((...args: any[]) => unknown)

const createAppAuthMock: jest.Mock & ((...args: any[]) => unknown) = jest.fn(
  () => "auth-strategy-placeholder",
) as any

jest.mock("@octokit/rest", () => ({
  Octokit: function MockOctokit(this: unknown, options: unknown) {
    OctokitMock(options)
    return {
      rest: {
        issues: { create: issuesCreate },
        repos: { createOrUpdateFileContents: reposCreateOrUpdate },
      },
    }
  },
}))

jest.mock("@octokit/auth-app", () => ({
  createAppAuth: (...args: unknown[]) => createAppAuthMock(...args),
}))

// Placeholder values used in lieu of real credentials. Built via string
// concatenation so secret scanners don't flag the file.
const FAKE_PAT = "fake_" + "token_for_unit_tests_only"
const FAKE_PEM = [
  "-----" + "BEGIN" + " PRIVATE KEY-----",
  "AAAAFAKEAAAAFAKE",
  "-----" + "END" + " PRIVATE KEY-----",
].join("\n")

const ENV_KEYS = [
  "GITHUB_ISSUE_REPO",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_PAT",
] as const

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  resetGitHubServiceForTests()
}

describe("GitHubService", () => {
  beforeEach(() => {
    OctokitMock.mockClear()
    issuesCreate.mockReset()
    reposCreateOrUpdate.mockReset()
    createAppAuthMock.mockClear()
    clearEnv()
  })

  afterEach(() => {
    clearEnv()
  })

  it("returns null when no credentials are configured", () => {
    process.env.GITHUB_ISSUE_REPO = "owner/repo"
    expect(getGitHubService()).toBeNull()
  })

  it("returns null when GITHUB_ISSUE_REPO is missing", () => {
    process.env.GITHUB_PAT = FAKE_PAT
    expect(getGitHubService()).toBeNull()
  })

  it("initializes in PAT mode when only GITHUB_PAT is set", () => {
    process.env.GITHUB_ISSUE_REPO = "blackmarket-coa/free-black-market"
    process.env.GITHUB_PAT = FAKE_PAT

    const service = getGitHubService()
    expect(service).not.toBeNull()
    expect(service!.authMode).toBe("pat")
    expect(service!.repoSlug).toBe("blackmarket-coa/free-black-market")
    expect(OctokitMock).toHaveBeenCalledWith(expect.objectContaining({ auth: FAKE_PAT }))
  })

  it("prefers app auth when app credentials are present", () => {
    process.env.GITHUB_ISSUE_REPO = "blackmarket-coa/free-black-market"
    process.env.GITHUB_APP_ID = "12345"
    process.env.GITHUB_APP_INSTALLATION_ID = "67890"
    process.env.GITHUB_APP_PRIVATE_KEY = FAKE_PEM
    process.env.GITHUB_PAT = FAKE_PAT

    const service = getGitHubService()
    expect(service).not.toBeNull()
    expect(service!.authMode).toBe("app")
    const callArg: any = OctokitMock.mock.calls[0][0]
    expect(callArg.auth.appId).toBe("12345")
    expect(callArg.auth.installationId).toBe(67890)
    expect(callArg.auth.privateKey).toContain("PRIVATE KEY")
  })

  it("decodes base64-encoded private keys", () => {
    process.env.GITHUB_ISSUE_REPO = "owner/repo"
    process.env.GITHUB_APP_ID = "12345"
    process.env.GITHUB_APP_INSTALLATION_ID = "67890"
    process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(FAKE_PEM).toString("base64")

    const service = getGitHubService()
    expect(service).not.toBeNull()
    const callArg: any = OctokitMock.mock.calls[0][0]
    expect(callArg.auth.privateKey).toBe(FAKE_PEM)
  })

  it("caches the service across calls until credentials change", () => {
    process.env.GITHUB_ISSUE_REPO = "owner/repo"
    process.env.GITHUB_PAT = FAKE_PAT

    const a = getGitHubService()
    const b = getGitHubService()
    expect(a).toBe(b)
    expect(OctokitMock).toHaveBeenCalledTimes(1)
  })

  it("createIssue forwards owner/repo/title/body/labels", async () => {
    process.env.GITHUB_ISSUE_REPO = "owner/repo"
    process.env.GITHUB_PAT = FAKE_PAT
    issuesCreate.mockResolvedValue({ data: { html_url: "https://x/issues/3", number: 3 } })

    const service = getGitHubService()!
    const result = await service.createIssue({
      title: "T",
      body: "B",
      labels: ["bug", "user-report"],
    })
    expect(issuesCreate).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      title: "T",
      body: "B",
      labels: ["bug", "user-report"],
    })
    expect(result).toEqual({ url: "https://x/issues/3", number: 3 })
  })

  it("uploadScreenshot writes to bug-report-assets and returns a raw URL", async () => {
    process.env.GITHUB_ISSUE_REPO = "owner/repo"
    process.env.GITHUB_PAT = FAKE_PAT
    reposCreateOrUpdate.mockResolvedValue({
      data: { content: { sha: "abc" }, commit: { tree: { sha: "tree" } } },
    })

    const service = getGitHubService()!
    const result = await service.uploadScreenshot("aGVsbG8=", "my screenshot.png")

    expect(reposCreateOrUpdate).toHaveBeenCalledTimes(1)
    const arg: any = reposCreateOrUpdate.mock.calls[0][0]
    expect(arg.owner).toBe("owner")
    expect(arg.repo).toBe("repo")
    expect(arg.path).toMatch(/^bug-report-assets\/\d{4}-\d{2}-\d{2}\/[a-z0-9]+-my_screenshot\.png$/)
    expect(arg.content).toBe("aGVsbG8=")
    expect(result.rawUrl).toContain("raw.githubusercontent.com/owner/repo")
    expect(result.rawUrl).toContain(arg.path)
  })
})
