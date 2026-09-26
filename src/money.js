/**
 * Utilidades de dinero. Se trabaja en centavos para evitar errores de
 * punto flotante (0.1 + 0.2 !== 0.3).
 */

/** Convierte un monto en pesos a centavos enteros. */
export function toCents(amount) {
    return Math.round(Number(amount) * 100);
}

/** Convierte centavos enteros a un monto con 2 decimales. */
export function fromCents(cents) {
    return Math.round(cents) / 100;
}

/** Redondea un monto a 2 decimales. */
export function round2(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

/**
 * Reparte `total` en `n` partes iguales.
 * El resto de centavos se distribuye entre las primeras partes para que
 * la suma de todas las partes sea exactamente `total`.
 *
 * @param {number} total Monto total.
 * @param {number} n Cantidad de partes (entero > 0).
 * @returns {number[]} Array de `n` montos que suman `total`.
 */
export function splitAmount(total, n) {
    const amount = Number(total);
    if (!Number.isFinite(amount)) throw new TypeError('total debe ser un número finito');
    if (!Number.isInteger(n) || n <= 0) throw new RangeError('n debe ser un entero mayor a 0');

    const totalCents = toCents(amount);
    const base = Math.trunc(totalCents / n);
    const remainder = totalCents - base * n;
    const step = remainder >= 0 ? 1 : -1;

    const parts = new Array(n).fill(base);
    for (let i = 0; i < Math.abs(remainder); i++) parts[i] += step;

    return parts.map(fromCents);
}

/** Suma de un array de montos, redondeada a 2 decimales. */
export function sumAmounts(amounts) {
    return fromCents(amounts.reduce((acc, a) => acc + toCents(a), 0));
}

/**
 * Formatea un monto como moneda. Por defecto pesos argentinos.
 */
export function formatMoney(amount, moneda = 'ARS', locale = 'es-AR') {
    const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: moneda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
