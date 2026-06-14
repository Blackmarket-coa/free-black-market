import { Module } from "@medusajs/framework/utils"
import KnowledgeBaseService from "./service"

export const KNOWLEDGE_BASE_MODULE = "knowledge_base"

export default Module(KNOWLEDGE_BASE_MODULE, {
  service: KnowledgeBaseService,
})

export * from "./models"
export {
  KB_SEED_ARTICLES,
  filterArticles,
  type KbSeedArticle,
  type KbType,
  type KbFilter,
} from "./catalog"
