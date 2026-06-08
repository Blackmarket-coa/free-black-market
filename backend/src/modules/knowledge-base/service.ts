import { MedusaService } from "@medusajs/framework/utils"
import { KbArticle, KbContribution } from "./models"
import { KbArticleStatus } from "./models/kb-article"
import { KbContributionStatus } from "./models/kb-contribution"

/**
 * Product Knowledge Base (§14) module service. Owns DIY/gardening/substitution
 * articles and the community-contribution moderation queue.
 */
class KnowledgeBaseService extends MedusaService({
  KbArticle,
  KbContribution,
}) {
  /** Submit a community contribution (pending moderation). */
  async submitContribution(input: {
    submitter_id: string
    submitter_type?: "CUSTOMER" | "SELLER"
    title: string
    type?: string
    payload: Record<string, unknown>
  }) {
    const [contribution] = await this.createKbContributions([
      {
        submitter_id: input.submitter_id,
        submitter_type: input.submitter_type || "CUSTOMER",
        title: input.title,
        type: input.type || "DIY",
        payload: input.payload,
        status: KbContributionStatus.PENDING,
      },
    ])
    return contribution
  }

  /**
   * Approve a contribution: publish it as an article and link the two.
   * Idempotent — a contribution already APPROVED returns its existing article.
   */
  async approveContribution(
    contributionId: string,
    reviewerId: string,
    overrides?: { slug?: string; category?: string; difficulty?: string }
  ) {
    const [c] = await this.listKbContributions({ id: contributionId })
    if (!c) {
      throw new Error(`Contribution ${contributionId} not found`)
    }
    if (c.status === KbContributionStatus.APPROVED && c.resulting_article_id) {
      const [existing] = await this.listKbArticles({
        id: c.resulting_article_id,
      })
      return existing
    }

    const payload = (c.payload || {}) as Record<string, any>
    const slug =
      overrides?.slug ||
      payload.slug ||
      `${slugify(c.title)}-${contributionId.slice(-6)}`

    const [article] = await this.createKbArticles([
      {
        slug,
        title: c.title,
        type: (c.type as any) || "DIY",
        summary: payload.summary || "",
        body: payload.body || "",
        category: overrides?.category || payload.category || null,
        difficulty: overrides?.difficulty || payload.difficulty || "Beginner",
        climate_zone: payload.climate_zone || null,
        space: payload.space || null,
        materials: payload.materials || null,
        steps: payload.steps || null,
        author_id: c.submitter_id,
        contributed_by_community: true,
        status: KbArticleStatus.PUBLISHED,
      },
    ])

    await this.updateKbContributions({
      id: contributionId,
      status: KbContributionStatus.APPROVED,
      decided_by: reviewerId,
      decided_at: new Date(),
      resulting_article_id: article.id,
    })

    return article
  }

  async rejectContribution(
    contributionId: string,
    reviewerId: string,
    note?: string
  ) {
    const [c] = await this.listKbContributions({ id: contributionId })
    if (!c) {
      throw new Error(`Contribution ${contributionId} not found`)
    }
    await this.updateKbContributions({
      id: contributionId,
      status: KbContributionStatus.REJECTED,
      decided_by: reviewerId,
      decided_at: new Date(),
      review_note: note ?? null,
    })
    const [updated] = await this.listKbContributions({ id: contributionId })
    return updated
  }
}

function slugify(s: string): string {
  return (s || "article")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60)
}

export default KnowledgeBaseService
