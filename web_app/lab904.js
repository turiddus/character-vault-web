/* Character Vault 9.0.4 — Photo Lab master prompts on the phone (same texts and composition as character_vault/lab.py;
 * the test suite checks that both produce identical prompts). The texts come from lab_masters.json. */
(function () {
"use strict";
let M = null, loading = null;
function loadMasters(){
  if (M) return Promise.resolve(M);
  if (!loading) loading = fetch("lab_masters.json").then(r => r.json()).then(j => (M = j)).catch(e => { loading = null; throw e; });
  return loading;
}
const clean = (t, n = 2000) => String(t || "").split(/\s+/).filter(Boolean).join(" ").slice(0, n);
const ordinal = n => ({1: "1st", 2: "2nd", 3: "3rd"})[n] || `${n}th`;
function targetText(index, count, note){
  note = clean(note, 300);
  if (note) return note;
  if (count <= 1) return "the main character of the reference image";
  return `the ${ordinal(index)} person from the left (of ${count} people in the reference image)`;
}
const need = () => { if (!M) throw new Error("Photo Lab prompts are still loading."); return M; };
const api = {
  load: loadMasters,
  ready: () => !!M,
  txt2img: text => need().txt2img.replace("{PROMPT}", clean(text) || M.defaults.txt2img),
  img2img: text => need().txt2img.replace("{PROMPT}", clean(text) || M.defaults.img2img),
  restore: note => { const n = clean(note, 600); return need().restore + (n ? `\n\nADDITIONAL NOTE: ${n}` : ""); },
  extract: (index, count, note) => need().extract.replace("{TARGET}", targetText(index, count, note)),
  genesis: spec => need().txt2img.replace("{PROMPT}", "an original fictional character (no real person's likeness) described in the CHARACTER SPECIFICATION below")
    + "\n\nCHARACTER SPECIFICATION:\n" + String(spec || "").trim(),
  targetText,
  MAX_EXTRACT: 8,
  LABELS: {txt2img: "Text → image", img2img: "Image → image (remaster)", restore: "Restore old photo", extract: "Extract characters"},
};
window.__cvLab = api;
loadMasters().catch(() => {});
})();
