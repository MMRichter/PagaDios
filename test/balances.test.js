import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSeededStore, UIDS } from '../support/helpers.js';
import { SESION_MOCK } from '../src/mockData.js';
import {
    computeBalances,
    settle,
    getSaldo,
    owedBy,
    getNotifications,
    TIPOS_NOTIFICACION
} from '../src/model.js';

const { yo, matias, juan } = UIDS;

test('computeBalances devuelve quién le debe a quién', async () => {
    const store = await freshSeededStore();
    const balances = await computeBalances(store, SESION_MOCK.id, yo);

    const vsMatias = balances.find((b) => b.uid === matias);
    const vsJuan = balances.find((b) => b.uid === juan);

    // Matias le debe 2166.66 a Yo; Juan le debe 2000 a Yo.
    assert.equal(vsMatias.net, 2166.66);
    assert.equal(vsJuan.net, 2000);
});

test('computeBalances es simétrico y cambia de signo', async () => {
    const store = await freshSeededStore();
    const deMatias = await computeBalances(store, SESION_MOCK.id, matias);
    const vsYo = deMatias.find((b) => b.uid === yo);
    assert.equal(vsYo.net, -2166.66);
});

test('settle reduce la deuda y registra el pago', async () => {
    const store = await freshSeededStore();
    // Desde la vista de Matias, le debe 166.67 a Juan.
    await settle(store, { sesionId: SESION_MOCK.id, pagadorId: matias, cobradorId: juan, monto: 100 });

    assert.equal(owedBy(matias, juan, await getSaldo(store, SESION_MOCK.id, matias, juan)), 66.67);

    const pagos = await store.query(`sesiones/${SESION_MOCK.id}/pagos`);
    assert.equal(pagos.length, 1);
    assert.equal(pagos[0].data.de, matias);
    assert.equal(pagos[0].data.para, juan);
    assert.equal(pagos[0].data.monto, 100);

    const notifs = await getNotifications(store, juan);
    assert.equal(notifs.some((n) => n.tipo === TIPOS_NOTIFICACION.pagoRecibido), true);
});

test('settle total deja la deuda en cero', async () => {
    const store = await freshSeededStore();
    await settle(store, { sesionId: SESION_MOCK.id, pagadorId: matias, cobradorId: juan, monto: 166.67 });
    assert.equal(owedBy(matias, juan, await getSaldo(store, SESION_MOCK.id, matias, juan)), 0);
});

test('settle rechaza pagar de más o cuando no hay deuda', async () => {
    const store = await freshSeededStore();
    await assert.rejects(
        () => settle(store, { sesionId: SESION_MOCK.id, pagadorId: matias, cobradorId: juan, monto: 999 }),
        /supera la deuda/
    );
    // Yo no le debe a Matias (es al revés).
    await assert.rejects(
        () => settle(store, { sesionId: SESION_MOCK.id, pagadorId: yo, cobradorId: matias, monto: 10 }),
        /No le debés nada/
    );
    await assert.rejects(
        () => settle(store, { sesionId: SESION_MOCK.id, pagadorId: matias, cobradorId: matias, monto: 10 }),
        /vos mismo/
    );
});
