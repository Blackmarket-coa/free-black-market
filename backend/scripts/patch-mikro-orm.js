#!/usr/bin/env node
/**
 * Patch MikroORM 6.6.14 so that Medusa 2.14.2's reads work on it.
 *
 * THE CAUSE (SD-117; bisected on Postgres through the real store routes)
 *
 * Medusa 2.14.2 is built against MikroORM 6.6.12 (`@medusajs/deps`). This
 * repo pins 6.6.14 for a CVE fix (SD-7, pnpm-workspace.yaml). 6.6.14 changed
 * one thing that matters here, in `EntityManager.preparePopulate`: when a
 * find is given BOTH `fields` and an explicit `populate`, every nested path
 * in `fields` is now turned into a populate hint and merged in
 * (`shouldMerge`). On 6.6.12 an explicit `populate` was left alone and a
 * `fields` entry naming no property of the entity was a silent no-op.
 *
 * Medusa's data layer relies on that no-op. Every module read passes both
 * options, and its field lists routinely name paths the entity does not
 * have: `shipping_address.region_code` (the store cart defaults and the tax
 * step; the cart's Address model has no such column), `items.variant` (a
 * link to another module), `items.item.quantity` on Order (SD-52),
 * `payments.captures_id` (a derived foreign key). On 6.6.14 each of those
 * becomes a populate hint for a property that does not exist.
 *
 * Measured, each on the same calls (create a cart in a one-country and a
 * two-country region, add and change a line, set addresses, Mercur's
 * shipping-method routes, pay, complete, read the order, cancel it as admin):
 *   - 6.6.14 as npm ships it: a TypeError in `pruneToOneRelations` on every
 *     such read;
 *   - 6.6.14 with the merge switched off and nothing else: every call 200;
 *   - 6.6.14 with the first version of this script: 500 on most of them;
 *   - 6.6.14 with this script: every call 200, and the response bodies the
 *     same as with the merge switched off.
 * Medusa moved to 6.6.14 in 2.16.0 and in the same release began dropping
 * unresolvable paths before they reach MikroORM
 * (`pruneFindOptionsAgainstMetadata` in `@medusajs/utils`), for this reason.
 * MikroORM has not changed the merge up to 6.6.18.
 *
 * WHAT THE FIRST VERSION OF THIS PATCH GOT WRONG
 *
 * It guarded the crash in `pruneToOneRelations` by pushing the unknown field
 * on as a populate hint, then guarded the next four places the bogus hint
 * crashed (`getJoinedFilters`, three in the SQL driver). Two were left: the
 * child find's own validation ("Entity 'Address' does not have property
 * 'region_code'") and `EntityLoader.populateField` ("Cannot read properties
 * of undefined (reading 'kind')"). Those were the 500s on `POST /store/carts`,
 * on every read of a cart with an address or a variant line, on Mercur's
 * shipping-method routes and on `POST /admin/orders/:id/cancel`.
 *
 * THE FIX
 *
 * `FBM-PATCHED-mergeResolvablePopulate` goes to where the hint is made: a
 * nested path from `fields` is merged into an explicit `populate` only when
 * MikroORM's own `canPopulate` accepts it, which is the check its validation
 * applies to a populate hint. Anything else is left out, which is what
 * 6.6.12 did with it. Paths that resolve are merged as 6.6.14 intends. A
 * find given `fields` and no `populate` is planned exactly as before.
 * `FBM-PATCHED-pruneUnknownRelation` covers the one dereference the first
 * version missed in the same function (a dotted path whose FIRST segment is
 * unknown, `reading 'targetMeta'`); an unknown relation in the explicit
 * `populate` is then refused by MikroORM's validation, by name.
 *
 * What a caller sees: a read that names a nested field the entity lacks
 * gets its rows without that field, and no error. An order read selecting
 * `items.quantity` used to throw and now returns lines with no quantity
 * (SD-52: select `items.*`). The check that names that mistake is
 * `src/shared/__tests__/order-items-quantity-guard.unit.spec.ts`.
 *
 * The five original guards stay. With the hint no longer made they are not
 * reached from the merge, but removing them would need a tree patched by the
 * old version to be un-patched, and they cost nothing.
 *
 * HOW IT IS APPLIED
 *
 * Every patch is marker-guarded and idempotent, and the two new ones anchor
 * on lines the first version never touched, so this script applies the same
 * way to a pristine tree and to one already patched by the first version
 * (which gains the two new markers). The second case is the common one: pnpm
 * hard-links node_modules to its store, so the first version's in-place
 * write patched the store's copy too, and a fresh install from that store
 * starts from it.
 *
 * It runs from `postinstall` and from `scripts/railway-start.js` on every
 * container start. In the Docker image the start is the one that counts: the
 * deps stage runs `pnpm install` before scripts/ is copied in. A pattern that
 * is not found is reported and skipped, not fatal: after a MikroORM bump,
 * read the output. `src/scripts/__tests__/patch-mikro-orm.unit.spec.ts` fails
 * when a pattern no longer matches the installed files or the installed tree
 * does not carry every patch, and `integration-tests/http/store-cart-path.spec.ts`
 * walks the buyer's cart path through the real routes.
 *
 * Verified against @mikro-orm/core@6.6.14 and @mikro-orm/knex@6.6.14 (the
 * npm tarballs, diffed).
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
      {
        // pruneToOneRelations dotted branch — `reading 'targetMeta'` when the
        // FIRST segment of a nested path is not a property. Passed on whole,
        // like the flat branch above passes its field on: the merge below
        // drops it, and a find without `populate` gets it named by validation.
        marker: 'FBM-PATCHED-pruneUnknownRelation',
        target:
          `                    const prop = meta.properties[key];\n` +
          `                    if (!prop.targetMeta) {`,
        replacement: (marker) =>
          `                    const prop = meta.properties[key];\n` +
          `                    if (!prop) { ret.push(field); continue; } // ${marker}: a nested path whose first segment is absent from entity metadata\n` +
          `                    if (!prop.targetMeta) {`,
      },
      {
        // preparePopulate, the merge 6.6.14 added — the cause (see the header).
        // Only a path whose every segment is a property of its entity becomes
        // a populate hint; the rest stay the no-op they were on 6.6.12.
        marker: 'FBM-PATCHED-mergeResolvablePopulate',
        target: `                const extras = fromFields.filter(f => f.includes('.'));`,
        replacement: (marker) =>
          `                const extras = fromFields.filter(f => f.includes('.') && this.canPopulate(entityName, f)); // ${marker}: a nested field that does not resolve against entity metadata is not a populate hint (e.g. shipping_address.region_code, items.variant, items.item.quantity)`,
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

/**
 * Apply `patches` to a file's text. Pure: returns the new text and what
 * happened to each patch (`applied`, `already` there, or pattern `missing`).
 */
function applyPatches(content, patches) {
  const outcome = [];
  for (const patch of patches) {
    if (content.includes(patch.marker)) {
      outcome.push({ marker: patch.marker, result: 'already' });
      continue;
    }
    if (!content.includes(patch.target)) {
      outcome.push({ marker: patch.marker, result: 'missing' });
      continue;
    }
    content = content
      .split(patch.target)
      .join(patch.replacement(patch.marker, patch.target));
    outcome.push({ marker: patch.marker, result: 'applied' });
  }
  return { content, outcome };
}

function patchFile(filePath, patches) {
  const { content, outcome } = applyPatches(fs.readFileSync(filePath, 'utf-8'), patches);
  let applied = 0;

  for (const { marker, result } of outcome) {
    if (result === 'already') {
      log(`Already patched (${marker}): ${filePath}`);
    } else if (result === 'missing') {
      log(`Pattern not found for ${marker} (skipping — version mismatch?): ${filePath}`);
    } else {
      applied++;
      log(`Patched (${marker}): ${filePath}`);
    }
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

if (require.main === module) {
  main();
}

module.exports = { TARGET_FILES, applyPatches };
