const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { randomUUID } = require('node:crypto');
const allowed = ['owner', 'other', 'reviewer', 'admin', 'revoked'];
for (const [name, exports] of [
    ['@clerk/express', { getAuth: req => ({ userId: req.headers['x-user'] }) }],
    ['../dist/config/env', { ENV: { NODE_ENV: 'test', ALLOWED_CLERK_USER_IDS: allowed.join(',') } }],
]) {
    const filename = require.resolve(name);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { requireSiteAccess } = require('../dist/middleware/requireSiteAccess');
const { catalogAccess, canRead, withCatalogAccess } = require('../dist/research/access');
const { camel } = require('../dist/research/validation');
const { createResearchRouter } = require('../dist/research/router');
const ids = { approved: randomUUID(), hidden: randomUUID(), own: randomUUID(), reviewer: randomUUID(), admin: randomUUID() };
const collectionId = randomUUID();
const hiddenImage = randomUUID();
let records = [
    { id: ids.approved, user_id: 'other', item_name: 'Published artifact', moderation_status: 'approved', museum_name: 'Visible Museum' },
    { id: ids.hidden, user_id: 'other', item_name: 'Private pending title', moderation_status: 'pending', museum_name: 'Secret Museum', hhw_identifier: 'PRIVATE-ID' },
    { id: ids.own, user_id: 'owner', item_name: 'Owner pending title', moderation_status: 'changes_requested' },
    { id: ids.reviewer, user_id: 'reviewer', item_name: 'Reviewer submission', moderation_status: 'pending' },
    { id: ids.admin, user_id: 'admin', item_name: 'Admin submission', moderation_status: 'pending' },
].map(r => ({ ...r, revision: 1, review_status: 'uncertain', inscribed: false, created_at: new Date().toISOString() }));
const roles = new Map([['reviewer', 'reviewer'], ['revoked', 'reviewer']]);
const history = [{ id: randomUUID(), record_id: ids.hidden, owner_id: 'other', actor_id: 'other', action: 'update',
        snapshot: { record: { ...records[1], item_name: 'Older private text' }, inscriptions: [] } }];
const roleHistory = [];
const jobs = [];
let roleReads = 0;
const visible = (r, actor = catalogAccess()) => canRead(r, actor);
const dto = r => ({ ...r, inscriptions: [], primaryImage: null });
function selectRecords(sql, values) {
    let selected = records.filter(r => visible(r));
    if (sql.includes('moderation_status=$1'))
        selected = selected.filter(r => r.moderation_status === values[0]);
    const selectedIds = values.find(Array.isArray);
    if (selectedIds)
        selected = selected.filter(r => selectedIds.includes(r.id));
    if (sql.includes('plainto_tsquery'))
        selected = selected.filter(r => r.item_name.toLowerCase().includes(values[0].toLowerCase()));
    return selected;
}
function fixture() {
    let tail = Promise.resolve();
    const query = async (sql, values = []) => {
        let rows = [];
        if (sql.includes('set_config') || sql.startsWith('BEGIN') || ['COMMIT', 'ROLLBACK', 'CLOSE research_export'].includes(sql))
            return { rows: [], rowCount: 0 };
        if (sql.startsWith('SELECT role FROM research_roles')) {
            roleReads++;
            rows = roles.has(values[0]) ? [{ role: roles.get(values[0]) }] : [];
        }
        else if (sql.startsWith('SELECT id FROM users')) {
            rows = allowed.includes(values[0]) ? [{ id: values[0] }] : [];
        }
        else if (sql.startsWith('SELECT u.id AS')) {
            rows = allowed.filter(id => values[0].includes(id)).map(id => ({ userId: id, name: id, email: id + '@example.test', role: roles.get(id) ?? 'contributor' }));
        }
        else if (sql.startsWith('INSERT INTO research_roles')) {
            roles.set(values[0], values[1]);
            rows = [{}];
        }
        else if (sql.startsWith('INSERT INTO research_role_history')) {
            roleHistory.push(values);
            rows = [{}];
        }
        else if (sql.startsWith('SELECT * FROM records WHERE id=')) {
            rows = records.filter(r => r.id === values[0]);
        }
        else if (sql.startsWith('SELECT * FROM collections WHERE id=')) {
            rows = values[0] === collectionId ? [{ id: collectionId, user_id: 'owner' }] : [];
        }
        else if (sql.startsWith('SELECT r.* FROM records')) {
            rows = records.filter(r => r.id === values[0] && visible(r));
        }
        else if (sql.startsWith('SELECT r.*,row_to_json')) {
            rows = sql.includes('WHERE r.id=$1') ? records.filter(r => r.id === values[0]).map(dto) : selectRecords(sql, values).map(dto);
        }
        else if (sql.startsWith('SELECT count(*) FROM records')) {
            rows = [{ count: selectRecords(sql, values).length }];
        }
        else if (sql.startsWith('UPDATE records SET moderation_status')) {
            const r = records.find(r => r.id === values[0]);
            Object.assign(r, { moderation_status: values[1], moderation_notes: values[2], moderated_by: values[3], moderated_at: new Date().toISOString(), revision: r.revision + 1 });
            history.push({ id: randomUUID(), record_id: r.id, owner_id: r.user_id, actor_id: catalogAccess().userId, action: 'update', snapshot: { record: structuredClone(r), inscriptions: [] } });
            rows = [r];
        }
        else if (sql.startsWith('UPDATE records SET updated_at')) {
            records.find(r => r.id === values[0]).revision++;
            rows = [{}];
        }
        else if (sql.startsWith('INSERT INTO research_history')) {
            const r = records.find(r => r.id === values[0]);
            history.push({ id: randomUUID(), record_id: r.id, owner_id: r.user_id, actor_id: values[1], action: values[2], summary: values[3] });
            rows = [{}];
        }
        else if (sql.startsWith('SELECT snapshot FROM research_history')) {
            rows = history.filter(h => h.id === values[0] && h.record_id === values[1] && h.owner_id === values[2]);
        }
        else if (sql.startsWith('SELECT id,record_id AS')) {
            rows = history.filter(h => h.record_id === values[0] && h.owner_id === values[1]);
        }
        else if (sql.startsWith('UPDATE records SET ')) {
            const r = records.find(r => r.id === values[0]);
            const keys = sql.slice('UPDATE records SET '.length, sql.indexOf(' WHERE')).split(',').map(s => s.trim().split('=')[0]);
            keys.forEach((key, i) => r[key] = values[i + 1]);
            r.revision++;
            r.moderation_status = 'pending';
            rows = [r];
        }
        else if (sql.startsWith('DELETE FROM inscriptions')) {
            rows = [];
        }
        else if (sql.startsWith('SELECT i.*,b.driver')) {
            rows = records.some(r => r.id === values[0] && visible(r)) && (!values[1] || values[1] === hiddenImage) ?
                [{ id: hiddenImage, record_id: values[0], blob_id: randomUUID(), driver: 'local', caption: 'Private caption', original_key: 'private/original', thumbnail_key: 'private/thumbnail', mime: 'image/png' }] : [];
        }
        else if (sql.startsWith('SELECT DISTINCT f.')) {
            const column = /SELECT DISTINCT f\.(\w+)/.exec(sql)[1];
            rows = [...new Set(records.filter(r => visible(r)).map(r => r[column]).filter(Boolean))].map(value => ({ value }));
        }
        else if (sql.startsWith('SELECT o.id,o.name')) {
            rows = [];
        }
        else if (sql.startsWith('WITH viewer AS')) {
            rows = [{ id: collectionId, userId: 'owner', title: 'Study', recordCount: records.filter(r => visible(r)).length }];
        }
        else if (sql.startsWith('DECLARE research_export')) {
            rows = [];
        }
        else if (sql.startsWith('SELECT id,user_id,moderation_status FROM records WHERE hhw_identifier')) {
            rows = records.filter(r => r.hhw_identifier === values[0]);
        }
        else if (sql.includes('pg_advisory_xact_lock') || sql.startsWith('DELETE FROM research_imports')) {
            rows = [];
        }
        else if (sql.startsWith('SELECT count(*) FROM research_imports')) {
            rows = [{ count: jobs.length }];
        }
        else if (sql.startsWith('INSERT INTO research_imports')) {
            const j = { id: randomUUID(), user_id: values[0], source_type: values[1], source_provider: values[2], payload: JSON.parse(values[3]), status: 'preview' };
            jobs.push(j);
            rows = [j];
        }
        else if (sql.startsWith('SELECT * FROM research_imports')) {
            rows = jobs.filter(j => j.id === values[0] && j.user_id === values[1]);
        }
        else if (sql.startsWith('SELECT r.id FROM records')) {
            rows = records.filter(r => values[0].includes(r.id) && visible(r)).map(r => ({ id: r.id }));
        }
        else
            throw Error('Unhandled policy fixture SQL ' + sql);
        return { rows: structuredClone(rows), rowCount: rows.length };
    };
    return { query, async connect() {
            const previous = tail;
            let unlock;
            tail = new Promise(resolve => unlock = resolve);
            await previous;
            const snapshot = structuredClone(records);
            let cursor = [];
            return { async query(sql, v) {
                    if (sql === 'ROLLBACK')
                        records = snapshot;
                    if (sql.startsWith('DECLARE research_export'))
                        cursor = selectRecords(sql, v).map(r => ({ payload: dto(r) }));
                    if (sql.startsWith('FETCH FORWARD')) {
                        const rows = cursor.splice(0, 5);
                        return { rows, rowCount: rows.length };
                    }
                    return query(sql, v);
                }, release() {
                    unlock();
                } };
        } };
}
// Keep real legacy controllers/routes and the existing account gate. Only DB rows and model HTTP are substituted.
const legacyQueries = {
    getAllRecords: async () => records.filter(r => visible(r)).map(r => camel(dto(r))),
    searchRecords: async (q) => records.filter(r => visible(r) && r.item_name.includes(q)).map(r => camel(dto(r))),
    getRecordsByUserId: async (id) => records.filter(r => r.user_id === id && visible(r)).map(r => camel(dto(r))),
    getRecordById: async (id) => {
        const r = records.find(r => r.id === id && visible(r));
        return r ? camel(dto(r)) : undefined;
    },
    getAllCollections: async () => [{ id: collectionId, records: records.filter(r => visible(r)).map(camel), recordCount: records.filter(r => visible(r)).length }],
    getCollectionById: async () => ({ id: collectionId, records: records.filter(r => visible(r)).map(camel), recordCount: records.filter(r => visible(r)).length }),
    updateRecord: async (id, data) => {
        const r = records.find(r => r.id === id);
        Object.assign(r, { item_name: data.itemName });
        return camel(r);
    },
    deleteRecord: async (id) => {
        records = records.filter(r => r.id !== id);
    },
};
const queryFile = require.resolve('../dist/db/queries');
require.cache[queryFile] = { id: queryFile, filename: queryFile, loaded: true, exports: legacyQueries };
let server, base, priorAdmins;
before(async () => {
    priorAdmins = process.env.CATALOG_ADMIN_USER_IDS;
    process.env.CATALOG_ADMIN_USER_IDS = 'admin,outsider';
    const app = express();
    app.use(express.json());
    app.use(requireSiteAccess);
    const pool = fixture();
    const { catalogContext } = require('../dist/research/access');
    app.use(catalogContext(pool));
    app.use('/api/research', createResearchRouter(pool, { driver: 'local', async get() {
            return Buffer.from('private original bytes');
        } }));
    app.use('/api/records', require('../dist/routes/recordRoutes').default);
    app.use('/api/collections', require('../dist/routes/collectionRoutes').default);
    app.use('/api/ml', require('../dist/routes/mlRoutes').default);
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (priorAdmins === undefined)
        delete process.env.CATALOG_ADMIN_USER_IDS;
    else
        process.env.CATALOG_ADMIN_USER_IDS = priorAdmins;
});
const request = (route, user = 'owner', method = 'GET', body) => fetch(base + route, { method, headers: { 'x-user': user, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
test('anonymous/unapproved users cannot bootstrap administration; browser claims never grant roles', async () => {
    for (const user of ['', 'outsider'])
        assert.equal((await request('/api/research/access', user)).status, user ? 403 : 401);
    const access = await (await request('/api/research/access', 'owner')).json();
    assert.deepEqual(access, { userId: 'owner', role: 'contributor', canReview: false, canManageRoles: false });
    assert.equal((await request('/api/research/roles/owner', 'owner', 'PATCH', { role: 'admin' })).status, 403);
    assert.equal((await request(`/api/records/${ids.own}`, 'owner', 'PUT', { moderation_status: 'approved', moderationStatus: 'approved', moderatedBy: 'admin' })).status, 400);
    assert.equal((await request('/api/research/moderation', 'owner')).status, 403);
    assert.equal((await request('/api/research/roles', 'reviewer')).status, 403);
    process.env.CATALOG_ADMIN_USER_IDS = '';
    assert.equal((await (await request('/api/research/access', 'admin')).json()).role, 'contributor');
    process.env.CATALOG_ADMIN_USER_IDS = 'admin,outsider';
});
test('contributors cannot bypass pending visibility through legacy/research/detail/image/export/facet/collection/ML routes', async () => {
    for (const route of [`/api/records/${ids.hidden}`, `/api/ml/records/${ids.hidden}/check`,
        `/api/research/records/${ids.hidden}/images`, `/api/research/records/${ids.hidden}/images/${hiddenImage}/file`,
        `/api/research/records/${ids.hidden}/history`])
        assert.equal((await request(route)).status, 404, route);
    for (const route of ['/api/records', '/api/records/search?query=Private', '/api/research/records',
        '/api/research/export?format=json', '/api/research/facets', '/api/collections', `/api/collections/${collectionId}`, `/api/research/collections/${collectionId}`]) {
        const response = await request(route);
        assert.equal(response.status, 200, route + ': ' + await response.clone().text());
        const text = await response.text();
        assert(!text.includes(ids.hidden), route);
        assert(!text.includes('Secret Museum'), route);
        assert(!text.includes('Private pending title'), route);
    }
    assert.equal((await request(`/api/research/collections/${collectionId}/records`, 'owner', 'POST', { recordIds: [ids.hidden] })).status, 404);
    assert.equal((await request(`/api/records/${ids.own}`)).status, 200);
    assert.equal((await request(`/api/research/records/${ids.hidden}/moderate`, 'owner', 'POST', { status: 'approved', notes: 'Forbidden', expectedRevision: 1 })).status, 404);
    assert.equal((await request(`/api/research/records/${ids.own}/moderate`, 'owner', 'POST', { status: 'approved', notes: 'Forbidden', expectedRevision: 1 })).status, 403);
});
test('reviewers inspect pending history/images but cannot edit, restore or decide their own submissions', async () => {
    assert.equal((await request('/api/research/moderation', 'reviewer')).status, 200);
    assert.equal((await request(`/api/research/records/${ids.hidden}/images`, 'reviewer')).status, 200);
    const file = await request(`/api/research/records/${ids.hidden}/images/${hiddenImage}/file`, 'reviewer');
    assert.equal(file.status, 200);
    assert.equal(await file.text(), 'private original bytes');
    assert.equal((await request(`/api/research/records/${ids.hidden}/history`, 'reviewer')).status, 200);
    assert.equal((await request(`/api/records/${ids.hidden}`, 'reviewer', 'PUT', { itemName: 'Forbidden' })).status, 403);
    assert.equal((await request(`/api/research/records/${ids.hidden}/history/${history[0].id}/restore`, 'reviewer', 'POST', { expectedRevision: 1 })).status, 403);
    assert.equal((await request(`/api/research/records/${ids.reviewer}/moderate`, 'reviewer', 'POST', { status: 'approved', notes: 'My own', expectedRevision: 1 })).status, 403);
});
test('decisions require notes/revision, preserve owner and uncertainty, and serialize concurrent approval', async () => {
    const route = `/api/research/records/${ids.hidden}/moderate`;
    for (const body of [{ status: 'approved', notes: '', expectedRevision: 1 }, { status: 'approved', notes: 'X'.repeat(10001), expectedRevision: 1 }, { status: 'approved', notes: 'Decision' }])
        assert.equal((await request(route, 'reviewer', 'POST', body)).status, 400);
    const responses = await Promise.all([1, 2].map(() => request(route, 'reviewer', 'POST', { status: 'approved', notes: 'Publication reviewed; transcription remains uncertain', expectedRevision: 1 })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const r = records.find(r => r.id === ids.hidden);
    assert.equal(r.user_id, 'other');
    assert.equal(r.review_status, 'uncertain');
    assert.equal(r.moderation_status, 'approved');
    assert.equal(history.at(-1).owner_id, 'other');
    assert.equal(history.at(-1).actor_id, 'reviewer');
    assert.equal((await request(`/api/records/${ids.hidden}`)).status, 200);
});
test('admin may decide own with explicit notes and edit/restore others without taking ownership', async () => {
    assert.equal((await request(`/api/research/records/${ids.admin}/moderate`, 'admin', 'POST', { status: 'approved', notes: '', expectedRevision: 1 })).status, 400);
    assert.equal((await request(`/api/research/records/${ids.admin}/moderate`, 'admin', 'POST', { status: 'approved', notes: 'Explicit self decision', expectedRevision: 1 })).status, 200);
    assert.equal((await request(`/api/records/${ids.hidden}`, 'admin', 'PUT', { itemName: 'Admin correction', userId: 'admin', moderationStatus: 'approved' })).status, 200);
    const revision = records.find(r => r.id === ids.hidden).revision;
    const response = await request(`/api/research/records/${ids.hidden}/history/${history[0].id}/restore`, 'admin', 'POST', { expectedRevision: revision });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).record.userId, 'other');
    assert.equal(history.at(-1).owner_id, 'other');
    assert.equal(history.at(-1).actor_id, 'admin');
    assert.equal((await request(`/api/records/${ids.approved}`, 'reviewer', 'DELETE')).status, 403);
    assert.equal((await request(`/api/records/${ids.approved}`, 'admin', 'DELETE')).status, 200);
});
test('only admin assigns existing approved non-admin accounts; roles refresh immediately and log dedicated history', async () => {
    for (const [target, role] of [['owner', 'admin'], ['admin', 'reviewer'], ['outsider', 'reviewer'], ['missing', 'reviewer']])
        assert.equal((await request('/api/research/roles/' + target, 'admin', 'PATCH', { role })).status, 400);
    const list = await (await request('/api/research/roles', 'admin')).json();
    assert.equal(list.items.length, 5);
    assert(!JSON.stringify(list).includes('outsider'));
    const beforeReads = roleReads;
    assert.equal((await request('/api/research/roles/owner', 'admin', 'PATCH', { role: 'reviewer' })).status, 200);
    assert.equal((await (await request('/api/research/access', 'owner')).json()).role, 'reviewer');
    assert.equal((await request('/api/research/roles/owner', 'admin', 'PATCH', { role: 'contributor' })).status, 200);
    assert.equal((await (await request('/api/research/access', 'owner')).json()).role, 'contributor');
    assert.equal((await request('/api/research/moderation', 'owner')).status, 403);
    assert(roleReads >= beforeReads + 4);
    assert.equal(roleHistory.at(-1)[0], 'admin');
    assert.equal(roleHistory.at(-1)[1], 'owner');
});
test('pending duplicate identity is reported without private record ID or source facts', async () => {
    const r = records.find(r => r.id === ids.hidden);
    r.moderation_status = 'pending';
    const form = new FormData();
    form.set('file', new Blob(['Title,HHW\nMy supplied title,PRIVATE-ID'], { type: 'text/csv' }), 'source.csv');
    const response = await fetch(base + '/api/research/imports/preview', { method: 'POST', headers: { 'x-user': 'owner' }, body: form });
    assert.equal(response.status, 201, await response.clone().text());
    const result = await response.json();
    assert.equal(result.rows[0].duplicate, true);
    assert.equal(result.rows[0].duplicateRecordId, undefined);
    assert(!JSON.stringify(result).includes(ids.hidden));
    assert(!JSON.stringify(result).includes('Private pending title'));
    assert(result.rows[0].warnings.some(w => w.includes('unavailable or pending')));
    assert.equal((await request('/api/research/imports/' + result.id, 'admin')).status, 404);
    assert.equal((await request('/api/research/imports/' + result.id, 'reviewer')).status, 404);
    await request('/api/research/roles/owner', 'admin', 'PATCH', { role: 'reviewer' });
    const again = new FormData();
    again.set('file', new Blob(['Title,HHW\nMy supplied title,PRIVATE-ID'], { type: 'text/csv' }), 'source.csv');
    const authorized = await (await fetch(base + '/api/research/imports/preview', { method: 'POST', headers: { 'x-user': 'owner' }, body: again })).json();
    assert.equal(authorized.rows[0].duplicateRecordId, ids.hidden);
    await request('/api/research/roles/owner', 'admin', 'PATCH', { role: 'contributor' });
    const reloaded = await (await request('/api/research/imports/' + authorized.id)).json();
    assert.equal(reloaded.rows[0].duplicateRecordId, undefined);
    assert(!JSON.stringify(reloaded).includes(ids.hidden));
    // The same contributor can see a duplicate while it is approved, but an
    // already persisted preview must redact it immediately after approval ends.
    r.moderation_status = 'approved';
    const visibleForm = new FormData();
    visibleForm.set('file', new Blob(['Title,HHW\nMy supplied title,PRIVATE-ID'], { type: 'text/csv' }), 'source.csv');
    const visible = await (await fetch(base + '/api/research/imports/preview', {
        method: 'POST', headers: { 'x-user': 'owner' }, body: visibleForm,
    })).json();
    assert.equal(visible.rows[0].duplicateRecordId, ids.hidden);
    r.moderation_status = 'pending';
    const revoked = await (await request('/api/research/imports/' + visible.id)).json();
    assert.equal(revoked.rows[0].duplicate, true);
    assert.equal(revoked.rows[0].duplicateRecordId, undefined);
    assert(!JSON.stringify(revoked).includes(ids.hidden));
    assert(!JSON.stringify(revoked).includes('Private pending title'));
});
