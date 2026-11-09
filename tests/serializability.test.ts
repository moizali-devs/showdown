import { describe, it, expect } from 'vitest';
import { parse, analyze } from '../web/src/lib/serializability';

const edgeKeys = (s: string) => analyze(s).edges.map((e) => `${e.from}>${e.to}`).sort();

describe('parse', () => {
  it('parses canonical form', () => {
    const r = parse('R1(A) W2(A) R2(B) W1(B) C1 C2');
    expect(r.errors).toEqual([]);
    expect(r.ops.map((o) => o.kind + o.tx + (o.item ?? ''))).toEqual(['R1A', 'W2A', 'R2B', 'W1B', 'C1', 'C2']);
  });
  it('is lenient about spaces, commas, case, brackets', () => {
    const r = parse('r1[x], w2 ( x ),R1(y);c1 commit2');
    expect(r.errors).toEqual([]);
    expect(r.ops).toHaveLength(5);
    expect(r.ops[0]).toMatchObject({ kind: 'R', tx: 1, item: 'X' });
    expect(r.ops[4]).toMatchObject({ kind: 'C', tx: 2 });
  });
  it('accepts no separators', () => {
    expect(parse('R1(A)W2(A)').ops).toHaveLength(2);
  });
  it('reports bad input', () => {
    expect(parse('R1(A) banana W2').errors.length).toBeGreaterThan(0);
    expect(analyze('R1(A) ??').serializable).toBe(false);
  });
  it('empty input is not serializable but has no errors', () => {
    const a = analyze('  ');
    expect(a.errors).toEqual([]);
    expect(a.serializable).toBe(false);
  });
});

describe('serializability', () => {
  it('Lab 5 Schedule A is serializable (T1 -> T2)', () => {
    const a = analyze('R1(A), R1(B), W1(A), R2(A), W2(A)');
    expect(a.serializable).toBe(true);
    expect(edgeKeys('R1(A), R1(B), W1(A), R2(A), W2(A)')).toEqual(['1>2']);
    expect(a.order).toEqual([1, 2]);
  });
  it('Lab 5 Schedule B (lost update) is not serializable', () => {
    const a = analyze('R1(X), R2(X), W2(X), W1(X)');
    expect(a.serializable).toBe(false);
    expect(edgeKeys('R1(X), R2(X), W2(X), W1(X)')).toEqual(['1>2', '2>1']);
    expect(a.cycle).toEqual([1, 2, 1]);
    expect(a.order).toBeNull();
  });
  it('design default R1(A) W2(A) R2(B) W1(B) has a cycle', () => {
    expect(edgeKeys('R1(A) W2(A) R2(B) W1(B)')).toEqual(['1>2', '2>1']);
    expect(analyze('R1(A) W2(A) R2(B) W1(B)').serializable).toBe(false);
  });
  it('read-read never conflicts', () => {
    const a = analyze('R1(A) R2(A) R1(B) R2(B)');
    expect(a.edges).toEqual([]);
    expect(a.serializable).toBe(true);
    expect(a.order).toEqual([1, 2]);
  });
  it('serial schedule T2 then T1 gives order 2,1', () => {
    expect(analyze('R2(A) W2(A) R1(A) W1(A) C2 C1').order).toEqual([2, 1]);
  });
  it('different items never conflict', () => {
    const a = analyze('W1(A) W2(B) W1(C) W2(D)');
    expect(a.edges).toEqual([]);
    expect(a.serializable).toBe(true);
  });
  it('three-transaction chain is serializable', () => {
    expect(analyze('W1(A) R2(A) W2(B) R3(B)').order).toEqual([1, 2, 3]);
  });
  it('three-transaction cycle detected', () => {
    const a = analyze('W1(A) R2(A) W2(B) R3(B) W3(C) R1(C)');
    expect(a.serializable).toBe(false);
    expect(a.cycle).toHaveLength(4);
    expect(a.cycle![0]).toBe(a.cycle![3]);
  });
  it('write-write conflicts count', () => {
    const a = analyze('W1(A) W2(A) W2(B) W1(B)');
    expect(a.serializable).toBe(false);
    expect(a.edges.find((e) => e.from === 1 && e.to === 2)!.kinds).toContain('WW');
  });
  it('lowercase bracket form', () => {
    expect(analyze('r1[x] w2[x] w2[y] r1[y]').serializable).toBe(false);
  });
});
