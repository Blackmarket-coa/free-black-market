#!/usr/bin/env node
/**
 * Patch MikroORM — null-safe relation-populate planning.
 *
 * Fixes a family of "Cannot read properties of undefined" 500s that all stem
 * from MikroORM dereferencing a populate-hint field that does not exist on the
 * parent entity's metadata (`meta.properties[field]` is undefined):
 *
 *   @mikro-orm/core/EntityManager.js
 *     1. pruneToOneRelations (`reading 'kind'`) — 500s every store/admin query
 *        that expands a relation (e.g. GET /store/regions expanding `countries`,
 *        or /store/products expanding `*variants,*categories`).
 *     2. getJoinedFilters (`reading 'strategy'`) — 500s POST /store/carts.
 *
 *   @mikro-orm/knex/AbstractSqlDriver.js  (same failing cart populate hint,
 *   `shipping_address.region_code`, which the cart module's Address model does
 *   not define — reached after the getJoinedFilters guard above lets it through)
 *     3. getFieldsForJoinedLoad (`reading 'type'`)
 *     4. joined-props where builder (`reading 'where'`)
 *     5. joined-props orderBy builder (`reading 'orderBy'`)
 *
 * Root cause (shared): Medusa's remote-query planner derives fields (a to-many
 * relation's `<relation>_id` FK that lives on the CHILD, or a populate hint for
 * a field absent from the model) that do NOT exist on the parent entity.
 * MikroORM guards some of these dereferences (`if (!prop.targetMeta)`, and one
 * `if (!prop)` in getFieldsForJoinedLoad's ref-join branch) but not the ones
 * above. Each patch adds the missing `if (!prop)` guard so the bogus hint is
 * skipped instead of crashing the whole query.
 *
 * All patches are marker-guarded and idempotent. Verified against
 * @mikro-orm/core@6.6.14 and @mikro-orm/knex@6.6.14.
 *
 * Mirrors scripts/patch-mercurjs.js (idempotent, marker-guarded, multi-path).
 */

const fs = require('fs');
const path = require('path');

function log(message) {
  console.log(`[PATCH:mikro-orm] ${message}`);
}

/**
 * Find every copy of `<pkgParts>/<relFile>` under the project's node_modules —
 * the direct path, the pnpm content-addressed store (entries starting with
 * `pnpmPrefix`), and a `.medusa/server` build copy if present.
 */
function findPackageFiles({ pkgParts, relFile, pnpmPrefix }) {
  const cwd = process.cwd();
  const results = new Set();
  const roots = [
    path.join(cwd, 'node_modules'),
    path.join(cwd, '.medusa', 'server', 'node_modules'),
  ];
  for (const root of roots) {
    const direct = path.join(root, ...pkgParts, relFile);
    if (fs.existsSync(direct)) results.add(direct);

    const pnpmDir = path.join(root, '.pnpm');
    let entries = [];
    try {
      entries = fs.readdirSync(pnpmDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(pnpmPrefix)) {
        const candidate = path.join(
          pnpmDir, entry, 'node_modules', ...pkgParts, relFile
        );
        if (fs.existsSync(candidate)) results.add(candidate);
      }
    }
  }
  return [...results];
}

/**
 * Build a patch that inserts a `if (!prop) { continue; }` guard between a
 * two-line anchor (the `const prop = ...` line and the following line that
 * dereferences `prop`). The two-line anchor keeps the match unique even though
 * the `const prop` line alone repeats in the file.
 */
function guardBetween({ marker, propLine, nextLine, note, indent = '            ' }) {
  return {
    marker,
    target: `${propLine}\n${nextLine}`,
    replacement: (m) =>
      `${propLine}\n${indent}if (!prop) { continue; } // ${m}: ${note}\n${nextLine}`,
  };
}

const PROP_BY_PROPNAME = '            const prop = meta.properties[propName];';

const TARGET_FILES = [
  {
    label: '@mikro-orm/core/EntityManager.js',
    find: () =>
      findPackageFiles({
        pkgParts: ['@mikro-orm', 'core'],
        relFile: 'EntityManager.js',
        pnpmPrefix: '@mikro-orm+core@',
      }),
    patches: [
      {
        // pruneToOneRelations flat-field branch — `reading 'kind'`
        marker: 'FBM-PATCHED-pruneToOneRelations',
        target:
          `                    if (!field.includes('.') && ![enums_1.ReferenceKind.MANY_TO_ONE, enums_1.ReferenceKind.ONE_TO_ONE].includes(meta.properties[field].kind)) {`,
        replacement: (marker, target) =>
          `                    if (!field.includes('.') && !meta.properties[field]) { ret.push(field); continue; } // ${marker}: skip non-dotted fields absent from entity metadata (e.g. derived <rel>_id for to-many relations)\n` +
          target,
      },
      {
        // getJoinedFilters loop — `reading 'strategy'`
        marker: 'FBM-PATCHED-getJoinedFilters',
        target: `            const prop = meta.properties[field];`,
        replacement: (marker, target) =>
          target +
          `\n            if (!prop) { continue; } // ${marker}: skip populate hints for fields absent from entity metadata (e.g. region_code on Address)`,
      },
    ],
  },
  {
    label: '@mikro-orm/knex/AbstractSqlDriver.js',
    find: () =>
      findPackageFiles({
        pkgParts: ['@mikro-orm', 'knex'],
        relFile: 'AbstractSqlDriver.js',
        pnpmPrefix: '@mikro-orm+knex@',
      }),
    patches: [
      guardBetween({
        // getFieldsForJoinedLoad — `reading 'type'`
        marker: 'FBM-PATCHED-getFieldsForJoinedLoad',
        propLine: PROP_BY_PROPNAME,
        nextLine: `            // ignore ref joins of known FKs unless it's a filter hint`,
        note: 'skip populate hints for fields absent from entity metadata (e.g. region_code on Address)',
      }),
      guardBetween({
        // joined-props where builder — `reading 'where'`
        marker: 'FBM-PATCHED-joinedWhere',
        propLine: PROP_BY_PROPNAME,
        nextLine: `            if (!core_1.Utils.isEmpty(prop.where)) {`,
        note: 'skip populate hints for fields absent from entity metadata',
      }),
      guardBetween({
        // joined-props orderBy builder — `reading 'orderBy'`
        marker: 'FBM-PATCHED-joinedOrderBy',
        propLine: PROP_BY_PROPNAME,
        nextLine: `            const propOrderBy = prop.orderBy;`,
        note: 'skip populate hints for fields absent from entity metadata',
      }),
    ],
  },
];

function patchFile(filePath, patches) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let applied = 0;

  for (const patch of patches) {
    if (content.includes(patch.marker)) {
      log(`Already patched (${patch.marker}): ${filePath}`);
      continue;
    }
    if (!content.includes(patch.target)) {
      log(`Pattern not found for ${patch.marker} (skipping — version mismatch?): ${filePath}`);
      continue;
    }
    content = content
      .split(patch.target)
      .join(patch.replacement(patch.marker, patch.target));
    applied++;
    log(`Patched (${patch.marker}): ${filePath}`);
  }

  if (applied > 0) {
    fs.writeFileSync(filePath, content);
  }
  return applied > 0;
}

function main() {
  log('Applying null-safe relation-populate patches...');
  let count = 0;
  let anyFiles = false;
  for (const target of TARGET_FILES) {
    const files = target.find();
    if (files.length === 0) {
      log(`No ${target.label} found, skipping`);
      continue;
    }
    anyFiles = true;
    for (const f of files) {
      if (patchFile(f, target.patches)) count++;
    }
  }
  if (!anyFiles) {
    log('No MikroORM files found, skipping');
    return;
  }
  log(count > 0 ? `Applied patches to ${count} file(s)` : 'No patches needed');
}

main();
