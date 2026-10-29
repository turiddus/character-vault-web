/* Character Vault 8.3 — Genesis on the phone with the Genesis DNA engine.
 *
 * The OpenAI key is saved by the native app (Android Keystore) and never comes back to this page. The character is
 * picked by the Genesis DNA engine (genesis_dna.js, twin of the desktop engine) against the SHARED memory on Drive
 * (folder Genesis_DNA: one file per device and month, dna_<device>_<YYYY-MM>.jsonl.gz), so the phone avoids what the
 * PC created and vice versa, and avoids the genes of images that the PC found visually too similar.
 * The image is uploaded to the Drive inbox like a phone photo; the PC imports it and Codex catalogs it.
 */
(function () {
"use strict";
const MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const QUALITIES = ["low", "medium", "high", "xhigh", "max"];
const SIZES = ["1152x2048", "1024x1536"];
// Identical to character_vault/genesis/director.py MASTER (checked by the test suite).
const MASTER = `UNIVERSAL RANDOM CHARACTER GENESIS / PHOTOGRAPHIC MASTER
Make ONE fully original adult or age-ambiguous fictional person or creature with no supplied image reference.
No existing celebrity, named copyrighted character, or recognizable real person likeness.
One coherent individual, head to feet with both feet visible, 9:16 frame. No multi-view sheets, no duplicates,
no overlays, logos, graphics or watermarks. Real-world light, real-world fabric and surface physics; realistic skin,
hair, scales, metal or other material where suitable. Studio-quality realism, not a CGI/video-game/illustrated look.
Distinctive anatomy and everyday imperfections; no automatic beautification, no stereotyped heroic proportions.
Natural body pose, allow asymmetry and varied stances rather than mannequin default. Both eyes gaze into the
camera lens IF the subject has two forward-pointing eyes; otherwise adapt gaze naturally to anatomy.
Choose a coherent lived-in environment contextual to the figure with naturally clear detail throughout;
soft realistic light, physical contact, grounded shadows. 85mm-equivalent framing if appropriate, sufficient
distance for entire figure, high depth of field without artificial blur. No stylization, cinematic grading,
exaggerated HDR or fantasy VFX. Fictional fantastical subjects must appear physically photographed.
Enforce 1 primary character only, natural proportions and credible anatomy. Do not crop extremities.
`;
function buildPrompt(spec){ return MASTER + "\nCHARACTER SPECIFICATION:\n" + spec.trim(); }

/* ------------------------------------------------------------------ shared memory (Drive folder Genesis_DNA) */
const MEM = {pack: null, folder: "", remote: [], loaded: false, syncing: false, error: "", ownMerged: {}};
function deviceId(){
  let id = localStorage.getItem("cv_dna_device");
  if (!/^phone-[0-9a-f]{6}$/.test(id || "")) { id = "phone-" + GenesisDNA.randomSeed().slice(0, 6); localStorage.setItem("cv_dna_device", id); }
  return id;
}
function month(){ return new Date().toISOString().slice(0, 7); }
function ownKey(m){ return "cv_dna_own_" + (m || month()); }
function ownLines(m){ try { return JSON.parse(localStorage.getItem(ownKey(m)) || "[]"); } catch (e) { return []; } }
function saveOwn(lines, m){ try { localStorage.setItem(ownKey(m), JSON.stringify(lines)); } catch (e) {} }
function ownName(m){ return `dna_${deviceId()}_${m || month()}.jsonl.gz`; }
async function loadPack(){
  if (!MEM.pack) MEM.pack = await (await fetch("genesis_dna_v1.json")).json();
  return MEM.pack;
}
function allLines(){
  const out = [], seen = new Set();
  const add = l => { const k = JSON.stringify(l); if (!seen.has(k)) { seen.add(k); out.push(l); } };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("cv_dna_own_")) ownLines(k.slice(11)).forEach(add);
  }
  MEM.remote.forEach(add);
  return out;
}
function records(){ return GenesisDNA.merge(allLines()); }
async function gzipText(text){
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}
async function gunzipText(buf){
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
function parseLines(text){ return text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); }
async function memFolder(){
  if (MEM.folder) return MEM.folder;
  const root = rootId(); if (!root) throw new Error("archive not selected");
  const found = await children(root, "Genesis_DNA", true, true);
  if (found.length) return (MEM.folder = found[0].id);
  const made = await apiJson(`${API}/files?supportsAllDrives=true&fields=id`, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({name: "Genesis_DNA", parents: [root], mimeType: "application/vnd.google-apps.folder"})});
  return (MEM.folder = made.id);
}
async function listMem(folder){
  const p = new URLSearchParams({q: `'${folder}' in parents and trashed=false`, fields: "files(id,name,modifiedTime,size)", pageSize: "1000",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true"});
  return ((await apiJson(`${API}/files?${p}`, {cache: "no-store"})).files || []).filter(f => /^dna_.+\.jsonl\.gz$/.test(f.name));
}
async function syncMemory(upload){
  if (MEM.syncing || !NATIVE) return;
  MEM.syncing = true;
  try {
    const folder = await memFolder(), files = await listMem(folder), mine = `dna_${deviceId()}_`, m = month();
    const remote = [];
    for (const f of files) {
      const lines = parseLines(await gunzipText(await media(f.id)));
      if (f.name.startsWith(mine)) {
        // This phone's own month on Drive (e.g. after reinstalling): merge it into the local copy once.
        const mm = f.name.slice(mine.length, mine.length + 7);
        if (!MEM.ownMerged[mm]) {
          const local = ownLines(mm), seen = new Set(local.map(l => JSON.stringify(l)));
          for (const l of lines) if (!seen.has(JSON.stringify(l))) local.push(l);
          saveOwn(local, mm); MEM.ownMerged[mm] = f.id;
        }
      } else remote.push(...lines);
    }
    MEM.remote = remote; MEM.loaded = true; MEM.error = "";
    if (upload) {
      const own = ownLines(m);
      if (own.length) {
        const blob = await gzipText(own.map(l => JSON.stringify(l)).join("\n") + "\n");
        const existing = files.find(f => f.name === ownName(m));
        if (existing) await api(`${UPLOAD}/files/${existing.id}?uploadType=media&supportsAllDrives=true`, {method: "PATCH", headers: {"Content-Type": "application/gzip"}, body: blob});
        else { const r = await uploadSmall(new Blob([blob], {type: "application/gzip"}), ownName(m), folder); MEM.ownMerged[m] = r.id; }
      }
    }
  } catch (e) { MEM.error = e.message || String(e); }
  finally { MEM.syncing = false; }
}
function remember(line){ const m = month(), own = ownLines(m); own.push(line); saveOwn(own, m); }
function memoryText(){
  const recs = records(), by = {phone: 0, pc: 0};
  let verified = 0, dup = 0;
  for (const r of recs) { by[r.src] = (by[r.src] || 0) + 1; if (r.verdict) verified++; if (r.dup) dup++; }
  let t = `Shared memory: ${recs.length} characters (phone ${by.phone || 0} · PC ${by.pc || 0})`;
  if (verified) t += ` · PC visual check: ${verified} verified, ${dup} too similar`;
  if (!MEM.loaded) t += MEM.error ? ` · Drive: ${MEM.error}` : " · syncing with Drive…";
  return t;
}

/* ------------------------------------------------------------------ page */
const P = {state: null, started: 0, timer: null, dna: null, spec: ""};
const hasBridge = () => NATIVE && typeof window.CVNative.genesisPhoneState === "function";
function readState(){
  try { P.state = JSON.parse(window.CVNative.genesisPhoneState()); } catch (e) { P.state = null; }
  return P.state;
}
const usd = (v, d = 3) => "$" + Number(v || 0).toFixed(d);
function selected(){
  return {model: $("#gp-model")?.value || MODELS[0], quality: $("#gp-quality")?.value || "low", size: $("#gp-size")?.value || SIZES[0]};
}
function estimate(){
  const st = P.state, s = selected();
  const cost = Number(st?.prices?.[s.model]?.[s.size]?.[s.quality]);
  return Number.isFinite(cost) ? cost : null;
}
function newCharacter(){
  const pack = MEM.pack; if (!pack) return;
  try {
    P.dna = GenesisDNA.sample(pack, records(), {kind: $("#gp-kind")?.value || null, world: $("#gp-world")?.value || null});
  } catch (e) { toast(e.message, 5000); return; }
  P.spec = GenesisDNA.specText(pack, GenesisDNA.render(pack, P.dna));
  const box = $("#gp-spec"); if (box) box.value = P.spec;
  paintDna();
}
function paintDna(){
  const s = $("#gp-dna"); if (!s || !P.dna) return;
  const nn = P.dna.nn;
  s.innerHTML = `<b>${esc(GenesisDNA.summary(P.dna))}</b><span class="muted"> · ${nn >= 0.999 ? "first of its kind" : "difference from the closest earlier character " + Math.round(nn * 100) + "%"}</span>`;
  const mem = $("#gp-mem"); if (mem) mem.textContent = memoryText();
}
function paintPhone(){
  const st = readState(), box = $("#gp-panel");
  if (!box || !st) return;
  $("#gp-keystate").textContent = st.has_key ? "OpenAI key saved on this phone ✓ (encrypted by Android)" : "No OpenAI key on this phone yet.";
  $("#gp-key").placeholder = st.has_key ? "Enter a new key to replace it" : "sk-…";
  $("#gp-clearkey").disabled = !st.has_key;
  $("#gp-money").textContent = `Budget left ${usd(st.remaining)} of ${usd(st.budget, 2)} · today ${usd(st.today_remaining)} of ${usd(st.daily, 2)} · spent ${usd(st.spent)} · ${st.generated} images`;
  const cost = estimate(), reserve = cost == null ? null : cost * (st.margin || 1.25);
  const left = Math.min(Number(st.remaining || 0), Number(st.today_remaining || 0));
  $("#gp-estimate").textContent = cost == null ? "" : `This image ≈ ${usd(cost, 4)} (reserved ${usd(reserve, 4)}) · you can still create ${reserve > 0 ? Math.floor(left / reserve) : 0} with this setting.`;
  const busy = !!st.busy;
  $("#gp-go").disabled = busy || !st.has_key || !!(st.uncertain && st.uncertain.id) || !P.dna;
  $("#gp-go").innerHTML = busy ? "Creating…" : `${ico("image")} Create on this phone`;
  const prog = $("#gp-progress");
  if (busy) {
    if (!P.started) P.started = Date.now();
    prog.hidden = false;
    prog.textContent = `Creating the image… ${Math.floor((Date.now() - P.started) / 1000)} s (usually 20 s–3 min). Keep Character Vault open.`;
    if (!P.timer) P.timer = setInterval(() => { if (S.view !== "genesis") { clearInterval(P.timer); P.timer = null; return; } paintPhone(); }, 1000);
  } else {
    P.started = 0; prog.hidden = true;
    if (P.timer) { clearInterval(P.timer); P.timer = null; }
  }
  const u = st.uncertain, ub = $("#gp-uncertain");
  if (u && u.id) {
    ub.hidden = false;
    ub.innerHTML = `<b>Uncertain request</b><p class="muted">${esc(u.error || "")} Reserved ${usd(u.reserve, 4)}. Check platform.openai.com › Usage, then choose. New requests are blocked until then.</p>
      <div class="row"><button class="btn" data-r="1">It was charged</button><button class="btn" data-r="0">Not charged</button></div>`;
    ub.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { window.CVNative.genesisPhoneReconcile(u.id, b.dataset.r === "1"); paintPhone(); });
  } else ub.hidden = true;
  const list = $("#gp-results");
  const items = (st.items || []).filter(x => x.file);
  list.innerHTML = items.length ? items.map(x => {
    const up = x.upload === "sent" ? "In the gallery queue ✓" : x.upload === "sending" ? "Sending…" : x.upload === "failed" ? "Not sent: " + (x.upload_error || "error") : "Not sent yet";
    return `<div class="gp-item" data-f="${esc(x.file)}"><img loading="lazy" src="/genesis-phone/${encodeURIComponent(x.file)}" alt="">
      <div class="gp-meta"><b>${esc(x.quality.toUpperCase())} · ${esc(x.size.replace("x", "×"))}</b><span class="muted">${usd(x.cost, 4)}${x.measured ? "" : " (estimate)"} · ${esc(up)}</span>
      <div class="row">${x.upload === "sent" ? "" : `<button class="btn" data-a="send">Send to gallery</button>`}<button class="btn" data-a="save">${ico("download")}</button><button class="btn" data-a="del">Remove</button></div></div></div>`;
  }).join("") : `<p class="muted">Images you create here appear in this list and, once sent, in the gallery after the PC imports them.</p>`;
  list.querySelectorAll(".gp-item").forEach(node => {
    const f = node.dataset.f;
    node.querySelector("img").onclick = () => viewer(f);
    node.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      if (b.dataset.a === "send") { window.CVNative.genesisPhoneSend(f); setTimeout(paintPhone, 400); }
      if (b.dataset.a === "save") window.CVNative.genesisPhoneSaveToGallery(f);
      if (b.dataset.a === "del") {
        const sent = (P.state.items || []).find(x => x.file === f)?.upload === "sent";
        if (!sent && !await confirmBox("Remove this image from the phone? It was NOT sent to the gallery: it will be lost.", "Remove")) return;
        window.CVNative.genesisPhoneDelete(f); paintPhone();
      }
    });
  });
  const mem = $("#gp-mem"); if (mem) mem.textContent = memoryText();
}
function confirmBox(text, ok){
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "gx-back";
    back.innerHTML = `<div class="gx-dialog" role="dialog"><p>${esc(text)}</p><div class="row"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div></div>`;
    const close = v => { back.remove(); resolve(v); };
    back.onclick = e => { if (e.target === back) close(false); };
    back.querySelector('[data-a="no"]').onclick = () => close(false);
    back.querySelector('[data-a="yes"]').onclick = () => close(true);
    document.body.appendChild(back);
  });
}
function viewer(file){
  const back = document.createElement("div");
  back.className = "gp-viewer";
  back.innerHTML = `<img src="/genesis-phone/${encodeURIComponent(file)}" alt=""><button class="btn" aria-label="Close">✕</button>`;
  back.onclick = () => back.remove();
  document.body.appendChild(back);
}
function pending(){ try { return JSON.parse(localStorage.getItem("cv_dna_pending") || "null"); } catch (e) { return null; } }
function setPending(v){ try { if (v) localStorage.setItem("cv_dna_pending", JSON.stringify(v)); else localStorage.removeItem("cv_dna_pending"); } catch (e) {} }
async function create(){
  const st = readState(); if (!st || !P.dna) return;
  const s = selected(), cost = estimate();
  const spec = ($("#gp-spec").value || "").trim();
  if (spec.length < 20) { toast("Describe the character or tap New character."); return; }
  const auto = $("#gp-auto").checked;
  const q = `Create 1 ${s.quality.toUpperCase()} image (${s.size.replace("x", "×")}) on this phone? It is a paid OpenAI request: about ${usd(cost, 4)}, ${usd(cost * (st.margin || 1.25), 4)} reserved from your local budget.`
    + (auto ? " It will be sent to the gallery automatically." : "");
  if (!await confirmBox(q, "Create")) return;
  const rec = GenesisDNA.record(MEM.pack, P.dna, deviceId(), "phone", {edited: spec !== P.spec.trim(), m: s.model, q: s.quality, size: s.size});
  setPending(rec);
  const gen = window.CVNative.genesisPhoneGenerateDna || null;
  const error = gen ? window.CVNative.genesisPhoneGenerateDna(s.model, s.quality, s.size, buildPrompt(spec), auto, P.dna.id)
                    : window.CVNative.genesisPhoneGenerate(s.model, s.quality, s.size, buildPrompt(spec), auto);
  if (error) { setPending(null); toast(error, 6000); return; }
  P.started = Date.now();
  try { window.CVNative.haptic && window.CVNative.haptic("confirm"); } catch (e) {}
  paintPhone();
}
function commitPending(sha, file){
  const rec = pending(); if (!rec) return false;
  remember(rec);
  if (sha) remember({t: "img", id: rec.id, ts: Math.floor(Date.now() / 1000), dev: deviceId(), sha, file: file || ""});
  setPending(null);
  void syncMemory(true).then(() => { if (S.view === "genesis") paintDna(); });
  return true;
}
function recoverPending(){
  // App closed during a generation: the native list still knows the DNA id and the image hash.
  const rec = pending(); if (!rec || !P.state) return;
  const item = (P.state.items || []).find(x => x.dna === rec.id && x.sha256);
  if (item) commitPending(item.sha256, item.file);
  else if (!P.state.busy && Date.now() / 1000 - rec.ts > 3600) setPending(null);
}

window.__cvGenesisPhone = function (raw){
  let ev = {}; try { ev = JSON.parse(raw); } catch (e) {}
  if (ev.type === "generated") {
    commitPending(ev.sha, ev.name);
    toast("Image created.");
    if (S.view === "genesis") { newCharacter(); paintPhone(); viewer(ev.name); } else toast("Genesis: image created on the phone.", 5000);
  }
  else if (ev.type === "failed") { setPending(null); toast("Genesis: " + (ev.message || "failed") + " (not charged)", 8000); }
  else if (ev.type === "uncertain") { commitPending("", ""); toast("Genesis: " + (ev.message || "uncertain request"), 9000); }
  else if (ev.type === "sent") toast("Sent: the PC will import it and Codex will catalog it.", 5000);
  else if (ev.type === "send_failed") toast("Sending failed: " + (ev.message || "error") + ". Tap Send to gallery to retry.", 7000);
  if (S.view === "genesis") paintPhone();
};

function panelHtml(){
  const m = load("cv_gp_model", MODELS[0]), q = load("cv_gp_quality", "low"), z = load("cv_gp_size", SIZES[0]);
  const kind = load("cv_gp_kind", ""), world = load("cv_gp_world", "");
  const st = P.state || {}, pack = MEM.pack;
  const kinds = [["", "Surprise me · everything"], ...pack.kinds.map(k => [k.id, k.v])];
  const worlds = [["", "Any world"], ...pack.lists.worlds.map(w => [w.id, w.v]).sort((a, b) => a[1].localeCompare(b[1]))];
  return `<div class="panel" id="gp-panel"><h4>Create on this phone</h4>
    <p class="muted">Genesis DNA picks a character that has never been made, on the phone or on the PC; the phone calls OpenAI with your key,
      shows the image and sends it to the gallery, where the PC imports it and Codex catalogs it.</p>
    <div id="gp-keystate" class="muted"></div>
    <input class="txt" id="gp-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…">
    <div class="row"><button class="btn" id="gp-savekey">Save key</button><button class="btn" id="gp-clearkey">Remove key</button></div>
    <div class="gp-limits"><label class="muted">Local budget $<input class="txt" id="gp-budget" type="number" min="0" step="0.5" value="${esc(st.budget || 0)}"></label>
      <label class="muted">Daily limit $<input class="txt" id="gp-daily" type="number" min="0" step="0.5" value="${esc(st.daily || 0)}"></label>
      <button class="btn" id="gp-savelimits">Save limits</button></div>
    <div id="gp-money" class="muted"></div>
    <label class="muted">Subject</label><select id="gp-kind">${kinds.map(([id, v]) => `<option value="${id}" ${id === kind ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
    <label class="muted">World</label><select id="gp-world">${worlds.map(([id, v]) => `<option value="${id}" ${id === world ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
    <div id="gp-dna" class="gp-dna"></div>
    <label class="muted">Character (you can edit it)</label><textarea class="txt" id="gp-spec" rows="10" spellcheck="false"></textarea>
    <div class="row"><button class="btn" id="gp-new">${ico("refresh")} New character</button></div>
    <div id="gp-mem" class="muted"></div>
    <label class="muted">Model</label><select id="gp-model">${MODELS.map(x => `<option value="${x}" ${x === m ? "selected" : ""}>${x === MODELS[0] ? "Flare · fast" : "Sunburst · most detailed"}</option>`).join("")}</select>
    <label class="muted">Quality</label><select id="gp-quality">${QUALITIES.map(x => `<option value="${x}" ${x === q ? "selected" : ""}>${x.toUpperCase()}</option>`).join("")}</select>
    <label class="muted">Resolution</label><select id="gp-size">${SIZES.map(x => `<option value="${x}" ${x === z ? "selected" : ""}>${x.replace("x", " × ")}${x === "1152x2048" ? " · 9:16" : ""}</option>`).join("")}</select>
    <label class="gp-check"><input type="checkbox" id="gp-auto" ${load("cv_gp_auto", true) ? "checked" : ""}> Send to the gallery automatically</label>
    <div id="gp-estimate" class="muted"></div>
    <div class="row"><button class="btn primary" id="gp-go">${ico("image")} Create on this phone</button></div>
    <div id="gp-progress" class="gp-progress" hidden></div>
    <div id="gp-uncertain" class="gp-uncertain" hidden></div>
    <div id="gp-results" class="gp-results"></div>
    <p class="muted">Local budget = your spending cap on this phone, separate from the PC. It is NOT your OpenAI balance (platform.openai.com › Billing).
      A request is never repeated automatically. The key stays on this phone only.</p></div>`;
}
function bindPanel(){
  $("#gp-savekey").onclick = () => {
    const v = $("#gp-key").value.trim();
    const err = window.CVNative.genesisPhoneSetKey(v);
    $("#gp-key").value = "";
    toast(err || "Key saved on this phone (encrypted)."); paintPhone();
  };
  $("#gp-clearkey").onclick = async () => { if (await confirmBox("Remove the OpenAI key from this phone?", "Remove")) { window.CVNative.genesisPhoneClearKey(); paintPhone(); } };
  $("#gp-savelimits").onclick = () => {
    const err = window.CVNative.genesisPhoneSetLimits(Number($("#gp-budget").value || 0), Number($("#gp-daily").value || 0));
    toast(err || "Limits saved."); paintPhone();
  };
  $("#gp-new").onclick = () => newCharacter();
  $("#gp-kind").onchange = e => { save("cv_gp_kind", e.target.value); newCharacter(); };
  $("#gp-world").onchange = e => { save("cv_gp_world", e.target.value); newCharacter(); };
  $("#gp-auto").onchange = e => save("cv_gp_auto", e.target.checked);
  for (const [id, key] of [["gp-model", "cv_gp_model"], ["gp-quality", "cv_gp_quality"], ["gp-size", "cv_gp_size"]])
    $("#" + id).onchange = e => { save(key, e.target.value); paintPhone(); };
  $("#gp-go").onclick = () => void create();
}

const base = window.renderGenesis;
window.renderGenesis = function (){
  base();
  if (!hasBridge()) return;
  readState();
  const mount = async () => {
    try { await loadPack(); } catch (e) { toast("Genesis DNA vocabulary missing: " + e.message); return; }
    const main = document.querySelector("#app main");
    if (!main || S.view !== "genesis" || $("#gp-panel")) return;
    const title = main.querySelector(".section-title");
    const wrap = document.createElement("div");
    wrap.innerHTML = panelHtml();
    main.insertBefore(wrap.firstElementChild, title ? title.nextSibling : main.firstChild);
    const pcTitle = main.querySelector("#gp-panel + .panel h4");
    if (pcTitle) pcTitle.textContent = "Or create with your PC (Codex)";
    bindPanel();
    recoverPending();
    newCharacter();
    paintPhone();
    // Load the PC's memory, then draw again so the first character already avoids what the PC made.
    await syncMemory(!!ownLines().length);
    if (S.view === "genesis" && $("#gp-panel") && !(P.state && P.state.busy)) { newCharacter(); paintPhone(); }
  };
  void mount();
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.view === "genesis" && hasBridge() && $("#gp-panel")) paintPhone(); });
window.__cvGenesisPhone83 = {buildPrompt, MASTER, records, syncMemory, deviceId, memoryText};
})();
