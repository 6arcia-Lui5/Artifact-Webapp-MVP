const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const inscriptionId = "a4dde13d-dff2-4edc-aa94-99a091a53abc";
const otherId = "a4dde13d-dff2-4edc-aa94-99a091a53abd";
let writes, existing;
const queries = {
  createRecordWithInscriptions: async (data, entries) => { writes.push({ data, entries }); return { ...data, inscriptions: entries }; },
  updateRecordWithInscriptions: async (id, data, entries) => { writes.push({ id, data, entries }); return { ...data, inscriptions: entries }; },
  updateRecord: async (id, data) => { writes.push({ id, data }); return data; },
  getRecordById: async () => existing,
};
for (const [name, exports] of [
  ["../dist/db/queries.js", queries], ["../dist/db/index.js", { db: {} }],
  ["@clerk/express", { getAuth: request => ({ userId: request.authenticatedUser }) }],
]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const controller = require("../dist/controllers/recordController.js");
const core = {
  itemName: "Test artifact", objectTypeId: "705b0cf5-00ae-4502-bfa6-8a05ebea8791",
  museumName: "Museum", museumCity: "City", museumCountry: "Country", museumNumber: "123",
  dateCulturePeriod: "100-200 CE", materials: "Gold", dimensions: "10 cm", inscribed: true,
};
const entry = { content: "χαῖρε", language: "Greek", script: "Greek", translation: "" };
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
beforeEach(() => { writes = []; existing = { id: "record", userId: "owner", inscribed: true, inscriptions: [{ id: inscriptionId }, { id: otherId }] }; });

test("creating an artifact forwards multiple original inscriptions while stripping client ownership and timestamps", async () => {
  const res = response();
  await controller.createRecord({ authenticatedUser: "owner", body: {
    ...core, userId: "forged", inscriptions: [{ ...entry, recordId: "forged", createdAt: "forged" }, { ...entry, content: "D M", language: "Latin" }],
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.userId, "owner");
  assert.equal("inscriptions" in writes[0].data, false);
  assert.deepEqual(writes[0].entries[0], { ...entry, serifsPresent: false, stopmarksPresent: false });
  assert.equal(writes[0].entries.length, 2);
});

test("an invalid second inscription prevents the entire save", async () => {
  const res = response();
  await controller.createRecord({ authenticatedUser: "owner", body: { ...core, inscriptions: [entry, { ...entry, content: " " }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Inscription 2.*original text/);
  assert.equal(writes.length, 0);
});

test("metadata-only updates preserve existing inscriptions by omitting the replacement operation", async () => {
  const res = response();
  await controller.updateRecord({ authenticatedUser: "owner", params: { id: "record" }, body: { itemName: "Corrected" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(writes, [{ id: "record", data: { itemName: "Corrected" } }]);
});

test("editing existing inscriptions preserves their IDs and multiple entries", async () => {
  const res = response();
  await controller.updateRecord({ authenticatedUser: "owner", params: { id: "record" }, body: {
    itemName: "Corrected", inscriptions: [{ ...entry, id: inscriptionId, translation: "Updated translation" }, { ...entry, id: otherId }],
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(writes[0].entries.map(item => item.id), [inscriptionId, otherId]);
  assert.equal(writes[0].entries[0].translation, "Updated translation");
});

test("another account cannot update either the artifact or its inscriptions", async () => {
  const res = response();
  await controller.updateRecord({ authenticatedUser: "other", params: { id: "record" }, body: { inscriptions: [entry] } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(writes.length, 0);
});

test("foreign or duplicate child identifiers cannot overwrite unrelated inscriptions", async () => {
  for (const entries of [[{ ...entry, id: "e4dde13d-dff2-4edc-aa94-99a091a53abc" }], [{ ...entry, id: inscriptionId }, { ...entry, id: inscriptionId }]]) {
    const res = response();
    await controller.updateRecord({ authenticatedUser: "owner", params: { id: "record" }, body: { inscriptions: entries } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(writes.length, 0);
  }
});

test("marking an artifact not inscribed cannot silently retain supplied inscription text", async () => {
  const res = response();
  await controller.updateRecord({ authenticatedUser: "owner", params: { id: "record" }, body: { inscribed: false, inscriptions: [entry] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(writes.length, 0);
});
