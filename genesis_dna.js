/* Character Vault 8.3 — Genesis DNA engine (twin of character_vault/genesis/dna.py).
 *
 * Same PRNG (cyrb128 + sfc32), same order of operations and integer distance weights as the desktop, so the same
 * seed and the same history give the same character on the phone and on the PC (checked by the test suite).
 * Data: genesis_dna_v1.json (vocabulary, rules, templates). No network here: the history comes from the caller.
 */
(function (root) {
"use strict";

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function sfc32(seed) {
  let [a, b, c, d] = cyrb128(seed);
  return function () {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + ((c << 3) >>> 0)) >>> 0;
    c = (((c << 21) >>> 0) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
}
function randomSeed() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function ok(when, ids) {
  if (!when) return true;
  for (const gene of Object.keys(when)) if (!when[gene].includes(ids[gene])) return false;
  return true;
}
function resolve(src, genes, lists) {
  const i = src.indexOf(":"), kind = src.slice(0, i), rest = src.slice(i + 1);
  if (kind === "L") return lists[rest];
  if (kind === "W") return genes.world[rest] || [];
  const [gene, sub] = rest.split(".");
  return genes[gene] ? (genes[gene][sub] || []) : [];
}
function choose(rng, weights) {
  let total = 0;
  for (const w of weights) total += w;
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (r < acc) return i; }
  return weights.length - 1;
}
function geneIds(rec) { return Object.assign({kind: rec.kind}, rec.g || {}); }
function cellKey(pack, ids) { return (pack.cells[ids.kind] || ["kind"]).map(g => ids[g] || "").join("|"); }

function context(pack, history) {
  const eng = pack.engine, ctx = {recent: history.slice(-eng.window).map(geneIds), freq: new Map(), pairc: new Map(), cells: new Map()};
  for (const rec of history.slice(-eng.freq_window)) {
    const mult = rec.dup ? 1 + eng.dup_penalty : 1, ids = geneIds(rec);
    for (const g of Object.keys(ids)) { const key = g + "=" + ids[g]; ctx.freq.set(key, (ctx.freq.get(key) || 0) + mult); }
    for (const [a, b] of pack.pairs) if (a in ids && b in ids) {
      const key = a + "=" + ids[a] + "|" + b + "=" + ids[b]; ctx.pairc.set(key, (ctx.pairc.get(key) || 0) + mult);
    }
  }
  for (const rec of history) { const key = cellKey(pack, geneIds(rec)); ctx.cells.set(key, (ctx.cells.get(key) || 0) + 1); }
  return ctx;
}
function distance(pack, a, b) {
  if (a.kind !== b.kind) return 1.0;
  let num = 0, den = 0;
  const seen = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const g of seen) {
    if (g === "kind") continue;
    const w = pack.weights[g] ?? 1;
    den += w;
    if (a[g] !== b[g]) num += w;
  }
  return den ? num / den : 0.0;
}
function build(pack, rng, ctx, kindFilter, worldFilter) {
  const lists = pack.lists, eng = pack.engine;
  const kinds = pack.kinds.filter(k => !kindFilter || k.id === kindFilter);
  if (!kinds.length) return null;
  const kind = kinds[choose(rng, kinds.map(k => (k.w ?? 1) / (1 + (ctx.freq.get("kind=" + k.id) || 0))))];
  const genes = {kind}, ids = {kind: kind.id};
  for (const step of pack.plans[kind.id]) {
    const gene = step.gene;
    if (step.when && !ok(step.when, ids)) continue;
    let pool = resolve(step.src, genes, lists);
    if (gene === "world" && worldFilter) pool = pool.filter(e => e.id === worldFilter);
    const distinct = step.distinct;
    const cand = pool.filter(e => ok(e.when, ids) && !(distinct && ids[distinct] === e.id));
    if (!cand.length) return null;
    const ws = [];
    for (const e of cand) {
      let w = (e.w ?? 1) / (1 + (ctx.freq.get(gene + "=" + e.id) || 0));
      for (const [a, b] of pack.pairs) {
        if (b === gene && a in ids) w = w / (1 + (ctx.pairc.get(a + "=" + ids[a] + "|" + gene + "=" + e.id) || 0) * eng.pair_k);
        else if (a === gene && b in ids) w = w / (1 + (ctx.pairc.get(gene + "=" + e.id + "|" + b + "=" + ids[b]) || 0) * eng.pair_k);
      }
      ws.push(w);
    }
    const e = cand[choose(rng, ws)];
    genes[gene] = e; ids[gene] = e.id;
  }
  return {genes, ids};
}
function round4(x) { return Math.round(x * 10000) / 10000; }
function sample(pack, history, opts = {}) {
  const seed = opts.seed || randomSeed(), rng = sfc32(seed), ctx = context(pack, history);
  let kind = opts.kind || null;
  if (!kind) {
    // Drawn once per character (frequency-balanced); the candidates then compete inside that kind.
    const kinds = pack.kinds;
    kind = kinds[choose(rng, kinds.map(k => (k.w ?? 1) / (1 + (ctx.freq.get("kind=" + k.id) || 0))))].id;
  }
  let best = null, bestScore = -1.0;
  for (let c = 0; c < pack.engine.candidates; c++) {
    const built = build(pack, rng, ctx, kind, opts.world || null);
    if (!built) continue;
    let nn = 1.0;
    for (const other of ctx.recent) { const d = distance(pack, built.ids, other); if (d < nn) nn = d; }
    const score = nn + pack.engine.cell_bonus / (1 + (ctx.cells.get(cellKey(pack, built.ids)) || 0));
    if (score > bestScore) { best = {built, nn, score}; bestScore = score; }
  }
  if (!best) throw new Error("No character fits these filters (this world has no constructs of that kind).");
  const g = {}; for (const k of Object.keys(best.built.ids)) if (k !== "kind") g[k] = best.built.ids[k];
  return {id: seed, seed, kind: best.built.ids.kind, g, genes: best.built.genes, nn: round4(best.nn), score: round4(best.score)};
}
function render(pack, dna) {
  const value = name => (dna.genes[name] ? dna.genes[name].v : "");
  const fill = tpl => tpl
    .replace(/\[([^\[\]]*)\]/g, (m, inner) => ([...inner.matchAll(/\{(\w+)\}/g)].every(x => value(x[1])) ? inner : ""))
    .replace(/\{(\w+)\}/g, (m, name) => value(name));
  const out = {};
  for (const f of pack.fields) out[f] = fill(pack.templates[dna.kind][f]);
  return out;
}
function specText(pack, fields) { return pack.fields.map(f => f.toUpperCase() + ": " + fields[f]).join("\n"); }
function summary(dna) {
  const g = dna.genes, parts = [g.kind.v, g.world.v];
  for (const n of ["gender", "age", "heritage", "species", "ctype", "body_plan", "profession"]) if (g[n]) parts.push(g[n].v);
  return parts.join(" · ");
}
function merge(lines) {
  const dna = new Map(), extra = [];
  for (const line of lines) {
    if (!line || typeof line !== "object" || typeof line.id !== "string") continue;
    if (line.t === "dna" && line.g && typeof line.g === "object" && typeof line.kind === "string") { if (!dna.has(line.id)) dna.set(line.id, Object.assign({}, line)); }
    else if (line.t === "img" || line.t === "verdict") extra.push(line);
  }
  extra.sort((x, y) => ((x.ts || 0) - (y.ts || 0)) || ((x.t || "") < (y.t || "") ? -1 : (x.t || "") > (y.t || "") ? 1 : 0));
  for (const line of extra) {
    const rec = dna.get(line.id); if (!rec) continue;
    if (line.t === "img") { rec.sha = line.sha || ""; rec.file = line.file || ""; }
    else { rec.verdict = {face: line.face, face_of: line.face_of, vis: line.vis, vis_of: line.vis_of, dup: line.dup}; rec.dup = !!line.dup; }
  }
  return [...dna.values()].sort((a, b) => ((a.ts | 0) - (b.ts | 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function record(pack, dna, device, src, extra = {}) {
  const rec = {t: "dna", id: dna.id, ts: Math.floor(Date.now() / 1000), dev: device, pv: pack.pack, kind: dna.kind, g: dna.g, src};
  for (const k of Object.keys(extra)) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== false) rec[k] = extra[k];
  return rec;
}
root.GenesisDNA = {cyrb128, sfc32, sample, render, specText, summary, merge, record, distance, cellKey, geneIds, randomSeed};
})(typeof window !== "undefined" ? window : globalThis);
