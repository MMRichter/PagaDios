import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSeededStore, makeStore, UIDS } from '../support/helpers.js';
import { SESION_MOCK } from '../src/mockData.js';
import { addExpense, countUnread } from '../src/model.js';

const { yo, matias, juan } = UIDS;
const SID = SESION_MOCK.id;

test('la semilla deja agregados y contadores consistentes', async () => {
    const store = await freshSeededStore();

    const [y, m, j, sesion] = await Promise.all([
        store.get(`sesiones/${SID}/miembros/${yo}`),
        store.get(`sesiones/${SID}/miembros/${matias}`),
        store.get(`sesiones/${SID}/miembros/${juan}`),
        store.get(`sesiones/${SID}`)
    ]);

    assert.equal(y.total_gastado, 15000);
    assert.equal(m.total_gastado, 8500);
    assert.equal(j.total_gastado, 9000);
    assert.equal(y.compras_count, 1);
    assert.equal(sesion.total_gastado, 32500);
    assert.equal(sesion.compras_count, 3);

    // Cada uno recibió aviso de las dos compras en las que no fue comprador.
    assert.equal(await countUnread(store, yo), 2);
    assert.equal(await countUnread(store, matias), 2);
    assert.equal(await countUnread(store, juan), 2);
});

test('addExpense actualiza agregados sin recalcular compras', async () => {
    const store = await freshSeededStore();

    await addExpense(store, {
        sesionId: SID, buyerId: juan, total: 1000,
        descripcion: 'Helado', participantIds: [yo, matias, juan], buyerNombre: 'Juan'
    });

    const [j, sesion] = await Promise.all([
        store.get(`sesiones/${SID}/miembros/${juan}`),
        store.get(`sesiones/${SID}`)
    ]);
    assert.equal(j.total_gastado, 10000);
    assert.equal(j.compras_count, 2);
    assert.equal(sesion.total_gastado, 33500);
    assert.equal(sesion.compras_count, 4);
});

test('addExpense no hace lecturas (escrituras por batch con increment)', async () => {
    const store = makeStore();
    let reads = 0;
    const originalGet = store.get.bind(store);
    const originalQuery = store.query.bind(store);
    store.get = async (path) => { reads++; return originalGet(path); };
    store.query = async (...args) => { reads++; return originalQuery(...args); };

    await addExpense(store, {
        sesionId: 's1', buyerId: 'a', total: 100,
        descripcion: 'Test', participantIds: ['a', 'b', 'c']
    });

    assert.equal(reads, 0);
});
