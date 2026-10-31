/* Goth Vault 1.0 — Goth Atlas on the phone: CREATE RANDOM (database / Codex alternated) + live statistics.
 * Database scenes come from goth_atlas.js; "Codex" turns use the stock of validated Codex scenes that the PC publishes in
 * the index (S.index.goth.pool), so the alternation works even when the PC is off. If the stock is empty → database. */
(function () {
"use strict";
const MODELS = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"];
const QUALITIES = ["low", "medium", "high", "xhigh", "max"];
const SIZES = [["1152x2048", "Vertical 9:16"], ["1024x1536", "Vertical 2:3"], ["2048x1152", "Horizontal 16:9"],
  ["1536x1024", "Horizontal 3:2"], ["1024x1024", "Square"]];
const AGES = ["18–24", "25–34", "35–44", "45–54", "55–64", "65–70"];
let run = null, wait = null, dna = "", results = [];
const session = {subgenre: [], category: [], city: []};
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(16).padStart(2, "0")).join("");
const canCreate = () => typeof NATIVE !== "undefined" && NATIVE && window.CVNative && typeof window.CVNative.genesisPhoneGenerateDna === "function";
const ld = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const sv = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function goth(){ return (S.index && S.index.goth) || {}; }
function recent(){
  const r = goth().recent || {};
  const out = {};
  for (const k of ["subgenre", "category", "city"]) out[k] = session[k].slice().reverse().concat(r[k] || []);
  return out;
}
function stockScene(){
  const used = new Set(ld("gv_pool_used", []));
  const x = (goth().pool || []).find(p => !used.has(p.id));
  if (!x) return null;
  used.add(x.id); sv("gv_pool_used", [...used].slice(-400));
  return x;
}
function sources(n){
  const mode = ld("gv_source", "alternate");
  if (mode !== "alternate") return Array(n).fill(mode);
  const k = ld("gv_alt", 0); sv("gv_alt", k + n);
  return Array.from({length: n}, (_, i) => (k + i) % 2 === 0 ? "database" : "codex");
}
function bars(rows, max){
  const top = Math.max(1, ...rows.map(r => r[1]));
  return rows.slice(0, max || 10).map(([k, n]) => `<div class="gv-bar"><span>${esc(k)}</span><i style="--w:${(100 * n / top).toFixed(1)}%"></i><b>${n}</b></div>`).join("")
    || `<p class="muted">No images yet.</p>`;
}
function ring(label, done, total){
  const pct = Math.round(100 * done / Math.max(1, total));
  return `<div class="gv-ring" style="--p:${pct}"><div><b>${pct}%</b></div><small>${esc(label)}<br>${done} of ${total}</small></div>`;
}
function statsHtml(){
  const G = window.__gothAtlas, g = goth(), agg = g.agg || {}, st = G.stats();
  const used = k => (agg[k] || []).length;
  const ages = Array(6).fill(0);
  (g.ages || []).forEach(a => { const i = a <= 24 ? 0 : a <= 34 ? 1 : a <= 44 ? 2 : a <= 54 ? 3 : a <= 64 ? 4 : 5; ages[i]++; });
  const days = {}; (g.days || []).forEach(([d, n]) => { days[d] = n; });
  const now = new Date(), tl = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(now - i * 864e5).toISOString().slice(0, 10); tl.push(days[d] || 0); }
  const tmax = Math.max(1, ...tl);
  return `<div class="panel"><h4>Live statistics</h4>
    <div class="gv-kpis"><div><b>${(g.total || 0) + results.length}</b><small>Goth Atlas images</small></div><div><b>$${Number(g.cost || 0).toFixed(2)}</b><small>spent (PC ledger)</small></div>
      <div><b>${(goth().pool || []).length}</b><small>Codex scenes ready</small></div></div>
    <div class="gv-rings">${ring("subgenres", used("subgenre"), st.subgenres)}${ring("scene categories", used("category"), st.categories)}${ring("countries", used("country"), st.countries)}</div>
    <h5>Images per day</h5><div class="gv-tl">${tl.map(n => `<i style="--h:${(100 * n / tmax).toFixed(0)}%"></i>`).join("")}</div>
    <h5>Top subgenres</h5>${bars(agg.subgenre || [], 10)}
    <h5>Continents</h5>${bars(agg.continent || [], 8)}
    <h5>Scene categories</h5>${bars(agg.category || [], 8)}
    <h5>Age bands</h5>${bars(AGES.map((a, i) => [a, ages[i]]), 6)}
    <h5>Source</h5>${bars(agg.source || [], 4)}
    <p class="muted">Updated by the PC with every sync (PC and phone images).</p></div>`;
}
function render(){
  const G = window.__gothAtlas;
  if (!G?.ready()) { mountPage(`<div class="empty">Loading the Goth Atlas…</div>`, "Goth Atlas"); G?.load().then(() => S.view === "atlas" && render()); return; }
  const st = G.stats(), f = ld("gv_filters", {});
  const sel = (id, items, cur, any) => `<select id="${id}"><option value="">${any}</option>${items.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const nat = canCreate() ? (() => { try { return JSON.parse(window.CVNative.genesisPhoneState()); } catch (e) { return null; } })() : null;
  const last = results[results.length - 1];
  mountPage(`<div class="gv-hero"><h2>Goth Atlas</h2><p class="muted">${st.subgenres} subgenres · ${st.scenes} scenes · ${st.cities} cities · adult women 18–70 · amateur phone realism</p>
    ${canCreate() ? `<button class="btn primary gv-go" id="gv-go" ${!nat?.has_key || run ? "disabled" : ""}>✦ CREATE RANDOM</button>
      <button class="btn" id="gv-stop" style="display:none">Stop after this one</button>
      <div class="muted" id="gv-state">${!nat?.has_key ? "Save your OpenAI key in Genesis › Create on this phone first." : run ? "Running…" : ""}</div>`
      : `<p class="muted">Creating needs the Goth Vault Android app with an OpenAI key.</p>`}
    <div class="lb-big" id="gv-big">${last ? `<img alt="" src="/genesis-phone/${encodeURIComponent(last.name)}"><div class="muted">${esc(last.caption)}</div>` : ""}</div>
    <div class="sx-res" id="gv-res">${results.map(r => `<img alt="" src="/genesis-phone/${encodeURIComponent(r.name)}">`).join("")}</div></div>
    <div class="panel"><h4>Settings</h4>
      <label class="muted">Images per press</label>${sel("gv-n", Array.from({length: 10}, (_, i) => [i + 1, String(i + 1)]), ld("gv_count", 4), "4")}
      <label class="muted">Source</label><select id="gv-src">${[["alternate", "Alternate · database / Codex"], ["database", "Database only"], ["codex", "Codex scenes only"]].map(([v, t]) => `<option value="${v}" ${ld("gv_source", "alternate") === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      <label class="muted">Subgenre</label>${sel("gv-sub", G.subgenres().slice().sort().map(x => [x, x]), f.subgenre, "Any subgenre")}
      <label class="muted">Scene</label>${sel("gv-cat", G.categories().slice().sort().map(x => [x, x]), f.category, "Any scene category")}
      <label class="muted">Continent</label>${sel("gv-cont", G.continents().slice().sort().map(x => [x, x]), f.continent, "Anywhere")}
      <label class="muted">Age</label>${sel("gv-age", AGES.map((a, i) => [i, a]), f.age_band, "Any age (18–70)")}
      <div class="lb-grid2"><div><label class="muted">Model</label><select id="gv-m">${MODELS.map(m => `<option ${m === ld("gv_model", MODELS[0]) ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div><label class="muted">Quality</label><select id="gv-q">${QUALITIES.map(q => `<option ${q === ld("gv_quality", "low") ? "selected" : ""}>${q}</option>`).join("")}</select></div>
        <div><label class="muted">Format</label><select id="gv-z">${SIZES.map(([v, t]) => `<option value="${v}" ${v === ld("gv_size", "1152x2048") ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
      <div class="muted" id="gv-est"></div><p><a href="#/genesis">Genesis, OpenAI key and spending ›</a></p></div>
    ${statsHtml()}`, "Goth Atlas");
  const saveAll = () => {
    sv("gv_count", Number($("#gv-n").value || 4)); sv("gv_source", $("#gv-src").value); sv("gv_model", $("#gv-m").value);
    sv("gv_quality", $("#gv-q").value); sv("gv_size", $("#gv-z").value);
    sv("gv_filters", {subgenre: $("#gv-sub").value, category: $("#gv-cat").value, continent: $("#gv-cont").value, age_band: $("#gv-age").value});
    const c = Number(nat?.prices?.[$("#gv-m").value]?.[$("#gv-z").value]?.[$("#gv-q").value]);
    $("#gv-est").textContent = Number.isFinite(c) ? `≈ $${(c * Number($("#gv-n").value || 4)).toFixed(3)} per press` : "";
  };
  ["#gv-n", "#gv-src", "#gv-sub", "#gv-cat", "#gv-cont", "#gv-age", "#gv-m", "#gv-q", "#gv-z"].forEach(s => { $(s).onchange = saveAll; });
  saveAll();
  if (!$("#gv-go")) return;
  $("#gv-stop").onclick = () => { if (run) run.stop = true; $("#gv-stop").disabled = true; };
  $("#gv-go").onclick = go_;
}
async function go_(){
  const G = window.__gothAtlas;
  const n = ld("gv_count", 4), model = ld("gv_model", MODELS[0]), quality = ld("gv_quality", "low"), size = ld("gv_size", "1152x2048");
  const filters = ld("gv_filters", {});
  const srcs = sources(n);
  run = {stop: false, done: 0}; let refused = 0, fallback = 0;
  $("#gv-go").disabled = true; $("#gv-stop").style.display = ""; $("#gv-stop").disabled = false;
  const state = t => { const e = $("#gv-state"); if (e) e.textContent = t; };
  for (let i = 0; i < n; i++) {
    if (run.stop) break;
    let prompt, caption, fields;
    const stocked = srcs[i] === "codex" ? stockScene() : null;
    if (srcs[i] === "codex" && !stocked) fallback++;
    if (stocked) { prompt = stocked.prompt; fields = stocked.f || {}; caption = `${fields.subgenre || "Codex scene"} · ${fields.city || ""} · Codex`; }
    else { fields = G.pick(filters, recent()); prompt = G.compose(fields); caption = `${fields.subgenre} · ${fields.city}, ${fields.country} · age ${fields.age} · database`; }
    for (const k of ["subgenre", "category", "city"]) if (fields[k]) session[k].push(fields[k]);
    state(`Image ${i + 1}/${n}… (20 s – 3 min, keep the app open)`);
    const result = new Promise(r => { wait = r; });
    dna = hex(8);
    const err = window.CVNative.genesisPhoneGenerateDna(model, quality, size, prompt, true, dna);
    if (err) { wait = null; state(`Stopped at image ${i + 1}: ${err} (nothing was sent or charged)`); run.stop = true; toast(err, 7000); break; }
    const ev = await result;
    if (ev.type === "failed" && /OpenAI error 4\d\d/.test(ev.message || "")) { refused++; toast(`Image ${i + 1}: refused by OpenAI, skipped.`, 4000); continue; }
    if (ev.type !== "generated") { state(`Stopped at image ${i + 1}: ${ev.message || ev.type}`); run.stop = true; break; }
    run.done++;
    results.push({name: ev.name, caption});
    const big = $("#gv-big");
    if (big) big.innerHTML = `<img alt="" src="/genesis-phone/${encodeURIComponent(ev.name)}"><div class="muted">${esc(caption)}</div>`;
    $("#gv-res")?.insertAdjacentHTML("beforeend", `<img alt="" src="/genesis-phone/${encodeURIComponent(ev.name)}">`);
  }
  const done = run.done, stopped = run.stop; run = null; dna = "";
  const msg = `${done} of ${n} created and sent: the PC archives them (Drive + NAS) and Codex catalogs them.`
    + (fallback ? ` No Codex scene in stock for ${fallback}: database used.` : "") + (refused ? ` Refused by OpenAI: ${refused}.` : "");
  if (S.view === "atlas") { const keep = $("#gv-state")?.textContent || ""; render(); state(stopped && keep.startsWith("Stopped") ? keep : msg); }
}
window.renderAtlas = render;
const previous = window.__cvGenesisPhone;
window.__cvGenesisPhone = function (raw){
  let ev = {}; try { ev = JSON.parse(raw); } catch (x) {}
  if (wait && dna && ev.dna === dna && ["generated", "failed", "uncertain"].includes(ev.type)) { const w = wait; wait = null; w(ev); return; }
  if (previous) previous(raw);
};
})();
