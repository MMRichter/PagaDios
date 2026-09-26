/**
 * Bootstrap de la UI de PagaDios.
 *
 * Corre con el store en memoria (`src/store.js`) y datos mock
 * (`src/mockData.js`). La UI **no** consulta el store al renderizar: lee de la
 * caché reactiva (`src/sessionCache.js`), que abre una sola suscripción por
 * colección. Así no hay lecturas de Firestore por render.
 */

import { createMemoryStore } from './src/store.js';
import { createSessionCache } from './src/sessionCache.js';
import { seedMockStore, USUARIOS_MOCK } from './src/mockData.js';
import { formatMoney } from './src/money.js';
import {
    addExpense,
    balancesFromSaldos,
    getUserSessions,
    leaderboardsFrom,
    markNotificationRead,
    requestEstafa,
    resolveEstafa,
    settle,
    forgivePagadios
} from './src/model.js';

const store = createMemoryStore();
const cache = createSessionCache(store);

const state = {
    uid: null,
    sesionId: null,
    filtro: 'todos',
    vista: 'add-expense',
    sesiones: []
};

const LS_UID = 'pagadios.uid';
const LS_SESION = 'pagadios.sesion';

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function fmtFecha(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function showView(id) {
    state.vista = id;
    window.switchView(id);
}

function $(sel) {
    return document.querySelector(sel);
}

// ---------------------------------------------------------------------------
// Render (solo lee de `cache.state`)
// ---------------------------------------------------------------------------

function render() {
    const c = cache.state;
    renderMockUsers();
    renderBadge(c);
    renderProgress(c);
    renderHistory(c);
    renderParticipants(c);
    renderBalance(c);
    renderLeaderboards(c);
    renderNotifications(c);
    renderSessions();
    document.body.classList.toggle('logged-in', Boolean(state.uid));
}

function renderMockUsers() {
    const cont = $('#lista-usuarios-mock');
    if (!cont) return;
    cont.innerHTML = USUARIOS_MOCK.map((u) => `
        <div class="list-item">
            <div>
                <div style="font-weight: 500;">${esc(u.nombre)}</div>
                <div class="item-meta">${esc(u.email)}</div>
            </div>
            <button class="btn" style="width:auto; padding: 0.5rem 1rem;" data-login="${esc(u.uid)}">Entrar</button>
        </div>
    `).join('');
    cont.querySelectorAll('[data-login]').forEach((btn) => {
        btn.onclick = () => login(btn.dataset.login);
    });
}

function renderProgress(c) {
    const cont = $('#progress-bar');
    if (!cont) return;
    const total = Number(c.sesion?.total_gastado) || 0;
    if (!c.sesionId || !c.miembros.length || total <= 0) {
        cont.innerHTML = '<div class="progress-segment" style="width:100%; background: var(--border); color: var(--text-muted);">Sin gastos</div>';
        return;
    }
    const colores = ['var(--primary)', 'var(--success)', 'var(--danger)', '#7c3aed', '#0891b2'];
    cont.innerHTML = c.miembros.map((m, i) => {
        const monto = Number(m.total_gastado) || 0;
        const pct = Math.round((monto / total) * 100);
        if (monto <= 0) return '';
        return `<div class="progress-segment" style="width:${pct}%; background:${colores[i % colores.length]};"
                    title="${esc(m.nombre)}: ${formatMoney(monto)}">${pct}%</div>`;
    }).join('');
}

function renderHistory(c) {
    const select = $('#filtro-participante');
    const cont = $('#lista-compras');
    const btnMas = $('#btn-cargar-mas');
    if (!select || !cont) return;
    if (!state.uid || !c.sesionId) {
        select.innerHTML = '';
        cont.innerHTML = '<p class="item-meta">Elegí una sesión.</p>';
        if (btnMas) btnMas.classList.add('hidden');
        return;
    }

    const nombre = new Map(c.miembros.map((m) => [m.uid, m.nombre]));
    select.innerHTML = '<option value="todos">Todos</option>' +
        c.miembros.map((m) => `<option value="${esc(m.uid)}" ${state.filtro === m.uid ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('');
    select.onchange = () => { state.filtro = select.value; render(); };

    const compras = cache.allCompras();
    const filtradas = state.filtro === 'todos' ? compras : compras.filter((x) => x.pagado_por === state.filtro);
    cont.innerHTML = filtradas.length
        ? filtradas.map((x) => `
            <div class="list-item">
                <div>
                    <div style="font-weight: 500;">${esc(x.descripcion)} (${esc(nombre.get(x.pagado_por) ?? '?')})</div>
                    <div class="item-meta">${esc(fmtFecha(x.fecha))}</div>
                </div>
                <div class="item-amount">${formatMoney(x.total)}</div>
            </div>`).join('')
        : '<p class="item-meta">No hay compras para mostrar.</p>';

    if (btnMas) {
        btnMas.classList.toggle('hidden', !c.hasMoreCompras);
        btnMas.onclick = () => cache.loadMoreCompras();
    }
}

function renderParticipants(c) {
    const cont = $('#lista-participantes');
    if (!cont) return;
    if (!state.uid || !c.sesionId) { cont.innerHTML = '<p class="item-meta">Elegí una sesión.</p>'; return; }

    cont.innerHTML = c.miembros.map((m) => `
        <div class="list-item">
            <div>
                <div style="font-weight: 500;">${esc(m.nombre)}${m.uid === state.uid ? ' (vos)' : ''}</div>
                <div class="item-meta">${m.rol === 'creador' ? 'Creador' : 'Invitado'} · Estafado: ${formatMoney(m.dinero_estafado || 0)} · Pagadios: ${formatMoney(m.pagadios || 0)}</div>
            </div>
            ${m.uid === state.uid ? '<span class="item-meta">Actual</span>' : ''}
        </div>
    `).join('');

    const btnInvitar = $('#btn-invitar');
    if (btnInvitar) {
        const codigo = c.sesion?.codigo ?? '?';
        btnInvitar.textContent = `+ Invitar persona (código: ${codigo})`;
        btnInvitar.onclick = async () => {
            try {
                await navigator.clipboard.writeText(codigo);
                alert(`Código copiado: ${codigo}`);
            } catch {
                alert(`Código de invitación: ${codigo}`);
            }
        };
    }
}

function renderBalance(c) {
    const cont = $('#lista-balance');
    const pend = $('#balance-pendientes');
    if (!cont || !pend) return;
    if (!c.sesionId || !state.uid) {
        cont.innerHTML = '<div class="card"><p class="item-meta">Elegí una sesión.</p></div>';
        pend.innerHTML = '';
        return;
    }

    pend.innerHTML = c.solicitudes.map((s) => `
        <div class="card">
            <div class="list-item" style="border:none; padding-bottom:0;">
                <div>
                    <div style="font-weight: 500;">Te pidieron perdonar una deuda</div>
                    <div class="item-meta">${formatMoney(s.monto)} · solicitud de estafa</div>
                </div>
            </div>
            <div class="action-row">
                <button class="btn btn-success" style="font-size: 0.875rem;" data-accion="aceptar" data-solicitud="${esc(s.id)}">Aceptar</button>
                <button class="btn btn-outline" style="font-size: 0.875rem;" data-accion="rechazar" data-solicitud="${esc(s.id)}">Rechazar</button>
            </div>
        </div>
    `).join('');

    const balances = balancesFromSaldos(c.miembros, c.saldos, state.uid);
    if (!balances.length) {
        cont.innerHTML = '<div class="card"><p class="item-meta">Estás al día. No hay deudas pendientes.</p></div>';
    } else {
        cont.innerHTML = balances.map((b) => {
            if (b.net > 0) {
                return `
                    <div class="card">
                        <div class="list-item" style="border:none; padding-bottom:0;">
                            <div><div style="font-weight: 500;">${esc(b.nombre)} te debe</div></div>
                            <div class="item-amount debt-positive">${formatMoney(b.net)}</div>
                        </div>
                        <div class="action-row">
                            <button class="btn btn-success" style="font-size: 0.875rem;" data-accion="pagadios" data-uid="${esc(b.uid)}" data-monto="${b.net}">Pagadios</button>
                        </div>
                    </div>`;
            }
            return `
                <div class="card">
                    <div class="list-item" style="border:none; padding-bottom:0;">
                        <div><div style="font-weight: 500;">Le debes a ${esc(b.nombre)}</div></div>
                        <div class="item-amount debt-negative">${formatMoney(Math.abs(b.net))}</div>
                    </div>
                    <div class="form-group" style="margin-top: 1rem;">
                        <input type="number" inputmode="decimal" id="input-pagar-${esc(b.uid)}" value="${Math.abs(b.net)}">
                    </div>
                    <div class="action-row">
                        <button class="btn btn-outline" style="font-size: 0.875rem;" data-accion="pagar" data-uid="${esc(b.uid)}">Pagar ahora</button>
                        <button class="btn btn-outline" style="font-size: 0.875rem;" data-accion="estafar" data-uid="${esc(b.uid)}">Estafar</button>
                    </div>
                </div>`;
        }).join('');
    }

    cont.querySelectorAll('[data-accion]').forEach((btn) => { btn.onclick = () => onBalanceAction(btn); });
    pend.querySelectorAll('[data-accion]').forEach((btn) => { btn.onclick = () => onBalanceAction(btn); });
}

async function onBalanceAction(btn) {
    const accion = btn.dataset.accion;
    const uid = btn.dataset.uid;
    try {
        if (accion === 'pagadios') {
            if (!confirm('¿Perdonar la deuda? Se registrará como Pagadios.')) return;
            const r = await forgivePagadios(store, {
                sesionId: state.sesionId, acreedorId: state.uid, deudorId: uid, monto: Number(btn.dataset.monto)
            });
            alert(`Perdonaste ${formatMoney(r.perdonado)}. PagaDios.`);
        } else if (accion === 'pagar') {
            const monto = Number(document.getElementById(`input-pagar-${uid}`)?.value);
            await settle(store, { sesionId: state.sesionId, pagadorId: state.uid, cobradorId: uid, monto });
            alert('Pago registrado.');
        } else if (accion === 'estafar') {
            const monto = Number(document.getElementById(`input-pagar-${uid}`)?.value);
            await requestEstafa(store, { sesionId: state.sesionId, deudorId: state.uid, acreedorId: uid, monto });
            alert('Solicitud enviada. Esperá la respuesta.');
        } else if (accion === 'aceptar' || accion === 'rechazar') {
            const r = await resolveEstafa(store, {
                sesionId: state.sesionId, solicitudId: btn.dataset.solicitud, aceptar: accion === 'aceptar'
            });
            alert(r.aceptada ? `Perdonaste ${formatMoney(r.perdonado)}.` : 'Solicitud rechazada.');
        }
    } catch (error) {
        alert(error.message || 'No se pudo completar la acción.');
    }
}

const TARJETAS_LEADERBOARD = [
    { key: 'pagadios', titulo: 'Pagadios', desc: 'El que más deuda se hizo perdonar', formato: 'money' },
    { key: 'estafado', titulo: 'El Estafado', desc: 'El que más plata perdonó', formato: 'money' },
    { key: 'gastador', titulo: 'El Gastador', desc: 'El que más gastó en compras', formato: 'money' },
    { key: 'peya', titulo: 'El Peya', desc: 'El que más compras hizo', formato: 'count' },
    { key: 'ratatouille', titulo: 'El Ratatouille', desc: 'El que más plata debe', formato: 'money' }
];

function renderLeaderboards(c) {
    const cont = $('#lista-leaderboards');
    if (!cont) return;
    if (!state.uid || !c.sesionId) {
        cont.innerHTML = '<div class="card"><p class="item-meta">Elegí una sesión.</p></div>';
        return;
    }

    const leaderboards = leaderboardsFrom(c.miembros, c.saldos);
    cont.innerHTML = TARJETAS_LEADERBOARD.map((t) => {
        const ganador = leaderboards[t.key];
        const valor = !ganador ? '' : (t.formato === 'money' ? formatMoney(ganador.valor) : String(ganador.valor));
        return `
            <div class="card leaderboard-card">
                <div class="item-meta">${esc(t.titulo)}</div>
                <div class="leaderboard-nombre">${ganador ? esc(ganador.nombre) : 'Sin datos'}</div>
                <div class="leaderboard-desc">${esc(t.desc)}</div>
                ${ganador ? `<div class="item-amount">${valor}</div>` : ''}
            </div>`;
    }).join('');
}

function renderNotifications(c) {
    const cont = $('#lista-notificaciones');
    if (!cont || !state.uid) return;
    const notifs = c.notificaciones;
    if (!notifs.length) {
        cont.innerHTML = '<p class="item-meta">No tenés notificaciones.</p>';
    } else {
        cont.innerHTML = notifs.map((n) => `
            <div class="list-item notif-item ${n.leida ? '' : 'unread'}" data-id="${esc(n.id)}">
                <div>
                    <div style="font-weight: 500;">${esc(n.titulo ?? n.tipo)}</div>
                    <div class="item-meta">${esc(n.mensaje ?? '')} · ${esc(fmtFecha(n.creadaEn))}</div>
                </div>
                ${n.leida ? '' : '<span class="dot"></span>'}
            </div>
        `).join('');
        cont.querySelectorAll('.notif-item.unread').forEach((item) => {
            item.onclick = async () => { await markNotificationRead(store, state.uid, item.dataset.id); };
        });
    }

    const btnTodas = $('#btn-leer-todas');
    if (btnTodas) {
        btnTodas.onclick = async () => {
            for (const n of notifs) {
                if (!n.leida) await markNotificationRead(store, state.uid, n.id);
            }
        };
    }
}

function renderBadge(c) {
    const badge = $('#notif-badge');
    if (!badge) return;
    const unread = Number(c.perfil?.notif_no_leidas) || 0;
    badge.textContent = String(unread);
    badge.classList.toggle('hidden', unread === 0);
}

function renderSessions() {
    const cont = $('#lista-sesiones');
    if (!cont || !state.uid) return;
    if (!state.sesiones.length) {
        cont.innerHTML = '<p class="item-meta">Todavía no pertenecés a ninguna sesión.</p>';
        return;
    }
    cont.innerHTML = state.sesiones.map((s) => `
        <div class="list-item">
            <div>
                <div style="font-weight: 500;">${esc(s.nombre)}</div>
                <div class="item-meta">Código: ${esc(s.codigo)}</div>
            </div>
            <button class="btn ${s.id === state.sesionId ? 'btn-outline' : ''}" style="width:auto; padding: 0.5rem 1rem;"
                data-sesion="${esc(s.id)}" ${s.id === state.sesionId ? 'disabled' : ''}>
                ${s.id === state.sesionId ? 'Actual' : 'Entrar'}
            </button>
        </div>
    `).join('');
    cont.querySelectorAll('[data-sesion]').forEach((btn) => {
        btn.onclick = () => selectSession(btn.dataset.sesion);
    });
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function refrescarSesiones() {
    state.sesiones = state.uid ? await getUserSessions(store, state.uid) : [];
}

async function abrirCache() {
    cache.open({ uid: state.uid, sesionId: state.sesionId });
}

async function login(uid) {
    state.uid = uid;
    localStorage.setItem(LS_UID, uid);
    await refrescarSesiones();
    const guardada = localStorage.getItem(LS_SESION);
    state.sesionId = state.sesiones.some((s) => s.id === guardada)
        ? guardada
        : (state.sesiones[0]?.id ?? null);
    if (state.sesionId) localStorage.setItem(LS_SESION, state.sesionId);
    showView('add-expense');
    await abrirCache();
    render();
}

window.pagadiosLogout = async function () {
    state.uid = null;
    state.sesionId = null;
    state.sesiones = [];
    localStorage.removeItem(LS_UID);
    localStorage.removeItem(LS_SESION);
    showView('auth');
    await abrirCache();
    render();
};

async function selectSession(sesionId) {
    state.sesionId = sesionId;
    state.filtro = 'todos';
    localStorage.setItem(LS_SESION, sesionId);
    showView('add-expense');
    await abrirCache();
    render();
}

async function enviarGasto() {
    if (!state.sesionId || !state.uid) return;
    const desc = $('#gasto-desc').value.trim();
    const monto = parseFloat($('#gasto-monto').value);
    if (!desc || Number.isNaN(monto) || monto <= 0) {
        alert('Che, poné una descripción y un monto válido.');
        return;
    }
    const btn = $('#btn-enviar-gasto');
    btn.disabled = true;
    btn.innerText = 'Guardando...';
    try {
        const miembros = cache.state.miembros;
        await addExpense(store, {
            sesionId: state.sesionId,
            buyerId: state.uid,
            buyerNombre: cache.state.perfil?.nombre ?? cache.state.miembros.find((m) => m.uid === state.uid)?.nombre,
            total: monto,
            descripcion: desc,
            participantIds: miembros.map((m) => m.uid)
        });
        $('#gasto-desc').value = '';
        $('#gasto-monto').value = '';
        alert('¡Gasto anotado! PagaDios.');
    } catch (error) {
        alert(error.message || 'Error al guardar el gasto.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Enviar Gasto';
    }
}

async function unirse() {
    const codigo = $('#input-codigo').value.trim();
    if (!codigo) return;
    const ref = await store.get(`codigos/${codigo}`);
    if (!ref) { alert('No existe ninguna sesión con ese código.'); return; }
    await store.set(`sesiones/${ref.sesionId}/miembros/${state.uid}`, {
        uid: state.uid,
        nombre: cache.state.perfil?.nombre ?? USUARIOS_MOCK.find((u) => u.uid === state.uid)?.nombre ?? state.uid,
        fotoUrl: '',
        rol: 'miembro',
        unidoEn: new Date().toISOString(),
        dinero_estafado: 0,
        pagadios: 0
    }, { merge: true });
    $('#input-codigo').value = '';
    await refrescarSesiones();
    await selectSession(ref.sesionId);
}

async function crearSesion() {
    const nombre = $('#input-nueva-sesion').value.trim();
    if (!nombre) return;
    const id = `s_${Date.now().toString(36)}`;
    const codigo = `${nombre.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 12)}-${Math.floor(Math.random() * 900 + 100)}`;
    await store.set(`sesiones/${id}`, {
        nombre, creadorUid: state.uid, codigo, creadaEn: new Date().toISOString(), moneda: 'ARS',
        total_gastado: 0, compras_count: 0
    });
    await store.set(`codigos/${codigo}`, { sesionId: id });
    await store.set(`sesiones/${id}/miembros/${state.uid}`, {
        uid: state.uid,
        nombre: cache.state.perfil?.nombre ?? USUARIOS_MOCK.find((u) => u.uid === state.uid)?.nombre ?? state.uid,
        fotoUrl: '', rol: 'creador', unidoEn: new Date().toISOString(),
        dinero_estafado: 0, pagadios: 0, total_gastado: 0, compras_count: 0
    });
    $('#input-nueva-sesion').value = '';
    await refrescarSesiones();
    await selectSession(id);
}

function reiniciar() {
    if (!confirm('Se borran los datos de la demo.')) return;
    localStorage.removeItem(LS_UID);
    localStorage.removeItem(LS_SESION);
    location.reload();
}

function bindGlobal() {
    $('#btn-enviar-gasto').onclick = enviarGasto;
    $('#btn-unirse').onclick = unirse;
    $('#btn-crear-sesion').onclick = crearSesion;
    $('#btn-reiniciar').onclick = reiniciar;
}

async function boot() {
    await seedMockStore(store);
    state.uid = localStorage.getItem(LS_UID);
    if (state.uid && !USUARIOS_MOCK.some((u) => u.uid === state.uid)) state.uid = null;

    bindGlobal();
    cache.onChange(() => render());

    if (state.uid) {
        await refrescarSesiones();
        const guardada = localStorage.getItem(LS_SESION);
        state.sesionId = state.sesiones.some((s) => s.id === guardada)
            ? guardada
            : (state.sesiones[0]?.id ?? null);
        showView('add-expense');
    } else {
        showView('auth');
    }

    await abrirCache();
    render();
}

boot();
