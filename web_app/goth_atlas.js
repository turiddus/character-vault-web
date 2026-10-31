/* Goth Vault 1.0 — Goth Atlas 2 on the phone: same database and same prompt wording as character_vault/goth_atlas.py
 * (the tests check that compose() gives identical prompts). Database source only; Codex scenes are asked to the PC. */
(function () {
"use strict";
let A = null, loading = null;
const MIN_AGE = 18, MAX_AGE = 70;
const FIELDS = ["subgenre", "city", "country", "setting", "district", "action", "detail", "time", "weather", "age", "skin",
  "body", "face", "haircolor", "hair", "makeup", "marks", "glasses", "nails", "emotion", "expression", "garment",
  "layer", "legwear", "footwear", "accessory", "palette", "phone", "angle", "light", "imp1", "imp2"];
function load(){
  if (A) return Promise.resolve(A);
  if (!loading) loading = fetch("goth_atlas.json").then(r => r.json()).then(j => (A = j)).catch(e => { loading = null; throw e; });
  return loading;
}
const rnd = n => Math.floor(Math.random() * n);
const ch = arr => arr[rnd(arr.length)];
function shuffle(a){ for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function leastUsed(items, key, recent, k){
  const used = {}; (recent || []).forEach(x => { used[x] = (used[x] || 0) + 1; });
  const pool = shuffle(items.slice()).sort((a, b) => (used[key(a)] || 0) - (used[key(b)] || 0));
  return ch(pool.slice(0, Math.max(1, Math.min(k || 6, pool.length))));
}
function pick(filters, recent){
  const f = filters || {}, r = recent || {}, P = A.pools;
  const subs = A.subgenres.filter(s => !f.subgenre || s.n === f.subgenre);
  const sub = leastUsed(subs.length ? subs : A.subgenres, s => s.n, r.subgenre, 6);
  const cats = A.categories.filter(c => !f.category || c.n === f.category);
  const cat = leastUsed(cats.length ? cats : A.categories, c => c.n, r.category, 8);
  const scene = ch(cat.scenes);
  const cs = A.cities.filter(c => (!f.continent || c[0] === f.continent) && (!f.country || c[1] === f.country));
  const city = leastUsed(cs.length ? cs : A.cities, c => c[2], r.city, 40);
  const band = /^\d+$/.test(String(f.age_band ?? "")) ? A.ages[Number(f.age_band)] : [MIN_AGE, MAX_AGE];
  const imps = shuffle(P.imp.slice()).slice(0, 2);
  return {subgenre: sub.n, category: cat.n, continent: city[0], country: city[1], city: city[2], setting: scene.s,
    district: ch(P.district), action: ch(scene.a), detail: scene.d, time: ch(P.time), weather: ch(P.weather),
    age: band[0] + rnd(band[1] - band[0] + 1), skin: ch(P.skin), body: ch(P.body), face: ch(P.face),
    haircolor: ch(P.haircolor), hair: ch(P.hair), makeup: ch(P.makeup), marks: ch(P.marks), glasses: ch(P.glasses),
    nails: ch(P.nails), emotion: ch(P.emotion), expression: ch(P.expression), garment: ch(sub.g), layer: ch(P.layer),
    legwear: ch(P.legwear), footwear: ch(P.footwear), accessory: ch(sub.a), palette: ch(sub.p), phone: ch(P.phone),
    angle: ch(P.angle), light: ch(scene.i ? P.light_in : P.light_out), imp1: imps[0], imp2: imps[1], source: "database"};
}
const clean = (v, n = 180) => String(v ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, n).trim().replace(/\.+$/, "");
function compose(fields){
  const f = {}; FIELDS.forEach(k => { f[k] = clean(fields[k]); });
  const age = Math.max(MIN_AGE, Math.min(MAX_AGE, parseInt(fields.age, 10) || MIN_AGE));
  const garment = f.garment.replace(/^(a |an )?deep[ -]v[ -]neck(ed)?\s+/i, "");
  const opt = v => (!v || v.toLowerCase().startsWith("no ")) ? "" : v;
  const cap = v => v.slice(0, 1).toUpperCase() + v.slice(1);
  const repl = Object.assign({}, f, {age: String(age), garment, time: cap(f.time),
    layer: (!f.layer || f.layer.toLowerCase().startsWith("no ")) ? "" : ` under ${f.layer}`,
    marks: opt(f.marks) ? "; " + f.marks : "", glasses: opt(f.glasses) ? "; " + f.glasses : ""});
  let t = A.master;
  for (const [k, v] of Object.entries(repl)) t = t.split("{" + k + "}").join(v);
  return t;
}
window.__gothAtlas = {
  load, ready: () => !!A, pick, compose, FIELDS,
  subgenres: () => (A ? A.subgenres.map(s => s.n) : []),
  categories: () => (A ? A.categories.map(c => c.n) : []),
  continents: () => (A ? [...new Set(A.cities.map(c => c[0]))] : []),
  stats: () => A ? {subgenres: A.subgenres.length, categories: A.categories.length,
    scenes: A.categories.reduce((n, c) => n + c.scenes.length, 0), cities: A.cities.length,
    countries: new Set(A.cities.map(c => c[1])).size} : {},
  ages: () => (A ? A.ages : []),
};
load().catch(() => {});
})();
