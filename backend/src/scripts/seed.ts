import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import { seedCmsBlueprint } from "../modules/cms-blueprint/seed";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              };
            }
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);

    return new WorkflowResponse(stores);
  }
);

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  const countries = ["gb", "de", "dk", "se", "fr", "es", "it"];

  logger.info("Seeding store data...");
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    // create the default sales channel
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
          },
        ],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        {
          currency_code: "eur",
          is_default: true,
        },
        {
          currency_code: "usd",
        },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });
  logger.info("Seeding region data...");
  let region;
  try {
    const { result: regionResult } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Europe",
            currency_code: "eur",
            countries,
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    region = regionResult[0];
    logger.info("Finished seeding regions.");
  } catch (error: any) {
    // If regions already exist, fetch the existing one
    if (error.message?.includes("already assigned to a region")) {
      logger.info("Regions already exist, fetching existing region...");
      try {
        const { data: regions } = await query.graph({
          entity: "region",
          fields: ["id", "name"],
        })
        if (regions && regions.length > 0) {
          region = regions[0];
          logger.info(`Using existing region: ${region.id}`);
        } else {
          throw error;
        }
      } catch (_queryError) {
        throw error;
      }
    } else {
      throw error;
    }
  }

  logger.info("Seeding tax regions...");
  try {
    await createTaxRegionsWorkflow(container).run({
      input: countries.map((country_code) => ({
        country_code,
        provider_id: "tp_system",
      })),
    });
    logger.info("Finished seeding tax regions.");
  } catch (error: any) {
    // Tax regions might already exist, that's okay
    if (error.message?.includes("already exists")) {
      logger.info("Tax regions already exist, skipping...");
    } else {
      logger.warn(`Warning seeding tax regions: ${error.message}`);
    }
  }

  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "European Warehouse",
          address: {
            city: "Copenhagen",
            country_code: "DK",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_location_id: stockLocation.id,
      },
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [
            {
              name: "Default Shipping Profile",
              type: "default",
            },
          ],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  logger.info("Seeding fulfillment set data...");
  let fulfillmentSet;
  try {
    fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "European Warehouse delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Europe",
          geo_zones: [
            {
              country_code: "gb",
              type: "country",
            },
            {
              country_code: "de",
              type: "country",
            },
            {
              country_code: "dk",
              type: "country",
            },
            {
              country_code: "se",
              type: "country",
            },
            {
              country_code: "fr",
              type: "country",
            },
            {
              country_code: "es",
              type: "country",
            },
            {
              country_code: "it",
              type: "country",
            },
          ],
        },
      ],
    });
    logger.info("Finished seeding fulfillment set.");
  } catch (error: any) {
    // If fulfillment set already exists, fetch the existing one
    if (error.message?.includes("already exists")) {
      logger.info("Fulfillment set already exists, fetching existing one...");
      const existingSets = await fulfillmentModuleService.listFulfillmentSets(
        {
          name: "European Warehouse delivery",
        },
        {
          relations: ["service_zones"],
        }
      );
      if (existingSets && existingSets.length > 0) {
        fulfillmentSet = existingSets[0];
        logger.info(`Using existing fulfillment set: ${fulfillmentSet.id}`);
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  // Create link between stock location and fulfillment set
  try {
    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_set_id: fulfillmentSet.id,
      },
    });
    logger.info("Created link between stock location and fulfillment set.");
  } catch (error: any) {
    if (
      error.message?.includes("Cannot create multiple links") ||
      error.message?.includes("already exists")
    ) {
      logger.info("Link between stock location and fulfillment set already exists, skipping...");
    } else {
      throw error;
    }
  }

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standard",
          description: "Ship in 2-3 days.",
          code: "standard",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            currency_code: "eur",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Ship in 24 hours.",
          code: "express",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            currency_code: "eur",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding stock location data.");

  logger.info("Seeding publishable API key data...");
  const { result: publishableApiKeyResult } = await createApiKeysWorkflow(
    container
  ).run({
    input: {
      api_keys: [
        {
          title: "Webshop",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  });
  const publishableApiKey = publishableApiKeyResult[0];

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding publishable API key data.");

  logger.info("Seeding product data...");

  // Seed Medusa core product types (these show in admin dashboard Product Types page)
  logger.info("Seeding product types...");
  const productModuleService = container.resolve(Modules.PRODUCT);
  try {
    const existingTypes = await productModuleService.listProductTypes({});
    if (!existingTypes || existingTypes.length === 0) {
      await productModuleService.createProductTypes([
        { value: "food", metadata: { allow_internal_fulfillment: true, community_priority: true } },
        { value: "land_access", metadata: { allow_internal_fulfillment: true, inventory_tracking: false, reservation_required: true } },
        { value: "tools_and_infrastructure", metadata: { allow_internal_fulfillment: true } },
        { value: "electronics_and_networks", metadata: { allow_internal_fulfillment: true } },
        { value: "digital_services", metadata: { allow_internal_fulfillment: true, digital: true } },
        { value: "community_and_events", metadata: { allow_internal_fulfillment: true, capacity_based: true } },
        { value: "mutual_aid", metadata: { allow_internal_fulfillment: true, manual_fulfillment_required: true, community_priority: true } },
        { value: "circular_economy", metadata: { allow_internal_fulfillment: true, requires_condition_grade: true } },
        { value: "membership", metadata: { allow_internal_fulfillment: true, digital: true } },
        { value: "experimental", metadata: { allow_internal_fulfillment: true, requires_governance_review: true } },
      ]);
      logger.info("Finished seeding product types.");
    } else {
      logger.info("Product types already exist, skipping...");
    }
  } catch (error: any) {
    logger.warn(`Warning seeding product types: ${error.message}`);
  }

  // Community-aligned product categories matching the new architecture
  const categoryNames = [
    "Fresh Produce",
    "Prepared Foods",
    "Pantry Staples",
    "Seeds & Starts",
    "Community Garden Plots",
    "Farm Tools",
    "Essentials",
    "Care Kits",
    "Repaired Goods",
    "Cooperative Access",
  ];

  let shouldSeedProducts = false;
  let categoryResult: any = [];

  try {
    const result = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: categoryNames.map((name) => ({
          name,
          is_active: true,
        })),
      },
    });
    categoryResult = result.result;
    shouldSeedProducts = categoryResult && categoryResult.length > 0;
    logger.info("Product categories created successfully.");
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      logger.info("Product categories already exist, skipping product seeding. Products can be created manually from the admin panel.");
      shouldSeedProducts = false;
    } else {
      throw error;
    }
  }

  // Seed product collections (operational logic layer)
  logger.info("Seeding product collections...");
  try {
    const existingCollections = await productModuleService.listProductCollections({});
    if (!existingCollections || existingCollections.length === 0) {
      await productModuleService.createProductCollections([
        {
          title: "Community-Grown",
          handle: "community-grown",
          metadata: {
            auto_approval: true,
            manual_fulfillment_required: true,
            community_priority: true,
            description: "Products grown by community members in shared or personal gardens",
          },
        },
        {
          title: "Community-Made",
          handle: "community-made",
          metadata: {
            auto_approval: true,
            manual_fulfillment_required: true,
            community_priority: true,
            description: "Items crafted, prepared, or assembled by community members",
          },
        },
        {
          title: "Shared Resources",
          handle: "shared-resources",
          metadata: {
            auto_approval: false,
            manual_fulfillment_required: true,
            inventory_tracking: false,
            requires_reservation: true,
            description: "Community-shared tools, spaces, and infrastructure",
          },
        },
        {
          title: "Mutual Aid Funded",
          handle: "mutual-aid-funded",
          metadata: {
            auto_approval: false,
            manual_fulfillment_required: true,
            tax_exempt: true,
            community_priority: true,
            description: "Items funded through community mutual aid contributions",
          },
        },
        {
          title: "Refurbished",
          handle: "refurbished",
          metadata: {
            auto_approval: true,
            manual_fulfillment_required: true,
            requires_condition_grade: true,
            description: "Repaired and restored items kept in community circulation",
          },
        },
        {
          title: "Pilot / Experimental",
          handle: "pilot-experimental",
          metadata: {
            auto_approval: false,
            requires_governance_review: true,
            manual_fulfillment_required: true,
            limited_availability: true,
            description: "Experimental products and projects requiring governance approval",
          },
        },
        {
          title: "EHS-Restricted",
          handle: "ehs-restricted",
          metadata: {
            auto_approval: false,
            requires_governance_review: true,
            requires_safety_certification: true,
            manual_fulfillment_required: true,
            description: "Items with environmental, health, or safety restrictions",
          },
        },
        {
          title: "Requires-Approval",
          handle: "requires-approval",
          metadata: {
            auto_approval: false,
            requires_governance_review: true,
            description: "Items requiring manual governance or admin approval before listing",
          },
        },
      ]);
      logger.info("Finished seeding product collections.");
    } else {
      logger.info("Product collections already exist, skipping...");
    }
  } catch (error: any) {
    logger.warn(`Warning seeding product collections: ${error.message}`);
  }

  if (shouldSeedProducts && categoryResult.length > 0) {
    const getCategoryId = (name: string) => {
      const category = categoryResult.find((cat: any) => cat.name === name);
      if (!category) {
        throw new Error(`Category "${name}" not found in categoryResult`);
      }
      return category.id;
    };

    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: "Organic Kale Bunch",
            category_ids: [getCategoryId("Fresh Produce")],
            description: "Locally grown organic kale from community garden plots. Harvested fresh each week.",
            handle: "organic-kale-bunch",
            weight: 250,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfile.id,
            options: [
              {
                title: "Size",
                values: ["Small", "Large"],
              },
            ],
            variants: [
              {
                title: "Small Bunch",
                sku: "KALE-SM",
                options: { Size: "Small" },
                prices: [
                  { amount: 300, currency_code: "eur" },
                  { amount: 350, currency_code: "usd" },
                ],
              },
              {
                title: "Large Bunch",
                sku: "KALE-LG",
                options: { Size: "Large" },
                prices: [
                  { amount: 500, currency_code: "eur" },
                  { amount: 600, currency_code: "usd" },
                ],
              },
            ],
            metadata: {
              product_type: "food",
              grown_by: "Community Garden Collective",
              allow_internal_fulfillment: true,
            },
            sales_channels: [{ id: defaultSalesChannel[0].id }],
          },
          {
            title: "Community Herb Seed Kit",
            category_ids: [getCategoryId("Seeds & Starts")],
            description: "Heirloom herb seed collection: basil, cilantro, parsley, dill. Saved from community gardens.",
            handle: "community-herb-seed-kit",
            weight: 50,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfile.id,
            options: [
              {
                title: "Kit",
                values: ["Standard"],
              },
            ],
            variants: [
              {
                title: "Standard Kit",
                sku: "SEED-HERB-KIT",
                options: { Kit: "Standard" },
                prices: [
                  { amount: 800, currency_code: "eur" },
                  { amount: 1000, currency_code: "usd" },
                ],
              },
            ],
            metadata: {
              product_type: "food",
              community_priority: true,
            },
            sales_channels: [{ id: defaultSalesChannel[0].id }],
          },
          {
            title: "10'x10' Garden Plot Access",
            category_ids: [getCategoryId("Community Garden Plots")],
            description: "Seasonal access to a 10x10 foot garden plot in the community growing space. Includes water and tool access.",
            handle: "garden-plot-10x10",
            weight: 0,
            status: ProductStatus.DRAFT,
            shipping_profile_id: shippingProfile.id,
            options: [
              {
                title: "Season",
                values: ["Spring", "Summer", "Fall"],
              },
            ],
            variants: [
              {
                title: "Spring Season",
                sku: "PLOT-10X10-SPR",
                options: { Season: "Spring" },
                prices: [
                  { amount: 2500, currency_code: "eur" },
                  { amount: 3000, currency_code: "usd" },
                ],
              },
              {
                title: "Summer Season",
                sku: "PLOT-10X10-SUM",
                options: { Season: "Summer" },
                prices: [
                  { amount: 2500, currency_code: "eur" },
                  { amount: 3000, currency_code: "usd" },
                ],
              },
              {
                title: "Fall Season",
                sku: "PLOT-10X10-FAL",
                options: { Season: "Fall" },
                prices: [
                  { amount: 2000, currency_code: "eur" },
                  { amount: 2500, currency_code: "usd" },
                ],
              },
            ],
            metadata: {
              product_type: "land_access",
              reservation_required: true,
              inventory_tracking: false,
            },
            sales_channels: [{ id: defaultSalesChannel[0].id }],
          },
          {
            title: "Winter Care Kit",
            category_ids: [getCategoryId("Care Kits")],
            description: "Community-assembled winter care package: warm socks, hand warmers, tea, and essential hygiene items.",
            handle: "winter-care-kit",
            weight: 1500,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: shippingProfile.id,
            options: [
              {
                title: "Size",
                values: ["Individual", "Family"],
              },
            ],
            variants: [
              {
                title: "Individual Kit",
                sku: "CARE-WINTER-IND",
                options: { Size: "Individual" },
                prices: [
                  { amount: 0, currency_code: "eur" },
                  { amount: 0, currency_code: "usd" },
                ],
              },
              {
                title: "Family Kit",
                sku: "CARE-WINTER-FAM",
                options: { Size: "Family" },
                prices: [
                  { amount: 0, currency_code: "eur" },
                  { amount: 0, currency_code: "usd" },
                ],
              },
            ],
            metadata: {
              product_type: "mutual_aid",
              mutual_aid_funded: true,
              manual_fulfillment_required: true,
            },
            sales_channels: [{ id: defaultSalesChannel[0].id }],
          },
        ],
      },
    });
    logger.info("Finished seeding product data.");
  } else {
    logger.info("Skipping product seeding since categories are not available. Products can be created manually from the admin panel.");
  }

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = [];
  for (const inventoryItem of inventoryItems) {
    const inventoryLevel = {
      location_id: stockLocation.id,
      stocked_quantity: 1000000,
      inventory_item_id: inventoryItem.id,
    };
    inventoryLevels.push(inventoryLevel);
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels,
    },
  });

  logger.info("Finished seeding inventory levels data.");

  // Seed CMS Blueprint data (types, categories, tags, attributes)
  logger.info("Seeding CMS Blueprint data...");
  try {
    await seedCmsBlueprint(container);
    logger.info("Finished seeding CMS Blueprint data.");
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      logger.info("CMS Blueprint data already exists, skipping...");
    } else {
      logger.warn(`Warning seeding CMS Blueprint data: ${error.message}`);
    }
  }
}
