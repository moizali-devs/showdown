// Conflict-serializability: parse a schedule, build the precedence graph, find a cycle or a serial order. Pure TS.
export type Op =
  | { kind: 'R' | 'W'; tx: number; item: string; index: number }
  | { kind: 'C' | 'A'; tx: number; item?: undefined; index: number };

export interface Edge { from: number; to: number; items: string[]; kinds: ('RW' | 'WR' | 'WW')[] }
export interface ParseResult { ops: Op[]; errors: string[] }
export interface Analysis {
  ops: Op[];
  errors: string[];
  txs: number[];
  edges: Edge[];
  cycle: number[] | null; // e.g. [1,2,1] (first node repeated at the end)
  order: number[] | null; // topological order when acyclic
  serializable: boolean;
}

const TOKEN = /([RrWw])\s*(\d+)\s*[(\[]\s*([A-Za-z_]\w*)\s*[)\]]|(?:commit|[Cc])\s*(\d+)|(?:abort|[Aa])\s*(\d+)/y;
const SEP = /[\s,;]+/y;

export function parse(text: string): ParseResult {
  const ops: Op[] = [];
  const errors: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    SEP.lastIndex = pos;
    if (SEP.exec(text)) pos = SEP.lastIndex;
    if (pos >= text.length) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) {
      const bad = /^[^\s,;]+/.exec(text.slice(pos))?.[0] ?? text[pos];
      errors.push(`Cannot read "${bad}" at position ${pos + 1}. Use R1(A), W2(B), C1.`);
      pos += bad.length;
      continue;
    }
    pos = TOKEN.lastIndex;
    const index = ops.length;
    if (m[1]) ops.push({ kind: m[1].toUpperCase() as 'R' | 'W', tx: parseInt(m[2], 10), item: m[3].toUpperCase(), index });
    else if (m[4]) ops.push({ kind: 'C', tx: parseInt(m[4], 10), index });
    else ops.push({ kind: 'A', tx: parseInt(m[5], 10), index });
  }
  return { ops, errors };
}

export function buildGraph(ops: Op[]): { txs: number[]; edges: Edge[] } {
  const txs = [...new Set(ops.map((o) => o.tx))].sort((a, b) => a - b);
  const map = new Map<string, Edge>();
  for (let i = 0; i < ops.length; i++) {
    const a = ops[i];
    if (a.kind !== 'R' && a.kind !== 'W') continue;
    for (let j = i + 1; j < ops.length; j++) {
      const b = ops[j];
      if (b.kind !== 'R' && b.kind !== 'W') continue;
      if (a.tx === b.tx || a.item !== b.item || (a.kind === 'R' && b.kind === 'R')) continue;
      const key = `${a.tx}>${b.tx}`;
      let e = map.get(key);
      if (!e) { e = { from: a.tx, to: b.tx, items: [], kinds: [] }; map.set(key, e); }
      if (!e.items.includes(a.item)) e.items.push(a.item);
      const k = (a.kind + b.kind) as 'RW' | 'WR' | 'WW';
      if (!e.kinds.includes(k)) e.kinds.push(k);
    }
  }
  return { txs, edges: [...map.values()] };
}

export function findCycle(txs: number[], edges: Edge[]): number[] | null {
  const adj = new Map<number, number[]>();
  txs.forEach((t) => adj.set(t, []));
  edges.forEach((e) => adj.get(e.from)!.push(e.to));
  const color = new Map<number, number>();
  const stack: number[] = [];
  let cycle: number[] | null = null;
  const dfs = (u: number) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u)!) {
      if (cycle) break;
      if (color.get(v) === 1) cycle = [...stack.slice(stack.indexOf(v)), v];
      else if (!color.get(v)) dfs(v);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const t of txs) if (!color.get(t) && !cycle) dfs(t);
  return cycle;
}

export function topoOrder(txs: number[], edges: Edge[]): number[] | null {
  const indeg = new Map<number, number>(txs.map((t) => [t, 0]));
  edges.forEach((e) => indeg.set(e.to, indeg.get(e.to)! + 1));
  const ready = txs.filter((t) => indeg.get(t) === 0);
  const order: number[] = [];
  while (ready.length) {
    ready.sort((a, b) => a - b);
    const u = ready.shift()!;
    order.push(u);
    for (const e of edges) {
      if (e.from !== u) continue;
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) ready.push(e.to);
    }
  }
  return order.length === txs.length ? order : null;
}

export function analyze(text: string): Analysis {
  const { ops, errors } = parse(text);
  const { txs, edges } = buildGraph(ops);
  const cycle = findCycle(txs, edges);
  const order = cycle ? null : topoOrder(txs, edges);
  return { ops, errors, txs, edges, cycle, order, serializable: errors.length === 0 && ops.length > 0 && !cycle };
}
