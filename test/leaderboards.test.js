import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSeededStore, UIDS } from '../support/helpers.js';
import { SESION_MOCK } from '../src/mockData.js';
import {
    computeLeaderboards,
    forgivePagadios,
    settle,
    addExpense
} from '../src/model.js';

const { yo, matias, juan } = UIDS;
const SID = SESION_MOCK.id;

test('leaderboards con datos semilla', async () => {
    const store = await freshSeededStore();
    const lb = await computeLeaderboards(store, SID);

    // Yo pagó 15000 (el mayor gastador).
    assert.equal(lb.gastador.uid, yo);
    assert.equal(lb.gastador.valor, 15000);

    // Matias es el que más debe (2166.66 a Yo + 166.67 a Juan).
    assert.equal(lb.ratatouille.uid, matias);
    assert.equal(lb.ratatouille.valor, 2333.33);

    // Todos hicieron 1 compra: hay ganador con valor 1.
    assert.equal(lb.peya.valor, 1);
    assert.equal([yo, matias, juan].includes(lb.peya.uid), true);

    // Sin perdones todavía.
    assert.equal(lb.pagadios, null);
    assert.equal(lb.estafado, null);
});

test('un perdón alimenta Pagadios y El Estafado', async () => {
    const store = await freshSeededStore();
    await forgivePagadios(store, { sesionId: SID, acreedorId: juan, deudorId: matias, monto: 100 });

    const lb = await computeLeaderboards(store, SID);
    assert.equal(lb.pagadios.uid, matias);
    assert.equal(lb.pagadios.valor, 100);
    assert.equal(lb.estafado.uid, juan);
    assert.equal(lb.estafado.valor, 100);
});

test('El Peya gana quien hace más compras, sin importar el monto', async () => {
    const store = await freshSeededStore();
    await addExpense(store, {
        sesionId: SID, buyerId: yo, total: 1,
        descripcion: 'Chicles', participantIds: [yo, matias, juan]
    });

    const lb = await computeLeaderboards(store, SID);
    assert.equal(lb.peya.uid, yo);
    assert.equal(lb.peya.valor, 2);
});

test('Ratatouille baja cuando se paga la deuda', async () => {
    const store = await freshSeededStore();
    await settle(store, { sesionId: SID, pagadorId: matias, cobradorId: juan, monto: 166.67 });

    const lb = await computeLeaderboards(store, SID);
    assert.equal(lb.ratatouille.uid, matias);
    assert.equal(lb.ratatouille.valor, 2166.66);
});
