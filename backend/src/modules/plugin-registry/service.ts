import { ContainerRegistrationKeys, MedusaService } from "@medusajs/framework/utils"
import { PluginListing, PluginVersion } from "./models"
import { PluginCategory, PluginStatus } from "./models/plugin-listing"
import { isValidSemverString } from "./compat"
import { decideRecordVersion, pickLatest } from "./versions"

/**
 * Plugin ecosystem (§16) module service. Owns the discovery catalog of
 * installable extensions/analytics/automation tools, the immutable
 * per-version history (W3), and the install counter. The actual per-seller
 * enablement lives on seller-extension's `enabled_extensions`; this module is
 * the registry + counts.
 */

export type RecordVersionInput = {
  plugin_listing_id?: string | null
  slug: string
  version: string
  min_host_version?: string | null
  max_host_version?: string | null
  manifest?: Record<string, unknown> | null
  manifest_url?: string | null
  signed_bundle_url?: string | null
  signature_envelope?: Record<string, unknown> | null
  signing_key_id?: string | null
  code_sha256?: string | null
  source_listing_id?: string | null
  published_at?: Date
  metadata?: Record<string, unknown> | null
}

export type PublishExtensionInput = {
  slug: string
  name: string
  category: PluginCategory
  description: string
  authorSellerId: string
  version: string
  minHostVersion?: string | null
  maxHostVersion?: string | null
  manifestUrl?: string | null
  iconUrl?: string | null
  version_record: Omit<RecordVersionInput, "slug" | "version" | "plugin_listing_id">
}

/** Typed error the publish route maps to its 409s. */
export class PluginRegistryConflictError extends Error {
  constructor(
    public readonly type: "plugin_slug_taken" | "version_already_published",
    message: string
  ) {
    super(message)
    this.name = "PluginRegistryConflictError"
  }
}

const isUniqueViolation = (err: unknown): boolean => {
  const anyErr = err as { code?: string; message?: string }
  return (
    anyErr?.code === "23505" ||
    /duplicate key|UQ_plugin_version_slug_version/i.test(anyErr?.message ?? "")
  )
}

class PluginRegistryService extends MedusaService({
  PluginListing,
  PluginVersion,
}) {
  async listPublished(filters?: { category?: string; limit?: number }) {
    const where: Record<string, unknown> = { status: PluginStatus.PUBLISHED }
    if (filters?.category) {
      where.category = filters.category
    }
    return this.listPluginListings(where, {
      take: filters?.limit || 100,
      order: { install_count: "DESC", name: "ASC" },
    })
  }

  async getBySlug(slug: string) {
    const [plugin] = await this.listPluginListings({ slug })
    return plugin || null
  }

  /**
   * Resolve a knex-style pg connection with `.raw` for atomic updates the
   * MedusaService CRUD can't express. Mirrors the resolver in
   * modules/demand-pool/service.ts (itself from hawala-ledger). Returns
   * undefined when no connection is reachable (e.g. unit tests without DI).
   */
  private resolvePgConnection():
    | { raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }> }
    | undefined {
    const container = (this as unknown as { __container__?: Record<string, unknown> })
      .__container__ as
      | { resolve?: (key: string) => unknown; [key: string]: unknown }
      | undefined
    try {
      const pg = (container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]) as
        | { raw?: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }> }
        | undefined
      if (pg?.raw) return pg as { raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }> }
    } catch {
      // fall through
    }
    try {
      const em =
        (this as unknown as { baseRepository_?: { getActiveManager?: () => unknown } })
          .baseRepository_?.getActiveManager?.() ??
        (container as { manager?: unknown } | undefined)?.manager
      const knex = (em as { getConnection?: () => { getKnex?: () => unknown } } | undefined)
        ?.getConnection?.()
        ?.getKnex?.() as
        | { raw?: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }> }
        | undefined
      if (knex?.raw) return knex as { raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }> }
    } catch {
      // no reachable connection
    }
    return undefined
  }

  /**
   * Increment install count. Atomic (`SET install_count = install_count + 1`)
   * when a pg connection is reachable; falls back to the historical
   * read-modify-write otherwise so DI-less unit harnesses keep working.
   */
  async incrementInstallCount(slug: string) {
    const pg = this.resolvePgConnection()
    if (pg) {
      const result = await pg.raw(
        `UPDATE "plugin_listing"
            SET "install_count" = "install_count" + 1, "updated_at" = NOW()
          WHERE "slug" = ? AND "deleted_at" IS NULL
        RETURNING *`,
        [slug]
      )
      const row = result?.rows?.[0] as
        | (Record<string, unknown> & { id: string; slug: string; install_count: number })
        | undefined
      if (!row) {
        throw new Error(`Plugin "${slug}" not found`)
      }
      return row
    }
    const [plugin] = await this.listPluginListings({ slug })
    if (!plugin) {
      throw new Error(`Plugin "${slug}" not found`)
    }
    await this.updatePluginListings({
      id: plugin.id,
      install_count: Number(plugin.install_count) + 1,
    })
    const [updated] = await this.listPluginListings({ id: plugin.id })
    return updated
  }

  /** Decrement install count, clamped at zero (uninstall path). */
  async decrementInstallCount(slug: string) {
    const pg = this.resolvePgConnection()
    if (pg) {
      const result = await pg.raw(
        `UPDATE "plugin_listing"
            SET "install_count" = GREATEST("install_count" - 1, 0), "updated_at" = NOW()
          WHERE "slug" = ? AND "deleted_at" IS NULL
        RETURNING *`,
        [slug]
      )
      const row = result?.rows?.[0] as
        | (Record<string, unknown> & { id: string; slug: string; install_count: number })
        | undefined
      if (!row) {
        throw new Error(`Plugin "${slug}" not found`)
      }
      return row
    }
    const [plugin] = await this.listPluginListings({ slug })
    if (!plugin) {
      throw new Error(`Plugin "${slug}" not found`)
    }
    await this.updatePluginListings({
      id: plugin.id,
      install_count: Math.max(Number(plugin.install_count) - 1, 0),
    })
    const [updated] = await this.listPluginListings({ id: plugin.id })
    return updated
  }

  // --- version history (W3) -------------------------------------------------

  async listVersions(slug: string, opts: { includeYanked?: boolean } = {}) {
    const rows = await this.listPluginVersions({ slug }, { take: 500 })
    const filtered = opts.includeYanked ? rows : rows.filter((row) => !row.yanked_at)
    return [...filtered].sort((a, b) => {
      // Newest-first by published_at as a stable secondary; primary ordering
      // (semver precedence) is what pickLatest resolves.
      const ta = new Date(a.published_at as unknown as string).getTime()
      const tb = new Date(b.published_at as unknown as string).getTime()
      return tb - ta
    })
  }

  async getLatestVersion(slug: string) {
    const rows = await this.listPluginVersions({ slug }, { take: 500 })
    return pickLatest(rows)
  }

  /**
   * Record one immutable `(slug, version)`. Idempotent for byte-identical
   * retries (same code_sha256); a different artifact under the same version
   * is refused. The unique index decides concurrent races — on violation the
   * row is re-read and the same decision applies.
   */
  async recordVersion(input: RecordVersionInput) {
    if (!isValidSemverString(input.version)) {
      throw new Error(`Invalid semver version "${input.version}"`)
    }
    for (const bound of [input.min_host_version, input.max_host_version]) {
      if (bound && !isValidSemverString(bound)) {
        throw new Error(`Invalid semver host bound "${bound}"`)
      }
    }
    const [existing] = await this.listPluginVersions({
      slug: input.slug,
      version: input.version,
    })
    const decision = decideRecordVersion(existing ?? null, input)
    if (decision === "already-recorded") {
      return { created: false as const, version: existing }
    }
    if (decision === "conflict") {
      throw new PluginRegistryConflictError(
        "version_already_published",
        `Version ${input.version} of "${input.slug}" is already published with a different artifact`
      )
    }
    try {
      const created = await this.createPluginVersions({
        ...input,
        published_at: input.published_at ?? new Date(),
      })
      return { created: true as const, version: created }
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err
      }
      const [raced] = await this.listPluginVersions({
        slug: input.slug,
        version: input.version,
      })
      if (raced && decideRecordVersion(raced, input) === "already-recorded") {
        return { created: false as const, version: raced }
      }
      throw new PluginRegistryConflictError(
        "version_already_published",
        `Version ${input.version} of "${input.slug}" is already published with a different artifact`
      )
    }
  }

  /** Hide a version from resolution without deleting the record. */
  async yankVersion(slug: string, version: string) {
    const [row] = await this.listPluginVersions({ slug, version })
    if (!row) {
      throw new Error(`Version ${version} of "${slug}" not found`)
    }
    await this.updatePluginVersions({ id: row.id, yanked_at: new Date() })
    const [updated] = await this.listPluginVersions({ id: row.id })
    return updated
  }

  /**
   * The publish bridge's single entry point: upsert the catalog row (latest)
   * and insert the version record. Ownership: a slug already claimed by a
   * different author (first-party seeds included — author null) is refused.
   * Not a DB transaction (marketplace convention is compensation + idempotent
   * retry): a listing row created here is deleted again if the version write
   * fails, and a crash between the two writes converges on the retried
   * publish because recordVersion is idempotent for identical artifacts.
   */
  async publishExtensionVersion(input: PublishExtensionInput) {
    if (!isValidSemverString(input.version)) {
      throw new Error(`Invalid semver version "${input.version}"`)
    }
    const existing = await this.getBySlug(input.slug)
    if (existing && existing.author_seller_id !== input.authorSellerId) {
      throw new PluginRegistryConflictError(
        "plugin_slug_taken",
        `Plugin slug "${input.slug}" is owned by another author`
      )
    }

    let listing = existing
    let createdListing = false
    const listingFields = {
      name: input.name,
      category: input.category,
      description: input.description,
      author_seller_id: input.authorSellerId,
      version: input.version,
      min_host_version: input.minHostVersion ?? null,
      max_host_version: input.maxHostVersion ?? null,
      manifest_url: input.manifestUrl ?? null,
      ...(input.iconUrl !== undefined ? { icon_url: input.iconUrl } : {}),
      // Publishing a new version by the author revives a deprecated listing.
      status: PluginStatus.PUBLISHED,
    }
    if (!listing) {
      try {
        listing = await this.createPluginListings({ slug: input.slug, ...listingFields })
        createdListing = true
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err
        }
        // Concurrent first publish: the DB unique on slug decided the race.
        const raced = await this.getBySlug(input.slug)
        if (!raced || raced.author_seller_id !== input.authorSellerId) {
          throw new PluginRegistryConflictError(
            "plugin_slug_taken",
            `Plugin slug "${input.slug}" is owned by another author`
          )
        }
        listing = raced
      }
    } else {
      await this.updatePluginListings({ id: listing.id, ...listingFields })
      listing = await this.getBySlug(input.slug)
    }

    try {
      const record = await this.recordVersion({
        ...input.version_record,
        plugin_listing_id: listing!.id,
        slug: input.slug,
        version: input.version,
        min_host_version: input.minHostVersion ?? null,
        max_host_version: input.maxHostVersion ?? null,
      })
      return { listing: listing!, ...record }
    } catch (err) {
      if (createdListing && listing) {
        // Compensation: never leave a version-less catalog claim behind.
        try {
          await this.deletePluginListings(listing.id)
        } catch {
          // best-effort — the retried publish converges either way
        }
      }
      throw err
    }
  }
}

export default PluginRegistryService
