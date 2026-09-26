/**
 * Lógica de negocio de PagaDios. No depende del navegador ni de Firebase:
 * opera sobre un `store` con la interfaz definida en `src/store.js`.
 *
 * Convención de saldos (heredada del código original, NO cambiar):
 * - El id del documento es `${sortedIds[0]}_${sortedIds[1]}` con los ids
 *   ordenados alfabéticamente, para que A->B y B->A impacten el mismo doc.
 * - `balance_neto_A_vs_B > 0` significa que participante_B le debe a
 *   participante_A. `< 0` significa que participante_A le debe a B.
 */

import { formatMoney, round2, splitAmount } from './money.js';
import { increment } from './store.js';

export const TIPOS_NOTIFICACION = {
    gastoNuevo: 'gasto_nuevo',
    estafarSolicitud: 'estafar_solicitud',
    estafarAceptada: 'estafar_aceptada',
    estafarRechazada: 'estafar_rechazada',
    pagadiosRecibido: 'pagadios_recibido',
    pagoRecibido: 'pago_recibido'
};

const EPSILON = 0.005;

export function sortedPair(uidA, uidB) {
    return [uidA, uidB].sort();
}

export function saldoId(uidA, uidB) {
    const [a, b] = sortedPair(uidA, uidB);
    return `${a}_${b}`;
}

export function saldoPath(sesionId, uidA, uidB) {
    return `sesiones/${sesionId}/saldos/${saldoId(uidA, uidB)}`;
}

export function miembroPath(sesionId, uid) {
    return `sesiones/${sesionId}/miembros/${uid}`;
}

export function comprasCollection(sesionId) {
    return `sesiones/${sesionId}/compras`;
}

export function solicitudesCollection(sesionId) {
    return `sesiones/${sesionId}/solicitudes`;
}

export function notificacionesCollection(uid) {
    return `usuarios/${uid}/notificaciones`;
}

function iso(now) {
    return (now instanceof Date ? now : new Date(now)).toISOString();
}

/**
 * Dado el doc de saldo entre dos usuarios, devuelve cuánto le debe
 * `uidB` a `uidA` (positivo) o cuánto le debe `uidA` a `uidB` (negativo).
 */
export function netOwedTo(uidA, uidB, saldo) {
    const balance = Number(saldo?.balance_neto_A_vs_B ?? 0);
    const [first] = sortedPair(uidA, uidB);
    return round2(uidA === first ? balance : -balance);
}

/** Cuánto le debe `deudor` a `acreedor` (positivo si efectivamente le debe). */
export function owedBy(deudor, acreedor, saldo) {
    return netOwedTo(acreedor, deudor, saldo);
}

/** Lee el saldo entre dos usuarios. */
export async function getSaldo(store, sesionId, uidA, uidB) {
    return store.get(saldoPath(sesionId, uidA, uidB));
}

/** Lista los miembros de una sesión. */
export async function getSessionMembers(store, sesionId) {
    const docs = await store.query(`sesiones/${sesionId}/miembros`);
    return docs
        .map((d) => ({ uid: d.id, ...d.data }))
        .sort((a, b) => (a.nombre ?? a.uid).localeCompare(b.nombre ?? b.uid));
}

/**
 * Lista las compras de una sesión, más recientes primero.
 * options: { limit, startAfter: { fecha }, where }
 */
export async function getSessionExpenses(store, sesionId, options = {}) {
    const docs = await store.query(comprasCollection(sesionId), {
        where: options.where,
        orderBy: [['fecha', 'desc']],
        limit: options.limit,
        startAfter: options.startAfter
    });
    return docs.map((d) => ({ id: d.id, ...d.data }));
}

/** Lista las notificaciones de un usuario, más recientes primero. */
export async function getNotifications(store, uid, { limit = 20 } = {}) {
    const docs = await store.query(notificacionesCollection(uid), {
        orderBy: [['creadaEn', 'desc']],
        limit
    });
    return docs.map((d) => ({ id: d.id, ...d.data }));
}

/** Cuenta notificaciones sin leer desde el contador del usuario (0 lecturas de docs). */
export async function countUnread(store, uid) {
    const usuario = await store.get(`usuarios/${uid}`);
    return Number(usuario?.notif_no_leidas) || 0;
}

/**
 * Marca una notificación como leída y ajusta el contador. Transaccional para
 * no descontar dos veces.
 * @returns {Promise<boolean>} true si estaba sin leer.
 */
export async function markNotificationRead(store, uid, notifId) {
    return store.runTransaction(async (tx) => {
        const path = `${notificacionesCollection(uid)}/${notifId}`;
        const notifDoc = await tx.get(path);
        if (!notifDoc || notifDoc.leida) return false;
        tx.update(path, { leida: true });
        tx.set(`usuarios/${uid}`, { notif_no_leidas: increment(-1) }, { merge: true });
        return true;
    });
}

/** Sesiones a las que pertenece un usuario (vía collection group de miembros). */
export async function getUserSessions(store, uid) {
    const membresias = await store.queryGroup('miembros', { where: [['uid', '==', uid]] });
    const sesiones = [];
    for (const m of membresias) {
        const sesionId = m.path.split('/')[1];
        const sesion = await store.get(`sesiones/${sesionId}`);
        if (sesion) sesiones.push({ id: sesionId, ...sesion });
    }
    return sesiones;
}

function notif(uid, data) {
    return { leida: false, ...data };
}

async function addStat(tx, sesionId, uid, field, amount) {
    if (!amount) return;
    const path = miembroPath(sesionId, uid);
    const miembro = (await tx.get(path)) ?? {};
    tx.set(path, { [field]: round2((Number(miembro[field]) || 0) + amount) }, { merge: true });
}

/**
 * Registra una compra y reparte el total en partes iguales entre todos los
 * participantes. La parte de cada participante distinto del comprador se suma
 * a la deuda que ese participante tiene con el comprador.
 *
 * @returns {Promise<string>} id de la compra creada.
 */
export async function addExpense(store, {
    sesionId,
    buyerId,
    total,
    descripcion,
    participantIds,
    buyerNombre,
    now = new Date()
}) {
    const amount = Number(total);
    if (!sesionId || !buyerId) throw new Error('Faltan datos de la sesión');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0');
    if (!descripcion || !String(descripcion).trim()) throw new Error('Falta la descripción');

    const participantes = [...new Set(participantIds ?? [])];
    if (participantes.length === 0) throw new Error('No hay participantes');
    if (!participantes.includes(buyerId)) throw new Error('El comprador debe ser participante');

    const parts = splitAmount(amount, participantes.length);
    const descripcionLimpia = String(descripcion).trim();
    const descripcionCorta = descripcionLimpia.slice(0, 40);
    const nombreComprador = buyerNombre ?? buyerId;

    // Batch sin lecturas: los saldos y agregados usan increment() del servidor.
    const batch = store.batch();
    const compraId = store.newId();

    batch.set(`${comprasCollection(sesionId)}/${compraId}`, {
        descripcion: descripcionLimpia,
        total: round2(amount),
        pagado_por: buyerId,
        fecha: iso(now),
        estado: 'activo',
        dividido_entre: participantes
    });

    for (let i = 0; i < participantes.length; i++) {
        const pid = participantes[i];
        if (pid === buyerId) continue;

        const [first, second] = sortedPair(pid, buyerId);
        // El comprador es acreedor: si es el id menor, el saldo sube.
        const delta = buyerId === first ? parts[i] : -parts[i];
        batch.set(saldoPath(sesionId, pid, buyerId), {
            participante_A: first,
            participante_B: second,
            balance_neto_A_vs_B: increment(delta)
        }, { merge: true });

        // Todos menos el comprador reciben aviso de la compra.
        batch.set(`${notificacionesCollection(pid)}/${store.newId()}`, notif(pid, {
            tipo: TIPOS_NOTIFICACION.gastoNuevo,
            sesionId,
            compraId,
            titulo: 'Nuevo gasto',
            mensaje: `${nombreComprador} cargó "${descripcionCorta}" por ${formatMoney(round2(amount))}. Te toca ${formatMoney(parts[i])}.`,
            creadaEn: iso(now)
        }));
        batch.set(`usuarios/${pid}`, { notif_no_leidas: increment(1) }, { merge: true });
    }

    // Agregados para leaderboards y barra de progreso (evitan releer compras).
    batch.set(miembroPath(sesionId, buyerId), {
        total_gastado: increment(round2(amount)),
        compras_count: increment(1)
    }, { merge: true });
    batch.set(`sesiones/${sesionId}`, {
        total_gastado: increment(round2(amount)),
        compras_count: increment(1)
    }, { merge: true });

    await batch.commit();
    return compraId;
}

/**
 * Registra el pago (total o parcial) de `pagadorId` a `cobradorId`.
 * Valida que no se pague más de lo que se debe.
 */
export async function settle(store, {
    sesionId,
    pagadorId,
    cobradorId,
    monto,
    now = new Date()
}) {
    const amount = round2(Number(monto));
    if (pagadorId === cobradorId) throw new Error('No podés pagarte a vos mismo');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0');

    return store.runTransaction(async (tx) => {
        const path = saldoPath(sesionId, pagadorId, cobradorId);
        const saldo = await tx.get(path);
        const deuda = owedBy(pagadorId, cobradorId, saldo);
        if (deuda <= EPSILON) throw new Error('No le debés nada a esa persona');
        if (amount > deuda + EPSILON) throw new Error('El monto supera la deuda');

        const [first, second] = sortedPair(pagadorId, cobradorId);
        const delta = pagadorId === first ? amount : -amount;
        const nuevo = round2((Number(saldo?.balance_neto_A_vs_B) || 0) + delta);
        tx.set(path, {
            participante_A: first,
            participante_B: second,
            balance_neto_A_vs_B: nuevo
        }, { merge: true });

        tx.add(`sesiones/${sesionId}/pagos`, {
            de: pagadorId,
            para: cobradorId,
            monto: amount,
            fecha: iso(now)
        });

        tx.add(notificacionesCollection(cobradorId), notif(cobradorId, {
            tipo: TIPOS_NOTIFICACION.pagoRecibido,
            sesionId,
            titulo: 'Pago recibido',
            mensaje: `Te pagaron ${amount} en la sesión.`,
            creadaEn: iso(now)
        }));
        tx.set(`usuarios/${cobradorId}`, { notif_no_leidas: increment(1) }, { merge: true });

        return nuevo;
    });
}

/**
 * Efecto de perdonar `monto` de la deuda que `deudorId` tiene con `acreedorId`.
 * Devuelve el monto realmente perdonado (acotado a la deuda) y el delta a
 * aplicar sobre `balance_neto_A_vs_B`.
 */
export function forgivenessEffect(saldo, deudorId, acreedorId, monto) {
    const deuda = owedBy(deudorId, acreedorId, saldo);
    const applied = round2(Math.min(round2(Number(monto)), Math.max(0, deuda)));
    const [first] = sortedPair(deudorId, acreedorId);
    const delta = deudorId === first ? applied : -applied;
    return { deuda: round2(Math.max(0, deuda)), applied, delta };
}

async function applyForgiveness(tx, { sesionId, deudorId, acreedorId, monto }) {
    const path = saldoPath(sesionId, deudorId, acreedorId);
    const saldo = await tx.get(path);
    const { applied, delta } = forgivenessEffect(saldo, deudorId, acreedorId, monto);
    if (applied <= 0) throw new Error('No hay deuda para perdonar');

    const [first, second] = sortedPair(deudorId, acreedorId);
    const nuevo = round2((Number(saldo?.balance_neto_A_vs_B) || 0) + delta);
    tx.set(path, {
        participante_A: first,
        participante_B: second,
        balance_neto_A_vs_B: nuevo
    }, { merge: true });

    // dinero_estafado acumula lo que se le perdonó al deudor.
    // pagadios acumula lo que el acreedor perdonó.
    await addStat(tx, sesionId, deudorId, 'dinero_estafado', applied);
    await addStat(tx, sesionId, acreedorId, 'pagadios', applied);

    return applied;
}

/**
 * El deudor solicita que le perdonen (total o parcialmente) su deuda.
 * Queda pendiente de aceptación del acreedor.
 */
export async function requestEstafa(store, {
    sesionId,
    deudorId,
    acreedorId,
    monto,
    now = new Date()
}) {
    const amount = round2(Number(monto));
    if (deudorId === acreedorId) throw new Error('No podés estafarte a vos mismo');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0');

    const saldo = await getSaldo(store, sesionId, deudorId, acreedorId);
    const deuda = owedBy(deudorId, acreedorId, saldo);
    if (deuda <= EPSILON) throw new Error('No le debés nada a esa persona');
    if (amount > deuda + EPSILON) throw new Error('El monto supera la deuda');

    const pendientes = await store.query(solicitudesCollection(sesionId), {
        where: [
            ['tipo', '==', 'estafar'],
            ['estado', '==', 'pendiente'],
            ['de', '==', deudorId],
            ['para', '==', acreedorId]
        ],
        limit: 1
    });
    if (pendientes.length) throw new Error('Ya tenés una solicitud pendiente con esa persona');

    const solicitudId = await store.add(solicitudesCollection(sesionId), {
        tipo: 'estafar',
        de: deudorId,
        para: acreedorId,
        monto: amount,
        estado: 'pendiente',
        creadaEn: iso(now),
        resueltaEn: null
    });

    await store.add(notificacionesCollection(acreedorId), notif(acreedorId, {
        tipo: TIPOS_NOTIFICACION.estafarSolicitud,
        sesionId,
        solicitudId,
        titulo: 'Solicitud de estafa',
        mensaje: 'Te pidieron perdonar una deuda.',
        creadaEn: iso(now)
    }));
    await store.set(`usuarios/${acreedorId}`, { notif_no_leidas: increment(1) }, { merge: true });

    return solicitudId;
}

/**
 * El acreedor responde una solicitud de estafa. Si acepta, se perdona la deuda
 * y se actualizan los contadores. Si rechaza, no cambia nada.
 */
export async function resolveEstafa(store, {
    sesionId,
    solicitudId,
    aceptar,
    now = new Date()
}) {
    return store.runTransaction(async (tx) => {
        const solicitudPath = `${solicitudesCollection(sesionId)}/${solicitudId}`;
        const solicitud = await tx.get(solicitudPath);
        if (!solicitud) throw new Error('La solicitud no existe');
        if (solicitud.tipo !== 'estafar') throw new Error('La solicitud no es de tipo estafar');
        if (solicitud.estado !== 'pendiente') throw new Error('La solicitud ya fue resuelta');

        const { de: deudorId, para: acreedorId, monto } = solicitud;

        if (!aceptar) {
            tx.set(solicitudPath, { estado: 'rechazada', resueltaEn: iso(now) }, { merge: true });
            tx.add(notificacionesCollection(deudorId), notif(deudorId, {
                tipo: TIPOS_NOTIFICACION.estafarRechazada,
                sesionId,
                solicitudId,
                titulo: 'Estafa rechazada',
                mensaje: 'No te perdonaron la deuda.',
                creadaEn: iso(now)
            }));
            tx.set(`usuarios/${deudorId}`, { notif_no_leidas: increment(1) }, { merge: true });
            return { aceptada: false, perdonado: 0 };
        }

        const applied = await applyForgiveness(tx, { sesionId, deudorId, acreedorId, monto });

        tx.set(solicitudPath, {
            estado: 'aceptada',
            resueltaEn: iso(now),
            monto_perdonado: applied
        }, { merge: true });

        tx.add(notificacionesCollection(deudorId), notif(deudorId, {
            tipo: TIPOS_NOTIFICACION.estafarAceptada,
            sesionId,
            solicitudId,
            titulo: 'Estafa aceptada',
            mensaje: `Te perdonaron ${applied}. PagaDios.`,
            creadaEn: iso(now)
        }));
        tx.set(`usuarios/${deudorId}`, { notif_no_leidas: increment(1) }, { merge: true });

        return { aceptada: true, perdonado: applied };
    });
}

/**
 * El acreedor perdona voluntariamente una deuda (botón Pagadios).
 * No requiere aceptación: se aplica y se notifica al perdonado.
 */
export async function forgivePagadios(store, {
    sesionId,
    acreedorId,
    deudorId,
    monto,
    now = new Date()
}) {
    const amount = round2(Number(monto));
    if (deudorId === acreedorId) throw new Error('No podés perdonarte a vos mismo');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor a 0');

    return store.runTransaction(async (tx) => {
        const applied = await applyForgiveness(tx, {
            sesionId,
            deudorId,
            acreedorId,
            monto: amount
        });

        tx.add(solicitudesCollection(sesionId), {
            tipo: 'pagadios',
            de: deudorId,
            para: acreedorId,
            monto: amount,
            estado: 'aplicada',
            creadaEn: iso(now),
            resueltaEn: iso(now),
            monto_perdonado: applied
        });

        tx.add(notificacionesCollection(deudorId), notif(deudorId, {
            tipo: TIPOS_NOTIFICACION.pagadiosRecibido,
            sesionId,
            titulo: 'Pagadios',
            mensaje: `Te perdonaron ${applied}. PagaDios.`,
            creadaEn: iso(now)
        }));
        tx.set(`usuarios/${deudorId}`, { notif_no_leidas: increment(1) }, { merge: true });

        return { perdonado: applied };
    });
}

/**
 * Balance puro de `viewerId` contra el resto, a partir de miembros y saldos
 * ya cargados (así la UI no relee nada del servidor).
 */
export function balancesFromSaldos(miembros, saldos, viewerId) {
    const porPar = new Map(saldos.map((s) => [s.id, s.data]));
    const resultado = [];
    for (const miembro of miembros) {
        if (miembro.uid === viewerId) continue;
        const saldo = porPar.get(saldoId(viewerId, miembro.uid)) ?? null;
        const net = round2(netOwedTo(viewerId, miembro.uid, saldo));
        if (Math.abs(net) < EPSILON) continue;
        resultado.push({ ...miembro, net, saldo });
    }
    return resultado.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

/** Balance de `viewerId` contra el resto de los miembros. */
export async function computeBalances(store, sesionId, viewerId) {
    const [miembros, saldos] = await Promise.all([
        getSessionMembers(store, sesionId),
        store.query(`sesiones/${sesionId}/saldos`)
    ]);
    return balancesFromSaldos(miembros, saldos, viewerId);
}

/** Lista de solicitudes pendientes para un acreedor (filtrado en el servidor). */
export async function getPendingRequestsFor(store, sesionId, acreedorId) {
    const solicitudes = await store.query(solicitudesCollection(sesionId), {
        where: [
            ['tipo', '==', 'estafar'],
            ['estado', '==', 'pendiente'],
            ['para', '==', acreedorId]
        ]
    });
    return solicitudes.map((s) => ({ id: s.id, ...s.data }));
}

/** Devuelve el miembro con el mayor valor. `null` si el máximo no supera 0. */
function topEntry(items, getValue) {
    let best = null;
    for (const item of items) {
        const valor = Number(getValue(item)) || 0;
        if (!best || valor > best.valor) best = { item, valor };
    }
    if (!best || best.valor <= 0) return null;
    return { uid: best.item.uid, nombre: best.item.nombre, valor: round2(best.valor) };
}

/**
 * Leaderboards puros a partir de miembros (con agregados `total_gastado`,
 * `compras_count`) y saldos ya cargados. No lee compras.
 *
 * - pagadios: quien más se hizo perdonar (dinero_estafado).
 * - estafado: quien más plata perdonó (pagadios).
 * - gastador: quien más gastó en compras (total_gastado).
 * - peya: quien más compras hizo (compras_count).
 * - ratatouille: quien más plata debe hoy (derivado de saldos).
 */
export function leaderboardsFrom(miembros, saldos) {
    // Deuda viva: balance > 0 => B debe A; balance < 0 => A debe B.
    const deuda = new Map(miembros.map((m) => [m.uid, 0]));
    for (const s of saldos) {
        const balance = Number(s.data.balance_neto_A_vs_B) || 0;
        const { participante_A: a, participante_B: b } = s.data;
        if (balance > 0) deuda.set(b, round2((deuda.get(b) ?? 0) + balance));
        else if (balance < 0) deuda.set(a, round2((deuda.get(a) ?? 0) + -balance));
    }

    return {
        pagadios: topEntry(miembros, (m) => m.dinero_estafado),
        estafado: topEntry(miembros, (m) => m.pagadios),
        gastador: topEntry(miembros, (m) => m.total_gastado),
        peya: topEntry(miembros, (m) => m.compras_count),
        ratatouille: topEntry(miembros, (m) => deuda.get(m.uid))
    };
}

/** Leaderboards de una sesión (sin leer compras). */
export async function computeLeaderboards(store, sesionId) {
    const [miembros, saldos] = await Promise.all([
        getSessionMembers(store, sesionId),
        store.query(`sesiones/${sesionId}/saldos`)
    ]);
    return leaderboardsFrom(miembros, saldos);
}
