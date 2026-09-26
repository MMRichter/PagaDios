/**
 * Datos mock para desarrollar y testear sin Firebase.
 * También sirve como semilla de la sesión de demo en el navegador.
 */

import { addExpense } from './model.js';

export const USUARIOS_MOCK = [
    { uid: 'u_yo', nombre: 'Yo', email: 'yo@pagadios.test', fotoUrl: '' },
    { uid: 'u_matias', nombre: 'Matias', email: 'matias@pagadios.test', fotoUrl: '' },
    { uid: 'u_juan', nombre: 'Juan', email: 'juan@pagadios.test', fotoUrl: '' }
];

export const SESION_MOCK = {
    id: 's_familia',
    nombre: 'Familia',
    codigo: 'FAMILIA-2026',
    creadorUid: 'u_yo',
    moneda: 'ARS'
};

/** Crea la sesión de demo, sus miembros y compras iniciales. */
export async function seedMockStore(store, { now = new Date('2026-09-01T12:00:00.000Z') } = {}) {
    for (const usuario of USUARIOS_MOCK) {
        await store.set(`usuarios/${usuario.uid}`, usuario, { merge: true });
    }

    await store.set(`sesiones/${SESION_MOCK.id}`, {
        nombre: SESION_MOCK.nombre,
        creadorUid: SESION_MOCK.creadorUid,
        codigo: SESION_MOCK.codigo,
        creadaEn: now.toISOString(),
        moneda: SESION_MOCK.moneda
    }, { merge: true });

    await store.set(`codigos/${SESION_MOCK.codigo}`, { sesionId: SESION_MOCK.id }, { merge: true });

    await store.set(`sesiones/${SESION_MOCK.id}/miembros/u_yo`, {
        uid: 'u_yo', nombre: 'Yo', fotoUrl: '', rol: 'creador',
        unidoEn: now.toISOString(), dinero_estafado: 0, pagadios: 0
    }, { merge: true });
    await store.set(`sesiones/${SESION_MOCK.id}/miembros/u_matias`, {
        uid: 'u_matias', nombre: 'Matias', fotoUrl: '', rol: 'miembro',
        unidoEn: now.toISOString(), dinero_estafado: 0, pagadios: 0
    }, { merge: true });
    await store.set(`sesiones/${SESION_MOCK.id}/miembros/u_juan`, {
        uid: 'u_juan', nombre: 'Juan', fotoUrl: '', rol: 'miembro',
        unidoEn: now.toISOString(), dinero_estafado: 0, pagadios: 0
    }, { merge: true });

    const todos = ['u_yo', 'u_matias', 'u_juan'];
    await addExpense(store, {
        sesionId: SESION_MOCK.id,
        buyerId: 'u_yo',
        buyerNombre: 'Yo',
        total: 15000,
        descripcion: 'Carnicería',
        participantIds: todos,
        now: new Date('2026-09-01T18:30:00.000Z')
    });
    await addExpense(store, {
        sesionId: SESION_MOCK.id,
        buyerId: 'u_matias',
        buyerNombre: 'Matias',
        total: 8500,
        descripcion: 'Bebidas',
        participantIds: todos,
        now: new Date('2026-09-01T19:15:00.000Z')
    });
    await addExpense(store, {
        sesionId: SESION_MOCK.id,
        buyerId: 'u_juan',
        buyerNombre: 'Juan',
        total: 9000,
        descripcion: 'Nafta',
        participantIds: todos,
        now: new Date('2026-09-02T10:00:00.000Z')
    });

    return { sesionId: SESION_MOCK.id };
}
