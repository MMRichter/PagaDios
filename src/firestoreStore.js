/**
 * Adaptador de Firestore que implementa la misma interfaz que
 * `src/store.js` (memory store). La app y `src/model.js` no cambian.
 *
 * Minimización de tráfico:
 * - La UI consume `subscribe*` (una suscripción por consulta); no hay lecturas
 *   por render.
 * - `batch()` + `increment()`/`serverTimestamp()` permiten escribir sin leer.
 * - `queryGroup` usa collection groups en vez de escanear colecciones.
 *
 * Importa el SDK desde el CDN (módulos de 10.8.0), así que NO se puede usar
 * en los tests de Node: para eso está el memory store.
 */

import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query as buildQuery,
    where as fbWhere,
    orderBy as fbOrderBy,
    limit as fbLimit,
    startAfter as fbStartAfter,
    writeBatch,
    runTransaction,
    FieldValue
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "../firestore.js";

function toFieldValue(value) {
    if (value && typeof value === 'object' && value.__op === 'increment') {
        return FieldValue.increment(value.n);
    }
    if (value && typeof value === 'object' && value.__op === 'serverTimestamp') {
        return FieldValue.serverTimestamp();
    }
    return value;
}

function withSentinels(data) {
    const out = {};
    for (const [key, value] of Object.entries(data)) out[key] = toFieldValue(value);
    return out;
}

function buildRef(target) {
    const parts = target.split('/');
    if (parts.length % 2 === 0) return doc(db, ...parts);
    return collection(db, ...parts);
}

function buildConstraints(options = {}) {
    const constraints = [];
    for (const [field, op, value] of options.where ?? []) {
        constraints.push(fbWhere(field, op, value));
    }
    for (const entry of options.orderBy ?? []) {
        const [field, dir] = Array.isArray(entry) ? entry : [entry, 'asc'];
        constraints.push(fbOrderBy(field, dir));
    }
    if (Number.isInteger(options.limit)) constraints.push(fbLimit(options.limit));
    if (options.startAfter && (options.orderBy?.length)) {
        const fields = options.orderBy.map((e) => (Array.isArray(e) ? e[0] : e));
        const values = fields.map((f) => options.startAfter[f]);
        constraints.push(fbStartAfter(...values));
    }
    return constraints;
}

function refFromQuery(ref, options) {
    const constraints = buildConstraints(options);
    return constraints.length ? buildQuery(ref, ...constraints) : ref;
}

function snapToItem(snap) {
    return { id: snap.id, path: snap.ref.path, exists: snap.exists(), data: snap.data() ?? null };
}

async function readCollection(ref, options) {
    const snaps = await getDocs(refFromQuery(ref, options));
    return snaps.docs.map(snapToItem);
}

/** Crea el store contra Firestore. */
export function createFirestoreStore() {
    const store = {
        newId(collectionPath) {
            return doc(collection(db, ...collectionPath.split('/'))).id;
        },

        async get(path) {
            const snap = await getDoc(buildRef(path));
            return snap.exists() ? snap.data() : null;
        },

        async set(path, data, { merge = false } = {}) {
            await setDoc(buildRef(path), withSentinels(data), { merge });
        },

        async update(path, partial) {
            await updateDoc(buildRef(path), withSentinels(partial));
        },

        async delete(path) {
            await deleteDoc(buildRef(path));
        },

        async add(collectionPath, data) {
            const ref = await addDoc(collection(db, ...collectionPath.split('/')), withSentinels(data));
            return ref.id;
        },

        async query(collectionPath, opts = {}) {
            return readCollection(collection(db, ...collectionPath.split('/')), opts);
        },

        async queryGroup(groupName, opts = {}) {
            return readCollection(collectionGroup(db, groupName), opts);
        },

        batch() {
            const batch = writeBatch(db);
            return {
                set(path, data, { merge = false } = {}) {
                    batch.set(buildRef(path), withSentinels(data), { merge });
                    return this;
                },
                update(path, partial) {
                    batch.update(buildRef(path), withSentinels(partial));
                    return this;
                },
                delete(path) {
                    batch.delete(buildRef(path));
                    return this;
                },
                async commit() {
                    await batch.commit();
                }
            };
        },

        async runTransaction(fn) {
            return runTransaction(db, async (tx) => {
                const txAdapter = {
                    async get(path) {
                        const snap = await tx.get(buildRef(path));
                        return snap.exists() ? snap.data() : null;
                    },
                    set(path, data, { merge = false } = {}) {
                        tx.set(buildRef(path), withSentinels(data), { merge });
                    },
                    update(path, partial) {
                        tx.update(buildRef(path), withSentinels(partial));
                    },
                    delete(path) {
                        tx.delete(buildRef(path));
                    },
                    add(collectionPath, data) {
                        const ref = doc(collection(db, ...collectionPath.split('/')));
                        tx.set(ref, withSentinels(data));
                        return ref.id;
                    }
                };
                return fn(txAdapter);
            });
        },

        subscribe(path, cb) {
            return onSnapshot(buildRef(path), (snap) => cb(snapToItem(snap)));
        },

        subscribeQuery(collectionPath, options, maybeCb) {
            const cb = typeof options === 'function' ? options : maybeCb;
            const opts = typeof options === 'function' ? {} : (options ?? {});
            const ref = refFromQuery(collection(db, ...collectionPath.split('/')), opts);
            return onSnapshot(ref, (snaps) => cb(snaps.docs.map(snapToItem)));
        },

        subscribeGroup(groupName, options, maybeCb) {
            const cb = typeof options === 'function' ? options : maybeCb;
            const opts = typeof options === 'function' ? {} : (options ?? {});
            const ref = refFromQuery(collectionGroup(db, groupName), opts);
            return onSnapshot(ref, (snaps) => cb(snaps.docs.map(snapToItem)));
        },

        subscribeAny() {
            // No hay una suscripción "global" eficiente en Firestore.
            // La UI usa sessionCache con suscripciones por colección.
            return () => {};
        }
    };

    return store;
}
