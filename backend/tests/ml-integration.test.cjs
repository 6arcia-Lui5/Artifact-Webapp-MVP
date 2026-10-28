const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// Exercise the real Express entry point and access middleware. Neither Clerk
// nor the shared database is contacted; only the model service is substituted.
let appServer, mlServer, apiUrl, storedRecord, received;
let modelCalls = 0;
let modelStatus = 200;
const prediction = { region: "Italia", date: { year: 150, low: 100, high: 200 }, flags: [], flagged: false };

function stub(name, exports) {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  mlServer = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = { path: req.url, body: JSON.parse(body) };
    modelCalls++;
    res.writeHead(modelStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify(prediction));
  });
  const modelUrl = await listen(mlServer);
  stub("../dist/config/env.js", { ENV: {
    NODE_ENV: "test", ALLOWED_CLERK_USER_IDS: "approved", ML_SERVICE_URL: modelUrl,
  } });
  stub("../dist/db/queries.js", { getRecordById: async () => storedRecord });
  stub("../dist/db/index.js", { db: {} });
  stub("@clerk/express", {
    clerkMiddleware: () => (_req, _res, next) => next(),
    getAuth: req => ({ userId: req.headers["x-test-user"] || null }),
  });
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  let app;
  try { app = require("../dist/index.js").default; }
  finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
  appServer = http.createServer(app);
  apiUrl = await listen(appServer);
});

after(async () => {
  await Promise.all([appServer, mlServer].filter(Boolean).map(server =>
    new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
});

async function check(path, { user = "approved", body } = {}) {
  return fetch(apiUrl + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("anonymous requests cannot reach either ML endpoint", async () => {
  const callsBefore = modelCalls;
  for (const [path, body] of [["/api/ml/check", { text: "D M" }], ["/api/ml/records/one/check"]]) {
    const response = await check(path, { user: null, body });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Sign in to continue" });
  }
  assert.equal(modelCalls, callsBefore);
});

test("an unapproved signed-in account cannot use the ML service", async () => {
  const callsBefore = modelCalls;
  const response = await check("/api/ml/check", { user: "unapproved", body: { text: "D M" } });
  assert.equal(response.status, 403);
  assert.equal(modelCalls, callsBefore);
});

test("an approved account can forward Unicode inscription text and receive a prediction", async () => {
  const body = { text: "D M / χαῖρε", not_before: 100, not_after: 200, region: "Italia" };
  const response = await check("/api/ml/check", { body });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), prediction);
  assert.deepEqual(received, { path: "/check", body });
});

test("missing records and records without inscription text do not call the model", async () => {
  const callsBefore = modelCalls;
  storedRecord = undefined;
  assert.equal((await check("/api/ml/records/one/check")).status, 404);
  storedRecord = { id: "one", inscriptions: [] };
  const response = await check("/api/ml/records/one/check");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Record has no inscription text");
  assert.equal(modelCalls, callsBefore);
});

test("stored-record checks join inscriptions and forward the listed dating and place", async () => {
  storedRecord = {
    id: "one", dateCulturePeriod: "2nd-3rd century CE", productionPlace: "Italy",
    inscriptions: [{ content: "D M" }, { content: "VIXIT" }],
  };
  const response = await check("/api/ml/records/one/check");
  assert.equal(response.status, 200);
  assert.deepEqual(received.body, {
    id: "one", text: "D M VIXIT", not_before: 101, not_after: 300, region: "Italy",
  });
  assert.deepEqual(await response.json(), {
    recordId: "one", listedDating: "2nd-3rd century CE", listedRegion: "Italy", dateNote: null, ...prediction,
  });
});

test("a model-service failure returns JSON without breaking catalog access", async () => {
  modelStatus = 503;
  try {
    const response = await check("/api/ml/check", { body: { text: "D M" } });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "ML service unavailable");
    assert.equal((await check("/api/access")).status, 204);
  } finally { modelStatus = 200; }
});

test("the imported date parser handles documented CE, BCE, and unknown inputs", () => {
  const { parseDating } = require("../dist/routes/mlRoutes.js");
  assert.deepEqual(parseDating("100-200 CE"), { notBefore: 100, notAfter: 200 });
  assert.deepEqual(parseDating("1st c. BCE"), { notBefore: -100, notAfter: -1 });
  assert.deepEqual(parseDating("undated"), { notBefore: null, notAfter: null });
  for (const input of ["803.1", "100 BCE-100 CE", "6th century", "0 CE", "0th century BCE", "Roman 2nd century"]) {
    assert.deepEqual(parseDating(input), { notBefore: null, notAfter: null });
  }
  assert.deepEqual(parseDating("5th-4th century BCE"), { notBefore: -500, notAfter: -301 });
});

test("unrecognized and out-of-range dates are explicitly skipped instead of producing misleading date flags", async () => {
  for (const dating of ["803.1", "1800 CE"]) {
    storedRecord = { id: "one", dateCulturePeriod: dating, inscriptions: [{ content: "D M" }] };
    const response = await check("/api/ml/records/one/check");
    assert.equal(response.status, 200);
    assert.equal(received.body.not_before, null);
    assert.equal(received.body.not_after, null);
    assert.match((await response.json()).dateNote, /date metadata was not checked/);
  }
});
