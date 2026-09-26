import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from '../support/helpers.js';
import { increment } from '../src/store.js';

test('set/get y merge', async () => {
    const store = makeStore();
    await store.set('a/1', { x: 1, y: 2 });
    assert.deepEqual(await store.get('a/1'), { x: 1, y: 2 });

    await store.set('a/1', { y: 3 }, { merge: true });
    assert.deepEqual(await store.get('a/1'), { x: 1, y: 3 });

    await store.set('a/1', { z: 9 });
    assert.deepEqual(await store.get('a/1'), { z: 9 });
});

test('get de documento inexistente devuelve null', async () => {
    const store = makeStore();
    assert.equal(await store.get('nada/aca'), null);
});

test('update falla si el documento no existe', async () => {
    const store = makeStore();
    await assert.rejects(() => store.update('a/1', { x: 1 }), /No existe/);
});

test('add/query listan solo hijos directos', async () => {
    const store = makeStore();
    const id1 = await store.add('a', { v: 1 });
    await store.add('a', { v: 2 });
    await store.add('a/sub', { v: 3 });

    const docs = await store.query('a');
    assert.equal(docs.length, 2);
    assert.equal(docs[0].id, id1);
    assert.deepEqual(docs.map((d) => d.data.v).sort(), [1, 2]);
});

test('delete quita el documento', async () => {
    const store = makeStore();
    await store.set('a/1', { x: 1 });
    await store.delete('a/1');
    assert.equal(await store.get('a/1'), null);
});

test('transacción: un throw aborta todas las escrituras', async () => {
    const store = makeStore();
    await store.set('a/1', { x: 1 });

    await assert.rejects(() => store.runTransaction(async (tx) => {
        tx.set('a/1', { x: 2 });
        tx.set('b/1', { y: 1 });
        throw new Error('abortar');
    }), /abortar/);

    assert.deepEqual(await store.get('a/1'), { x: 1 });
    assert.equal(await store.get('b/1'), null);
});

test('transacción: reintenta ante conflicto y termina aplicando', async () => {
    const store = makeStore();
    await store.set('a/1', { x: 0 });

    let sabotaged = false;
    let attempts = 0;
    await store.runTransaction(async (tx) => {
        attempts++;
        const actual = await tx.get('a/1');
        if (!sabotaged) {
            sabotaged = true;
            await store.set('a/1', { x: 99 });
        }
        tx.set('a/1', { x: (actual?.x ?? 0) + 1 });
    });

    assert.equal(attempts, 2);
    assert.equal((await store.get('a/1')).x, 100);
});

test('query soporta where, orderBy, limit y startAfter', async () => {
    const store = makeStore();
    await store.set('c/1', { t: 10, pagado_por: 'a' });
    await store.set('c/2', { t: 30, pagado_por: 'b' });
    await store.set('c/3', { t: 20, pagado_por: 'a' });
    await store.set('c/4', { t: 40, pagado_por: 'a' });

    const ordenado = await store.query('c', { orderBy: [['t', 'desc']] });
    assert.deepEqual(ordenado.map((d) => d.data.t), [40, 30, 20, 10]);

    const filtrado = await store.query('c', { where: [['pagado_por', '==', 'a']] });
    assert.equal(filtrado.length, 3);

    const pagina = await store.query('c', { orderBy: [['t', 'desc']], limit: 2 });
    assert.deepEqual(pagina.map((d) => d.data.t), [40, 30]);

    const siguiente = await store.query('c', {
        orderBy: [['t', 'desc']], limit: 2, startAfter: { t: 30 }
    });
    assert.deepEqual(siguiente.map((d) => d.data.t), [20, 10]);
});

test('queryGroup busca por collection group', async () => {
    const store = makeStore();
    await store.set('sesiones/s1/miembros/u1', { uid: 'u1' });
    await store.set('sesiones/s2/miembros/u1', { uid: 'u1' });
    await store.set('sesiones/s2/miembros/u9', { uid: 'u9' });

    const docs = await store.queryGroup('miembros', { where: [['uid', '==', 'u1']] });
    assert.equal(docs.length, 2);
    assert.deepEqual(docs.map((d) => d.path.split('/')[1]).sort(), ['s1', 's2']);
});

test('batch aplica increment sin leer', async () => {
    const store = makeStore();
    await store.set('saldos/a_b', { balance_neto_A_vs_B: 100 });
    await store.set('usuarios/u', { notif_no_leidas: 2 });

    const batch = store.batch();
    batch.set('saldos/a_b', { balance_neto_A_vs_B: increment(50) }, { merge: true });
    batch.set('usuarios/u', { notif_no_leidas: increment(1) }, { merge: true });
    batch.set('saldos/nuevo', { balance_neto_A_vs_B: increment(7) }, { merge: true });
    const id = store.newId();
    batch.set(`compras/${id}`, { total: 10 });
    await batch.commit();

    assert.equal((await store.get('saldos/a_b')).balance_neto_A_vs_B, 150);
    assert.equal((await store.get('usuarios/u')).notif_no_leidas, 3);
    assert.equal((await store.get('saldos/nuevo')).balance_neto_A_vs_B, 7);
    assert.equal((await store.get(`compras/${id}`)).total, 10);
});

test('subscribeQuery emite estado inicial y ante cambios', async () => {
    const store = makeStore();
    const vistos = [];
    const unsub = store.subscribeQuery('a', (docs) => vistos.push(docs.length));

    await new Promise((r) => setTimeout(r, 0));
    assert.equal(vistos.at(-1), 0);

    await store.add('a', { v: 1 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(vistos.at(-1), 1);

    unsub();
    await store.add('a', { v: 2 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(vistos.at(-1), 1);
});
