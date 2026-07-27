#!/usr/bin/env node
/**
 * Conditional Seed Script
 *
 * Only runs seed if:
 * 1. FORCE_SEED=true is set, OR
 * 2. The database appears to be empty (no regions exist)
 *
 * This prevents unnecessary seeding on every deployment, which saves 30-60s.
 */

const { execSync } = require('child_process');

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '\x1b[34m[SEED]\x1b[0m',
    success: '\x1b[32m[SEED]\x1b[0m',
    warn: '\x1b[33m[SEED]\x1b[0m',
    error: '\x1b[31m[SEED]\x1b[0m',
  }[type] || '[SEED]';

  console.log(`${timestamp} ${prefix} ${message}`);
}

async function checkDatabaseEmpty() {
  // Check if pg module is available
  try {
    require.resolve('pg');
  } catch {
    log('pg module not found, assuming seed needed', 'warn');
    return true;
  }

  const { Pool } = require('pg');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('DATABASE_URL not set, skipping seed check', 'warn');
    return true;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway.app') || databaseUrl.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Check if regions table exists and has data
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'region'
      ) as table_exists
    `);

    if (!result.rows[0].table_exists) {
      log('Region table does not exist, seed needed');
      return true;
    }

    // Check if any regions exist
    const regionCount = await pool.query('SELECT COUNT(*) as count FROM region');
    const count = parseInt(regionCount.rows[0].count, 10);

    if (count === 0) {
      log('No regions found, seed needed');
      return true;
    }

    // Check if product types exist (added with community architecture update)
    try {
      const ptResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'product_type'
        ) as table_exists
      `);

      if (ptResult.rows[0].table_exists) {
        const ptCount = await pool.query('SELECT COUNT(*) as count FROM product_type');
        const ptCountVal = parseInt(ptCount.rows[0].count, 10);

        if (ptCountVal === 0) {
          log('No product types found, seed needed to create community product types');
          return true;
        }
      }
    } catch (error) {
      // Non-critical check, continue
    }

    // Check if product collections exist (added with community architecture update)
    try {
      const pcResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'product_collection'
        ) as table_exists
      `);

      if (pcResult.rows[0].table_exists) {
        const pcCount = await pool.query('SELECT COUNT(*) as count FROM product_collection');
        const pcCountVal = parseInt(pcCount.rows[0].count, 10);

        if (pcCountVal === 0) {
          log('No product collections found, seed needed to create operational collections');
          return true;
        }
      }
    } catch (error) {
      // Non-critical check, continue
    }

    log(`Found ${count} region(s), database is already seeded`);
    return false;
  } catch (error) {
    // If table doesn't exist or query fails, assume seed is needed
    if (error.code === '42P01') {
      log('Region table does not exist, seed needed');
      return true;
    }
    log(`Database check failed: ${error.message}`, 'warn');
    return true;
  } finally {
    await pool.end();
  }
}

async function main() {
  const forceSeed = process.env.FORCE_SEED === 'true';
  const isProduction = process.env.NODE_ENV === 'production';
  const allowProductionSeed = process.env.ALLOW_PRODUCTION_SEED === 'true';

  // Safety gate: never auto-seed a production database from the emptiness
  // heuristic. `pnpm seed` (src/scripts/seed.ts) creates PUBLISHED demo
  // products ("Organic Kale Bunch", "Community Herb Seed Kit", ...), so a
  // production DB that merely has empty product_type / product_collection
  // tables would otherwise get a demo catalog injected and shown to real
  // customers. Seeding in production requires an explicit opt-in.
  if (isProduction && !allowProductionSeed && !forceSeed) {
    log(
      'NODE_ENV=production: automatic seed is disabled to avoid injecting demo ' +
        'products into a live database. To seed a fresh production database on ' +
        'purpose, set ALLOW_PRODUCTION_SEED=true (or FORCE_SEED=true).',
      'warn'
    );
    process.exit(0);
  }

  if (forceSeed) {
    log('FORCE_SEED=true, running seed...');
  } else if (isProduction) {
    log('ALLOW_PRODUCTION_SEED=true, checking if seed is needed...');
    const needsSeed = await checkDatabaseEmpty();

    if (!needsSeed) {
      log('Seed not needed, skipping', 'success');
      process.exit(0);
    }
  } else {
    log('Checking if seed is needed...');
    const needsSeed = await checkDatabaseEmpty();

    if (!needsSeed) {
      log('Seed not needed, skipping', 'success');
      process.exit(0);
    }
  }

  log('Running seed...');
  const startTime = Date.now();

  try {
    execSync('pnpm seed', {
      stdio: 'inherit',
      env: process.env,
      cwd: process.cwd(),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`Seed completed in ${duration}s`, 'success');
    process.exit(0);
  } catch (error) {
    log(`Seed failed: ${error.message}`, 'error');
    // Exit with success even if seed fails - don't block deployment
    // The application should still be able to start
    process.exit(0);
  }
}

main().catch((error) => {
  log(`Unexpected error: ${error.message}`, 'error');
  process.exit(0);
});
