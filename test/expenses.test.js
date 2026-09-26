import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from '../support/helpers.js';
import {
    addExpense,
    getSessionExpenses,
    getSaldo,
    owedBy,
    saldoPath,
    netOwedTo
} from '../src/model.js';

const SESION = 's_test';
const YO = 'u_yo';
const MATI = 'u_matias';
const JUAN = 'u_juan';

test('addExpense registra la compra y reparte la deuda entre los demás', async () => {
    const store = makeStore();
    const id = await addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 15000,
        descripcion: 'Carnicería', participantIds: [YO, MATI, JUAN],
        now: new Date('2026-09-01T18:30:00.000Z')
    });

    const compras = await getSessionExpenses(store, SESION);
    assert.equal(compras.length, 1);
    assert.equal(compras[0].id, id);
    assert.equal(compras[0].total, 15000);
    assert.equal(compras[0].pagado_por, YO);
    assert.deepEqual(compras[0].dividido_entre, [YO, MATI, JUAN]);

    // Matias y Juan le deben 5000 cada uno a Yo.
    assert.equal(owedBy(MATI, YO, await getSaldo(store, SESION, MATI, YO)), 5000);
    assert.equal(owedBy(JUAN, YO, await getSaldo(store, SESION, JUAN, YO)), 5000);
    // El comprador no se debe a sí mismo.
    assert.equal(await getSaldo(store, SESION, YO, YO), null);
});

test('addExpense acumula deudas de varias compras', async () => {
    const store = makeStore();
    await addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 9000,
        descripcion: 'A', participantIds: [YO, MATI, JUAN]
    });
    await addExpense(store, {
        sesionId: SESION, buyerId: MATI, total: 3000,
        descripcion: 'B', participantIds: [YO, MATI, JUAN]
    });

    // Matias le debe 3000 a Yo por A; Yo le debe 1000 a Matias por B.
    assert.equal(owedBy(MATI, YO, await getSaldo(store, SESION, MATI, YO)), 2000);
    assert.equal(owedBy(YO, MATI, await getSaldo(store, SESION, YO, MATI)), -2000);
});

test('addExpense con total no divisible mantiene la suma exacta', async () => {
    const store = makeStore();
    await addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 100,
        descripcion: 'No divisible', participantIds: [YO, MATI, JUAN]
    });

    const dMati = owedBy(MATI, YO, await getSaldo(store, SESION, MATI, YO));
    const dJuan = owedBy(JUAN, YO, await getSaldo(store, SESION, JUAN, YO));
    assert.equal(Math.round((dMati + dJuan) * 100) / 100, 66.66);
});

test('addExpense usa el mismo doc de saldo en ambos sentidos', async () => {
    const store = makeStore();
    await addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 15000,
        descripcion: 'X', participantIds: [YO, MATI]
    });
    const a = await store.get(saldoPath(SESION, YO, MATI));
    const b = await store.get(saldoPath(SESION, MATI, YO));
    assert.deepEqual(a, b);
    assert.equal(a.participante_A < a.participante_B, true);
});

test('addExpense valida entradas', async () => {
    const store = makeStore();
    await assert.rejects(() => addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 0, descripcion: 'x', participantIds: [YO]
    }), /mayor a 0/);
    await assert.rejects(() => addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 10, descripcion: '  ', participantIds: [YO]
    }), /descripción/i);
    await assert.rejects(() => addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 10, descripcion: 'x', participantIds: [MATI]
    }), /comprador/);
});

test('netOwedTo respeta la convención de signo', async () => {
    const store = makeStore();
    await addExpense(store, {
        sesionId: SESION, buyerId: YO, total: 300,
        descripcion: 'x', participantIds: [YO, MATI]
    });
    const saldo = await getSaldo(store, SESION, YO, MATI);
    // sortedPair('u_yo','u_matias') => ['u_matias','u_yo']: A=Matias, B=Yo.
    // El comprador es B, así que el balance (B debe a A) es negativo.
    assert.equal(saldo.participante_A, MATI);
    assert.equal(saldo.participante_B, YO);
    assert.equal(saldo.balance_neto_A_vs_B, -150);
    assert.equal(netOwedTo(YO, MATI, saldo), 150);
    assert.equal(netOwedTo(MATI, YO, saldo), -150);
});
