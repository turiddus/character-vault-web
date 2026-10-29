/* Character Vault 7.3 — videos from a link, sent from the phone to the PC at home.
 *
 * The phone only sends the link (a normal edit in the Drive "modifiche" folder, op "download_url").
 * The editing PC downloads it at full quality with its private yt-dlp, imports it and Codex analyzes it;
 * the video then appears in the gallery. Progress is read from cv_links_v1.json.gz in the web folder.
 * Works with both the Modern and the Classic interface. "Share › Download video (Character Vault)"
 * from YouTube, TikTok, Instagram… arrives here through window.__cvSharedLink.
 */
(function () {
"use strict";
const STATUS = "cv_links_v1.json.gz";
const L = {status: null, rev: "", busy: false, last: 0, local: load("cv_links_local", [])};
const ACTIVE = new Set(["sent", "queued", "downloading", "importing"]);
Object.assign(ICONS, {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
});

function extractUrl(text){
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[.,);\]}>。，!?]+$/, "") : "";
}
function newId(){ return "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function haptic(kind){ try { if (NATIVE && typeof window.CVNative.haptic === "function") window.CVNative.haptic(kind); } catch (e) {} }

async function sendLink(text){
  const url = extractUrl(text);
  if (!url) { toast("No link found in the shared text."); return false; }
  if (!S.index) { save("cv_shared_link", text); toast("The link will be sent as soon as the archive is open."); return false; }
  const id = newId();
  L.local = [{id, url, at: Date.now() / 1000}, ...L.local.filter(x => x.url !== url)].slice(0, 30);
  save("cv_links_local", L.local);
  await queueOp({op: "download_url", url, id, src: NATIVE ? "android" : "web"});
  haptic("confirm");
  toast("Sent to your PC: it downloads the video and Codex analyzes it.", 4200);
  paint();
  setTimeout(() => refreshLinks(true), 1500);
  return true;
}

async function refreshLinks(force){
  if (L.busy || !S.index || document.visibilityState === "hidden") return;
  if (!force && Date.now() - L.last < 12000) return;
  L.busy = true; L.last = Date.now();
  try {
    const f = await resolveFolders();
    const found = await children(f.web, STATUS, false, true);
    if (found.length) {
      const file = found[0], rev = [file.id, file.version, file.modifiedTime, file.size].join(":");
      if (rev !== L.rev) {
        const data = await gunzipJson(await media(file.id));
        if (data && Array.isArray(data.jobs)) {
          const before = JSON.stringify((L.status || {}).jobs || []);
          L.status = data; L.rev = rev;
          const known = new Set(data.jobs.map(j => j.id));
          const wasDone = new Set(((JSON.parse(before) || []).filter(j => j.st === "done")).map(j => j.id));
          L.local = L.local.filter(x => !known.has(x.id) && Date.now() / 1000 - x.at < 7 * 86400);
          save("cv_links_local", L.local);
          if (data.jobs.some(j => j.st === "done" && !wasDone.has(j.id) && before !== "[]")) {
            void autoRefresh(true);           // a new record is in the index: bring it into the gallery
          }
        }
      }
    }
  } catch (e) { /* offline or no status yet: keep the last view */ }
  finally { L.busy = false; paint(); }
}

function jobs(){
  const remote = ((L.status || {}).jobs || []).filter(j => !String(j.url || "").startsWith("cineremix:") || j.st !== "failed");
  const ids = new Set(remote.map(j => j.id));
  const local = L.local.filter(x => !ids.has(x.id)).map(x => ({id: x.id, url: x.url, st: "sent", p: 0, t: "", m: "", src: NATIVE ? "android" : "web", img: []}));
  return [...local, ...remote];
}
function activeJobs(){ return jobs().filter(j => ACTIVE.has(j.st)); }
function stateText(j){
  const pct = Math.round((j.p || 0) * 100);
  switch (j.st) {
    case "sent": return "Sent · waiting for the PC (open Character Vault on the PC)";
    case "queued": return "On the PC · waiting";
    case "downloading": return `Downloading on the PC · ${pct}%`;
    case "importing": return "Importing into the catalog";
    case "analyzing": return "In the gallery · Codex is analyzing it";
    case "done": return "Ready in the gallery";
    case "failed": return "Failed · " + (j.m || "see the PC");
    case "cancelled": return "Canceled";
    default: return j.st;
  }
}
function title(j){
  if (String(j.url || "").startsWith("cineremix:")) return "CineRemix · " + (j.t || "remix");
  if (j.t) return j.t;
  try { const u = new URL(j.url); return u.hostname.replace(/^www\./, "") + u.pathname.slice(0, 40); } catch (e) { return j.url || "video"; }
}
function itemHtml(j){
  const img = (j.img || []).find(id => S.byId && S.byId.has(id));
  const bar = ACTIVE.has(j.st) && j.st !== "sent"
    ? `<div class="lk-bar"><span style="width:${Math.max(4, Math.round((j.p || 0) * 100))}%"></span></div>` : "";
  const action = j.st === "failed" ? `<button class="btn" data-lk-retry="${esc(j.id)}">Retry</button>`
    : img ? `<button class="btn" data-lk-open="${esc(img)}">Open</button>` : "";
  const from = j.src === "android" ? "📱" : j.src === "cineremix" ? "🎬" : j.src === "web" ? "🌐" : "💻";
  return `<div class="lk-item st-${esc(j.st)}"><div class="lk-ic">${from}</div><div class="lk-n"><b>${esc(title(j))}</b>
    <span class="muted">${esc(stateText(j))}</span>${bar}</div>${action}</div>`;
}
function paint(){
  const box = $("#links73");
  if (box) {
    const list = jobs().slice(0, 25);
    box.innerHTML = list.length ? list.map(itemHtml).join("")
      : `<div class="muted" style="padding:6px 0">No links yet. In YouTube, TikTok or Instagram use Share › Character Vault.</div>`;
    box.querySelectorAll("[data-lk-retry]").forEach(b => b.onclick = () => {
      const j = jobs().find(x => x.id === b.dataset.lkRetry); if (j) sendLink(j.url);
    });
    box.querySelectorAll("[data-lk-open]").forEach(b => b.onclick = () => window.openDetail(b.dataset.lkOpen, [S.byId.get(b.dataset.lkOpen)]));
  }
  const banner = $("#lk-banner");
  if (banner) banner.outerHTML = bannerHtml() || `<span id="lk-banner" hidden></span>`;
  bindBanner();
}
function bannerHtml(){
  const active = activeJobs();
  if (!active.length || S.view !== "gallery") return "";
  const first = active[0];
  const extra = active.length > 1 ? ` (+${active.length - 1})` : "";
  return `<div class="banner lk-banner" id="lk-banner"><span>⬇ ${esc(title(first))}${extra}: ${esc(stateText(first))}</span>
    <button class="btn" data-lk-go="1">Details</button></div>`;
}
function bindBanner(){ document.querySelectorAll("[data-lk-go]").forEach(b => b.onclick = () => go("#/add")); }

/* ------------------------------------------------------------------ pages */
const coreRenderAdd = window.renderAdd;
window.renderAdd = function (){
  coreRenderAdd();
  const main = $("main"); if (!main) return;
  const panel = document.createElement("div");
  panel.className = "panel links73";
  panel.innerHTML = `<h4>Download a video from a link</h4>
    <div class="muted">YouTube, TikTok, Instagram, Facebook, X, Vimeo, RedNote and many more. Your PC at home downloads the
      whole video at full quality, imports it and Codex analyzes it; then it appears in the gallery.</div>
    <div class="lk-row"><input id="lk-url" type="url" inputmode="url" autocomplete="off" placeholder="Paste a link or shared text">
      <button class="btn primary" id="lk-go">${ico("download")} Send to PC</button></div>
    <div class="lk-row">${navigator.clipboard && navigator.clipboard.readText ? `<button class="btn" id="lk-paste">${ico("copy")} Paste</button>` : ""}
      <span class="muted">Tip: Share › Character Vault from the video app sends it directly.</span></div>
    <div id="links73"></div>`;
  const title = main.querySelector(".section-title");
  if (title) title.after(panel); else main.prepend(panel);
  const input = $("#lk-url");
  const submit = async () => { if (await sendLink(input.value)) input.value = ""; };
  $("#lk-go").onclick = submit;
  input.onkeydown = e => { if (e.key === "Enter") submit(); };
  const paste = $("#lk-paste");
  if (paste) paste.onclick = async () => {
    try { input.value = await navigator.clipboard.readText(); input.focus(); }
    catch (e) { input.focus(); toast("Long-press the field and choose Paste."); }
  };
  paint();
  refreshLinks(true);
};
const corePendingBanner = window.pendingBanner;
window.pendingBanner = function (){
  return (bannerHtml() || `<span id="lk-banner" hidden></span>`) + corePendingBanner();
};
const coreBindCommon = window.bindCommon;
window.bindCommon = function (){ coreBindCommon.apply(this, arguments); bindBanner(); };

/* ------------------------------------------------------------------ share target and polling */
window.__cvSharedLink = text => {
  if (!S.index) { save("cv_shared_link", text); return; }
  go("#/add");
  setTimeout(() => sendLink(text), 250);
};
setInterval(() => {
  const stashed = load("cv_shared_link", "");
  if (stashed && S.index) { localStorage.removeItem("cv_shared_link"); window.__cvSharedLink(stashed); }
}, 1500);
setInterval(() => { if (S.index && (S.view === "add" || activeJobs().length)) refreshLinks(false); }, 15000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.index) refreshLinks(true); });
window.__cvLinks73 = {sendLink, refreshLinks, extractUrl, jobs};
})();
