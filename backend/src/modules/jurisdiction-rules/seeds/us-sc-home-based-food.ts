import type { JurisdictionProgram, RuleKind } from "../types"

/**
 * South Carolina, home-based food: the two archived sources and the sixteen
 * draft rules read from them. Version 1 only. Once
 * `src/scripts/seed-jurisdiction-rules.ts` has run, the database is the source
 * of truth and a correction is a new version through the admin API, not an
 * edit here.
 *
 * Every quote below was copied from the archived PDFs in `docs/sources/us-sc/`
 * (read 2026-11-21), not from the plan's summary of them. Quotes are verbatim
 * with line breaks joined by single spaces; the documents' own punctuation is
 * kept, including the typographic quotation marks, the dagger on the allergen
 * list and the apostrophe in "CAROLINA’S" (U+2019). Do not straighten them:
 * the label statement is a sentence a seller prints, and the content hash a
 * reviewer signs is taken over these exact characters.
 *
 * Four things about the sources that shaped what is and is not here:
 *
 * 1. **Page 2 of the FAQ is mostly a different legal path.** Its list of
 *    foods "exempted from requiring a Retail Food Establishment permit"
 *    (popcorn, jams and jellies, vinegars, boiled peanuts and more) is not a
 *    list of foods allowed under the home-based food law, and none of it is
 *    seeded. The one thing cited from page 2 is its separate question about
 *    meals and TCS foods (`tcs.permit_path`).
 * 2. **Both food lists on the fact sheet are partial.** "FOODS ALLOWED*" and
 *    "FOODS NOT ALLOWED*" carry the same asterisk, to a footnote pointing at
 *    SCDA's "Home-based Food Production Law Guidance" for a more complete
 *    list. That guidance is not archived. A food neither list names is "not
 *    covered by our sources", not "not allowed" and not "allowed".
 * 3. **Neither document says the Home-based Food ID is optional, or how to
 *    get one.** They say only that the label may carry it in place of the
 *    name and address.
 * 4. **Neither document states an effective date, an annual sales cap,
 *    anything about a food handler certificate, or anything about online
 *    orders, shipping or delivery.** The first is `effective_from: null` on
 *    every rule; the other three are `not_stated` rules, which cite both
 *    documents as read in full and carry no quote.
 *
 * Rules are information. Nothing reads `kind: "prohibition"` to refuse a
 * listing or a sale.
 */

export const US_SC = "US-SC"
export const HOME_BASED_FOOD: JurisdictionProgram = "home_based_food"

/**
 * South Carolina's required label statement, exactly as the fact sheet prints
 * it. The apostrophe is U+2019.
 */
export const US_SC_LABEL_STATEMENT =
  "PROCESSED AND PREPARED BY A HOME-BASED FOOD PRODUCTION OPERATION THAT IS NOT SUBJECT TO SOUTH CAROLINA’S FOOD SAFETY REGULATIONS."

export type SeedSourceKey = "fact_sheet" | "faq"

export type SeedSource = {
  key: SeedSourceKey
  jurisdiction_code: string
  issuer: string
  title: string
  url: string | null
  document_id: string | null
  document_date: string | null
  document_date_note: string | null
  retrieved_at: string
  content_sha256: string
  archive_ref: string
  notes: string | null
}

export const US_SC_SOURCES: SeedSource[] = [
  {
    key: "fact_sheet",
    jurisdiction_code: US_SC,
    issuer: "South Carolina Department of Agriculture",
    title: "Home-Based Food Production (Cottage Law)",
    url: "https://agriculture.sc.gov/retail-food-safety",
    document_id: "CPD Form #2210",
    document_date: "2026-05-01",
    document_date_note: "Printed in the footer as 5/1/26.",
    retrieved_at: "2026-11-17",
    content_sha256: "b19c9924721c9219b54f6c859e4733b97e8ad86caa7b29c13df0d8647fe7712c",
    archive_ref: "docs/sources/us-sc/scda-cpd-2210-home-based-food-production-2026-05-01.pdf",
    notes:
      "One-page fact sheet headed \"Retail Food Establishments\" and \"Regulation 61-25: Retail Food Establishments\"; it cites SC Law 44-1-143. " +
      "The address recorded here is the one printed in its footer; the address the file was downloaded from was not recorded. " +
      "Both of its food lists carry an asterisk to a footnote pointing at SCDA's \"Home-based Food Production Law Guidance\" for a more complete list. That guidance is not archived.",
  },
  {
    key: "faq",
    jurisdiction_code: US_SC,
    issuer: "South Carolina Department of Agriculture",
    title: "Are you interested in selling food out of your home?",
    url: "https://agriculture.sc.gov/wp-content/uploads/2025/07/RF_SellingFoodFromHomeFAQ2025.pdf",
    document_id: null,
    document_date: null,
    document_date_note:
      "No date or form number is printed on the document. The published file name says 2025, and the file's own metadata gives a creation date of 2025-05-02.",
    retrieved_at: "2026-11-17",
    content_sha256: "f1f6d6f95464188b0cbf261731f562422823dced8eda993fd7a7faeb34a3ef61",
    archive_ref: "docs/sources/us-sc/scda-selling-food-from-home-faq-2025.pdf",
    notes:
      "Two pages of questions and answers. Page 2's list of foods \"exempted from requiring a Retail Food Establishment permit\" is a different legal path from the home-based food law and is deliberately not recorded as home-based food rules. " +
      "Only page 1, and page 2's separate question about meals and TCS foods, are cited.",
  },
]

export type SeedCitation = {
  source: SeedSourceKey
  locator: string
  /** The source's own words. Left out only on a `not_stated` rule. */
  quote?: string
}

export type SeedRule = {
  rule_key: string
  kind: RuleKind
  value: Record<string, unknown>
  display_text: string
  citations: SeedCitation[]
  effective_from: string | null
  effective_note: string | null
}

const NO_EFFECTIVE_DATE = "Neither source states when this took effect."

// ---- The fact sheet's words ----

const FS_WHAT_IS = 'Section "What is home-based food production?"'
const FS_LABELING = 'Section "Labeling"'
const FS_RETAIL = 'Section "Requirements for retail establishments"'
const FS_ALLERGENS = 'Section "Allergens"'

const FS_DEFINITION =
  "Home-based food production, often referred to as “cottage food,” involves preparing non-potentially hazardous foods in a residential kitchen for sale directly to consumers or retail stores within South Carolina."
const FS_NO_PERMIT =
  "Home-based food producers are not required to obtain a retail food permit from the South Carolina Department of Agriculture."
const FS_LABEL_MUST_CONTAIN =
  "All cottage food produced and sold must be properly labeled and comply with SC Law 44-1-143. The label must contain:"
const FS_MAJOR_ALLERGENS =
  "The major food allergens are Wheat, Soy, Milk, Egg, Finfish†, Crustacean Shellfish†, Peanuts, Tree Nuts, and Sesame."
const FS_DAGGER = "†Not allowed as cottage food."
const FS_PERMIT_FOR_NOT_ALLOWED = "Making any food item that is not allowed will require a permit."
const FS_FULLER_LIST = "*See the Home-based Food Production Law Guidance for a more complete list of products."

const labelIntro: SeedCitation = {
  source: "fact_sheet",
  locator: `${FS_LABELING}, opening sentences`,
  quote: FS_LABEL_MUST_CONTAIN,
}

const readInFull: SeedCitation[] = [
  { source: "fact_sheet", locator: "Whole document (1 page), read in full" },
  { source: "faq", locator: "Whole document (2 pages), read in full" },
]

export const US_SC_HOME_BASED_FOOD_RULES: SeedRule[] = [
  {
    rule_key: "permit.retail_food_permit",
    kind: "fact",
    value: {
      retail_food_permit_required: false,
      permit_issuer: "South Carolina Department of Agriculture",
    },
    display_text:
      "A home-based food producer is not required to obtain a retail food permit from the South Carolina Department of Agriculture (SCDA).",
    citations: [
      { source: "fact_sheet", locator: `${FS_WHAT_IS}, second sentence`, quote: FS_NO_PERMIT },
      {
        source: "faq",
        locator: "Page 1, answer to the first question, fourth paragraph",
        quote:
          "The Home-based Food Production Law, also commonly referred to as the “Cottage Law” allows for certain foods that do not require time or temperature control to be sold without inspection or a permit.",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "label.producer_identity",
    kind: "requirement",
    value: {
      label_field: "producer_identity",
      one_of: ["name_and_address", "scda_home_based_food_id"],
      id_issuance_stated: false,
    },
    display_text:
      "The label must show the name and address of the home-based food operation, or its SCDA Home-based Food ID number. The sources do not say how that ID number is obtained, or whether one must be obtained.",
    citations: [
      labelIntro,
      {
        source: "fact_sheet",
        locator: `${FS_LABELING}, item 1`,
        quote: "Name and address of the home-based food operation or SCDA Home-based Food ID number.",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "label.product_name",
    kind: "requirement",
    value: { label_field: "product_name" },
    display_text: "The label must show the standard name of the product.",
    citations: [
      labelIntro,
      { source: "fact_sheet", locator: `${FS_LABELING}, item 2`, quote: "The standard name of the product." },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "label.ingredients",
    kind: "requirement",
    value: { label_field: "ingredients", order: "descending_predominance_by_weight" },
    display_text: "The label must list the product's ingredients in descending order of predominance by weight.",
    citations: [
      labelIntro,
      {
        source: "fact_sheet",
        locator: `${FS_LABELING}, item 3`,
        quote: "The ingredients in the product in descending order of predominance by weight.",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "label.statement",
    kind: "requirement",
    value: {
      label_field: "statement",
      text: US_SC_LABEL_STATEMENT,
      all_capitals: true,
      contrasting_color: true,
    },
    display_text:
      "The label must carry this statement, printed in all capital letters and in a color that clearly contrasts with the background: " +
      US_SC_LABEL_STATEMENT,
    citations: [
      labelIntro,
      {
        source: "fact_sheet",
        locator: `${FS_LABELING}, item 4`,
        quote:
          "A statement printed in all capital letters and in a color that provides a clear contrast to the background that reads: " +
          US_SC_LABEL_STATEMENT,
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "claims.health",
    kind: "prohibition",
    value: { health_claims_allowed: false },
    display_text: "No health claims may be made in association with food produced in a home-based food operation.",
    citations: [
      {
        source: "fact_sheet",
        locator: `${FS_LABELING}, closing sentence`,
        quote: "No health claims may be made in association with foods produced in a home-based food operation.",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "allergens.declaration",
    kind: "requirement",
    value: {
      one_of: ["list_each_major_allergen_by_name", "disclaimer_may_contain_any_major_allergen"],
      // `key` is the cottage-food label's allergen key; `label` is the fact sheet's word.
      major_allergens: [
        { key: "wheat", label: "Wheat" },
        { key: "soybeans", label: "Soy" },
        { key: "milk", label: "Milk" },
        { key: "eggs", label: "Egg" },
        { key: "fish", label: "Finfish", not_allowed_as_cottage_food: true },
        { key: "crustacean_shellfish", label: "Crustacean Shellfish", not_allowed_as_cottage_food: true },
        { key: "peanuts", label: "Peanuts" },
        { key: "tree_nuts", label: "Tree Nuts" },
        { key: "sesame", label: "Sesame" },
      ],
    },
    display_text:
      "The allergen statement must list each major allergen by name, or include a disclaimer that the food may contain any major allergen. " +
      "The fact sheet names nine major food allergens: wheat, soy, milk, egg, finfish, crustacean shellfish, peanuts, tree nuts and sesame. " +
      "It marks finfish and crustacean shellfish as not allowed as cottage food.",
    citations: [
      {
        source: "fact_sheet",
        locator: `${FS_ALLERGENS}, first paragraph`,
        quote:
          "The allergen statement must list each major allergen by name or include a disclaimer that the food may contain any major allergen.",
      },
      { source: "fact_sheet", locator: `${FS_ALLERGENS}, second paragraph, first sentence`, quote: FS_MAJOR_ALLERGENS },
      { source: "fact_sheet", locator: `${FS_ALLERGENS}, footnote`, quote: FS_DAGGER },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "allergens.tree_nut_type",
    kind: "requirement",
    value: { applies_to_allergen: "tree_nuts", name_specific_type: true, examples: ["walnuts", "pecans", "almonds"] },
    display_text:
      "If a home-based food item contains tree nuts, the allergen statement must name the specific type, for example walnuts, pecans or almonds.",
    citations: [
      {
        source: "fact_sheet",
        locator: `${FS_ALLERGENS}, second paragraph, second sentence`,
        quote:
          "If a home-based food item contains tree nuts, the specific type must be labeled in the allergen statement (e.g., walnuts, pecans, almonds, etc.).",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "foods.allowed",
    kind: "permission",
    value: {
      list_is_partial: true,
      fuller_list: { title: "Home-based Food Production Law Guidance", archived: false },
      items: [
        { key: "shelf_stable_cakes", label: "Shelf-stable cakes" },
        { key: "shelf_stable_cookies", label: "Shelf-stable cookies" },
        { key: "shelf_stable_cupcakes", label: "Shelf-stable cupcakes" },
        { key: "dried_herbs_and_spices", label: "Dried herbs and spices" },
        { key: "pie_and_pie_fillings_high_acid", label: "Pie and pie fillings (high acid)" },
        { key: "roasted_nuts", label: "Roasted nuts" },
        { key: "sourdough_bread_commercial_starter", label: "Sourdough bread (made with commercial sourdough starter)" },
      ],
      general_description: {
        foods: ["baked goods (without cream fillings)", "candies", "cookies", "most breads"],
        conditions: [
          "does not require time or temperature control",
          "made and packaged in the home kitchen",
          "labeled according to the law",
        ],
      },
    },
    display_text:
      "The fact sheet lists these foods as allowed: shelf-stable cakes; shelf-stable cookies; shelf-stable cupcakes; dried herbs and spices; pie and pie fillings (high acid); roasted nuts; sourdough bread (made with commercial sourdough starter). " +
      "The list is partial: the fact sheet points to SCDA's Home-based Food Production Law Guidance for a more complete list, which is not among our sources. " +
      "SCDA's FAQ says the law allows certain foods that do not require time or temperature control (non-TCS) to be sold without inspection or a permit, generally baked goods (without cream fillings), candies, cookies and most breads, and that they must be made and packaged in the home kitchen and labeled according to the law. " +
      "A food on neither this list nor the fact sheet's list of foods not allowed is not covered by our sources: it may or may not be allowed, and the fuller SCDA guidance is not among our sources.",
    citations: [
      {
        source: "fact_sheet",
        locator: 'List "Foods allowed"',
        quote:
          "FOODS ALLOWED* • Shelf-stable cakes • Shelf-stable cookies • Shelf-stable cupcakes • Dried herbs and spices • Pie and pie fillings (high acid) • Roasted nuts • Sourdough bread (made with commercial sourdough starter)",
      },
      { source: "fact_sheet", locator: "Footnote to both food lists", quote: FS_FULLER_LIST },
      {
        source: "faq",
        locator: "Page 1, answer to the first question, fourth paragraph",
        quote:
          "The Home-based Food Production Law, also commonly referred to as the “Cottage Law” allows for certain foods that do not require time or temperature control to be sold without inspection or a permit. " +
          "These foods are referred to as “non-potentially hazardous foods” and are also called “non-time/temperature control for food safety foods” (non-TCS) foods. " +
          "These are generally baked goods (without cream fillings), candies, cookies, and most breads. " +
          "The foods must be made and packaged in the home kitchen and labeled according to the law to show that they were made in an uninspected kitchen.",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "foods.not_allowed",
    kind: "prohibition",
    value: {
      list_is_partial: true,
      fuller_list: { title: "Home-based Food Production Law Guidance", archived: false },
      making_one_requires_permit: true,
      items: [
        {
          key: "tcs_foods",
          label: "Time/temperature controlled for safety foods",
          examples: ["casseroles", "meats", "seafood", "ice cream"],
        },
        { key: "bottled_beverages", label: "Bottled beverages" },
        { key: "cheesecake", label: "Cheesecake" },
        { key: "charcuterie_boards", label: "Charcuterie boards" },
        { key: "hot_sauce_and_bbq_sauce", label: "Hot sauce and BBQ sauce" },
        { key: "finfish", label: "Finfish", stated_in: "allergens_footnote" },
        { key: "crustacean_shellfish", label: "Crustacean Shellfish", stated_in: "allergens_footnote" },
      ],
    },
    display_text:
      "The fact sheet lists these foods as not allowed: time/temperature controlled for safety foods (for example casseroles, meats, seafood or ice cream); bottled beverages; cheesecake; charcuterie boards; hot sauce and BBQ sauce. " +
      "In its allergen list it also marks finfish and crustacean shellfish as not allowed as cottage food. " +
      "Making any food item that is not allowed requires a permit. " +
      "This list is partial too: it carries the same pointer to SCDA's Home-based Food Production Law Guidance, which is not among our sources.",
    citations: [
      {
        source: "fact_sheet",
        locator: 'List "Foods not allowed"',
        quote:
          "FOODS NOT ALLOWED* • Time/temperature controlled for safety foods (e.g. casseroles, meats, seafood, or ice cream) • Bottled beverages • Cheesecake • Charcuterie boards • Hot sauce and BBQ sauce",
      },
      { source: "fact_sheet", locator: 'List "Foods not allowed", closing sentence', quote: FS_PERMIT_FOR_NOT_ALLOWED },
      { source: "fact_sheet", locator: "Footnote to both food lists", quote: FS_FULLER_LIST },
      { source: "fact_sheet", locator: `${FS_ALLERGENS}, second paragraph, first sentence`, quote: FS_MAJOR_ALLERGENS },
      { source: "fact_sheet", locator: `${FS_ALLERGENS}, footnote`, quote: FS_DAGGER },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "sales.area",
    // A fact, not a requirement: the fact sheet defines the activity as sales
    // within the state and says nothing about sales outside it, so reading a
    // rule ("sales must stay in South Carolina") into it would assert more
    // than the source does.
    kind: "fact",
    value: { defined_as_sales_within: US_SC, sales_outside_state_addressed: false },
    display_text:
      "The fact sheet defines home-based food production as preparing food for sale directly to consumers or retail stores within South Carolina; it does not address sales outside the state.",
    citations: [{ source: "fact_sheet", locator: `${FS_WHAT_IS}, first sentence`, quote: FS_DEFINITION }],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "sales.channels",
    kind: "permission",
    value: {
      channels: [
        { key: "direct_to_consumer" },
        { key: "retail_store", conditions: ["original_packaging", "store_posts_sign"] },
        { key: "restaurant_service_or_ingredient", conditions: ["scda_approved_variance"] },
      ],
      retail_sign_text: US_SC_LABEL_STATEMENT,
    },
    display_text:
      "Home-based food may be sold directly to consumers or to retail stores within South Carolina. " +
      "A retail food establishment can sell it in its original packaging from the producer, and must clearly post a sign carrying the home-based food statement. " +
      "It may be served or used as an ingredient in a retail food establishment (restaurant) with a variance approved by SCDA, which the establishment's operator applies for.",
    citations: [
      { source: "fact_sheet", locator: `${FS_WHAT_IS}, first sentence`, quote: FS_DEFINITION },
      {
        source: "fact_sheet",
        locator: `${FS_RETAIL}, first paragraph and the statement that follows it`,
        quote:
          "Retail food establishments can sell cottage food in its original packaging from the home-based food producer. Retail establishments must clearly post a sign indicating that the home-based food products are not subject to commercial food regulations that reads: " +
          US_SC_LABEL_STATEMENT,
      },
      {
        source: "fact_sheet",
        locator: `${FS_RETAIL}, last paragraph`,
        quote:
          "Home-based food may be served or used as an ingredient in a retail food establishment (restaurant) with a variance approved by SCDA. The operator of the retail food establishment is required to submit a variance proposal stating how the consumer will be informed that the food or ingredient was prepared in a home-based food production operation. The consumer advisory must contain the above bolded statement about the food, or the ingredient.",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "tcs.permit_path",
    kind: "fact",
    value: {
      applies_to: "tcs_foods",
      permit_required: true,
      routes: [
        {
          key: "shared_use_kitchen",
          regulation: "SCDA Regulation 61-25",
          chapter: "9-5",
          chapter_title: "Shared Use Kitchens",
        },
      ],
    },
    display_text:
      "Time/temperature controlled for safety (TCS) foods are not allowed as home-based food, and making them requires a permit. " +
      "For someone who wants to sell meals or TCS foods, SCDA's FAQ describes one route: under SCDA Regulation 61-25, a person can obtain a permit and share kitchen time and space at a permitted Retail Food Establishment. The requirements are in Chapter 9-5, \"Shared Use Kitchens\".",
    citations: [
      {
        source: "fact_sheet",
        locator: 'List "Foods not allowed", first item',
        quote: "Time/temperature controlled for safety foods (e.g. casseroles, meats, seafood, or ice cream)",
      },
      { source: "fact_sheet", locator: 'List "Foods not allowed", closing sentence', quote: FS_PERMIT_FOR_NOT_ALLOWED },
      {
        source: "faq",
        locator: "Page 2, second question (the document's third)",
        quote: "What if I want to sell meals or foods that are “potentially hazardous” or TCS? How can I do this on a budget?",
      },
      {
        source: "faq",
        locator: "Page 2, answer to the second question (the document's third)",
        quote:
          "If you can’t afford to build or rent a commercial kitchen, you do have another option. SCDA Regulation 61-25 explains how you can obtain a permit and “share” kitchen time and space at a permitted Retail Food Establishment. These specially designated commercial kitchens are operated by a person who rents time and space in the establishment and allows for you to have a permit using their kitchen. The requirements for getting a permit under this section of the regulation is covered in Chapter 9-5, “Shared Use Kitchens.”",
      },
    ],
    effective_from: null,
    effective_note: NO_EFFECTIVE_DATE,
  },
  {
    rule_key: "sales.annual_cap",
    kind: "not_stated",
    value: { topic: "annual_sales_cap" },
    display_text:
      "Not addressed by our sources: neither document names an annual sales cap, or any limit on how much a home-based food producer may sell.",
    citations: readInFull,
    effective_from: null,
    effective_note: null,
  },
  {
    rule_key: "food_handler.certificate",
    kind: "not_stated",
    value: { topic: "food_handler_certificate" },
    display_text:
      "Not addressed by our sources: neither document mentions a food handler card, certificate or food safety training.",
    citations: readInFull,
    effective_from: null,
    effective_note: null,
  },
  {
    rule_key: "sales.online_delivery",
    kind: "not_stated",
    value: { topic: "online_orders_shipping_delivery" },
    display_text:
      "Not addressed by our sources: neither document says anything about online orders, shipping or delivery within South Carolina.",
    citations: readInFull,
    effective_from: null,
    effective_note: null,
  },
]

/** The keys coverage requires, in the order readers are shown them: all sixteen. */
export const US_SC_REQUIRED_RULE_KEYS: string[] = US_SC_HOME_BASED_FOOD_RULES.map((rule) => rule.rule_key)
