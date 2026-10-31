/* Character Vault 9.1.0 — Image Studio prompts on the phone: same texts, presets and composition as character_vault/lab.py
 * (the test suite checks that both produce identical prompts). Texts: lab_masters.json · presets: lab_presets.json. */
(function () {
"use strict";
let M = null, P = null, IDX = null, loading = null;
function loadMasters(){
  if (M && P) return Promise.resolve(M);
  if (!loading) loading = Promise.all([fetch("lab_masters.json").then(r => r.json()), fetch("lab_presets.json").then(r => r.json())])
    .then(([m, p]) => { M = m; P = p; IDX = {};
      for (const c of p.categories) for (const x of c.presets) IDX[x.id] = Object.assign({}, x, {slot: c.slot, modes: c.modes, category: c.name});
      return M; })
    .catch(e => { loading = null; throw e; });
  return loading;
}
const SLOTS = ["framing", "camera", "light", "color", "focus"];
const ROLE_TEXT = {subject: "the same person (identity, face and body)", face: "use only the face and identity",
  outfit: "use only the clothing and accessories", background: "use only the location as the background",
  style: "use only its colors, light and photographic style", pose: "use only the body pose",
  object: "include this object, at a realistic scale"};
const ROLE_LABELS = {subject: "Subject", face: "Face", outfit: "Outfit", background: "Background", style: "Style", pose: "Pose", object: "Object"};
const FORMATS = [["portrait", "Vertical 9:16", "1152x2048"], ["portrait", "Vertical 2:3", "1024x1536"],
  ["landscape", "Horizontal 16:9", "2048x1152"], ["landscape", "Horizontal 3:2", "1536x1024"],
  ["square", "Square", "1024x1024"], ["square", "Square large", "1536x1536"]];
const clean = (t, n = 2000) => String(t || "").split(/\s+/).filter(Boolean).join(" ").slice(0, n);
const ordinal = n => ({1: "1st", 2: "2nd", 3: "3rd"})[n] || `${n}th`;
function targetText(index, count, note){
  note = clean(note, 300);
  if (note) return note;
  if (count <= 1) return "the main character of the reference image";
  return `the ${ordinal(index)} person from the left (of ${count} people in the reference image)`;
}
function orientation(size){
  const [w, h] = String(size || "").split("x").map(Number);
  if (!w || !h) return "portrait";
  return w > h ? "landscape" : w === h ? "square" : "portrait";
}
function rolesLine(roles, first){
  const parts = (roles || []).map((r, i) => `Image ${first + i} – ${ROLE_TEXT[r] || ROLE_TEXT.object}`);
  return parts.length ? "REFERENCES: " + parts.join("; ") + "." : "";
}
const need = () => { if (!M || !P) throw new Error("Image Studio prompts are still loading."); return M; };
let STYLE = "compact";
try { const s = localStorage.getItem("cv_lab_style"); if (s === "classic" || s === "compact") STYLE = s; } catch (_) {}
const rep = (s, a, b) => s.split(a).join(b);
function compose(mode, text, presetIds, o){
  o = o || {};
  const m = need();
  const st = o.style === "classic" || o.style === "compact" ? o.style : STYLE;
  const chosen = (presetIds || []).map(id => IDX[id]).filter(p => p && (!p.modes.length || p.modes.includes(mode)));
  const slots = Object.assign({}, m.slots, m.mode_slots[mode] || {});
  const picked = {}, extras = [], changes = [];
  for (const p of chosen){
    if (p.slot === "extra") extras.push(p.text);
    else if (p.slot === "change") changes.push(p.text);
    else picked[p.slot] = p.text;
  }
  Object.assign(slots, picked);
  const line = rolesLine(o.roles, mode === "txt2img" ? 1 : 2);
  if (line) extras.push(line);
  const user = clean(text);
  const index = o.index || 1, count = o.count || 1, note = o.note || "";
  if (st === "classic") return classic(mode, user, changes, picked, extras, index, count, note, o.size);
  let prompt = "";
  if (mode === "img2img") prompt = [user].concat(changes).filter(Boolean).join("; ") || m.defaults.img2img;
  else if (mode === "txt2img") prompt = user || m.defaults.txt2img;
  let out = rep(rep(m.styles.compact[mode], "{PROMPT}", prompt), "{TARGET}", targetText(index, count, note));
  for (const s of SLOTS) out = rep(out, "{" + s.toUpperCase() + "}", slots[s]);
  out = rep(out, "\n{EXTRA}", extras.length ? "\n" + extras.join("\n") : "");
  if (mode === "restore"){ const n = clean(note, 600); if (n) out += `\n\nADDITIONAL NOTE: ${n}`; }
  return out;
}
function classic(mode, user, changes, picked, extras, index, count, note, size){
  const m = M, c = m.styles.classic;
  let out;
  if (mode === "txt2img") out = rep(c.txt2img, "{PROMPT}", user || m.defaults.txt2img);
  else if (mode === "img2img") out = rep(c.txt2img, "{PROMPT}", [user].concat(changes).filter(Boolean).join("; ") || m.defaults.img2img_classic);
  else if (mode === "restore"){ out = c.restore; const n = clean(note, 600); if (n) out += `\n\nADDITIONAL NOTE: ${n}`; }
  else out = rep(c.extract, "{TARGET}", targetText(index, count, note));
  const ori = orientation(size);
  if (size && ori !== "portrait") out = rep(out, "9:16 vertical", ori === "landscape" ? "16:9 horizontal" : "1:1 square");
  const block = SLOTS.filter(s => s in picked).map(s => picked[s]).concat(extras);
  if (block.length) out += "\n\nSTYLE PRESETS (they override any conflicting instruction above):\n" + block.map(b => "- " + b).join("\n");
  return out;
}
const api = {
  load: loadMasters,
  ready: () => !!(M && P),
  compose,
  txt2img: (text, ids, o) => compose("txt2img", text, ids, o),
  img2img: (text, ids, o) => compose("img2img", text, ids, o),
  restore: (note, ids, o) => compose("restore", "", ids, Object.assign({}, o, {note})),
  extract: (index, count, note, ids, o) => compose("extract", "", ids, Object.assign({}, o, {index, count, note})),
  genesis: (spec, o) => compose("txt2img", "an original fictional character (no real person's likeness) described in the CHARACTER SPECIFICATION below", [], o)
    + "\n\nCHARACTER SPECIFICATION:\n" + String(spec || "").trim(),
  categories: mode => (P ? P.categories : []).filter(c => !c.modes.length || c.modes.includes(mode)),
  preset: id => IDX && IDX[id],
  style: () => STYLE,
  setStyle: s => { STYLE = s === "classic" ? "classic" : "compact"; try { localStorage.setItem("cv_lab_style", STYLE); } catch (_) {} },
  targetText, orientation, rolesLine,
  ROLE_LABELS, FORMATS, SLOTS,
  MAX_EXTRACT: 8,
  LABELS: {txt2img: "Text → image", img2img: "Image → image (edit / remaster)", restore: "Restore old photo", extract: "Extract characters"},
};
window.__cvLab = api;
loadMasters().catch(() => {});
})();
