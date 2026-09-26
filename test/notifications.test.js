import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSeededStore, UIDS } from '../support/helpers.js';
import { SESION_MOCK } from '../src/mockData.js';
import {
    addExpense,
    countUnread,
    getNotifications,
    markNotificationRead,
    settle,
    forgivePagadios
} from '../src/model.js';

const { yo, matias, juan } = UIDS;
const SID = SESION_MOCK.id;

async function limpiarNotifs(store, uid) {
    const notifs = await getNotifications(store, uid);
    for (const n of notifs) {
        if (!n.leida) await markNotificationRead(store, uid, n.id);
    }
}

test('una compra notifica a todos menos al comprador', async () => {
    const store = await freshSeededStore();

    // La semilla tiene 3 compras: cada usuario es comprador de una y recibe
    // aviso de las otras dos.
    assert.equal(await countUnread(store, yo), 2);
    assert.equal(await countUnread(store, matias), 2);
    assert.equal(await countUnread(store, juan), 2);

    for (const uid of [yo, matias, juan]) await limpiarNotifs(store, uid);

    await addExpense(store, {
        sesionId: SID, buyerId: yo, total: 300,
        descripcion: 'Pizza', participantIds: [yo, matias, juan]
    });

    assert.equal(await countUnread(store, yo), 0);
    assert.equal(await countUnread(store, matias), 1);
    assert.equal(await countUnread(store, juan), 1);

    const [notif] = await getNotifications(store, matias);
    assert.equal(notif.tipo, 'gasto_nuevo');
    assert.equal(notif.sesionId, SID);
    assert.match(notif.mensaje, /Pizza/);
});

test('un pago genera notificación no leída y se puede marcar leída', async () => {
    const store = await freshSeededStore();
    await limpiarNotifs(store, juan);

    await settle(store, { sesionId: SID, pagadorId: matias, cobradorId: juan, monto: 50 });

    assert.equal(await countUnread(store, juan), 1);
    const [notif] = await getNotifications(store, juan);
    assert.equal(notif.leida, false);

    await markNotificationRead(store, juan, notif.id);
    assert.equal(await countUnread(store, juan), 0);
});

test('perdonar genera notificación para el perdonado', async () => {
    const store = await freshSeededStore();
    await limpiarNotifs(store, matias);

    await forgivePagadios(store, { sesionId: SID, acreedorId: juan, deudorId: matias, monto: 100 });

    const [notif] = await getNotifications(store, matias);
    assert.equal(notif.tipo, 'pagadios_recibido');
    assert.equal(await countUnread(store, matias), 1);
});
