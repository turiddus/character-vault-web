/* Character Vault 8.2 — Genesis on the phone (ported from 8.1 Genesis Mobile, same protocol).
 *
 * The phone never holds an OpenAI API key. It signs commands with the 64-character pairing key shown by
 * Genesis Studio on the PC (HMAC-SHA256 over v|id|ts|action|count|model|quality|size) and uploads them to the
 * archive folder Genesis_Remote on Drive. The PC (writer) verifies, queues and generates with Codex + GPT Image;
 * images enter the gallery through the normal import. Status: Genesis_Remote/genesis_status.json.
 * Sending is available in the Android app only (as in 8.1).
 */
(function () {
"use strict";
const MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const QUALITIES = ["low", "medium", "high", "xhigh", "max"];
const SIZES = ["1152x2048", "1024x1536", "2160x3840"];
const G = {status: null, folder: "", busy: false};

function hex(bytes){ return Array.from(bytes, x => x.toString(16).padStart(2, "0")).join(""); }
function haptic(kind){ try { if (NATIVE && typeof window.CVNative.haptic === "function") window.CVNative.haptic(kind); } catch (e) {} }

function ask(text, okText){
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "gx-back";
    back.innerHTML = `<div class="gx-dialog" role="dialog"><p>${esc(text)}</p><div class="row">
      <button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(okText || "Confirm")}</button></div></div>`;
    const close = value => { back.remove(); resolve(value); };
    back.onclick = e => { if (e.target === back) close(false); };
    back.querySelector('[data-a="no"]').onclick = () => close(false);
    back.querySelector('[data-a="yes"]').onclick = () => close(true);
    document.body.appendChild(back);
  });
}

async function folder(){
  if (G.folder) return G.folder;
  const root = rootId();
  if (!root) throw new Error("Select your synchronized Drive archive first.");
  const found = await children(root, "Genesis_Remote", true);
  if (!found.length) throw new Error("Genesis on the phone is not enabled on the PC yet (Genesis Studio › Allow paired smartphone commands).");
  G.folder = found[0].id;
  return G.folder;
}
async function signature(secret, doc){
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error("Invalid pairing key: enter the 64-character key from Genesis Studio.");
  if (!crypto.subtle) throw new Error("Secure Web Crypto is not available on this device.");
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secret.match(/../g).map(x => parseInt(x, 16))),
    {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const wire = [doc.v, doc.id, doc.ts, doc.action, doc.count, doc.model, doc.quality, doc.size].join("|");
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(wire))));
}
async function loadStatus(force){
  try {
    const f = await folder();
    const files = await children(f, "genesis_status.json", false, true);
    if (!files.length) throw new Error("The PC has not published a Genesis status yet.");
    const state = JSON.parse(new TextDecoder().decode(await media(files[0].id)));
    if (state.version !== 1 || typeof state.updated_at !== "number") throw new Error("Invalid status format.");
    G.status = state;
  } catch (e) {
    G.status = null;
    if (force) { const node = $("#gx-state"); if (node) node.textContent = "Status unavailable: " + e.message; }
    return;
  }
  paint();
}
function capacity(q){
  const st = G.status || {}, model = $("#gx-model")?.value || st.model, size = $("#gx-size")?.value || SIZES[0];
  const cost = Number(st.price_matrix?.[model]?.[size]?.[q]);
  if (!Number.isFinite(cost) || cost <= 0) return "N/A";
  const budget = Math.max(0, Math.min(Number(st.remaining_usd || 0), Number(st.today_remaining_usd || 0)));
  return String(Math.floor(budget / (cost * 1.25)));
}
function paint(){
  const st = G.status, el = $("#gx-state");
  if (!el) return;
  if (!st) { el.textContent = "Waiting for the PC. Pair this phone and refresh."; return; }
  const age = Math.max(0, Math.floor(Date.now() / 1000 - st.updated_at));
  el.textContent = age > 100 ? `Last PC update ${age} s ago: the PC may be off or Character Vault closed.`
    : `PC updated ${age} s ago · ${st.remote_enabled ? "phone commands enabled" : "phone commands disabled on the PC"} · queue: ${st.pending || 0}`
      + (st.last_error ? ` · ${st.last_error}` : "");
  const budget = $("#gx-budget");
  if (budget) budget.textContent = `Local budget left $${Number(st.remaining_usd || 0).toFixed(3)} · today $${Number(st.today_remaining_usd || 0).toFixed(3)} · spent $${Number(st.spent_usd || 0).toFixed(3)} · generated ${st.generated || 0}`;
  const usage = st.tokens || {}, tk = $("#gx-tokens");
  if (tk) tk.textContent = `Last image: ${usage.total_tokens ?? "N/A"} tokens (${usage.input_tokens ?? "N/A"} in · ${usage.output_tokens ?? "N/A"} out).`;
  const model = $("#gx-model")?.value || st.model, size = $("#gx-size")?.value || SIZES[0];
  const prices = st.price_matrix?.[model]?.[size] || {};
  const table = $("#gx-estimates");
  if (table) table.innerHTML = QUALITIES.map(q => `<div class="gx-row"><b>${esc(q.toUpperCase())}</b><span class="muted">${prices[q] == null ? "unknown" : "$" + Number(prices[q]).toFixed(4)} · ${capacity(q)} images*</span></div>`).join("");
}
async function send(action, count){
  if (G.busy) return;
  if (!NATIVE) { toast("Genesis commands are sent from the Android app."); return; }
  const secret = (localStorage.getItem("cv_genesis_pair") || "").trim().toLowerCase();
  const model = $("#gx-model")?.value || MODELS[0], quality = $("#gx-quality")?.value || "low", size = $("#gx-size")?.value || SIZES[0];
  if (!MODELS.includes(model) || !QUALITIES.includes(quality) || !SIZES.includes(size)) return;
  if (action === "enqueue" && (!Number.isInteger(count) || count < 1 || count > 100)) { toast("Choose 1 to 100 characters."); return; }
  if (!secret) { toast("Save the pairing key from Genesis Studio first."); return; }
  const question = action === "enqueue"
    ? `Queue ${count} ${quality.toUpperCase()} image(s) on your PC? Each one is a paid OpenAI request; the PC budget limits apply.`
    : "Clear the queue and stop automatic generation on the PC? A request already sent to OpenAI cannot be canceled.";
  if (!await ask(question, action === "enqueue" ? "Queue" : "Pause")) return;
  G.busy = true;
  const buttons = Array.from(document.querySelectorAll("#gx-generate,#gx-pause"));
  buttons.forEach(b => b.disabled = true);
  try {
    const f = await folder();
    const id = hex(crypto.getRandomValues(new Uint8Array(16)));
    const doc = {v: 1, id, ts: Math.floor(Date.now() / 1000), action, count: action === "pause" ? 0 : count, model, quality, size};
    doc.sig = await signature(secret, doc);
    await uploadSmall(new Blob([JSON.stringify(doc)], {type: "application/json"}), `genesis_cmd_${id}.json`, f);
    haptic("confirm");
    toast("Command sent: the PC confirms within a minute.", 5000);
    const el = $("#gx-state"); if (el) el.textContent = "Command uploaded to Drive. Waiting for the PC…";
    setTimeout(() => loadStatus(false), 30000);
  } catch (e) { toast("Genesis command failed: " + e.message, 6000); }
  finally { G.busy = false; buttons.forEach(b => b.disabled = false); }
}

window.renderGenesis = function (){
  const model = load("cv_genesis_model", MODELS[0]), quality = load("cv_genesis_quality", "low");
  const size = load("cv_genesis_size", SIZES[0]), count = load("cv_genesis_count", 1);
  const paired = /^[0-9a-f]{64}$/.test(localStorage.getItem("cv_genesis_pair") || "");
  mountPage(`<div class="section-title"><h2>Genesis</h2></div>
    <div class="panel"><h4>Create characters with your PC</h4>
      <p class="muted">Codex invents an original character and GPT Image creates it on your PC; the image enters the gallery
        and Codex catalogs it. No API key on the phone. Character Vault must be open on the PC that edits the archive.</p>
      <label class="muted">Pairing key (Genesis Studio › Show pairing key)</label>
      <input class="txt" id="gx-secret" type="password" placeholder="${paired ? "Paired ✓ (enter a new key to replace it)" : "64-character pairing key"}" autocomplete="off" spellcheck="false">
      <div class="row"><button class="btn" id="gx-savekey">Save pairing</button><button class="btn" id="gx-clear"${paired ? "" : " disabled"}>Remove pairing</button></div>
      <div id="gx-state" class="muted">Checking the PC…</div>
      <div class="row"><button class="btn" id="gx-refresh">${ico("refresh")} Refresh status</button></div></div>
    <div class="panel"><h4>New characters</h4>
      <label class="muted">Model</label><select id="gx-model">${MODELS.map(x => `<option value="${x}" ${x === model ? "selected" : ""}>${x === MODELS[0] ? "Flare · fast" : "Sunburst · most detailed"}</option>`).join("")}</select>
      <label class="muted">Quality</label><select id="gx-quality">${QUALITIES.map(x => `<option value="${x}" ${x === quality ? "selected" : ""}>${x.toUpperCase()}</option>`).join("")}</select>
      <label class="muted">Resolution</label><select id="gx-size">${SIZES.map(x => `<option value="${x}" ${x === size ? "selected" : ""}>${x.replace("x", " × ")}${x === "2160x3840" ? " · 4K experimental" : x === "1152x2048" ? " · 9:16" : ""}</option>`).join("")}</select>
      <label class="muted">How many characters (1–100)</label><input id="gx-count" class="txt" type="number" min="1" max="100" value="${esc(count)}">
      <div class="row"><button class="btn primary" id="gx-generate">${ico("image")} Queue on the PC</button><button class="btn" id="gx-pause">Pause / clear queue</button></div>
      <p class="muted">The PC applies its own budget, daily limit and import checks. Queued work runs only while Character Vault is open there.</p></div>
    <div class="panel"><h4>Budget and capacity</h4><div class="muted" id="gx-budget">Waiting for the PC…</div>
      <div class="muted" id="gx-tokens" style="margin-top:6px"></div><div id="gx-estimates" style="margin-top:10px"></div>
      <p class="muted">* Estimate with a 25% margin, based on the budget set in Genesis Studio. It is NOT your OpenAI prepaid balance (check it on platform.openai.com).</p></div>`, "Genesis");
  $("#gx-savekey").onclick = () => {
    const v = $("#gx-secret").value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(v)) { toast("The key must be 64 characters (0-9, a-f)."); return; }
    localStorage.setItem("cv_genesis_pair", v); toast("Pairing saved on this phone."); window.renderGenesis();
  };
  $("#gx-clear").onclick = () => { localStorage.removeItem("cv_genesis_pair"); toast("Pairing removed from this phone."); window.renderGenesis(); };
  for (const [id, key] of [["gx-model", "cv_genesis_model"], ["gx-quality", "cv_genesis_quality"], ["gx-size", "cv_genesis_size"], ["gx-count", "cv_genesis_count"]])
    $("#" + id).onchange = e => { save(key, id === "gx-count" ? Number(e.target.value) : e.target.value); paint(); };
  $("#gx-generate").onclick = () => void send("enqueue", Number($("#gx-count").value));
  $("#gx-pause").onclick = () => void send("pause", 0);
  $("#gx-refresh").onclick = () => void loadStatus(true);
  paint(); void loadStatus(false);
};
setInterval(() => { if (S.view === "genesis" && document.visibilityState === "visible") void loadStatus(false); }, 30000);
window.__cvGenesis82 = {signature, send, loadStatus};
})();
