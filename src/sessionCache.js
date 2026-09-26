/**
 * Caché reactiva por (usuario, sesión).
 *
 * Abre **una sola** suscripción por colección y mantiene el estado en memoria.
 * La UI renderiza leyendo de acá, nunca del servidor: así no hay lecturas por
 * render. Solo llegan documentos cuando cambian (o la primera foto al abrir).
 *
 * Las compras se cargan paginadas: la primera página es en tiempo real (para
 * ver lo nuevo) y "Cargar más" trae páginas anteriores con `startAfter`.
 */

export const COMPRAS_PAGE_SIZE = 20;
export const NOTIF_LIMIT = 20;

export function createSessionCache(store, {
    comprasPageSize = COMPRAS_PAGE_SIZE,
    notifLimit = NOTIF_LIMIT
} = {}) {
    let unsubs = [];
    const listeners = new Set();

    const state = {
        uid: null,
        sesionId: null,
        sesion: null,
        perfil: null,
        miembros: [],
        saldos: [],
        compras: [],
        comprasExtra: [],
        notificaciones: [],
        solicitudes: [],
        hasMoreCompras: true
    };

    function emit() {
        for (const cb of [...listeners]) cb(state);
    }

    function onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    function cerrarSuscripciones() {
        unsubs.forEach((unsub) => unsub());
        unsubs = [];
    }

    function open({ uid, sesionId }) {
        cerrarSuscripciones();
        state.uid = uid ?? null;
        state.sesionId = sesionId ?? null;
        state.sesion = null;
        state.perfil = null;
        state.miembros = [];
        state.saldos = [];
        state.compras = [];
        state.comprasExtra = [];
        state.notificaciones = [];
        state.solicitudes = [];
        state.hasMoreCompras = true;

        if (!uid) { emit(); return; }

        unsubs.push(store.subscribe(`usuarios/${uid}`, (snap) => {
            state.perfil = snap.data;
            emit();
        }));

        if (!sesionId) { emit(); return; }

        unsubs.push(store.subscribe(`sesiones/${sesionId}`, (snap) => {
            state.sesion = snap.data;
            emit();
        }));

        unsubs.push(store.subscribeQuery(`sesiones/${sesionId}/miembros`, (docs) => {
            state.miembros = docs
                .map((d) => ({ uid: d.id, ...d.data }))
                .sort((a, b) => (a.nombre ?? a.uid).localeCompare(b.nombre ?? b.uid));
            emit();
        }));

        unsubs.push(store.subscribeQuery(`sesiones/${sesionId}/saldos`, (docs) => {
            state.saldos = docs.map((d) => ({ id: d.id, data: d.data }));
            emit();
        }));

        unsubs.push(store.subscribeQuery(`sesiones/${sesionId}/compras`, {
            orderBy: [['fecha', 'desc']],
            limit: comprasPageSize
        }, (docs) => {
            state.compras = docs.map((d) => ({ id: d.id, ...d.data }));
            if (state.comprasExtra.length === 0) {
                state.hasMoreCompras = docs.length >= comprasPageSize;
            }
            emit();
        }));

        unsubs.push(store.subscribeQuery(`usuarios/${uid}/notificaciones`, {
            orderBy: [['creadaEn', 'desc']],
            limit: notifLimit
        }, (docs) => {
            state.notificaciones = docs.map((d) => ({ id: d.id, ...d.data }));
            emit();
        }));

        unsubs.push(store.subscribeQuery(`sesiones/${sesionId}/solicitudes`, {
            where: [
                ['tipo', '==', 'estafar'],
                ['estado', '==', 'pendiente'],
                ['para', '==', uid]
            ]
        }, (docs) => {
            state.solicitudes = docs.map((d) => ({ id: d.id, ...d.data }));
            emit();
        }));
    }

    /** Todas las compras cargadas (primera página + páginas pedidas), sin duplicados. */
    function allCompras() {
        const vistos = new Set();
        const out = [];
        for (const c of [...state.compras, ...state.comprasExtra]) {
            if (vistos.has(c.id)) continue;
            vistos.add(c.id);
            out.push(c);
        }
        return out;
    }

    /** Pide la siguiente página de compras anteriores a la más vieja cargada. */
    async function loadMoreCompras() {
        if (!state.sesionId || !state.hasMoreCompras) return;
        const cargadas = allCompras();
        const ultima = cargadas[cargadas.length - 1];
        const pagina = await store.query(`sesiones/${state.sesionId}/compras`, {
            orderBy: [['fecha', 'desc']],
            limit: comprasPageSize,
            startAfter: ultima ? { fecha: ultima.fecha } : undefined
        });
        const ids = new Set(cargadas.map((c) => c.id));
        const nuevas = pagina
            .map((d) => ({ id: d.id, ...d.data }))
            .filter((c) => !ids.has(c.id));
        state.comprasExtra.push(...nuevas);
        state.hasMoreCompras = pagina.length >= comprasPageSize;
        emit();
    }

    return { state, onChange, open, close: cerrarSuscripciones, allCompras, loadMoreCompras };
}
