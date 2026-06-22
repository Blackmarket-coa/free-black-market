import { createHmac, timingSafeEqual } from "crypto";
import { createLogger } from "./logger";

const log = createLogger("shared/site-provisioning");

/**
 * FBM Sites — provisioning helpers for the vendor "My Website" tab.
 *
 * Two modes are backed here:
 *   - Connect (Mode 1): normalize the bare hostnames a vendor embeds the
 *     Connect SDK on. Pure/local — no external calls.
 *   - Launch  (Mode 2): provision a standardized FBM-hosted site by creating a
 *     repo from the GitHub template and dispatching its `configure` workflow.
 *     This is gated entirely on env config so the endpoint degrades gracefully
 *     (HTTP 501) anywhere the secrets are absent.
 */

export type LaunchResult = {
  repo: string; // org/name
  url: string; // public site URL
  repo_url: string; // GitHub repo URL
};

const SITES_DOMAIN = (process.env.SITES_DOMAIN || "sites.freeblackmarket.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

/** True when the Launch flow has everything it needs to call GitHub. */
export function isLaunchConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_TOKEN &&
    process.env.GITHUB_ORG &&
    (process.env.SITE_TEMPLATE_REPO || process.env.GITHUB_TEMPLATE_REPO),
  );
}

/** Public URL a launched site is served at. */
export function launchedSiteUrl(subdomain: string): string {
  return `https://${subdomain}.${SITES_DOMAIN}`;
}

/**
 * How long a launched site may sit in "provisioning" before we give up and mark
 * it "failed". A GitHub-template generate + Pages deploy normally completes in a
 * couple of minutes; well past that with no successful liveness probe (and no
 * deploy webhook) means something went wrong (bad token scope, Pages disabled,
 * DNS not pointed). Flipping to "failed" stops the panel spinning forever and
 * lets the vendor retry.
 */
export const PROVISIONING_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * True when a row that's still "provisioning" has been stuck longer than
 * PROVISIONING_TIMEOUT_MS. `since` is the row's last-touched timestamp
 * (updated_at). Returns false for missing/unparseable input so we never flip a
 * site we can't reason about.
 */
export function isProvisioningStale(
  since: Date | string | number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (since === null || since === undefined) return false;
  const ts = since instanceof Date ? since.getTime() : new Date(since).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts > PROVISIONING_TIMEOUT_MS;
}

// ─── Deploy → live status flip ───────────────────────────────────────────────

/** True when the deploy → live webhook callback is wired (shared HMAC secret). */
export function isDeployCallbackConfigured(): boolean {
  return Boolean(process.env.SITE_DEPLOY_SECRET);
}

/**
 * Verify an HMAC-SHA256 signature over the raw webhook body using
 * SITE_DEPLOY_SECRET. Timing-safe. Mirrors the Printful webhook verification at
 * src/api/store/printful/webhooks/route.ts.
 */
export function verifyDeploySignature(
  rawBody: Buffer | string,
  signature: string,
): boolean {
  const secret = process.env.SITE_DEPLOY_SECRET;
  if (!secret || !signature) return false;

  const body = Buffer.isBuffer(rawBody)
    ? rawBody.toString("utf8")
    : String(rawBody ?? "");
  const digest = createHmac("sha256", secret).update(body).digest("hex");

  const expected = Buffer.from(digest);
  const provided = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — guard first.
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

/**
 * Lightweight liveness probe for a launched site. `url` is always server-derived
 * (launchedSiteUrl / persisted site_url), never user input, so this is not an
 * SSRF vector. Never throws — returns false on any error or timeout.
 */
export async function probeSiteLive(
  url: string,
  timeoutMs = 2500,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 2xx/3xx means the host is serving the site; 404 = not published yet.
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Normalize arbitrary user input into a clean, deduped list of bare hostnames.
 * Accepts full URLs, "www." prefixes, paths, and whitespace; drops anything
 * that doesn't resolve to a plausible hostname.
 */
export function normalizeDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    let host = raw.trim().toLowerCase();
    if (!host) continue;
    // Strip protocol + path/query if a full URL was pasted in.
    host = host.replace(/^[a-z]+:\/\//, "");
    host = host.split("/")[0].split("?")[0];
    host = host.replace(/^www\./, "");
    // Minimal hostname sanity check (label.tld, allows subdomains + ports).
    if (!/^[a-z0-9.-]+\.[a-z]{2,}(:\d{2,5})?$/.test(host)) continue;
    out.add(host);
    if (out.size >= 50) break;
  }
  return Array.from(out);
}

const GH_API = "https://api.github.com";

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "fbm-site-provisioner",
  };
}

/**
 * Provision a standardized site for a vendor:
 *   1. Generate a new repo from the FBM site template.
 *   2. Dispatch the repo's `configure` workflow with the vendor handle so it can
 *      patch the `__VENDOR_HANDLE__` placeholders and deploy.
 *
 * Throws on any failure; callers translate that into a 502 for the vendor.
 */
export async function provisionSite(opts: {
  handle: string;
  subdomain: string;
}): Promise<LaunchResult> {
  if (!isLaunchConfigured()) {
    throw new Error("LAUNCH_NOT_CONFIGURED");
  }

  const org = process.env.GITHUB_ORG as string;
  const templateRepo = (process.env.SITE_TEMPLATE_REPO ||
    process.env.GITHUB_TEMPLATE_REPO) as string;
  const [templateOwner, templateName] = templateRepo.includes("/")
    ? templateRepo.split("/")
    : [org, templateRepo];

  const repoName = `site-${opts.handle}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");

  // 1) Create repo from template.
  const generateRes = await fetch(
    `${GH_API}/repos/${templateOwner}/${templateName}/generate`,
    {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({
        owner: org,
        name: repoName,
        description: `FBM storefront for ${opts.handle}`,
        private: false,
        include_all_branches: false,
      }),
    },
  );

  if (!generateRes.ok && generateRes.status !== 422) {
    // 422 == repo already exists; we treat that as idempotent re-launch.
    const text = await generateRes.text().catch(() => "");
    log.error(
      `GitHub generate failed (${generateRes.status}) for ${repoName}: ${text}`,
    );
    throw new Error(`GITHUB_GENERATE_FAILED_${generateRes.status}`);
  }

  const fullName = `${org}/${repoName}`;

  // 2) Dispatch the configure workflow (best effort: the repo is created either
  //    way, and the workflow can be re-run from GitHub if this call races the
  //    repo's first commit).
  try {
    const dispatchRes = await fetch(
      `${GH_API}/repos/${org}/${repoName}/actions/workflows/configure.yml/dispatches`,
      {
        method: "POST",
        headers: ghHeaders(),
        body: JSON.stringify({
          ref: "main",
          inputs: {
            vendor_handle: opts.handle,
            subdomain: opts.subdomain,
          },
        }),
      },
    );
    if (!dispatchRes.ok) {
      const text = await dispatchRes.text().catch(() => "");
      log.warn(
        `configure.yml dispatch returned ${dispatchRes.status} for ${fullName}: ${text}`,
      );
    }
  } catch (err) {
    log.warn(`configure.yml dispatch threw for ${fullName}`, err);
  }

  return {
    repo: fullName,
    repo_url: `https://github.com/${fullName}`,
    url: launchedSiteUrl(opts.subdomain),
  };
}
