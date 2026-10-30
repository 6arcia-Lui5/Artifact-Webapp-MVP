/* Explicit, disposable-schema measurement. Never runs during application startup. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '..');
const resultPath = path.join(root, '.local', 'research-scale-results.json');
const GREEK = '\u03c7\u03b1\u1fd6\u03c1\u03b5';
const BASE_TABLES = ['users', 'collections', 'object_types', 'records', 'inscriptions'];
const round = value => Math.round(value * 1000) / 1000;

function help() {
  console.log('Usage: node backend/scripts/check-catalog-scale.cjs --run [--explain]');
  console.log('Build backend first. Explicitly runs synthetic 2000/10000-record measurements in a new disposable schema.');
  console.log('Reads backend/.env; copies five public table definitions, never public rows; always attempts schema cleanup.');
  console.log('Writes .local/research-scale-results.json. Without --run, no database connection or environment loading occurs.');
  console.log('--explain additionally captures unforced count/page query plans for metadata and Greek searches at 10000 records.');
}

function generatedIdentifier(schema) {
  if (!/^research_test_scale_[0-9]{13}_[a-f0-9]{8}$/.test(schema)) {
    throw new Error('Refusing an invalid generated scale schema name');
  }
  return `"${schema}"`;
}

async function inSchema(client, schema, work) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query(`SET LOCAL search_path TO ${generatedIdentifier(schema)}, pg_catalog`);
    await client.query("SELECT set_config('statement_timeout','60000',true),set_config('lock_timeout','5000',true)");
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function measureThree(query, validate, statementCount) {
  const durations = [];
  let rows, jsonBytes, total;
  for (let sample = 0; sample < 3; sample += 1) {
    const start = performance.now();
    const result = await query();
    durations.push(performance.now() - start);
    // Assertions and JSON byte counting are deliberately outside the query timer.
    validate(result);
    rows = Array.isArray(result) ? result.length : result.items.length;
    total = Array.isArray(result) ? result.length : result.total;
    jsonBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  }
  return {
    samplesMs: durations.map(round),
    medianMs: round([...durations].sort((a, b) => a - b)[1]),
    rows, total, jsonBytes, sqlStatementsPerSample: statementCount,
    transactionAndSetScopeIncluded: false,
  };
}

function validatePage(result, expectedTotal, predicate = () => true) {
  assert.equal(result.total, expectedTotal, 'The selected fixture population must match the expected total');
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 24);
  assert.equal(result.items.length, Math.min(24, expectedTotal), 'Pages must deliver at most 24 matching records');
  assert.equal(result.totalPages, Math.ceil(expectedTotal / 24));
  for (const item of result.items) assert.ok(predicate(item), 'Every delivered record must satisfy the workload semantics');
}

async function seed(client, previous, count, owner, objectTypeId) {
  await client.query("SELECT set_config('research.actor',$1,true)", [owner]);
  await client.query(`
    INSERT INTO records (
      id,user_id,item_name,object_type_id,museum_name,museum_city,museum_country,
      museum_number,date_culture_period,materials,dimensions,production_place,
      date_start,date_end,museum_description,inscribed,source_provider,source_object_id,
      moderation_status,created_at
    )
    SELECT gen_random_uuid(),$1,
      CASE WHEN n%100=0 THEN 'Dedication fragment ' ELSE 'Catalog fragment ' END||n,
      $2,'Synthetic fixture museum','Test city','Test country','SCALE-'||n,
      CASE WHEN n%100=0 THEN NULL ELSE '300 BCE to 100 CE' END,
      CASE WHEN n%2=0 THEN 'Bronze' ELSE 'Marble' END,
      '12 x 8 cm',CASE WHEN n%50=0 THEN 'Ostia' ELSE 'Rome' END,
      CASE WHEN n%100=0 THEN NULL ELSE -300 END,CASE WHEN n%100=0 THEN NULL ELSE 100 END,
      repeat('Synthetic description for measuring catalog delivery. ',3),n%20=0,
      'scale-fixture',n::text,'pending',timestamp '2020-01-01' + n * interval '1 second'
    FROM generate_series($3::int,$4::int) n`, [owner, objectTypeId, previous + 1, count]);
  await client.query(`
    INSERT INTO inscriptions(record_id,content,translation,language,script,serifs_present,stopmarks_present)
    SELECT id,$1,'A literal greeting','Greek','Greek',false,false FROM records
    WHERE user_id=$2 AND substring(museum_number from '[0-9]+$')::int>$3
      AND substring(museum_number from '[0-9]+$')::int%20=0`, [GREEK, owner, previous]);
  await client.query('ANALYZE records');
  await client.query('ANALYZE inscriptions');
  const counts = (await client.query(`SELECT
    (SELECT count(*) FROM records)::int AS records,
    (SELECT count(*) FROM inscriptions)::int AS inscriptions,
    (SELECT count(*) FROM research_history)::int AS history`)).rows[0];
  assert.equal(counts.records, count);
  assert.equal(counts.inscriptions, count / 20, 'Exactly five percent of records must have literal Greek originals');
  assert.ok(counts.history >= count + count / 20, 'Audit triggers must have recorded fixture writes');
  return counts;
}

async function storageBytes(client, schema) {
  const row = (await client.query(`SELECT
    coalesce(sum(pg_table_size(c.oid)),0)::bigint AS "tableBytes",
    coalesce(sum(pg_indexes_size(c.oid)),0)::bigint AS "indexBytes"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind='r'`, [schema])).rows[0];
  const tableBytes = Number(row.tableBytes), indexBytes = Number(row.indexBytes);
  return { tableBytes, indexBytes, totalBytes: tableBytes + indexBytes };
}

async function explainStatement(client, sql, values) {
  const start = performance.now();
  const result = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, values);
  const networkInclusiveMs = round(performance.now() - start);
  const document = result.rows[0]['QUERY PLAN'][0];
  const nodes = [];
  function visit(node, parent = null) {
    const position = nodes.length;
    nodes.push({
      position, parent, nodeType: node['Node Type'], relation: node['Relation Name'],
      indexName: node['Index Name'], actualRows: node['Actual Rows'], actualLoops: node['Actual Loops'],
      actualStartupTimeMs: node['Actual Startup Time'], actualTotalTimeMs: node['Actual Total Time'],
      sharedHitBlocks: node['Shared Hit Blocks'], sharedReadBlocks: node['Shared Read Blocks'],
      localHitBlocks: node['Local Hit Blocks'], localReadBlocks: node['Local Read Blocks'],
      tempReadBlocks: node['Temp Read Blocks'], tempWrittenBlocks: node['Temp Written Blocks'],
    });
    for (const child of node.Plans || []) visit(child, position);
  }
  visit(document.Plan);
  return {
    networkInclusiveMs, planningTimeMs: document['Planning Time'], executionTimeMs: document['Execution Time'],
    indexNames: [...new Set(nodes.map(node => node.indexName).filter(Boolean))], nodes,
  };
}

async function run({ explain = false } = {}) {
  const schema = `research_test_scale_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const schemaSql = generatedIdentifier(schema);
  const output = {
    ok: false, timestamp: new Date().toISOString(), schema,
    measurement: 'Three network-inclusive database query-path samples within an already-established transaction; includes query construction and result decoding, excludes BEGIN, SET LOCAL/set_config, COMMIT, JSON byte counting, migration/seeding, Clerk, role resolution and HTTP overhead.',
    limitations: 'Synthetic single-client workload after seeding/ANALYZE; no cache flush, concurrency, browser rendering or production-capacity claims. Workloads run in the order reported.',
    comparison: 'Historical unbounded Drizzle findMany with user and createdAt descending versus current recordSelect + parseSearch + contributor-owner appendVisibility, pageSize 24. Current pages also include inscriptions, object type and primary-image metadata; historical results include the user relation only.',
    workload: '2000, then 10000 total pending records owned by the contributor; 5% contain one literal Greek inscription, 1% have Dedication titles and unknown dates, 2% are Bronze/Ostia, and 1% match the structured Bronze/Ostia/date/source/type filter after unknown dates are excluded. Audit triggers remain active.',
    explainRequested: explain,
    explainMethod: 'Optional EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON), collected after timed workloads at 10000 records for both count and 24-row selection. Same contributor visibility and schema scope; planner method settings are not changed and index use is not asserted. PostgreSQL execution/planning times are distinct from network-inclusive EXPLAIN elapsed time.',
    samples: [], cleanup: { schemaRemoved: false, errors: [] },
  };
  let admin, pool, client, created = false, stage = 'preflight';
  try {
    // This code is reached only after explicit --run. Never print connection values.
    require('dotenv').config({ path: path.join(backend, '.env'), quiet: true });
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in backend/.env or the environment');
    for (const name of ['db/schema', 'research/database', 'research/validation', 'research/access']) {
      const compiled = path.join(backend, 'dist', `${name}.js`);
      const source = path.join(backend, 'src', `${name}.ts`);
      if (!fs.existsSync(compiled) || (fs.existsSync(source) && fs.statSync(source).mtimeMs > fs.statSync(compiled).mtimeMs)) {
        throw new Error('Build the latest backend, including moderation access, before running this check');
      }
    }
    const { Pool } = require('pg');
    const { drizzle } = require('drizzle-orm/node-postgres');
    const actualSchema = require('../dist/db/schema');
    const { recordSelect } = require('../dist/research/database');
    const { parseSearch, camel } = require('../dist/research/validation');
    const { appendVisibility } = require('../dist/research/access');
    assert.equal(typeof appendVisibility, 'function', 'The moderation visibility module must be built');
    const migrationsDir = path.join(backend, 'migrations');
    const migrations = fs.readdirSync(migrationsDir).filter(name => /^\d+_.+\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .map(name => {
        const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
        return { name, sql, sha256: createHash('sha256').update(sql).digest('hex') };
      });
    assert.ok(migrations.length, 'At least one ordered SQL migration is required');
    output.migrations = migrations.map(({ name, sha256 }) => ({ name, sha256 }));
    output.migrationPasses = 2;
    const config = {
      connectionString: process.env.DATABASE_URL, max: 1,
      connectionTimeoutMillis: 10000, idleTimeoutMillis: 5000,
      statement_timeout: 60000, query_timeout: 75000, lock_timeout: 5000,
    };
    admin = new Pool(config);
    pool = new Pool(config);
    stage = 'create disposable schema and clone definitions';
    await admin.query(`CREATE SCHEMA ${schemaSql}`);
    created = true;
    for (const table of BASE_TABLES) {
      await admin.query(`CREATE TABLE ${schemaSql}."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    client = await pool.connect();
    stage = 'apply ordered migrations twice';
    for (let pass = 0; pass < 2; pass += 1) {
      await inSchema(client, schema, async () => {
        for (const migration of migrations) await client.query(migration.sql);
      });
    }
    const owner = `scale-${randomUUID()}`;
    const outsider = `scale-outsider-${randomUUID()}`;
    const objectTypeId = randomUUID();
    const access = { userId: owner, role: 'contributor' };
    const db = drizzle(client, { schema: actualSchema });
    const historical = () => db.query.records.findMany({
      with: { user: true },
      orderBy: (records, { desc }) => [desc(records.createdAt)],
    });
    const pageStatements = (filters, reader = access) => {
      const search = appendVisibility(parseSearch({ ...filters, page: '1', pageSize: '24' }, reader.userId), reader);
      return {
        search,
        count: { sql: 'SELECT count(*) FROM records r ' + search.where, values: search.values },
        selection: { sql: `${recordSelect} ${search.where} ORDER BY ${search.order} LIMIT $${search.values.length + 1} OFFSET $${search.values.length + 2}`,
          values: [...search.values, search.pageSize, (search.page - 1) * search.pageSize] },
      };
    };
    const page = async (filters, reader = access) => {
      const { search, count, selection } = pageStatements(filters, reader);
      const total = Number((await client.query(count.sql, count.values)).rows[0].count);
      const result = await client.query(selection.sql, selection.values);
      return { items: result.rows.map(camel), total, page: search.page, pageSize: search.pageSize, totalPages: Math.ceil(total / search.pageSize) };
    };
    await inSchema(client, schema, async () => {
      const triggers = (await client.query(`SELECT t.tgname,t.tgenabled FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND t.tgname IN ('research_record_audit','research_inscription_audit','research_revision')`, [schema])).rows;
      assert.equal(triggers.length, 3, 'All three record/inscription audit and revision triggers must exist');
      assert.ok(triggers.every(trigger => trigger.tgenabled !== 'D'), 'Audit triggers must be enabled');
      await client.query('INSERT INTO users(id,email,name) VALUES($1,$2,$3)', [owner, `${randomUUID()}@example.invalid`, 'Synthetic scale fixture']);
      await client.query('INSERT INTO object_types(id,name) VALUES($1,$2)', [objectTypeId, 'Synthetic fragment']);
    });
    let previous = 0;
    for (const count of [2000, 10000]) {
      stage = `seed and measure ${count} synthetic records`;
      await inSchema(client, schema, async () => {
        const fixtureCounts = await seed(client, previous, count, owner, objectTypeId);
        const sameOwner = item => item.userId === owner;
        const sample = {
          records: count, fixtureCounts,
          historicalUnbounded: await measureThree(historical, items => {
            assert.equal(items.length, count, 'Historical baseline must actually be unbounded');
            assert.ok(items.every(item => item.userId === owner && item.user?.id === owner));
            for (let i = 1; i < items.length; i += 1) assert.ok(new Date(items[i - 1].createdAt) >= new Date(items[i].createdAt));
          }, 1),
          firstPage: await measureThree(() => page({}), result => validatePage(result, count, sameOwner), 2),
          metadataSearch: await measureThree(() => page({ q: 'dedication' }), result => validatePage(result, count / 100,
            item => sameOwner(item) && item.itemName.startsWith('Dedication fragment ')), 2),
          originalGreekSearch: await measureThree(() => page({ q: GREEK }), result => validatePage(result, count / 20,
            item => sameOwner(item) && item.inscriptions.some(inscription => inscription.content === GREEK)), 2),
          structuredFilters: await measureThree(() => page({
            museum: 'Synthetic fixture museum', material: 'Bronze', place: 'Ostia',
            objectTypeId, reviewStatus: 'draft', sourceProvider: 'scale-fixture', dateFrom: '-200', dateTo: '0',
          }), result => validatePage(result, count / 100, item => sameOwner(item) && item.materials === 'Bronze' && item.productionPlace === 'Ostia'
            && item.museumName === 'Synthetic fixture museum' && item.objectTypeId === objectTypeId && item.reviewStatus === 'draft'
            && item.sourceProvider === 'scale-fixture' && Number.isInteger(item.dateStart) && Number.isInteger(item.dateEnd)
            && item.dateEnd >= -200 && item.dateStart <= 0), 2),
          storage: await storageBytes(client, schema),
        };
        // A different contributor cannot see these pending records: visibility is exercised, not bypassed.
        validatePage(await page({}, { userId: outsider, role: 'contributor' }), 0);
        sample.outsiderPendingVisible = 0;
        if (explain && count === 10000) {
          sample.explainPlans = {};
          for (const [name, filters] of [['metadataSearch', { q: 'dedication' }], ['originalGreekSearch', { q: GREEK }]]) {
            const statements = pageStatements(filters);
            sample.explainPlans[name] = {
              count: await explainStatement(client, statements.count.sql, statements.count.values),
              selection: await explainStatement(client, statements.selection.sql, statements.selection.values),
            };
          }
        }
        output.samples.push(sample);
      });
      previous = count;
    }
    output.ok = true;
  } catch (error) {
    const publicPreflightMessages = new Set([
      'DATABASE_URL is required in backend/.env or the environment',
      'Build the latest backend, including moderation access, before running this check',
    ]);
    output.failure = {
      stage, code: error.code || error.name || 'Error',
      message: publicPreflightMessages.has(error.message) || error.name === 'AssertionError' ? error.message : 'Scale check failed at the reported stage; raw connection, SQL and server error details are intentionally omitted.',
    };
  } finally {
    // Cleanup failures never skip the remaining cleanup operations or pool closure.
    if (client) {
      try { client.release(); } catch { output.cleanup.errors.push('release workload connection'); }
    }
    if (pool) {
      try { await pool.end(); } catch { output.cleanup.errors.push('close workload pool'); }
    }
    if (created && admin) {
      try {
        await admin.query(`DROP SCHEMA ${generatedIdentifier(schema)} CASCADE`);
        output.cleanup.schemaRemoved = true;
      } catch { output.cleanup.errors.push('drop generated disposable schema'); }
    }
    if (admin) {
      try { await admin.end(); } catch { output.cleanup.errors.push('close administration pool'); }
    }
    if (output.cleanup.errors.length) output.ok = false;
  }
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(output, null, 2) + '\n');
  const concise = { ...output, samples: output.samples.map(({ explainPlans, ...sample }) => ({
    ...sample,
    ...(explainPlans ? { explainPlans: Object.fromEntries(Object.entries(explainPlans).map(([name, statements]) => [name,
      Object.fromEntries(Object.entries(statements).map(([kind, { nodes, ...plan }]) => [kind, {
        ...plan, nodeTypes: [...new Set(nodes.map(node => node.nodeType))],
      }])),
    ])) } : {}),
  })) };
  console.log(JSON.stringify(concise));
  if (!output.ok) process.exitCode = 1;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const validRun = args.includes('--run') && args.length === new Set(args).size && args.every(arg => ['--run', '--explain'].includes(arg));
  if (!validRun) {
    help();
    if (args.length && !args.every(arg => ['--help', '-h'].includes(arg))) process.exitCode = 1;
  } else {
    run({ explain: args.includes('--explain') }).catch(() => {
      console.error(JSON.stringify({ ok: false, message: 'Scale check could not save its results. No connection details are printed.' }));
      process.exitCode = 1;
    });
  }
}
