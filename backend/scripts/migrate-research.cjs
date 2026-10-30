/* Explicit entry point. Never imports application code or dotenv. */
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

function parseMigrationArgs(args) {
  const schemas = args.filter(arg => !arg.startsWith('--'));
  const flags = args.filter(arg => arg.startsWith('--'));
  if (schemas.length !== 1 || new Set(flags).size !== flags.length ||
      flags.some(flag => !['--allow-public', '--preview'].includes(flag))) {
    throw new Error('Specify one existing schema and optional --preview or --allow-public flags');
  }
  const schema = schemas[0];
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema) ||
      /^pg_/i.test(schema) || schema.toLowerCase() === 'information_schema') {
    throw new Error('Invalid or protected schema');
  }
  if (schema.toLowerCase() === 'public' && !flags.includes('--allow-public')) {
    throw new Error('Applying to public requires both the explicit schema name and --allow-public');
  }
  return { schema, preview: flags.includes('--preview') };
}

async function runMigration(options, connectionString) {
  const sql = ['001_research_catalog.sql', '002_catalog_moderation.sql']
    .map(file => fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8')).join('\n');
  const searchPath = `SET LOCAL search_path TO "${options.schema}", pg_catalog`;
  if (options.preview) {
    process.stdout.write(`BEGIN;\n${searchPath};\n${sql}\nCOMMIT;\n`);
    return;
  }
  if (!connectionString) throw new Error('DATABASE_URL must be supplied externally');
  const pool = new Pool({ connectionString });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [options.schema]);
    if (!exists.rowCount) throw new Error('Schema must already exist with baseline tables');
    await client.query(searchPath);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [options.schema + ':research_catalog_001']);
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Applied research_catalog_001 and catalog_moderation_002 to ' + options.schema);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (require.main === module) {
  let options;
  try {
    options = parseMigrationArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('Usage: node scripts/migrate-research.cjs <existing-schema> [--preview] [--allow-public]');
    process.exitCode = 1;
  }
  if (options) {
    runMigration(options, process.env.DATABASE_URL).catch(() => {
      console.error('Research migration failed. No application startup migration is attempted; check the schema and external connection, then retry.');
      process.exitCode = 1;
    });
  }
}

module.exports = { parseMigrationArgs, runMigration };
