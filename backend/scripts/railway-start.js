#!/usr/bin/env node
/**
 * Railway-Optimized Startup Script
 *
 * This script optimizes the startup sequence for Railway deployment:
 * 1. Sets NODE_OPTIONS for memory management
 * 2. Runs database migrations
 * 3. Conditionally seeds data (skipped if SKIP_SEED=true or data exists)
 * 4. Initializes backend
 * 5. Starts the MedusaJS server
 *
 * Environment Variables:
 * - SKIP_SEED: Set to "true" to skip seeding entirely
 * - SKIP_MIGRATIONS: Set to "true" to skip migrations (use for faster restarts)
 * - NODE_MEMORY_MB: Memory limit in MB (default: 512)
 * - RAILWAY_ENVIRONMENT: Detected automatically by Railway
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

// Configuration
const NODE_MEMORY_MB = process.env.NODE_MEMORY_MB || '512';
const SKIP_SEED = process.env.SKIP_SEED === 'true';
const SKIP_MIGRATIONS = process.env.SKIP_MIGRATIONS === 'true';
const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT;

// Set Node.js options for Railway optimization
// Note: Only --max-old-space-size is safe to use in NODE_OPTIONS for Node.js 24+
const nodeOptions = [
  `--max-old-space-size=${NODE_MEMORY_MB}`,
].join(' ');

// Merge with existing NODE_OPTIONS if present
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS
  ? `${process.env.NODE_OPTIONS} ${nodeOptions}`
  : nodeOptions;

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '\x1b[34m[INFO]\x1b[0m',
    success: '\x1b[32m[SUCCESS]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
  }[type] || '[LOG]';

  console.log(`${timestamp} ${prefix} ${message}`);
}

function runCommand(command, description) {
  log(`Starting: ${description}`);
  const startTime = Date.now();

  try {
    execSync(command, {
      stdio: 'inherit',
      env: process.env,
      cwd: process.cwd(),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`Completed: ${description} (${duration}s)`, 'success');
    return true;
  } catch (error) {
    log(`Failed: ${description} - ${error.message}`, 'error');
    return false;
  }
}

/**
 * Wait for the database to accept connections before proceeding.
 * Retries with exponential back-off (1s → 2s → 4s … up to 30s cap).
 */
async function waitForDatabase(maxAttempts = 15) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('DATABASE_URL not set, skipping readiness check', 'warn');
    return;
  }

  const { Pool } = require('pg');

  const sslEnabled = databaseUrl.includes('railway.app') ||
    databaseUrl.includes('railway.internal') ||
    databaseUrl.includes('sslmode=require') ||
    !!process.env.RAILWAY_ENVIRONMENT;

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    max: 1,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      log('Database is ready', 'success');
      await pool.end();
      return;
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
      log(`Database not ready (attempt ${attempt}/${maxAttempts}): ${err.message}. Retrying in ${delay / 1000}s...`, 'warn');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  await pool.end();
  log('Database did not become ready in time — proceeding anyway', 'warn');
}

async function main() {
  log('='.repeat(60));
  log('Railway-Optimized Startup Sequence');
  log('='.repeat(60));
  log(`Environment: ${IS_RAILWAY ? 'Railway' : 'Local'}`);
  log(`Memory Limit: ${NODE_MEMORY_MB}MB`);
  log(`Skip Seed: ${SKIP_SEED}`);
  log(`Skip Migrations: ${SKIP_MIGRATIONS}`);
  log('='.repeat(60));

  const startTime = Date.now();

  // Step 0: Apply MercurJS patches (null-safety for store_status)
  runCommand('node scripts/patch-mercurjs.js', 'MercurJS patches');

  // Step 0b: Apply MikroORM patch (null-safe pruneToOneRelations — fixes
  // relation-expansion 500s on store/admin queries; idempotent)
  runCommand('node scripts/patch-mikro-orm.js', 'MikroORM patches');

  // Step 0.5: Wait for database to accept connections
  await waitForDatabase();

  // Step 1: Database Migrations
  if (!SKIP_MIGRATIONS) {
    if (!runCommand('pnpm exec medusa db:migrate --execute-safe-links', 'Database migrations')) {
      log('Migrations failed, but continuing startup...', 'warn');
    }
  } else {
    log('Skipping migrations (SKIP_MIGRATIONS=true)', 'warn');
  }

  // Step 2: Conditional Seeding
  if (!SKIP_SEED) {
    if (!runCommand('pnpm seed:if-needed', 'Conditional seeding')) {
      log('Seeding failed, but continuing startup...', 'warn');
    }
  } else {
    log('Skipping seed (SKIP_SEED=true)', 'warn');
  }

  // Step 3: Initialize Backend
  if (!runCommand('init-backend', 'Backend initialization')) {
    log('Backend initialization failed', 'error');
    process.exit(1);
  }

  const setupDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  log('='.repeat(60));
  log(`Setup completed in ${setupDuration}s`, 'success');
  log('Starting MedusaJS server...');
  log('='.repeat(60));

  // Step 4: Start MedusaJS Server
  // Use pnpm exec instead of npx to avoid npm deprecation warnings
  // Pass command as single string with shell:true to avoid DEP0190 warning
  const serverProcess = spawn('pnpm exec medusa start', {
    stdio: 'inherit',
    env: process.env,
    cwd: path.join(process.cwd(), '.medusa', 'server'),
    shell: true,
  });

  let shutdownSignal = null;

  // Handle server process signals
  serverProcess.on('error', (error) => {
    log(`Server failed to start: ${error.message}`, 'error');
    process.exit(1);
  });

  serverProcess.on('exit', (code, signal) => {
    if (signal && shutdownSignal === signal) {
      log(`Server shutdown completed after ${signal}`);
      process.exit(0);
    }

    if (signal) {
      log(`Server exited due to signal ${signal}`, 'error');
      process.exit(1);
    }

    if (code !== 0) {
      log(`Server exited with code ${code}`, 'error');
    }

    process.exit(code || 0);
  });

  // Forward signals to server process
  ['SIGTERM', 'SIGINT'].forEach((signal) => {
    process.on(signal, () => {
      log(`Received ${signal}, forwarding to server...`);
      shutdownSignal = signal;
      serverProcess.kill(signal);

      setTimeout(() => {
        if (!serverProcess.killed) {
          log(`Server did not stop after ${signal}, sending SIGKILL`, 'warn');
          serverProcess.kill('SIGKILL');
        }
      }, 10_000);
    });
  });
}

main().catch((error) => {
  log(`Startup failed: ${error.message}`, 'error');
  process.exit(1);
});
