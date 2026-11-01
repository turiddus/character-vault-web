/* Goth Vault 1.1 — Goth Atlas 3 on the phone: same database (+ the learned additions published by the PC in the index)
 * and same prompt wording as character_vault/goth_atlas.py (compose() is checked for identical output by the tests). */
(function () {
"use strict";
let B = null, A = null, learnedSig = "", loading = null;
const MIN_AGE = 18, MAX_AGE = 70;
const SUBJECTS = ["woman", "man", "couple_mf", "couple_ff"];
const SUBJECT_LABELS = {woman: "Woman", man: "Man", couple_mf: "Couple · man & woman", couple_ff: "Couple · two women"};
const DEFAULT_MIX = {woman: 50, man: 20, couple_mf: 15, couple_ff: 15};
const SCENE_KEYS = ["city", "country", "setting", "district", "action", "detail", "crowd", "time", "season", "weather",
  "phone", "angle", "light", "imp1", "imp2", "pose", "prop"];
const PERSON_W = ["age", "skin", "body", "face", "haircolor", "hair", "makeup", "marks", "glasses", "nails", "emotion",
  "expression", "garment", "gdetail", "layer", "legwear", "footwear", "accessory", "palette", "subgenre"];
const PERSON_M = ["age", "skin", "body", "face", "haircolor", "hair", "facial_hair", "makeup", "marks", "glasses", "emotion",
  "expression", "garment", "layer", "footwear", "accessory", "palette", "subgenre"];
const COUPLE_KEYS = ["city", "country", "setting", "district", "couple_action", "detail", "crowd", "time", "season", "weather",
  "couple_mood", "relationship", "framing", "phone", "angle", "light", "imp1", "imp2"];
const STOP = new Set(("a an the in on at of with and to for from by near into onto over under around her his their she he " +
  "they is are it its this that some small little big large old new local neighbourhood neighborhood ordinary everyday " +
  "quiet busy late early just one two very while during after before inside outside").split(" "));
const SYN = {shop: "store", laundrette: "laundromat", coffeehouse: "cafe", coffeeshop: "cafe", evening: "night",
  nighttime: "night", midnight: "night", grocery: "supermarket", flat: "apartment", pub: "bar", tavern: "bar",
  train: "rail", railway: "rail", tram: "rail", subway: "metro", underground: "metro"};
function concept(text){
  const t = String(text ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const out = new Set();
  for (let w of t.replace(/[^a-z]+/g, " ").split(" ").filter(Boolean)) {
    w = SYN[w] || w;
    if (STOP.has(w) || w.length < 3) continue;
    if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "y";
    else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
    else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
    w = SYN[w] || w;
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}
function similar(a, b, threshold = 0.75){
  const A = a instanceof Set ? a : concept(a), B = b instanceof Set ? b : concept(b);
  if (!A.size || !B.size) return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
  const jac = inter / (A.size + B.size - inter), small = Math.min(A.size, B.size);
  return jac >= threshold || (small >= 2 && inter === small && jac >= 0.6);
}
const RISKY = /(fishnet|stocking|thigh[- ]high|garter|corset|bodice|slit|sheer|mesh|lace overlay|bare|shirtless|bralette|cleavage|low[- ]cut|bodycon|mini\b|tube dress|halter|backless|strapless|wiggle|hips|leaning|crouch|bed\b|bedroom|pillow|sheets|bath|shower|towel|lingerie|sleeveless|tank)/i;
const SAFE_LINE = "Everyday street style: clothing fully covers the body apart from the V neckline (worn over an opaque lining); relaxed, non-suggestive candid moment.";
function safe(items, riskyOk){ if (riskyOk) return ch(items); const ok = items.filter(x => !RISKY.test(x)); return ch(ok.length ? ok : items); }
function load(){
  if (B) return Promise.resolve(atlas());
  if (!loading) loading = fetch("goth_atlas.json").then(r => r.json()).then(j => { B = j; return atlas(); }).catch(e => { loading = null; throw e; });
  return loading;
}
const copy = o => JSON.parse(JSON.stringify(o));
function merge(b, ln){
  const a = copy(b); ln = ln || {};
  const cats = {}; a.categories.forEach(c => { cats[c.n] = c; });
  for (const [cat, scenes] of Object.entries(ln.scenes || {})) { if (!cats[cat]) { cats[cat] = {n: cat, scenes: []}; a.categories.push(cats[cat]); } cats[cat].scenes.push(...scenes); }
  const subs = {}; a.subgenres.forEach(s => { subs[s.n] = s; });
  for (const [n, items] of Object.entries(ln.garments || {})) if (subs[n]) subs[n].g = subs[n].g.concat(items);
  for (const [n, items] of Object.entries(ln.accessories || {})) if (subs[n]) subs[n].a = subs[n].a.concat(items);
  const fams = {}; a.men.families.forEach(f => { fams[f.n] = f; });
  for (const [n, items] of Object.entries(ln.garments_m || {})) if (fams[n]) fams[n].g = fams[n].g.concat(items);
  a.couples.actions = a.couples.actions.concat(ln.couple_actions || []);
  const known = new Set(a.cities.map(c => c[1] + "|" + c[2]));
  a.cities = a.cities.concat((ln.cities || []).filter(c => !known.has(c[1] + "|" + c[2])));
  return a;
}
function atlas(){
  const ln = (typeof S !== "undefined" && S.index && S.index.goth && S.index.goth.learned) || window.__gothLearned || {};
  const sig = JSON.stringify(ln).length + ":" + Object.keys(ln).length;
  if (!A || sig !== learnedSig) { A = merge(B, ln); learnedSig = sig; }
  return A;
}
const rnd = n => Math.floor(Math.random() * n);
const ch = arr => arr[rnd(arr.length)];
function shuffle(a){ for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function leastUsed(items, key, recent, k){
  const used = {}; (recent || []).forEach(x => { used[x] = (used[x] || 0) + 1; });
  const pool = shuffle(items.slice()).sort((a, b) => (used[key(a)] || 0) - (used[key(b)] || 0));
  return ch(pool.slice(0, Math.max(1, Math.min(k || 6, pool.length))));
}
function chooseSubject(f, mix){
  if (SUBJECTS.includes(f.subject)) return f.subject;
  const m = {}; let tot = 0;
  SUBJECTS.forEach(k => { m[k] = Math.max(0, Number((mix || DEFAULT_MIX)[k] || 0)); tot += m[k]; });
  if (!tot) { Object.assign(m, DEFAULT_MIX); tot = 100; }
  let x = Math.random() * tot;
  for (const k of SUBJECTS) { if ((x -= m[k]) < 0) return k; }
  return "woman";
}
function age(f, near){
  const a = atlas();
  let [lo, hi] = /^\d+$/.test(String(f.age_band ?? "")) ? a.ages[Number(f.age_band)] : [MIN_AGE, MAX_AGE];
  if (near != null) { lo = Math.max(MIN_AGE, near - 12); hi = Math.min(MAX_AGE, near + 12); }
  return lo + rnd(hi - lo + 1);
}
function family(sub){ const fams = {}; atlas().men.families.forEach(f => { fams[f.n] = f; }); return fams[sub.fam || "casual"] || fams.casual; }
function person(kind, sub, f, near){
  const a = atlas(), P = a.pools, ag = age(f, near), young = ag <= 24;
  const ch = items => safe(items, !young);
  const c = {age: ag, skin: safe(P.skin, true), face: ch(P.face), haircolor: ch(P.haircolor), marks: ch(P.marks),
    glasses: ch(P.glasses), emotion: ch(P.emotion), expression: ch(P.expression), palette: ch(sub.p), subgenre: sub.n};
  if (kind === "man") { const fam = family(sub), M = a.men;
    return Object.assign(c, {body: ch(M.body), hair: ch(M.hair), facial_hair: ch(M.facial_hair), makeup: ch(M.makeup),
      garment: ch(fam.g), layer: ch(fam.l), footwear: ch(fam.f), accessory: ch(fam.a)}); }
  return Object.assign(c, {body: ch(P.body), hair: ch(P.hair), makeup: ch(P.makeup), nails: ch(P.nails), garment: ch(sub.g),
    gdetail: ch(P.gdetail), layer: ch(P.layer), legwear: ch(P.legwear), footwear: ch(P.footwear), accessory: ch(sub.a)});
}
function pick(filters, recent, mix){
  const f = filters || {}, r = recent || {}, a = atlas(), P = a.pools;
  const subject = chooseSubject(f, mix);
  let subs = a.subgenres.filter(s => !f.subgenre || s.n === f.subgenre); if (!subs.length) subs = a.subgenres;
  const sub = leastUsed(subs, s => s.n, r.subgenre, 6);
  let cats = a.categories.filter(c => c.scenes.length && (!f.category || c.n === f.category)); if (!cats.length) cats = a.categories.filter(c => c.scenes.length);
  const cat = leastUsed(cats, c => c.n, r.category, 8);
  const rc = (r.setting || []).slice(0, 30).map(concept);
  const fresh = rc.length ? cat.scenes.filter(sc => { const c = concept(sc.s); return !rc.some(x => similar(c, x)); }) : [];
  const scene = ch(fresh.length ? fresh : cat.scenes);
  let cs = a.cities.filter(c => (!f.continent || c[0] === f.continent) && (!f.country || c[1] === f.country)); if (!cs.length) cs = a.cities;
  const city = leastUsed(cs, c => c[2], r.city, 40);
  const imps = shuffle(P.imp.slice()).slice(0, 2);
  const sf = {subject, category: cat.n, continent: city[0], country: city[1], city: city[2], setting: scene.s, district: ch(P.district),
    detail: scene.d, crowd: ch(P.crowd), time: ch(P.time), season: ch(P.season), weather: ch(P.weather), phone: ch(P.phone),
    angle: ch(P.angle), light: ch(scene.i ? P.light_in : P.light_out), imp1: imps[0], imp2: imps[1], source: "database"};
  if (subject === "woman" || subject === "man") {
    const pr = person(subject, sub, f);
    return Object.assign(sf, {action: ch(scene.a), pose: safe(P.pose, pr.age > 24), prop: Math.random() < 0.5 ? ch(P.prop) : ""}, pr);
  }
  const C = a.couples, aKind = subject === "couple_mf" ? "man" : "woman";
  const subB = leastUsed(subs, s => s.n, (r.subgenre || []).concat([sub.n, sub.n, sub.n]), 6);
  const pa = person(aKind, sub, f), pb = person("woman", subB, f, pa.age);
  const act = Math.random() < 0.6 ? ch(scene.a) + " together" : ch(C.actions);
  return Object.assign(sf, {couple_action: act, couple_mood: ch(C.mood), relationship: ch(C.relationship), framing: ch(C.framing),
    person_a: pa, person_b: pb, subgenre: sub.n, age: pa.age});
}
const clean = (v, n = 180) => String(v ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, n).trim().replace(/\.+$/, "");
const opt = v => (!v || v.toLowerCase().startsWith("no ")) ? "" : v;
const stripV = g => g.replace(/^(a |an )?deep[ -]v[ -]neck(ed)?\s+/i, "");
const ageOf = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(MIN_AGE, Math.min(MAX_AGE, n)) : MIN_AGE; };
const cap = v => v.slice(0, 1).toUpperCase() + v.slice(1);
function pronouns(text, who){
  if (who === "woman") return text;
  const m = who === "man" ? {she: "he", her: "his", hers: "his", herself: "himself"} : {she: "they", her: "their", hers: "theirs", herself: "themselves"};
  return text.replace(/\b(she|her|hers|herself)\b/gi, x => m[x.toLowerCase()]);
}
function fill(t, repl){ for (const [k, v] of Object.entries(repl)) t = t.split("{" + k + "}").join(v); return t; }
function common(f){
  return {time: cap(f.time), season: f.season || "an ordinary season", crowd: f.crowd || "nobody else around",
    marks: opt(f.marks) ? "; " + f.marks : "", glasses: opt(f.glasses) ? "; " + f.glasses : "",
    layer: !opt(f.layer) ? "" : ` under ${f.layer}`, prop: f.prop ? `, with ${f.prop}` : "", pose: f.pose || "standing naturally"};
}
function personLine(p, kind, label){
  let q = {}; [...new Set(PERSON_W.concat(PERSON_M))].forEach(k => { q[k] = clean(p[k]); });
  if (kind === "man") { const r = {}; for (const [k, v] of Object.entries(q)) r[k] = pronouns(v, "man"); q = r; }
  const a = ageOf(p.age);
  const extra = (opt(q.marks) ? "; " + q.marks : "") + (opt(q.glasses) ? "; " + q.glasses : "");
  const layer = opt(q.layer) ? ` under ${q.layer}` : "";
  if (kind === "man") return `${label}: adult man, age ${a}, ${q.subgenre} style; ${q.skin}, ${q.body}, ${q.face}; ${q.haircolor} hair, ${q.hair}; ${q.facial_hair}; ${q.makeup}${extra}; wearing ${q.garment}${layer}, ${q.footwear}, ${q.accessory}; colours ${q.palette}; ${q.expression}.`;
  return `${label}: adult woman, age ${a}, ${q.subgenre} style; ${q.skin}, ${q.body}, ${q.face}; ${q.haircolor} hair, ${q.hair}; ${q.makeup}${extra}; wearing a deep V-neck ${stripV(q.garment)}${q.gdetail ? " with " + q.gdetail : ""}${layer}, ${q.legwear}, ${q.footwear}, ${q.accessory}; colours ${q.palette}; ${q.expression}.`;
}
function soften(fields){
  const a = atlas(), P = a.pools, f = copy(fields), subs = {};
  a.subgenres.forEach(s => { subs[s.n] = s; });
  const fix = (p, kind) => {
    const sub = subs[p.subgenre] || ch(a.subgenres);
    if (kind === "man") { const fam = family(sub);
      [["garment", fam.g], ["layer", fam.l], ["accessory", fam.a]].forEach(([k, items]) => { if (RISKY.test(String(p[k] || ""))) p[k] = safe(items, false); });
    } else {
      [["garment", sub.g], ["gdetail", P.gdetail], ["layer", P.layer], ["legwear", P.legwear], ["accessory", sub.a]].forEach(([k, items]) => { if (RISKY.test(String(p[k] || ""))) p[k] = safe(items, false); });
      if (!opt(String(p.layer || ""))) p.layer = safe(P.layer.filter(x => opt(x)), false);
    }
  };
  const subject = f.subject || "woman";
  if (subject.startsWith("couple")) { f.person_a = f.person_a || {}; f.person_b = f.person_b || {}; fix(f.person_a, subject === "couple_mf" ? "man" : "woman"); fix(f.person_b, "woman"); }
  else { fix(f, subject); if (RISKY.test(String(f.pose || ""))) f.pose = safe(P.pose, false); }
  if (["setting", "detail", "action", "couple_action"].some(k => RISKY.test(String(f[k] || "")))) {
    const ok = []; a.categories.forEach(c => c.scenes.forEach(sc => { if (!RISKY.test(sc.s + " " + sc.d + " " + sc.a.join(" "))) ok.push([c, sc]); }));
    const [c, sc] = ch(ok); f.category = c.n; f.setting = sc.s; f.detail = sc.d;
    if (subject.startsWith("couple")) f.couple_action = safe(sc.a, false) + " together"; else f.action = safe(sc.a, false);
  }
  f.soft = true;
  return f;
}
function young(fields){
  return [fields.age, (fields.person_a || {}).age, (fields.person_b || {}).age].some(x => x !== undefined && x !== null && x !== "" && ageOf(x) <= 24);
}
function compose(fields){
  let t = compose_(fields);
  if (fields.soft || young(fields)) t = t.replace("\nCONSTRAINTS: ", "\n" + SAFE_LINE + "\nCONSTRAINTS: ");
  return t;
}
function compose_(fields){
  const a = atlas(), subject = fields.subject || "woman";
  if (subject === "couple_mf" || subject === "couple_ff") {
    const f = {}; COUPLE_KEYS.forEach(k => { f[k] = pronouns(clean(fields[k]), "couple"); });
    const c = common(Object.assign({}, f, {marks: "", glasses: "", layer: "", prop: "", pose: "x"}));
    const [la, lb] = subject === "couple_mf" ? ["MAN", "WOMAN"] : ["WOMAN 1", "WOMAN 2"];
    return fill(a.master_couple, Object.assign({}, f, {time: c.time, season: c.season, crowd: c.crowd,
      couple_kind: subject === "couple_mf" ? "a man and a woman" : "two women",
      person_a: personLine(fields.person_a || {}, subject === "couple_mf" ? "man" : "woman", la),
      person_b: personLine(fields.person_b || {}, "woman", lb)}));
  }
  const keys = [...new Set(SCENE_KEYS.concat(subject === "man" ? PERSON_M : PERSON_W))];
  const f = {}; keys.forEach(k => { f[k] = pronouns(clean(fields[k]), subject); });
  const repl = Object.assign({}, f, common(f), {age: String(ageOf(fields.age))});
  if (subject === "man") return fill(a.master_man, repl);
  repl.garment = stripV(f.garment); repl.gdetail = f.gdetail || "a simple neckline trim";
  return fill(a.master, repl);
}
window.__gothAtlas = {
  load, ready: () => !!B, pick, compose, merge, concept, similar, soften, SUBJECTS, SUBJECT_LABELS, DEFAULT_MIX,
  subgenres: () => (B ? atlas().subgenres.map(s => s.n) : []),
  categories: () => (B ? atlas().categories.map(c => c.n) : []),
  continents: () => (B ? [...new Set(atlas().cities.map(c => c[0]))] : []),
  stats: () => { if (!B) return {}; const a = atlas(); return {subgenres: a.subgenres.length, categories: a.categories.length,
    scenes: a.categories.reduce((n, c) => n + c.scenes.length, 0), cities: a.cities.length, countries: new Set(a.cities.map(c => c[1])).size,
    women_garments: a.subgenres.reduce((n, s) => n + s.g.length, 0), men_garments: a.men.families.reduce((n, f) => n + f.g.length, 0),
    couple_actions: a.couples.actions.length}; },
  ages: () => (B ? atlas().ages : []),
};
load().catch(() => {});
})();
