/**
 * Store en memoria que imita el subconjunto de Firestore que usa la app:
 * documentos por path, colecciones, queries con filtros/orden/límite,
 * transacciones con detección de conflictos, batch de escrituras y
 * suscripciones tipo onSnapshot.
 *
 * El objetivo es poder desarrollar y testear toda la lógica de negocio sin
 * Firebase levantado. `src/firestoreStore.js` implementa la misma interfaz
 * contra Firestore, así que cambiar de backend es cambiar el import.
 *
 * Reglas para minimizar tráfico: las lecturas de la UI salen de suscripciones
 * (una sola vez por colección) y las escrituras derivadas usan `increment()`
 * para no tener que leer antes de escribir.
 */

function deepClone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function parentOf(path) {
    const i = path.lastIndexOf('/');
    return i === -1 ? '' : path.slice(0, i);
}

function idOf(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}

function isDirectChild(path, collectionPath) {
    return parentOf(path) === collectionPath;
}

function isInGroup(path, groupName) {
    const parts = path.split('/');
    return parts.length >= 2 && parts[parts.length - 2] === groupName;
}

/** Sentinela de escritura: suma `n` al valor actual del campo. */
export function increment(n) {
    return { __op: 'increment', n: Number(n) || 0 };
}

/** Sentinela de escritura: la hora del servidor (acá, ISO del reloj local). */
export function serverTimestamp() {
    return { __op: 'serverTimestamp' };
}

function isSentinel(value) {
    return value && typeof value === 'object' && typeof value.__op === 'string';
}

/** Resuelve sentinelas contra el documento previo. */
function materialize(prev, data) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (isSentinel(value) && value.__op === 'increment') {
            out[key] = (Number(prev?.[key]) || 0) + value.n;
        } else if (isSentinel(value) && value.__op === 'serverTimestamp') {
            out[key] = new Date().toISOString();
        } else {
            out[key] = deepClone(value);
        }
    }
    return out;
}

function normalizeOrderBy(orderBy) {
    if (!orderBy) return [];
    const list = Array.isArray(orderBy) ? orderBy : [orderBy];
    return list.map((entry) => (Array.isArray(entry) ? entry : [entry, 'asc']));
}

function compareValues(a, b) {
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    return a < b ? -1 : 1;
}

function matchesWhere(data, where) {
    for (const [field, op, value] of where ?? []) {
        const actual = data[field];
        switch (op) {
            case '==': if (actual !== value) return false; break;
            case '!=': if (actual === value) return false; break;
            case '<': if (!(actual < value)) return false; break;
            case '<=': if (!(actual <= value)) return false; break;
            case '>': if (!(actual > value)) return false; break;
            case '>=': if (!(actual >= value)) return false; break;
            case 'in': if (!Array.isArray(value) || !value.includes(actual)) return false; break;
            case 'array-contains': if (!Array.isArray(actual) || !actual.includes(value)) return false; break;
            default: throw new Error(`Operador no soportado: ${op}`);
        }
    }
    return true;
}

function applyOptions(items, options = {}) {
    const { where, orderBy, limit, startAfter } = options;
    let result = items;
    if (where) result = result.filter((it) => matchesWhere(it.data, where));

    const order = normalizeOrderBy(orderBy);
    if (order.length) {
        result = [...result].sort((a, b) => {
            for (const [field, dir] of order) {
                const cmp = compareValues(a.data[field], b.data[field]);
                if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
            }
            return 0;
        });
    } else {
        result = [...result].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    if (startAfter && order.length) {
        const [field, dir] = order[0];
        const cursor = startAfter[field];
        result = result.filter((it) => (dir === 'desc' ? it.data[field] < cursor : it.data[field] > cursor));
    }

    if (Number.isInteger(limit)) result = result.slice(0, limit);
    return result;
}

export function createMemoryStore(options = {}) {
    /** @type {Map<string, any>} */
    const docs = new Map();
    /** @type {Map<string, number>} */
    const versions = new Map();
    /** @type {Set<object>} */
    const listeners = new Set();

    let idCounter = 0;
    const genId = options.genId || (() => `id${(++idCounter).toString(36)}${Math.random().toString(36).slice(2, 8)}`);

    function snapshot(path) {
        const exists = docs.has(path);
        return {
            id: idOf(path),
            path,
            exists,
            data: exists ? deepClone(docs.get(path)) : null
        };
    }

    function allItems(predicate, options) {
        const items = [];
        for (const path of docs.keys()) {
            if (predicate(path)) items.push(snapshot(path));
        }
        return applyOptions(items, options);
    }

    function querySync(collectionPath, opts) {
        return allItems((path) => isDirectChild(path, collectionPath), opts);
    }

    function queryGroupSync(groupName, opts) {
        return allItems((path) => isInGroup(path, groupName), opts);
    }

    function bump(path) {
        versions.set(path, (versions.get(path) ?? 0) + 1);
    }

    function notify(affectedPaths) {
        const affected = affectedPaths.map((p) => (typeof p === 'object' ? p : { path: p }));
        queueMicrotask(() => {
            for (const listener of [...listeners]) {
                if (listener.kind === 'doc') {
                    if (affected.some((a) => a.path === listener.path)) {
                        listener.cb(snapshot(listener.path));
                    }
                } else if (listener.kind === 'query') {
                    const inScope = affected.some((a) =>
                        listener.group
                            ? isInGroup(a.path, listener.group)
                            : isDirectChild(a.path, listener.collection)
                    );
                    if (inScope) {
                        listener.cb(
                            listener.group
                                ? queryGroupSync(listener.group, listener.options)
                                : querySync(listener.collection, listener.options)
                        );
                    }
                } else if (listener.kind === 'any') {
                    listener.cb();
                }
            }
        });
    }

    function applyWrites(writes) {
        const affected = [];
        for (const w of writes) {
            if (w.type === 'set') {
                const prev = docs.get(w.path);
                const next = { ...(w.merge ? (prev ?? {}) : {}), ...materialize(w.merge ? prev : {}, w.data) };
                docs.set(w.path, next);
                bump(w.path);
                affected.push(w.path);
            } else if (w.type === 'update') {
                if (!docs.has(w.path)) throw new Error(`No existe el documento ${w.path}`);
                const prev = docs.get(w.path);
                docs.set(w.path, { ...prev, ...materialize(prev, w.partial) });
                bump(w.path);
                affected.push(w.path);
            } else if (w.type === 'delete') {
                if (docs.delete(w.path)) {
                    bump(w.path);
                    affected.push(w.path);
                }
            }
        }
        if (affected.length) notify(affected);
        return affected;
    }

    function buildBatch() {
        const writes = [];
        return {
            set(path, data, { merge = false } = {}) { writes.push({ type: 'set', path, data, merge }); return this; },
            update(path, partial) { writes.push({ type: 'update', path, partial }); return this; },
            delete(path) { writes.push({ type: 'delete', path }); return this; },
            async commit() { applyWrites(writes); }
        };
    }

    const store = {
        /** Genera un id para una colección (para usar con `batch.set`). */
        newId() {
            return genId();
        },

        async get(path) {
            return docs.has(path) ? deepClone(docs.get(path)) : null;
        },

        async set(path, data, { merge = false } = {}) {
            applyWrites([{ type: 'set', path, data, merge }]);
        },

        async update(path, partial) {
            applyWrites([{ type: 'update', path, partial }]);
        },

        async delete(path) {
            applyWrites([{ type: 'delete', path }]);
        },

        async add(collectionPath, data) {
            const id = genId();
            const path = `${collectionPath}/${id}`;
            applyWrites([{ type: 'set', path, data, merge: false }]);
            return id;
        },

        /**
         * Lista documentos de una colección.
         * options: { where: [[campo, op, valor]], orderBy: [[campo, 'asc'|'desc']], limit, startAfter }
         */
        async query(collectionPath, opts = {}) {
            return querySync(collectionPath, opts);
        },

        /** Igual que query pero sobre un collection group (ej: 'miembros'). */
        async queryGroup(groupName, opts = {}) {
            return queryGroupSync(groupName, opts);
        },

        /** Batch de escrituras atómicas (sin lecturas). */
        batch() {
            return buildBatch();
        },

        async runTransaction(fn) {
            const maxAttempts = 10;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const baseline = new Map();
                const writes = [];
                const overlay = new Map();

                const baseOf = (path) => (overlay.has(path) ? overlay.get(path) : docs.get(path));

                const tx = {
                    async get(path) {
                        if (overlay.has(path)) return deepClone(overlay.get(path));
                        if (!baseline.has(path)) baseline.set(path, versions.get(path) ?? 0);
                        return docs.has(path) ? deepClone(docs.get(path)) : null;
                    },
                    set(path, data, { merge = false } = {}) {
                        writes.push({ type: 'set', path, data, merge });
                        const prev = baseOf(path);
                        const next = { ...(merge ? (prev ?? {}) : {}), ...materialize(merge ? prev : {}, data) };
                        overlay.set(path, next);
                    },
                    update(path, partial) {
                        writes.push({ type: 'update', path, partial });
                        const prev = baseOf(path) ?? {};
                        overlay.set(path, { ...prev, ...materialize(prev, partial) });
                    },
                    delete(path) {
                        writes.push({ type: 'delete', path });
                        overlay.set(path, undefined);
                    },
                    add(collectionPath, data) {
                        const id = genId();
                        const path = `${collectionPath}/${id}`;
                        this.set(path, data, { merge: false });
                        return id;
                    }
                };

                const result = await fn(tx);

                let conflict = false;
                for (const [path, version] of baseline) {
                    if ((versions.get(path) ?? 0) !== version) {
                        conflict = true;
                        break;
                    }
                }
                if (conflict) continue;

                applyWrites(writes);
                return result;
            }
            throw new Error('Transacción abortada: demasiados conflictos');
        },

        /** Suscribe a un documento. Devuelve función para cancelar. */
        subscribe(path, cb) {
            const listener = { kind: 'doc', path, cb };
            listeners.add(listener);
            queueMicrotask(() => {
                if (listeners.has(listener)) cb(snapshot(path));
            });
            return () => listeners.delete(listener);
        },

        /**
         * Suscribe a una colección.
         * Acepta (collection, cb) o (collection, options, cb).
         */
        subscribeQuery(collectionPath, options, maybeCb) {
            const cb = typeof options === 'function' ? options : maybeCb;
            const opts = typeof options === 'function' ? {} : (options ?? {});
            const listener = { kind: 'query', collection: collectionPath, options: opts, cb };
            listeners.add(listener);
            queueMicrotask(() => {
                if (listeners.has(listener)) cb(querySync(collectionPath, opts));
            });
            return () => listeners.delete(listener);
        },

        /** Suscribe a un collection group (ej: 'miembros'). */
        subscribeGroup(groupName, options, maybeCb) {
            const cb = typeof options === 'function' ? options : maybeCb;
            const opts = typeof options === 'function' ? {} : (options ?? {});
            const listener = { kind: 'query', group: groupName, options: opts, cb };
            listeners.add(listener);
            queueMicrotask(() => {
                if (listeners.has(listener)) cb(queryGroupSync(groupName, opts));
            });
            return () => listeners.delete(listener);
        },

        /** Suscribe a cualquier cambio del store. */
        subscribeAny(cb) {
            const listener = { kind: 'any', cb };
            listeners.add(listener);
            queueMicrotask(() => {
                if (listeners.has(listener)) cb();
            });
            return () => listeners.delete(listener);
        },

        /** Solo para tests/debug. */
        _size() {
            return docs.size;
        },

        _reset() {
            docs.clear();
            versions.clear();
            listeners.clear();
        }
    };

    return store;
}
