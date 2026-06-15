#!/usr/bin/env node
/**
 * Patch @mikro-orm/core EntityManager — null-safe pruneToOneRelations
 *
 * Fixes "Cannot read properties of undefined (reading 'kind')" 500s on every
 * store/admin query that expands a relation (e.g. GET /store/regions expanding
 * `countries`, or /store/products expanding `*variants,*categories`).
 *
 * Root cause: Medusa's remote-query planner derives a `<relation>_id` foreign-key
 * field for expanded relations. For to-MANY relations (region.countries,
 * product.variants, ...) that FK lives on the CHILD, so `<relation>_id`
 * (countries_id, variants_id, ...) does NOT exist on the parent entity. MikroORM's
 * `pruneToOneRelations` then does `meta.properties[field].kind` on an undefined
 * property and throws — which aborts the whole query and 500s the request.
 *
 * MikroORM already guards the nested-path branch (`if (!prop.targetMeta)`); the
 * flat-field branch lacks the equivalent `if (!meta.properties[field])` guard.
 * This script adds it: when a field has no matching property metadata, keep it in
 * the populate list and continue (the field is simply not a to-one relation to
 * prune). Verified against EntityManager.js from @mikro-orm/core@6.6.14.
 *
 * Mirrors scripts/patch-mercurjs.js (idempotent, marker-guarded, multi-path).
 */

const fs = require('fs');
const path = require('path');

const MARKER = 'FBM-PATCHED-pruneToOneRelations';

const TARGET =
  `                    if (!field.includes('.') && ![enums_1.ReferenceKind.MANY_TO_ONE, enums_1.ReferenceKind.ONE_TO_ONE].includes(meta.properties[field].kind)) {`;

const REPLACEMENT =
  `                    if (!meta.properties[field]) { ret.push(field); continue; } // ${MARKER}: skip fields absent from entity metadata (e.g. derived <rel>_id for to-many relations)\n` +
  TARGET;

function log(message) {
  console.log(`[PATCH:mikro-orm] ${message}`);
}

/**
 * Collect every @mikro-orm/core/EntityManager.js under the project's node_modules,
 * including the pnpm content-addressed store and a `.medusa/server` copy if present.
 */
function findEntityManagerFiles() {
  const cwd = process.cwd();
  const results = new Set();

  const directCandidates = [
    path.join(cwd, 'node_modules', '@mikro-orm', 'core', 'EntityManager.js'),
    path.join(cwd, '.medusa', 'server', 'node_modules', '@mikro-orm', 'core', 'EntityManager.js'),
  ];
  for (const c of directCandidates) {
    if (fs.existsSync(c)) results.add(c);
  }

  const pnpmDirs = [
    path.join(cwd, 'node_modules', '.pnpm'),
    path.join(cwd, '.medusa', 'server', 'node_modules', '.pnpm'),
  ];
  for (const pnpmDir of pnpmDirs) {
    if (!fs.existsSync(pnpmDir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(pnpmDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('@mikro-orm+core@')) {
        const candidate = path.join(
          pnpmDir, entry, 'node_modules', '@mikro-orm', 'core', 'EntityManager.js'
        );
        if (fs.existsSync(candidate)) results.add(candidate);
      }
    }
  }

  return [...results];
}

function patchFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (content.includes(MARKER)) {
    log(`Already patched: ${filePath}`);
    return false;
  }

  if (!content.includes(TARGET)) {
    log(`Pattern not found (skipping — version mismatch?): ${filePath}`);
    return false;
  }

  fs.writeFileSync(filePath, content.split(TARGET).join(REPLACEMENT));
  log(`Patched: ${filePath}`);
  return true;
}

function main() {
  log('Applying null-safe pruneToOneRelations patch...');
  const files = findEntityManagerFiles();
  if (files.length === 0) {
    log('No @mikro-orm/core/EntityManager.js found, skipping');
    return;
  }
  let count = 0;
  for (const f of files) {
    if (patchFile(f)) count++;
  }
  log(count > 0 ? `Applied ${count} patch(es) successfully` : 'No patches needed');
}

main();
