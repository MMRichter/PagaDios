import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAmount, sumAmounts, round2, toCents, fromCents } from '../src/money.js';

test('splitAmount reparte exacto cuando el total es divisible', () => {
    assert.deepEqual(splitAmount(15000, 3), [5000, 5000, 5000]);
    assert.deepEqual(splitAmount(100, 4), [25, 25, 25, 25]);
});

test('splitAmount distribuye centavos sobrantes y la suma es exacta', () => {
    const partes = splitAmount(100, 3);
    assert.equal(sumAmounts(partes), 100);
    assert.equal(partes.length, 3);
    assert.equal(toCents(Math.max(...partes)) - toCents(Math.min(...partes)) <= 1, true);
});

test('splitAmount con montos grandes mantiene la suma exacta', () => {
    for (const [total, n] of [[8500, 3], [999.99, 7], [10, 3], [0.05, 3], [123456.78, 11]]) {
        const partes = splitAmount(total, n);
        assert.equal(sumAmounts(partes), round2(total), `total=${total} n=${n}`);
    }
});

test('splitAmount valida entradas', () => {
    assert.throws(() => splitAmount('x', 3), /número/);
    assert.throws(() => splitAmount(100, 0), /entero/);
    assert.throws(() => splitAmount(100, 2.5), /entero/);
});

test('toCents/fromCents y round2 evitan errores de punto flotante', () => {
    assert.equal(toCents(0.1) + toCents(0.2), 30);
    assert.equal(fromCents(30), 0.3);
    assert.equal(round2(0.1 + 0.2), 0.3);
    assert.equal(round2(2833.333333), 2833.33);
});
