#!/usr/bin/env node
/**
 * Patch MercurJS B2C Core
 *
 * Fixes "Cannot read properties of undefined (reading 'store_status')" errors
 * by adding null-safety to MercurJS's storeActiveGuard, filterBySellerId, and
 * fetchSellerByAuthActorId.
 *
 * Root cause: MercurJS's fetchSellerByAuthActorId queries sellers by members.id,
 * which requires a member ID (mem_*). When the JWT contains a seller ID (sel_*)
 * or the member isn't found, the function returns undefined. The storeActiveGuard
 * then crashes accessing .store_status on undefined.
 *
 * This script patches the compiled JS files in node_modules to:
 * 1. Make fetchSellerByAuthActorId try both member ID and seller ID lookups
 * 2. Add null checks in storeActiveGuard and filterBySellerId
 */

const fs = require('fs');
const path = require('path');

function log(message) {
  console.log(`[PATCH] ${message}`);
}

function findFile(baseDirs, relativePath) {
  for (const baseDir of baseDirs) {
    const fullPath = path.join(baseDir, relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function findMercurjsDir() {
  const cwd = process.cwd();
  const candidates = [];

  // Direct node_modules (for hoisted packages)
  candidates.push(path.join(cwd, 'node_modules', '@mercurjs', 'b2c-core'));
  candidates.push(path.join(cwd, '.medusa', 'server', 'node_modules', '@mercurjs', 'b2c-core'));

  // pnpm store (glob for the hash-based directory)
  const pnpmDir = path.join(cwd, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    try {
      const entries = fs.readdirSync(pnpmDir);
      for (const entry of entries) {
        if (entry.startsWith('@mercurjs+b2c-core@')) {
          const candidate = path.join(pnpmDir, entry, 'node_modules', '@mercurjs', 'b2c-core');
          if (fs.existsSync(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    } catch (e) {
      // Ignore readdir errors
    }
  }

  // Also check .medusa/server pnpm dir
  const medusaPnpmDir = path.join(cwd, '.medusa', 'server', 'node_modules', '.pnpm');
  if (fs.existsSync(medusaPnpmDir)) {
    try {
      const entries = fs.readdirSync(medusaPnpmDir);
      for (const entry of entries) {
        if (entry.startsWith('@mercurjs+b2c-core@')) {
          const candidate = path.join(medusaPnpmDir, entry, 'node_modules', '@mercurjs', 'b2c-core');
          if (fs.existsSync(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    } catch (e) {
      // Ignore readdir errors
    }
  }

  return candidates.filter(c => fs.existsSync(c));
}

function patchStoreActiveGuard(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if already patched
  if (content.includes('// PATCHED: null-safe store_status check')) {
    log(`  Already patched: ${filePath}`);
    return false;
  }

  // Original code:
  //   const seller = await (0, seller_1.fetchSellerByAuthActorId)(req.auth_context.actor_id, req.scope, ['store_status']);
  //   const isActiveStore = seller.store_status === framework_1.StoreStatus.ACTIVE;
  //   const isGetRequest = req.method === 'GET';
  //   if (isActiveStore || isGetRequest) {
  //       return next();
  //   }
  //
  // Patched: handle undefined seller gracefully

  const patched = content.replace(
    /const seller = await \(0, seller_1\.fetchSellerByAuthActorId\)\(req\.auth_context\.actor_id, req\.scope, \['store_status'\]\);\s*const isActiveStore = seller\.store_status === framework_1\.StoreStatus\.ACTIVE;\s*const isGetRequest = req\.method === 'GET';\s*if \(isActiveStore \|\| isGetRequest\) \{\s*return next\(\);\s*\}/,
    `// PATCHED: null-safe store_status check
    const seller = await (0, seller_1.fetchSellerByAuthActorId)(req.auth_context.actor_id, req.scope, ['store_status']);
    const isGetRequest = req.method === 'GET';
    if (!seller) {
        if (isGetRequest) { return next(); }
        return res.status(403).json({ message: 'Seller not found for current user' });
    }
    const isActiveStore = seller.store_status === framework_1.StoreStatus.ACTIVE;
    if (isActiveStore || isGetRequest) {
        return next();
    }`
  );

  if (patched === content) {
    log(`  Could not match pattern in: ${filePath}`);
    return false;
  }

  fs.writeFileSync(filePath, patched);
  log(`  Patched: ${filePath}`);
  return true;
}

function patchFilterBySellerId(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (content.includes('// PATCHED: null-safe seller check')) {
    log(`  Already patched: ${filePath}`);
    return false;
  }

  // Original:
  //   const seller = await (0, seller_1.fetchSellerByAuthActorId)(req.auth_context.actor_id, req.scope);
  //   req.filterableFields.seller_id = seller.id;
  //
  // Patched: handle undefined seller

  const patched = content.replace(
    /const seller = await \(0, seller_1\.fetchSellerByAuthActorId\)\(req\.auth_context\.actor_id, req\.scope\);\s*req\.filterableFields\.seller_id = seller\.id;/,
    `// PATCHED: null-safe seller check
        const seller = await (0, seller_1.fetchSellerByAuthActorId)(req.auth_context.actor_id, req.scope);
        if (!seller) {
            req.filterableFields.seller_id = req.auth_context.actor_id;
        } else {
            req.filterableFields.seller_id = seller.id;
        }`
  );

  if (patched === content) {
    log(`  Could not match pattern in: ${filePath}`);
    return false;
  }

  fs.writeFileSync(filePath, patched);
  log(`  Patched: ${filePath}`);
  return true;
}

function patchFetchSellerByAuthActorId(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (content.includes('// PATCHED: handle sel_ IDs and undefined results')) {
    log(`  Already patched: ${filePath}`);
    return false;
  }

  // Original (b2c-core version):
  //   const fetchSellerByAuthActorId = async (authActorId, scope, fields = ['id']) => {
  //       const query = scope.resolve(utils_1.ContainerRegistrationKeys.QUERY);
  //       const { data: [seller] } = await query.graph({
  //           entity: 'seller',
  //           filters: { members: { id: authActorId } },
  //           fields
  //       });
  //       return seller;
  //   };
  //
  // Patched: try member ID lookup first, fall back to direct seller ID lookup

  const patched = content.replace(
    /const fetchSellerByAuthActorId = async \(authActorId, scope, fields = \['id'\]\) => \{[\s\S]*?return seller;\s*\};/,
    `const fetchSellerByAuthActorId = async (authActorId, scope, fields = ['id']) => {
    // PATCHED: handle sel_ IDs and undefined results
    const query = scope.resolve(utils_1.ContainerRegistrationKeys.QUERY);
    try {
        // First try: lookup by member ID (standard MercurJS flow)
        const { data: [seller] } = await query.graph({
            entity: 'seller',
            filters: { members: { id: authActorId } },
            fields
        });
        if (seller) return seller;
    } catch (e) {
        // Query failed, try fallback
    }
    try {
        // Fallback: if authActorId is a seller ID (sel_*), query directly
        if (authActorId && authActorId.startsWith('sel_')) {
            const { data: [seller] } = await query.graph({
                entity: 'seller',
                filters: { id: authActorId },
                fields
            });
            if (seller) return seller;
        }
    } catch (e) {
        // Fallback also failed
    }
    return undefined;
};`
  );

  if (patched === content) {
    // Try the framework version pattern (slightly different formatting)
    const patched2 = content.replace(
      /const fetchSellerByAuthActorId = async \(authActorId, scope, fields = \["id"\]\) => \{[\s\S]*?return seller;\s*\};/,
      `const fetchSellerByAuthActorId = async (authActorId, scope, fields = ["id"]) => {
    // PATCHED: handle sel_ IDs and undefined results
    const query = scope.resolve(utils_1.ContainerRegistrationKeys.QUERY);
    try {
        const { data: [seller], } = await query.graph({
            entity: "seller",
            filters: { members: { id: authActorId } },
            fields,
        });
        if (seller) return seller;
    } catch (e) {
        // Query failed, try fallback
    }
    try {
        if (authActorId && authActorId.startsWith("sel_")) {
            const { data: [seller], } = await query.graph({
                entity: "seller",
                filters: { id: authActorId },
                fields,
            });
            if (seller) return seller;
        }
    } catch (e) {
        // Fallback also failed
    }
    return undefined;
};`
    );
    if (patched2 !== content) {
      fs.writeFileSync(filePath, patched2);
      log(`  Patched: ${filePath}`);
      return true;
    }
    log(`  Could not match pattern in: ${filePath}`);
    return false;
  }

  fs.writeFileSync(filePath, patched);
  log(`  Patched: ${filePath}`);
  return true;
}

function patchCheckOwnershipForMissingSellerInventoryItem(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (content.includes('// PATCHED: tolerate missing seller_inventory_item links')) {
    log(`  Already patched: ${filePath}`);
    return false;
  }

  const patched = content.replace(
    /if \(!resource\) \{\s*res\.status\(404\)\.json\(\{\s*message: `\$\{entryPoint\} with \$\{filterField\}: \$\{id\} not found`,\s*type: utils_1\.MedusaError\.Types\.NOT_FOUND\s*\}\);\s*return;\s*\}/,
    `if (!resource) {
            // PATCHED: tolerate missing seller_inventory_item links
            // Some legacy draft products can reference inventory items before the
            // seller_inventory_item relation is created. Do not block vendor actions.
            if (entryPoint === 'seller_inventory_item' && filterField === 'inventory_item_id') {
                return next();
            }
            res.status(404).json({
                message: \`${'${entryPoint}'} with ${'${filterField}'}: ${'${id}'} not found\`,
                type: utils_1.MedusaError.Types.NOT_FOUND
            });
            return;
        }`
  );

  if (patched === content) {
    log(`  Could not match pattern in: ${filePath}`);
    return false;
  }

  fs.writeFileSync(filePath, patched);
  log(`  Patched: ${filePath}`);
  return true;
}

function patchPromotionGuardZod4(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (content.includes('// PATCHED: zod4 issues')) {
    log(`  Already patched: ${filePath}`);
    return false;
  }

  // Zod 4 renamed ZodError.errors -> ZodError.issues. MercurJS's compiled
  // path-param guards still read `result.error.errors`, which is undefined
  // under the zod 4 the backend now runs, so 400 responses lose their details.
  const patched = content.replace(
    /details: result\.error\.errors,/g,
    'details: result.error.issues, // PATCHED: zod4 issues'
  );

  if (patched === content) {
    log(`  Could not match pattern in: ${filePath}`);
    return false;
  }

  fs.writeFileSync(filePath, patched);
  log(`  Patched: ${filePath}`);
  return true;
}

function main() {
  log('Applying MercurJS patches for store_status null-safety...');

  const mercurjsDirs = findMercurjsDir();
  if (mercurjsDirs.length === 0) {
    log('No @mercurjs/b2c-core package found, skipping patches');
    return;
  }

  let patchCount = 0;

  for (const dir of mercurjsDirs) {
    log(`Found @mercurjs/b2c-core at: ${dir}`);

    // Patch store-active-guard.js
    const guardPath = path.join(dir, '.medusa', 'server', 'src', 'shared', 'infra', 'http', 'middlewares', 'store-active-guard.js');
    if (fs.existsSync(guardPath)) {
      if (patchStoreActiveGuard(guardPath)) patchCount++;
    } else {
      log(`  Not found: store-active-guard.js`);
    }

    // Patch filter-by-seller-id.js
    const filterPath = path.join(dir, '.medusa', 'server', 'src', 'shared', 'infra', 'http', 'middlewares', 'filter-by-seller-id.js');
    if (fs.existsSync(filterPath)) {
      if (patchFilterBySellerId(filterPath)) patchCount++;
    } else {
      log(`  Not found: filter-by-seller-id.js`);
    }

    // Patch seller.js (utils in b2c-core)
    const sellerUtilPath = path.join(dir, '.medusa', 'server', 'src', 'shared', 'infra', 'http', 'utils', 'seller.js');
    if (fs.existsSync(sellerUtilPath)) {
      if (patchFetchSellerByAuthActorId(sellerUtilPath)) patchCount++;
    } else {
      log(`  Not found: seller.js (b2c-core utils)`);
    }

    // Patch check-ownership.js
    const checkOwnershipPath = path.join(dir, '.medusa', 'server', 'src', 'shared', 'infra', 'http', 'middlewares', 'check-ownership.js');
    if (fs.existsSync(checkOwnershipPath)) {
      if (patchCheckOwnershipForMissingSellerInventoryItem(checkOwnershipPath)) patchCount++;
    } else {
      log(`  Not found: check-ownership.js`);
    }

    // Patch vendor-promotions path-param guards for zod 4 (.error.errors -> .error.issues)
    const middlewaresDir = path.join(dir, '.medusa', 'server', 'src', 'shared', 'infra', 'http', 'middlewares');
    for (const guardFile of [
      'vendor-promotions-rule-attribute-options-path-params-guard.js',
      'vendor-promotions-rule-value-options-path-params-guard.js',
    ]) {
      const promoGuardPath = path.join(middlewaresDir, guardFile);
      if (fs.existsSync(promoGuardPath)) {
        if (patchPromotionGuardZod4(promoGuardPath)) patchCount++;
      } else {
        log(`  Not found: ${guardFile}`);
      }
    }
  }

  // Also patch @mercurjs/framework seller.js
  const frameworkDirs = [];
  const cwd = process.cwd();
  frameworkDirs.push(path.join(cwd, 'node_modules', '@mercurjs', 'framework'));

  const pnpmDir = path.join(cwd, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    try {
      const entries = fs.readdirSync(pnpmDir);
      for (const entry of entries) {
        if (entry.startsWith('@mercurjs+framework@')) {
          const candidate = path.join(pnpmDir, entry, 'node_modules', '@mercurjs', 'framework');
          if (fs.existsSync(candidate)) {
            frameworkDirs.push(candidate);
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  for (const dir of frameworkDirs) {
    const sellerPath = path.join(dir, 'dist', 'utils', 'seller.js');
    if (fs.existsSync(sellerPath)) {
      log(`Found @mercurjs/framework at: ${dir}`);
      if (patchFetchSellerByAuthActorId(sellerPath)) patchCount++;
    }
  }

  if (patchCount > 0) {
    log(`Applied ${patchCount} patch(es) successfully`);
  } else {
    log('No patches needed (already patched or patterns not found)');
  }
}

main();
