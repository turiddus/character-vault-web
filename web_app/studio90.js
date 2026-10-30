/* Character Vault 9.0 — Studio tab on the phone (replaces the retired Catalog tab).
 *
 * Studio: characters with fewest images first, their coverage gaps and bible (computed on the PC), and — in the
 * Android app with an OpenAI key saved — a NEW IMAGE OF THE SAME CHARACTER: the app downloads up to 4 previews of the
 * character from Drive as references, calls GPT Image (/images/edits), shows the result and uploads it to the inbox
 * with the Drive property cv_character, so the PC joins it to that character after a face check.
 * Explore: the categories of the collection with a cover taken from your own images.
 */
(function () {
"use strict";
// Same presets and wording as character_vault/studio.py (checked by the test suite).
const PRESETS = [
  ["full_body", "Full body", "full-body shot, head to feet, both feet visible"],
  ["close_up", "Close-up portrait", "close-up portrait, head and shoulders, face sharply detailed"],
  ["profile", "Profile view", "side profile view, head turned 90 degrees"],
  ["three_quarter", "Three-quarter view", "three-quarter view"],
  ["back", "From behind", "seen from behind, looking back over the shoulder"],
  ["smiling", "Smiling", "genuine smile"],
  ["serious", "Serious", "serious, intense expression"],
  ["action", "Action pose", "dynamic action pose, natural motion"],
  ["sitting", "Sitting", "sitting naturally"],
  ["new_outfit", "New outfit", "a new outfit coherent with the character's style (different from the references)"],
  ["new_setting", "New setting", "a different, coherent environment"],
  ["night", "Night scene", "night scene with realistic practical lighting"],
];
const LABELS = {full_body: "Full body", close_up: "Close-up", medium: "Medium shot", front: "Front", three_quarter: "Three-quarter",
  profile: "Profile", back: "From behind", smiling: "Smiling", serious: "Serious", sad: "Sad", angry: "Angry", other: "Other expressions",
  new_outfit: "Second outfit"};
const SIZES = ["1024x1536", "1152x2048"];
const QUALITIES = ["low", "medium", "high", "xhigh", "max"];

function buildPrompt(entity, request, presets){
  const bible = (entity.bible || `${entity.name} · ${entity.type || ""}`).slice(0, 1500);
  const wanted = PRESETS.filter(p => presets.includes(p[0])).map(p => p[2]);
  if (request.trim()) wanted.push(request.trim());
  return "Create a NEW photograph of the SAME fictional character shown in the reference images. "
    + "Keep the identity exactly: face structure, eyes, skin tone, hair color and length, body type and distinctive "
    + "marks must match the references. Do not copy a reference image: new pose, framing and moment.\n"
    + `CHARACTER BIBLE: ${bible}\n`
    + `THIS IMAGE: ${wanted.length ? wanted.join("; ") : "a new natural moment of this character"}.\n`
    + "One character only. Photorealistic, real-world light and materials, natural anatomy, no text, logos or "
    + "watermarks, no collage or multiple views. If the references are drawn or rendered, keep their medium.";
}
function references(entity, n){
  const imgs = S.index.images.filter(it => it.e?.includes(entity.id) && it.mt !== "video" && (it.p || it.o));
  imgs.sort((a, b) => (b.fav - a.fav) || (b.r - a.r) || (b.dt < a.dt ? -1 : 1));
  return imgs.slice(0, n).map(it => it.p || it.o);
}
function ask(text){
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "gx-back";
    back.innerHTML = `<div class="gx-dialog" role="dialog"><p>${esc(text)}</p><div class="row"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">Create</button></div></div>`;
    const close = v => { back.remove(); resolve(v); };
    back.onclick = ev => { if (ev.target === back) close(false); };
    back.querySelector('[data-a="no"]').onclick = () => close(false);
    back.querySelector('[data-a="yes"]').onclick = () => close(true);
    document.body.appendChild(back);
  });
}
const canCreate = () => NATIVE && typeof window.CVNative.genesisPhoneStudio === "function";

function tabs(active){
  return `<div class="chips" style="padding-top:0"><button class="chip ${active === "studio" ? "on" : ""}" data-st="studio">Studio</button>
    <button class="chip ${active === "explore" ? "on" : ""}" data-st="explore">Explore</button></div>`;
}
function bindTabs(){ document.querySelectorAll("[data-st]").forEach(b => b.onclick = () => go(b.dataset.st === "explore" ? "#/studio/~explore" : "#/studio")); }

function renderList(){
  const q = norm(S.query);
  const list = S.index.entities.filter(e => !q || norm(e.name).includes(q)).sort((a, b) => (a.n - b.n) || a.name.localeCompare(b.name));
  mountPage(`${tabs("studio")}<div class="status"><span>${list.length} characters · fewest images first</span></div>
    <div class="list">${list.map(e => {
      const gaps = (e.cov?.m || []).length;
      return coverCard("s", e, `${e.n} images${gaps ? ` · ${gaps} gaps` : ""}${e.bible ? " · bible" : ""}`);
    }).join("") || '<div class="empty">No characters.</div>'}</div>`, "Studio");
  bindTabs(); bindCovers();
  document.querySelectorAll('[data-open^="s:"]').forEach(b => b.onclick = () => go(`#/studio/${encodeURIComponent(b.dataset.open.slice(2))}`));
}

function renderExplore(){
  const counts = new Map();
  for (const it of S.index.images) if (it.c) counts.set(it.c, (counts.get(it.c) || 0) + 1);
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const best = new Map();
  for (const it of S.index.images) {
    if (!it.c) continue;
    const cur = best.get(it.c);
    if (!cur || (it.fav - cur.fav) > 0 || (it.fav === cur.fav && it.r > cur.r)) best.set(it.c, it);
  }
  mountPage(`${tabs("explore")}<div class="sx-grid">${cats.map(([c, n]) => `<button class="sx-cat" data-cat="${esc(c)}">
      <img alt="" data-id="${esc(best.get(c)?.i || "")}"><span class="sx-shade"></span>
      <b>${esc(S.index.labels?.[c] || c)}</b><small>${n.toLocaleString("en-US")} ${n === 1 ? "item" : "items"}</small></button>`).join("")
      || '<div class="empty">Nothing to explore yet.</div>'}</div>`, "Explore");
  bindTabs();
  document.querySelectorAll(".sx-cat img[data-id]").forEach(img => img.dataset.id && io.observe(img));
  document.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { S.filters = {sort: S.filters?.sort, cat: b.dataset.cat}; save("cv_filters", S.filters); go("#/"); });
}

function renderDetail(id){
  const e = S.entById.get(id); if (!e) return go("#/studio");
  const cov = e.cov || {};
  const chips = [];
  for (const group of [cov.s || {}, cov.g || {}, cov.x || {}])
    for (const [k, n] of Object.entries(group).sort((a, b) => b[1] - a[1])) chips.push(`<span class="chip on">${esc(LABELS[k] || k)} · ${n}</span>`);
  if (cov.o != null) chips.push(`<span class="chip ${cov.o >= 2 ? "on" : ""}">Outfits · ${cov.o}</span>`);
  for (const k of cov.m || []) chips.push(`<button class="chip sx-miss" data-miss="${k}">Missing: ${esc(LABELS[k] || k)}</button>`);
  const refs = references(e, 4);
  const cover = S.byId.get(e.cover) || S.index.images.find(it => it.e?.includes(id));
  const q = load("cv_sx_quality", "low"), z = load("cv_sx_size", SIZES[0]);
  const st = canCreate() ? (() => { try { return JSON.parse(window.CVNative.genesisPhoneState()); } catch (x) { return null; } })() : null;
  mountPage(`<div class="section-title"><button class="icon-btn" onclick="history.back()">${ico("back")}</button><h2>${esc(e.name)}</h2></div>
    <div class="panel sx-head"><div class="ent"><div class="cv"><img alt="" data-id="${esc(cover?.i || "")}"></div></div>
      <div><b>${e.n} images</b><div class="muted">${esc(e.type || "")}${cov.a != null ? ` · ${cov.a} analyzed by Codex` : ""}</div>
      <div class="row"><button class="btn" id="sx-gallery">${ico("grid")} Gallery</button></div></div></div>
    <div class="panel"><h4>Coverage</h4><div class="chips sx-wrap">${chips.join("") || '<span class="muted">Coverage appears after the Codex analyses on the PC.</span>'}</div></div>
    <div class="panel"><h4>Character bible</h4><p class="muted sx-bible">${esc(e.bible || "No bible yet: write it in Character Studio on the PC (Codex).")}</p></div>
    <div class="panel" id="sx-new"><h4>New image of this character</h4>
      ${canCreate() ? `<p class="muted">The phone sends ${refs.length} image(s) of ${esc(e.name)} as references and the bible to GPT Image with your key;
        the image goes to the gallery and joins the character after the PC checks the face.</p>
      <div class="chips sx-wrap">${PRESETS.map(p => `<button class="chip" data-p="${p[0]}">${esc(p[1])}</button>`).join("")}</div>
      <input class="txt" id="sx-req" placeholder="Optional: anything else">
      <label class="muted">Quality</label><select id="sx-q">${QUALITIES.map(x => `<option value="${x}" ${x === q ? "selected" : ""}>${x.toUpperCase()}</option>`).join("")}</select>
      <label class="muted">Resolution</label><select id="sx-z">${SIZES.map(x => `<option value="${x}" ${x === z ? "selected" : ""}>${x.replace("x", " × ")}</option>`).join("")}</select>
      <div class="muted" id="sx-est"></div>
      <div class="row"><button class="btn primary" id="sx-go" ${!refs.length || !st?.has_key ? "disabled" : ""}>${ico("image")} Create (paid)</button></div>
      <div class="muted" id="sx-state">${!st?.has_key ? "Save your OpenAI key in Genesis › Create on this phone first." : !refs.length ? "No preview of this character on Drive yet." : ""}</div>`
      : `<p class="muted">Available in the Android app with an OpenAI key (Genesis › Create on this phone), or in Character Studio on the PC.</p>`}</div>`, e.name);
  document.querySelectorAll(".sx-head img[data-id]").forEach(img => img.dataset.id && io.observe(img));
  $("#sx-gallery").onclick = () => go(`#/person/${encodeURIComponent(id)}`);
  if (!canCreate()) return;
  const chosen = new Set();
  document.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { b.classList.toggle("on"); b.classList.contains("on") ? chosen.add(b.dataset.p) : chosen.delete(b.dataset.p); });
  document.querySelectorAll("[data-miss]").forEach(b => b.onclick = () => { const p = document.querySelector(`[data-p="${b.dataset.miss}"]`); if (p && !p.classList.contains("on")) p.click(); });
  const estimate = () => {
    const s2 = st || {}, quality = $("#sx-q").value, size = $("#sx-z").value;
    const cost = Number(s2.prices?.["gpt-image-2.5-flare"]?.[size]?.[quality]);
    $("#sx-est").textContent = Number.isFinite(cost) ? `≈ $${cost.toFixed(4)} + reference images · budget left $${Number(s2.remaining || 0).toFixed(3)}` : "";
    return cost;
  };
  $("#sx-q").onchange = ev => { save("cv_sx_quality", ev.target.value); estimate(); };
  $("#sx-z").onchange = ev => { save("cv_sx_size", ev.target.value); estimate(); };
  estimate();
  $("#sx-go").onclick = async () => {
    const quality = $("#sx-q").value, size = $("#sx-z").value, cost = estimate();
    if (!await ask(`Create a ${quality.toUpperCase()} image of ${e.name} with ${refs.length} reference image(s)? Paid OpenAI request (≈ $${(cost || 0).toFixed(4)} + references).`)) return;
    const prompt = buildPrompt(e, $("#sx-req").value || "", [...chosen]);
    const err = window.CVNative.genesisPhoneStudio("gpt-image-2.5-flare", quality, size, prompt, true, id, JSON.stringify(refs));
    if (err) { toast(err, 6000); return; }
    $("#sx-go").disabled = true;
    $("#sx-state").textContent = "Downloading the references and creating the image… (20 s – 3 min, keep the app open)";
  };
}

window.renderStudio = function (arg){
  if (arg === "~explore") return renderExplore();
  if (arg) return renderDetail(decodeURIComponent(arg));
  return renderList();
};

const previous = window.__cvGenesisPhone;
window.__cvGenesisPhone = function (raw){
  let ev = {}; try { ev = JSON.parse(raw); } catch (x) {}
  if (previous) previous(raw);
  if (S.view !== "studio" || !ev.entity) return;
  const state = $("#sx-state"), go_ = $("#sx-go");
  if (ev.type === "generated") {
    if (state) state.textContent = "Created and sent: the PC adds it to the character after the face check.";
    const back = document.createElement("div");
    back.className = "gp-viewer";
    back.innerHTML = `<img src="/genesis-phone/${encodeURIComponent(ev.name)}" alt=""><button class="btn" aria-label="Close">✕</button>`;
    back.onclick = () => back.remove();
    document.body.appendChild(back);
  } else if (state && (ev.type === "failed" || ev.type === "uncertain")) state.textContent = (ev.message || ev.type);
  if (go_ && ev.type !== "sending") go_.disabled = false;
};
window.__cvStudio90 = {PRESETS, buildPrompt, references};
})();
