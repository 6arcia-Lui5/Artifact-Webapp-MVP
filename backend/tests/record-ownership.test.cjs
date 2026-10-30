const { test } = require("node:test");
const assert = require("node:assert/strict");

// Exercise the real controllers without writing to the shared database.
let written;
const queries = {
  createRecord: async data => { written = data; return data; },
  getRecordById: async () => ({ id: "record", userId: "owner" }),
  updateRecord: async (_id, data) => { written = data; return data; },
};
for (const [name, exports] of [
  ["../dist/db/queries.js", queries],
  ["../dist/db/index.js", { db: {} }],
  ["@clerk/express", { getAuth: request => ({ userId: request.authenticatedUser }) }],
]) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const controller = require("../dist/controllers/recordController.js");

function response() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const recordData = {
  itemName: "Artifact", objectTypeId: "705b0cf5-00ae-4502-bfa6-8a05ebea8791",
  museumName: "Museum", museumCity: "City", museumCountry: "Country", museumNumber: "123",
  dateCulturePeriod: "6th century", materials: "Gold", dimensions: "10 cm",
};

test("creating a record uses the signed-in owner and server-managed identity", async () => {
  const res = response();
  await controller.createRecord({
    authenticatedUser: "owner",
    body: { ...recordData, userId: "someone-else", id: "forged", createdAt: "forged", updatedAt: "forged" },
  }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(written, { ...recordData, userId: "owner" });
});

test("an owner can update fields without transferring ownership or changing identity", async () => {
  const res = response();
  await controller.updateRecord({
    authenticatedUser: "owner", params: { id: "record" },
    body: { itemName: "Updated artifact", userId: "someone-else", id: "forged", createdAt: "forged", updatedAt: "forged" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(written, { itemName: "Updated artifact" });
});

test("another approved account cannot update someone else's record", async () => {
  written = undefined;
  const res = response();
  await controller.updateRecord({
    authenticatedUser: "someone-else", params: { id: "record" }, body: { itemName: "Changed" },
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(written, undefined);
});

test("record saving preserves a museum source URL and rejects image descriptions", async () => {
  const source = "https://www.metmuseum.org/art/collection/search/464070";
  const valid = response();
  await controller.createRecord({ authenticatedUser: "owner", body: { ...recordData, imageSourceUrl: source } }, valid);
  assert.equal(valid.statusCode, 201);
  assert.equal(written.imageSourceUrl, source);

  written = undefined;
  const invalid = response();
  await controller.createRecord({ authenticatedUser: "owner", body: { ...recordData, imageSourceUrl: "Colour photo" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /Image Source URL/);
  assert.equal(written, undefined);
});

test("an unselected object type returns an actionable validation error", async () => {
  written = undefined;
  const res = response();
  await controller.createRecord({ authenticatedUser: "owner", body: { ...recordData, objectTypeId: "" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Object Type/);
  assert.equal(written, undefined);
});
