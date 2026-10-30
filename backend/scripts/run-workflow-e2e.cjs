// Development-only runner: clone table definitions into a disposable schema,
// seed synthetic fixtures, test the real app, then remove only that schema.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const backend = path.resolve(__dirname, "..");
const root = path.resolve(backend, "..");
const frontend = path.join(root, "frontend");
const local = path.join(root, ".local");
const schemaName = `artifact_e2e_${Date.now()}_${randomBytes(4).toString("hex")}`;
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
const children = [];
const apiOrigin = "http://localhost:3307";
const frontendOrigin = "http://localhost:5317";

function run(script, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: backend, windowsHide: true, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Check failed with exit code ${code}`)));
  });
}

function serve(script, args, options) {
  const child = spawn(process.execPath, [script, ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  const log = fs.createWriteStream(path.join(local, `workflow-${children.length}.log`));
  child.stdout.pipe(log); child.stderr.pipe(log);
  children.push(child);
  return child;
}

async function ready(url, status) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).status === status) return; } catch { /* Server is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Test server did not become ready at ${url}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill();
  await exited;
}

async function main() {
  fs.mkdirSync(local, { recursive: true });
  const accounts = JSON.parse(fs.readFileSync(path.join(local, "dev-accounts.json"), "utf8"));
  if (accounts.length !== 5 || !accounts.every(account => account.userId)) throw new Error("Five existing developer accounts are required");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const direct = new URL(process.env.DATABASE_URL);
  if (direct.hostname.endsWith(".neon.tech")) direct.hostname = direct.hostname.replace("-pooler.", ".");
  const pool = new Pool({ connectionString: direct.toString(), max: 2, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
  let created = false;
  try {
    await pool.query(`CREATE SCHEMA ${identifier(schemaName)}`); created = true;
    for (const table of ["users", "collections", "object_types", "records", "inscriptions"]) {
      await pool.query(`CREATE TABLE ${identifier(schemaName)}.${identifier(table)} (LIKE public.${identifier(table)} INCLUDING ALL)`);
    }
    const url = new URL(direct); url.searchParams.set("options", `-c search_path=${schemaName}`);
    const isolated = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 10000 });
    try {
      assert.equal((await isolated.query("SELECT current_schema() AS name")).rows[0].name, schemaName);
      // Exercise the explicit research migration only in this newly generated schema.
      const migrations = path.join(backend, "migrations");
      if (fs.existsSync(migrations)) {
        const client = await isolated.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL search_path TO ${identifier(schemaName)}, pg_catalog`);
          const files = fs.readdirSync(migrations).filter(file => /^\d+_[a-z_]+\.sql$/.test(file)).sort();
          for (let pass = 0; pass < 2; pass += 1) {
            for (const file of files) await client.query(fs.readFileSync(path.join(migrations, file), "utf8"));
          } // Reapplying must preserve data and schema.
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      const typeId = randomUUID(), ownId = randomUUID(), foreignId = randomUUID();
      await isolated.query("INSERT INTO object_types (id, name) VALUES ($1,$2)", [typeId, "Pendant"]);
      for (const account of accounts) {
        await isolated.query('INSERT INTO users (id,email,name) VALUES ($1,$2,$3)', [account.userId, account.email, account.name]);
      }
      for (const [id, owner, name, image, inscribed] of [
        [ownId, accounts[0].userId, "Sample catalog artifact", "https://www.metmuseum.org/art/collection/search/464070", true],
        [foreignId, accounts[1].userId, "Sample artifact without an image", "Colour photo", false],
      ]) {
        await isolated.query(`INSERT INTO records
          (id,user_id,item_name,object_type_id,museum_name,museum_city,museum_country,museum_number,date_culture_period,materials,dimensions,image_source_url,inscribed,production_place)
          VALUES ($1,$2,$3,$4,'Demo museum','Demo city','Demo country',$5,'201-500 CE','Gold','10 cm',$6,$7,'Sicilia')`,
        [id, owner, name, typeId, `DEMO-${id}`, image, inscribed]);
      }
      const example = JSON.parse(fs.readFileSync(path.join(root, "ml/demo/examples.json"), "utf8"))[0];
      await isolated.query("INSERT INTO inscriptions (record_id,content,language,translation,script,serifs_present,stopmarks_present) VALUES ($1,$2,'Greek','','Greek',false,false)", [ownId, example.text]);
      if (fs.existsSync(path.join(backend, "migrations/002_catalog_moderation.sql"))) {
        // Only these generated legacy-readable fixtures are pre-approved. Newly
        // submitted browser/API records must still enter the pending queue.
        await isolated.query("UPDATE records SET moderation_status='approved',moderation_notes='Synthetic fixture approved for isolated regression checks',moderated_by=$1,moderated_at=now() WHERE id=ANY($2::uuid[])", [accounts[4].userId, [ownId, foreignId]]);
      }
      fs.writeFileSync(path.join(local, "workflow-fixture.json"), JSON.stringify({ ownId, foreignId, schemaName }));

      // Use the real query functions against this isolated database to prove
      // transaction rollback, including failure after the parent was changed.
      const { drizzle } = require("drizzle-orm/node-postgres");
      const dbModule = require.resolve("../dist/db/index.js");
      const actualSchema = require("../dist/db/schema.js");
      require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: { db: drizzle(isolated, { schema: actualSchema }), pool: isolated } };
      const queries = require("../dist/db/queries.js");
      const { withCatalogAccess } = require("../dist/research/access.js");
      await withCatalogAccess({ userId: accounts[0].userId, role: 'contributor' }, async () => {
      const before = (await isolated.query("SELECT count(*)::int AS n FROM records")).rows[0].n;
      const data = { userId: accounts[0].userId, itemName: "Must roll back", objectTypeId: typeId, museumName: "Demo", museumCity: "Demo", museumCountry: "Demo", museumNumber: "ROLLBACK", dateCulturePeriod: "100 CE", materials: "Gold", dimensions: "10 cm", inscribed: true };
      const badEntry = { content: null, language: "Latin", script: "Latin", translation: "", serifsPresent: false, stopmarksPresent: false };
      await assert.rejects(() => queries.createRecordWithInscriptions(data, [badEntry]));
      assert.equal((await isolated.query("SELECT count(*)::int AS n FROM records")).rows[0].n, before);
      const originalChild = (await isolated.query("SELECT id FROM inscriptions WHERE record_id=$1", [ownId])).rows[0].id;
      await assert.rejects(() => queries.updateRecordWithInscriptions(ownId, { itemName: "Must roll back" }, [{ ...badEntry, id: originalChild }]));
      assert.equal((await isolated.query("SELECT item_name FROM records WHERE id=$1", [ownId])).rows[0].item_name, "Sample catalog artifact");
      const temporary = await queries.createRecordWithInscriptions(data, [{ ...badEntry, content: "D M" }]);
      await queries.deleteRecord(temporary.id);
      assert.equal((await isolated.query("SELECT count(*)::int AS n FROM inscriptions WHERE record_id=$1", [temporary.id])).rows[0].n, 0);
      assert.equal((await isolated.query("SELECT count(*)::int AS n FROM records WHERE id=$1", [temporary.id])).rows[0].n, 0);
      console.log("Real Postgres rollback and linked-deletion checks passed; public artifact tables were not written.");
      });
    } finally { await isolated.end(); }

    const env = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "development", PORT: "3307", FRONTEND_URL: frontendOrigin, ML_SERVICE_URL: process.env.ML_SERVICE_URL || "http://127.0.0.1:8007", ALLOWED_CLERK_USER_IDS: accounts.map(account => account.userId).join(","), CATALOG_ADMIN_USER_IDS: accounts[4].userId, IMAGE_STORAGE_DRIVER: process.env.IMAGE_STORAGE_DRIVER || "local", IMAGE_LOCAL_DIRECTORY: path.join(local, "workflow-images", schemaName), IMAGE_STORAGE_MAX_BYTES: "20000000" };
    delete env.VERCEL;
    serve(path.join(backend, "dist/index.js"), [], { cwd: backend, env });
    await ready(apiOrigin + "/api/access", 401);
    const browserEnv = { ...process.env, NODE_ENV: "production", VITE_API_URL: apiOrigin + "/api" };
    await run(path.join(frontend, "node_modules/vite/bin/vite.js"), ["build"], { cwd: frontend, env: browserEnv });
    serve(path.join(frontend, "node_modules/vite/bin/vite.js"), ["preview", "--host", "127.0.0.1", "--port", "5317", "--strictPort"], { cwd: frontend, env: browserEnv });
    await ready(frontendOrigin, 200);
    await run(path.join(frontend, "node_modules/@playwright/test/cli.js"), ["test", "--output", path.join(local, "workflow-results"), ...process.argv.slice(2)], {
      cwd: frontend, env: { ...process.env, E2E_HOSTED: "1", E2E_WRITE: "1", E2E_ML: process.env.E2E_ML || "1", E2E_FRONTEND_URL: frontendOrigin, E2E_API_URL: apiOrigin + "/api", E2E_FIXTURE: path.join(local, "workflow-fixture.json") },
    });
  } finally {
    await Promise.all(children.map(stop));
    // Generated here, never accepted as a user-supplied cleanup target.
    if (created && /^artifact_e2e_\d+_[0-9a-f]{8}$/.test(schemaName)) {
      await pool.query(`DROP SCHEMA ${identifier(schemaName)} CASCADE`);
      console.log(`Removed disposable schema ${schemaName}.`);
    }
    const imageRoot = path.resolve(local, "workflow-images");
    const imageDirectory = path.resolve(imageRoot, schemaName);
    if (imageDirectory.startsWith(imageRoot + path.sep) && /^artifact_e2e_\d+_[0-9a-f]{8}$/.test(path.basename(imageDirectory))) {
      fs.rmSync(imageDirectory, { recursive: true, force: true });
    }
    await pool.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
