import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSeededStore, UIDS } from '../support/helpers.js';
import { SESION_MOCK } from '../src/mockData.js';
import { createSessionCache } from '../src/sessionCache.js';

const { yo } = UIDS;
const SID = SESION_MOCK.id;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('la caché carga todo con una sola apertura', async () => {
    const store = await freshSeededStore();
    const cache = createSessionCache(store, { comprasPageSize: 2 });
    let cambios = 0;
    cache.onChange(() => { cambios++; });

    cache.open({ uid: yo, sesionId: SID });
    await flush();
    await flush();

    assert.equal(cache.state.miembros.length, 3);
    assert.equal(cache.state.saldos.length, 3);
    assert.equal(cache.state.compras.length, 2);
    assert.equal(cache.state.notificaciones.length, 2);
    assert.equal(cache.state.sesion.nombre, SESION_MOCK.nombre);
    assert.equal(cambios > 0, true);

    cache.close();
});

test('loadMoreCompras trae las páginas anteriores', async () => {
    const store = await freshSeededStore();
    const cache = createSessionCache(store, { comprasPageSize: 2 });
    cache.open({ uid: yo, sesionId: SID });
    await flush();

    assert.equal(cache.allCompras().length, 2);
    assert.equal(cache.state.hasMoreCompras, true);

    await cache.loadMoreCompras();
    assert.equal(cache.allCompras().length, 3);
    assert.equal(cache.state.hasMoreCompras, false);

    // No debe duplicar ids al volver a pedir.
    await cache.loadMoreCompras();
    assert.equal(cache.allCompras().length, 3);

    cache.close();
});

test('los cambios del store se reflejan en la caché', async () => {
    const store = await freshSeededStore();
    const cache = createSessionCache(store);
    cache.open({ uid: yo, sesionId: SID });
    await flush();

    await store.set(`sesiones/${SID}/miembros/${yo}`, { total_gastado: 99999 }, { merge: true });
    await flush();

    const mi = cache.state.miembros.find((m) => m.uid === yo);
    assert.equal(mi.total_gastado, 99999);

    cache.close();
});
