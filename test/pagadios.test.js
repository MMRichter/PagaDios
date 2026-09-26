import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSeededStore, UIDS } from '../support/helpers.js';
import { SESION_MOCK } from '../src/mockData.js';
import {
    requestEstafa,
    resolveEstafa,
    forgivePagadios,
    getSaldo,
    owedBy,
    settle,
    getNotifications,
    getPendingRequestsFor,
    TIPOS_NOTIFICACION
} from '../src/model.js';

const { yo, matias, juan } = UIDS;
const SID = SESION_MOCK.id;

async function stat(store, uid, field) {
    const m = await store.get(`sesiones/${SID}/miembros/${uid}`);
    return m[field];
}

test('requestEstafa crea solicitud pendiente y notifica al acreedor', async () => {
    const store = await freshSeededStore();
    const solicitudId = await requestEstafa(store, {
        sesionId: SID, deudorId: matias, acreedorId: juan, monto: 100
    });

    const pendientes = await getPendingRequestsFor(store, SID, juan);
    assert.equal(pendientes.length, 1);
    assert.equal(pendientes[0].id, solicitudId);
    assert.equal(pendientes[0].monto, 100);

    const notifs = await getNotifications(store, juan);
    assert.equal(notifs.some((n) => n.tipo === TIPOS_NOTIFICACION.estafarSolicitud), true);
    // La deuda todavía no cambió.
    assert.equal(owedBy(matias, juan, await getSaldo(store, SID, matias, juan)), 166.67);
});

test('requestEstafa valida deuda, monto y duplicados', async () => {
    const store = await freshSeededStore();
    await assert.rejects(
        () => requestEstafa(store, { sesionId: SID, deudorId: yo, acreedorId: matias, monto: 10 }),
        /No le debés nada/
    );
    await assert.rejects(
        () => requestEstafa(store, { sesionId: SID, deudorId: matias, acreedorId: juan, monto: 999 }),
        /supera la deuda/
    );
    await requestEstafa(store, { sesionId: SID, deudorId: matias, acreedorId: juan, monto: 50 });
    await assert.rejects(
        () => requestEstafa(store, { sesionId: SID, deudorId: matias, acreedorId: juan, monto: 50 }),
        /pendiente/
    );
});

test('resolveEstafa aceptada perdona la deuda y actualiza contadores', async () => {
    const store = await freshSeededStore();
    const solicitudId = await requestEstafa(store, {
        sesionId: SID, deudorId: matias, acreedorId: juan, monto: 100
    });

    const r = await resolveEstafa(store, { sesionId: SID, solicitudId, aceptar: true });
    assert.deepEqual(r, { aceptada: true, perdonado: 100 });

    assert.equal(owedBy(matias, juan, await getSaldo(store, SID, matias, juan)), 66.67);
    assert.equal(await stat(store, matias, 'dinero_estafado'), 100);
    assert.equal(await stat(store, juan, 'pagadios'), 100);

    const solicitud = await store.get(`sesiones/${SID}/solicitudes/${solicitudId}`);
    assert.equal(solicitud.estado, 'aceptada');
    assert.equal(solicitud.monto_perdonado, 100);

    const notifs = await getNotifications(store, matias);
    assert.equal(notifs.some((n) => n.tipo === TIPOS_NOTIFICACION.estafarAceptada), true);
});

test('resolveEstafa rechazada no cambia la deuda', async () => {
    const store = await freshSeededStore();
    const solicitudId = await requestEstafa(store, {
        sesionId: SID, deudorId: matias, acreedorId: juan, monto: 100
    });

    const r = await resolveEstafa(store, { sesionId: SID, solicitudId, aceptar: false });
    assert.equal(r.aceptada, false);

    assert.equal(owedBy(matias, juan, await getSaldo(store, SID, matias, juan)), 166.67);
    assert.equal(await stat(store, matias, 'dinero_estafado'), 0);
    assert.equal(await stat(store, juan, 'pagadios'), 0);

    const notifs = await getNotifications(store, matias);
    assert.equal(notifs.some((n) => n.tipo === TIPOS_NOTIFICACION.estafarRechazada), true);

    await assert.rejects(
        () => resolveEstafa(store, { sesionId: SID, solicitudId, aceptar: true }),
        /ya fue resuelta/
    );
});

test('si la deuda bajó antes de aceptar, se perdona solo lo pendiente', async () => {
    const store = await freshSeededStore();
    const solicitudId = await requestEstafa(store, {
        sesionId: SID, deudorId: matias, acreedorId: juan, monto: 166.67
    });
    await settle(store, { sesionId: SID, pagadorId: matias, cobradorId: juan, monto: 100 });

    const r = await resolveEstafa(store, { sesionId: SID, solicitudId, aceptar: true });
    assert.equal(r.perdonado, 66.67);
    assert.equal(owedBy(matias, juan, await getSaldo(store, SID, matias, juan)), 0);
    assert.equal(await stat(store, matias, 'dinero_estafado'), 66.67);
    assert.equal(await stat(store, juan, 'pagadios'), 66.67);
});

test('forgivePagadios aplica de inmediato y notifica al perdonado', async () => {
    const store = await freshSeededStore();
    const r = await forgivePagadios(store, {
        sesionId: SID, acreedorId: juan, deudorId: matias, monto: 100
    });

    assert.equal(r.perdonado, 100);
    assert.equal(owedBy(matias, juan, await getSaldo(store, SID, matias, juan)), 66.67);
    assert.equal(await stat(store, matias, 'dinero_estafado'), 100);
    assert.equal(await stat(store, juan, 'pagadios'), 100);

    const solicitudes = await store.query(`sesiones/${SID}/solicitudes`);
    assert.equal(solicitudes.length, 1);
    assert.equal(solicitudes[0].data.tipo, 'pagadios');
    assert.equal(solicitudes[0].data.estado, 'aplicada');

    const notifs = await getNotifications(store, matias);
    assert.equal(notifs.some((n) => n.tipo === TIPOS_NOTIFICACION.pagadiosRecibido), true);
});

test('forgivePagadios no perdona más que la deuda', async () => {
    const store = await freshSeededStore();
    const r = await forgivePagadios(store, {
        sesionId: SID, acreedorId: juan, deudorId: matias, monto: 999
    });
    assert.equal(r.perdonado, 166.67);
    assert.equal(owedBy(matias, juan, await getSaldo(store, SID, matias, juan)), 0);
});
