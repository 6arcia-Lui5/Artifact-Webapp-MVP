const { test } = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");

let inserted;
let objectTypeWrites = 0;
const queries = {
  getOrCreateObjectType: async () => {
    objectTypeWrites++;
    return { id: "705b0cf5-00ae-4502-bfa6-8a05ebea8791" };
  },
  createRecordsBatch: async rows => {
    if (rows.some(row => !row.museumName || !row.objectTypeId)) {
      throw new Error("null value violates not-null constraint");
    }
    inserted = rows;
    return rows;
  },
};
for (const [name, exports] of [
  ["../dist/db/queries.js", queries],
  ["../dist/db/index.js", { db: {} }],
  ["@clerk/express", { getAuth: () => ({ userId: "owner" }) }],
]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { importRecords } = require("../dist/controllers/recordController.js");

const row = {
  "Item Name": "Pectoral", "Object Type": "Pendant",
  "Museum or Institute's Name": "Metropolitan Museum of Art",
  City: "New York", Country: "United States", "Museum or Institute Number": "17.190.1664",
  "Date/ Culture/ Time Period": "6th century", Materials: "Gold", Dimensions: "27.9 cm",
  "Image Source URL": "https://www.metmuseum.org/art/collection/search/464070",
};

async function importRows(rows, format = "csv") {
  inserted = undefined;
  objectTypeWrites = 0;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Artifacts");
  const buffer = format === "csv"
    ? Buffer.from(XLSX.utils.sheet_to_csv(workbook.Sheets.Artifacts))
    : XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await importRecords({ file: { originalname: "artifacts." + format, buffer } }, response);
  return response;
}

test("CSV and Excel imports accept straight apostrophes and whitespace in headers", async () => {
  for (const format of ["csv", "xlsx"]) {
    const res = await importRows([{ ...row, "Museum or Institute's Name": undefined,
      " Museum or Institute’s Name ": row["Museum or Institute's Name"],
      "Image Source URL": "  " + row["Image Source URL"] + "  " }], format);
    assert.equal(res.statusCode, 201);
    assert.equal(inserted[0].museumName, "Metropolitan Museum of Art");
    assert.equal(inserted[0].imageSourceUrl, row["Image Source URL"]);
    assert.equal(inserted[0].userId, "owner");
  }
  assert.equal((await importRows([row])).statusCode, 201);
});

test("an image description is rejected before any database writes", async () => {
  const res = await importRows([{ ...row, "Image Source URL": "Colour photo" }]);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /row 2/i);
  assert.match(res.body.error, /Image Source URL/);
  assert.equal(objectTypeWrites, 0);
  assert.equal(inserted, undefined);
});

test("a missing required field identifies the row and prevents a partial import", async () => {
  const res = await importRows([row, { ...row, "Object Type": "" }]);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /row 3/i);
  assert.match(res.body.error, /Object Type/);
  assert.equal(objectTypeWrites, 0);
  assert.equal(inserted, undefined);
});

test("legacy CSV and XLSX reject over 500 rows before object-type or artifact writes", async () => {
  for (const format of ["csv", "xlsx"]) {
    const res = await importRows(Array.from({ length: 501 }, () => row), format);
    assert.equal(res.statusCode, 413, JSON.stringify(res.body));
    assert.equal(objectTypeWrites, 0);
    assert.equal(inserted, undefined);
  }
});

test("legacy workbook expansion is checked before decoding or writes", async () => {
  inserted = undefined;
  objectTypeWrites = 0;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), "Artifacts");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert(central >= 0);
  buffer.writeUInt32LE(9 * 1024 * 1024, central + 24);
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await importRecords({ file: { originalname: "bomb.xlsx", buffer } }, response);
  assert.equal(response.statusCode, 413);
  assert.equal(objectTypeWrites, 0);
  assert.equal(inserted, undefined);
});

test("legacy imports reject sparse truncated CSV instead of writing a decoded prefix", async () => {
  inserted = undefined;
  objectTypeWrites = 0;
  const sheet = XLSX.utils.json_to_sheet([row]);
  const csv = XLSX.utils.sheet_to_csv(sheet) + '\n'.repeat(600) + XLSX.utils.sheet_to_csv(sheet);
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await importRecords({ file: { originalname: 'sparse.csv', buffer: Buffer.from(csv) } }, response);
  assert.equal(response.statusCode, 413);
  assert.equal(objectTypeWrites, 0);
  assert.equal(inserted, undefined);
});

test("legacy multipart route rejects oversized files before import writes", async () => {
  const express = require('express');
  const http = require('node:http');
  const app = express();
  app.use('/api/records', require('../dist/routes/recordRoutes').default);
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  inserted = undefined;
  objectTypeWrites = 0;
  try {
    const form = new FormData();
    form.set('file', new Blob([Buffer.alloc(4 * 1024 * 1024 + 1, 65)]), 'large.csv');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/records/import`, { method: 'POST', body: form });
    assert.equal(response.status, 413, await response.clone().text());
    assert.equal(objectTypeWrites, 0);
    assert.equal(inserted, undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
