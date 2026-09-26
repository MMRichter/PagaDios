import { createMemoryStore } from '../src/store.js';
import { seedMockStore, SESION_MOCK } from '../src/mockData.js';

export { SESION_MOCK };

/** Generador de ids determinista para tests. */
export function makeIdGen() {
    let n = 0;
    return () => `id${String(++n).padStart(4, '0')}`;
}

export function makeStore() {
    return createMemoryStore({ genId: makeIdGen() });
}

export async function freshSeededStore() {
    const store = makeStore();
    await seedMockStore(store);
    return store;
}

export const UIDS = { yo: 'u_yo', matias: 'u_matias', juan: 'u_juan' };
