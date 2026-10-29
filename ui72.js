/* Character Vault 7.2 — modern graphic layer for the web app and the Android app.
 *
 * Presentation only: it reuses the core functions (index, thumbnails, media(), queueOp, saveDriveFile…)
 * and never touches Drive writes, the index format or uploads. Settings › Appearance › Classic restores
 * the previous screens (the original functions are kept and called unchanged).
 */
(function () {
"use strict";

/* =================================================================== preferences */
const PREF = {
  get modern(){ return (localStorage.getItem("cv_ui") || "modern") !== "classic"; },
  get colors(){ return localStorage.getItem("cv_colors") || "brand"; },
  get cols(){ return Number(localStorage.getItem("cv_cols") || 0); },
  get storySec(){ return Number(localStorage.getItem("cv_story_sec") || 5); },
  get kenBurns(){ return localStorage.getItem("cv_kenburns") !== "0"; },
  get music(){ return localStorage.getItem("cv_music_on") === "1"; },
};
const setPref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const nativeHas = name => NATIVE && typeof window.CVNative[name] === "function";

Object.assign(ICONS, {
  play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>', heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  rotate: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 3h8M12 3v4"/>',
  shuffle: '<path d="M3 6h3c4 0 6 12 10 12h5"/><path d="M3 18h3c1.6 0 2.8-2 4-4.5M14 8.5C15 7 16 6 17 6h4"/><path d="m18 3 3 3-3 3M18 15l3 3-3 3"/>',
  story: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
});

function haptic(kind){
  try { if (nativeHas("haptic")) window.CVNative.haptic(kind || "tick"); else navigator.vibrate?.(kind === "long" ? 18 : 8); } catch (e) {}
}
// one message at a time: a new toast replaces the previous one instead of drawing over it
const coreToast = window.toast;
window.toast = function (text, ms) {
  document.querySelectorAll("body > .toast").forEach(t => t.remove());
  return coreToast(text, ms);
};
function floatBadge(text){
  const b = document.createElement("div"); b.className = "cv-badge-float"; b.textContent = text;
  document.body.appendChild(b); setTimeout(() => b.remove(), 950);
}
const titleOf = it => it.t || it.f || "Image";
const namesOf = it => (it.e || []).map(id => S.entById.get(id)?.name).filter(Boolean);
const isVideo = it => it.mt === "video";
const nsfw = it => S.blurExplicit && it.cr === "esplicito";

/* =================================================================== colors (Material You) */
function mix(hex, other, t){
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function applyTheme(){
  const root = document.documentElement.style;
  ["--accent", "--accent2", "--accent-soft"].forEach(v => root.removeProperty(v));
  let accent = "#c4364f";
  if (PREF.colors === "system" && nativeHas("theme")) {
    try {
      const t = JSON.parse(window.CVNative.theme() || "{}");
      if (t.dynamic && /^#[0-9a-f]{6}$/i.test(t.a500 || "")) {
        accent = t.a600 || t.a500;
        root.setProperty("--accent", accent);
        root.setProperty("--accent2", t.a300 || mix(accent, "#ffffff", .3));
        root.setProperty("--accent-soft", mix(t.a900 || accent, "#0c0a0f", .45));
      }
    } catch (e) {}
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0c0a0f");
  return accent;
}

/* =================================================================== shared media cache */
// Full images (preview 1600 px or original) as blob URLs, shared by viewer and stories.
const FULL = new Map();               // driveId -> {url, at}
const FULL_MAX = 8;
const FULL_WAIT = new Map();
function fullId(it){ return isVideo(it) ? "" : (it.p || it.o || ""); }
async function fullUrl(it){
  const id = fullId(it); if (!id) return "";
  if (FULL.has(id)) { FULL.get(id).at = Date.now(); return FULL.get(id).url; }
  if (FULL_WAIT.has(id)) return FULL_WAIT.get(id);
  const p = (async () => {
    const url = URL.createObjectURL(new Blob([await media(id)]));
    FULL.set(id, {url, at: Date.now()});
    while (FULL.size > FULL_MAX) {
      const oldest = [...FULL.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (document.querySelector(`img[src="${oldest[1].url}"]`)) { oldest[1].at = Date.now(); break; }
      URL.revokeObjectURL(oldest[1].url); FULL.delete(oldest[0]);
    }
    return url;
  })();
  FULL_WAIT.set(id, p);
  try { return await p; } finally { FULL_WAIT.delete(id); }
}
const THUMBS = new Map();             // imageId -> blob url (cover crops, small)
async function coverUrl(it){
  if (THUMBS.has(it.i)) return THUMBS.get(it.i);
  const url = await thumbUrl(it).catch(() => "");
  if (url) { THUMBS.set(it.i, url); if (THUMBS.size > 80) { const [k, v] = THUMBS.entries().next().value; URL.revokeObjectURL(v); THUMBS.delete(k); } }
  return url;
}

/* =================================================================== common actions */
async function toggleFav(it){ haptic("confirm"); await queueOp({op: "favorite", image: it.i, value: it.fav ? 0 : 1}); }
async function setRating(it, n){ haptic("tick"); await queueOp({op: "rating", image: it.i, value: (it.r || 0) === n ? 0 : n}); }
async function downloadOriginal(it){
  if (!it.o) { toast("The original is not on Drive yet."); return; }
  if (isVideo(it) && !NATIVE) { window.open(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(it.o)}`, "_blank", "noopener"); return; }
  if (NATIVE) {
    window.__cvNativeSaved = (id, ok) => { if (id === it.o) toast(ok ? "Saved to Gallery › CharacterVault" : "Download failed"); };
    window.CVNative.saveDriveFile(it.o, it.f || (it.i + (it.x || ".jpg")));
    toast("Downloading the original…");
    return;
  }
  try {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([await media(it.o)])); a.download = it.f || (it.i + (it.x || ".jpg"));
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  } catch (e) { toast(e.message); }
}
async function shareItem(it){
  const id = it.o || it.p; if (!id) { toast("The original is not on Drive yet."); return; }
  const name = it.f || (it.i + (it.x || ".jpg"));
  if (nativeHas("shareDriveFile")) {
    window.__cvNativeShared = (fid, ok) => { if (fid === id && !ok) toast("Sharing failed"); };
    window.CVNative.shareDriveFile(id, name); toast("Preparing to share…"); return;
  }
  try {
    const blob = new Blob([await media(id)], {type: isVideo(it) ? "video/mp4" : "image/jpeg"});
    const file = new File([blob], name, {type: blob.type});
    if (navigator.canShare?.({files: [file]})) { await navigator.share({files: [file], title: titleOf(it)}); return; }
  } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(`https://drive.google.com/file/d/${it.o || id}/view`); toast("Drive link copied"); } catch (e) { toast("Sharing is not available here"); }
}
function openInfo(list, idx, replace){
  S.detailList = list; detailIdx = idx;
  (replace ? history.replaceState : history.pushState).call(history, {detail: list[idx].i}, "");
  showDetail();
}
function starsHtml(r){ return [1, 2, 3, 4, 5].map(n => `<button data-st="${n}" class="${(r || 0) >= n ? "on" : ""}">★</button>`).join(""); }

/* =================================================================== full-screen viewer */
const LV = {el: null, list: [], idx: 0, slides: [], w: 0, h: 0, zoom: {s: 1, x: 0, y: 0}, from: null, closing: false, revealed: new Set()};

function lvOpen(list, idx, fromEl, replace){
  if (!list?.length || idx < 0) return;
  lvClose(true, true);
  LV.list = list; LV.idx = idx; LV.from = fromEl || null; LV.closing = false;
  const el = document.createElement("div"); el.id = "lv"; el.className = "lv";
  el.innerHTML = `<div class="lv-bg"></div><div class="lv-amb"></div><div class="lv-track"></div>
    <div class="lv-top"><button class="lv-btn" data-a="back">${ico("back")}</button>
      <div class="lv-title"><b></b><span></span></div>
      <button class="lv-btn" data-a="story" aria-label="Stories">${ico("story")}</button>
      <button class="lv-btn" data-a="info" aria-label="Details">${ico("info")}</button></div>
    <div class="lv-hint">Swipe up for details</div>
    <div class="lv-bottom"><div class="lv-chips"></div>
      <div class="lv-actions"><button class="lv-btn" data-a="fav" aria-label="Favorite">${ico("heart")}</button>
        <div class="lv-stars"></div>
        <button class="lv-btn" data-a="dl" aria-label="Download original">${ico("download")}</button>
        <button class="lv-btn" data-a="share" aria-label="Share">${ico("share")}</button></div></div>`;
  document.body.appendChild(el); document.body.style.overflow = "hidden";
  LV.el = el;
  LV.slides = [0, 1, 2].map(() => { const s = document.createElement("div"); s.className = "lv-slide";
    el.querySelector(".lv-track").appendChild(s); return s; });
  lvMeasure();
  (replace ? history.replaceState : history.pushState).call(history, {lv: list[idx].i}, "");
  lvFill(true);
  lvBind();
  lvFlyIn(list[idx]).finally(() => el.classList.add("ready"));
  requestAnimationFrame(() => el.classList.add("ready"));
}
function lvMeasure(){ LV.w = window.innerWidth; LV.h = window.innerHeight; }
function lvPlace(dx = 0, animate = false){
  LV.slides.forEach((s, i) => {
    s.style.transition = animate ? "transform .28s cubic-bezier(.2,.8,.2,1)" : "none";
    s.style.transform = `translate3d(${(i - 1) * (LV.w + 18) + dx}px,0,0)`;
  });
}
function lvFill(all){
  const it = LV.list[LV.idx];
  const order = [LV.idx - 1, LV.idx, LV.idx + 1];
  LV.slides.forEach((s, i) => {
    if (all || s.dataset.id !== (LV.list[order[i]]?.i || "")) lvSlide(s, LV.list[order[i]]);
    const z = s.querySelector(".lv-zoom"); if (z) { z.style.transition = "none"; z.style.transform = ""; }
  });
  LV.el.querySelector(".lv-bg").style.opacity = "";
  lvResetZoom(false);
  lvPlace(0, false);
  lvChrome(it);
}
function lvSlide(slide, it){
  slide.innerHTML = `<div class="lv-zoom"><img class="lv-ph" alt=""><img class="lv-full" alt=""></div><div class="lv-spin"></div>`;
  const ph = slide.querySelector(".lv-ph"), full = slide.querySelector(".lv-full");
  slide.classList.remove("nsfw", "loading");
  slide.style.opacity = "";
  slide.dataset.id = it ? it.i : "";
  if (!it) return;
  if (nsfw(it) && !LV.revealed.has(it.i)) {
    slide.classList.add("nsfw");
    const r = document.createElement("button"); r.className = "lv-reveal"; r.textContent = "Explicit · tap to show";
    r.onclick = e => { e.stopPropagation(); LV.revealed.add(it.i); slide.classList.remove("nsfw"); r.remove(); };
    slide.appendChild(r);
  }
  coverUrl(it).then(u => { if (u && slide.dataset.id === it.i) ph.src = u; });
  if (isVideo(it)) {
    const b = document.createElement("button"); b.className = "lv-play"; b.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    b.onclick = e => { e.stopPropagation(); if (it.o) playVideo(it.o, titleOf(it), slide.querySelector(".lv-zoom")); else toast("The video is not on Drive yet."); };
    slide.appendChild(b);
    return;
  }
  if (!fullId(it)) return;
  slide.classList.add("loading");
  fullUrl(it).then(u => {
    if (slide.dataset.id !== it.i || !u) return;
    full.onload = () => { full.classList.add("ok"); slide.classList.remove("loading"); };
    full.onerror = () => slide.classList.remove("loading");
    full.src = u;
  }).catch(() => slide.classList.remove("loading"));
}
function lvChrome(it){
  if (!LV.el || !it) return;
  LV.el.querySelector(".lv-title b").textContent = titleOf(it);
  const names = namesOf(it);
  LV.el.querySelector(".lv-title span").textContent = `${LV.idx + 1} / ${LV.list.length}${names.length ? " · " + names.join(", ") : ""}`;
  const fav = LV.el.querySelector('[data-a="fav"]'); fav.classList.toggle("on", !!it.fav); fav.classList.toggle("fill", !!it.fav);
  LV.el.querySelector(".lv-stars").innerHTML = starsHtml(it.r);
  LV.el.querySelectorAll(".lv-stars [data-st]").forEach(b => b.onclick = async e => { e.stopPropagation(); await setRating(it, +b.dataset.st); lvChrome(LV.list[LV.idx]); });
  const chips = (it.e || []).map(id => S.entById.get(id)).filter(Boolean).map(e => `<button data-go="#/person/${encodeURIComponent(e.id)}">${esc(e.name)}</button>`)
    .concat((it.th || []).map(id => S.thingById.get(id)).filter(Boolean).slice(0, 4).map(t => `<button data-go="#/thing/${encodeURIComponent(t.id)}">${esc(t.name)}</button>`));
  const host = LV.el.querySelector(".lv-chips"); host.innerHTML = chips.join(""); host.style.display = chips.length ? "" : "none";
  host.querySelectorAll("[data-go]").forEach(b => b.onclick = e => { e.stopPropagation(); const h = b.dataset.go; lvClose(true); history.replaceState(null, ""); location.hash = h; });
  coverUrl(it).then(u => { if (u && LV.el && LV.list[LV.idx]?.i === it.i) LV.el.querySelector(".lv-amb").style.backgroundImage = `url("${u}")`; });
  const next = [LV.list[LV.idx + 1], LV.list[LV.idx - 1]].filter(Boolean);   // warm neighbours
  setTimeout(() => next.forEach(n => { if (fullId(n)) fullUrl(n).catch(() => {}); }), 350);
}
function lvGo(step){
  const target = LV.idx + step;
  if (target < 0 || target >= LV.list.length) { lvPlace(0, true); haptic("tick"); return; }
  haptic("tick");
  lvPlace(-step * (LV.w + 18), true);
  setTimeout(() => {
    if (!LV.el) return;
    if (step > 0) LV.slides.push(LV.slides.shift()); else LV.slides.unshift(LV.slides.pop());
    LV.idx = target;
    history.replaceState({lv: LV.list[LV.idx].i}, "");
    lvFill(false);
  }, 280);
}
function lvCur(){ return LV.slides[1]?.querySelector(".lv-zoom"); }
function lvApplyZoom(animate){
  const z = lvCur(); if (!z) return;
  z.style.transition = animate ? "transform .25s ease" : "none";
  z.style.transform = `translate3d(${LV.zoom.x}px,${LV.zoom.y}px,0) scale(${LV.zoom.s})`;
}
function lvResetZoom(animate){ LV.zoom = {s: 1, x: 0, y: 0}; lvApplyZoom(animate); }
function lvImgBox(){
  const img = LV.slides[1]?.querySelector(".lv-full.ok") || LV.slides[1]?.querySelector(".lv-ph");
  const nw = img?.naturalWidth || 4, nh = img?.naturalHeight || 5;
  const k = Math.min(LV.w / nw, LV.h / nh);
  return {w: nw * k, h: nh * k};
}
function lvClamp(){
  const b = lvImgBox(), s = LV.zoom.s;
  const mx = Math.max(0, (b.w * s - LV.w) / 2), my = Math.max(0, (b.h * s - LV.h) / 2);
  LV.zoom.x = Math.max(-mx, Math.min(mx, LV.zoom.x)); LV.zoom.y = Math.max(-my, Math.min(my, LV.zoom.y));
}
function lvZoomAt(px, py, s){
  const cx = LV.w / 2, cy = LV.h / 2, old = LV.zoom;
  // keep the touched point under the finger
  const fx = (px - cx - old.x) / old.s, fy = (py - cy - old.y) / old.s;
  LV.zoom = {s, x: px - cx - fx * s, y: py - cy - fy * s};
  if (s <= 1.001) LV.zoom = {s: 1, x: 0, y: 0};
  lvClamp();
}
function lvBind(){
  const el = LV.el, track = el.querySelector(".lv-track");
  el.querySelectorAll("[data-a]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const it = LV.list[LV.idx], a = b.dataset.a;
    if (a === "back") history.back();
    else if (a === "info") openInfo(LV.list, LV.idx);
    else if (a === "story") { const list = LV.list, idx = LV.idx; lvClose(true, true); storiesOpen(list, idx, {title: currentTitle || "Gallery", replace: true}); }
    else if (a === "fav") toggleFav(it).then(() => lvChrome(LV.list[LV.idx]));
    else if (a === "dl") downloadOriginal(it);
    else if (a === "share") shareItem(it);
  });
  const P = new Map(); let g = null, lastTap = 0, tapTimer = 0;
  const dist = () => { const [a, b] = [...P.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...P.values()]; return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}; };
  const capture = id => { try { track.setPointerCapture(id); } catch (err) {} };
  track.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    P.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (P.size === 2) P.forEach((v, id) => capture(id));
    if (P.size === 1) g = {mode: "", x0: e.clientX, y0: e.clientY, t0: performance.now(), zx: LV.zoom.x, zy: LV.zoom.y, moved: 0};
    else if (P.size === 2) { const m = mid(); g = {mode: "pinch", d0: dist(), s0: LV.zoom.s, m0: m, zx: LV.zoom.x, zy: LV.zoom.y, moved: 99}; }
  });
  track.addEventListener("pointermove", e => {
    if (!P.has(e.pointerId) || !g) return;
    P.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (g.mode === "pinch" && P.size === 2) {
      const m = mid(), s = Math.max(1, Math.min(6, g.s0 * dist() / g.d0));
      LV.zoom = {s: g.s0, x: g.zx, y: g.zy}; lvZoomAt(g.m0.x, g.m0.y, s);
      LV.zoom.x += m.x - g.m0.x; LV.zoom.y += m.y - g.m0.y; lvClamp(); lvApplyZoom(false); return;
    }
    if (P.size !== 1) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    g.moved = Math.max(g.moved, Math.hypot(dx, dy));
    if (LV.zoom.s > 1.01) { if (g.moved > 9) capture(e.pointerId); LV.zoom.x = g.zx + dx; LV.zoom.y = g.zy + dy; lvClamp(); lvApplyZoom(false); return; }
    if (!g.mode && g.moved > 9) { g.mode = Math.abs(dx) > Math.abs(dy) ? "x" : (dy > 0 ? "down" : "up"); capture(e.pointerId); }
    if (g.mode === "x") lvPlace(dx * ((LV.idx === 0 && dx > 0) || (LV.idx === LV.list.length - 1 && dx < 0) ? .3 : 1), false);
    else if (g.mode === "down") {
      const z = lvCur(), k = Math.max(.6, 1 - dy / 1600);
      z.style.transition = "none"; z.style.transform = `translate3d(${dx * .6}px,${dy}px,0) scale(${k})`;
      el.querySelector(".lv-bg").style.opacity = String(Math.max(0, 1 - dy / 450));
      el.classList.add("hide-chrome");
    } else if (g.mode === "up") el.querySelector(".lv-hint").classList.toggle("show", dy < -30);
  });
  const end = e => {
    if (!P.has(e.pointerId)) return;
    P.delete(e.pointerId);
    if (!g) return;
    if (g.mode === "pinch") { if (P.size === 0) { if (LV.zoom.s < 1.05) lvResetZoom(true); g = null; } else g.mode = "panlock"; return; }
    if (P.size) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dt = Math.max(1, performance.now() - g.t0);
    const mode = g.mode; g = null;
    el.querySelector(".lv-hint").classList.remove("show");
    if (mode === "x") {
      if (Math.abs(dx) > LV.w * .22 || Math.abs(dx) / dt > .5) lvGo(dx < 0 ? 1 : -1); else lvPlace(0, true);
    } else if (mode === "down") {
      if (dy > 120 || dy / dt > .65) { lvClose(false); history.back(); }
      else { const z = lvCur(); z.style.transition = "transform .25s ease"; z.style.transform = ""; el.querySelector(".lv-bg").style.opacity = ""; el.classList.remove("hide-chrome"); lvApplyZoom(true); }
    } else if (mode === "up") {
      if (dy < -80) openInfo(LV.list, LV.idx);
    } else if (dt < 300 && Math.hypot(dx, dy) < 10) {
      const now = performance.now();
      if (now - lastTap < 290) {               // double tap: zoom at the finger / back to fit
        clearTimeout(tapTimer); lastTap = 0;
        if (LV.zoom.s > 1.01) lvResetZoom(true); else { lvZoomAt(e.clientX, e.clientY, 2.6); lvApplyZoom(true); }
        haptic("tick");
      } else {
        lastTap = now;
        tapTimer = setTimeout(() => el.classList.toggle("hide-chrome"), 300);
      }
    }
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("wheel", e => {             // desktop browsers: wheel/trackpad zoom
    e.preventDefault();
    lvZoomAt(e.clientX, e.clientY, Math.max(1, Math.min(6, LV.zoom.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); lvApplyZoom(false);
  }, {passive: false});
}
function lvRectOf(w, h){
  const k = Math.min(LV.w / (w || 4), LV.h / (h || 5)), bw = (w || 4) * k, bh = (h || 5) * k;
  return {left: (LV.w - bw) / 2, top: (LV.h - bh) / 2, width: bw, height: bh};
}
function lvFlyIn(it){
  const tile = LV.from?.querySelector?.("img.ok"), src = tile?.src;
  if (!src || reduceMotion()) return Promise.resolve();
  const r = LV.from.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > LV.h) return Promise.resolve();
  const fly = document.createElement("img"); fly.className = "lv-fly"; fly.src = src;
  Object.assign(fly.style, {left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px"});
  document.body.appendChild(fly);
  const t = lvRectOf(tile.naturalWidth, tile.naturalHeight);
  const a = fly.animate([{left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", borderRadius: "10px"},
    {left: t.left + "px", top: t.top + "px", width: t.width + "px", height: t.height + "px", borderRadius: "0px"}], {duration: 300, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards"});
  LV.slides[1].style.opacity = "0";
  return a.finished.catch(() => {}).then(() => { if (LV.slides[1]) LV.slides[1].style.opacity = ""; fly.remove(); });
}
function lvTileFor(it){
  const img = document.querySelector(`.grid img[data-id="${CSS.escape(it.i)}"].ok`);
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight ? img : null;
}
function lvClose(silent, immediate){
  const el = LV.el; if (!el || LV.closing) return;
  LV.closing = true;
  const it = LV.list[LV.idx], tile = !immediate && it && lvTileFor(it);
  const finish = () => { el.remove(); if (!$("#story") && !$("#detail")) document.body.style.overflow = ""; };
  LV.el = null;
  if (!tile || reduceMotion() || immediate) { if (immediate) finish(); else { el.style.transition = "opacity .2s"; el.style.opacity = "0"; setTimeout(finish, 200); } return; }
  const shown = LV.slides[1]?.querySelector(".lv-full.ok") || LV.slides[1]?.querySelector(".lv-ph");
  const t = tile.getBoundingClientRect(), from = lvRectOf(shown?.naturalWidth || tile.naturalWidth, shown?.naturalHeight || tile.naturalHeight);
  const fly = document.createElement("img"); fly.className = "lv-fly"; fly.src = shown?.src || tile.src;
  Object.assign(fly.style, {left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px"});
  document.body.appendChild(fly);
  LV.slides.forEach(s => s.style.opacity = "0");
  el.style.transition = "opacity .28s"; el.style.opacity = "0";
  fly.animate([{left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px", borderRadius: "0px"},
    {left: t.left + "px", top: t.top + "px", width: t.width + "px", height: t.height + "px", borderRadius: "10px"}], {duration: 280, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards"})
    .finished.catch(() => {}).then(() => { fly.remove(); finish(); });
}
window.addEventListener("popstate", () => {
  if (LV.el) {
    if (history.state && history.state.lv) {        // came back from the details sheet
      if (S.detailList === LV.list && detailIdx >= 0 && detailIdx !== LV.idx) { LV.idx = detailIdx; lvFill(true); }
      else lvChrome(LV.list[LV.idx]);
    } else lvClose(false);
  }
});
window.addEventListener("resize", () => { if (LV.el) { lvMeasure(); lvResetZoom(false); lvPlace(0, false); } });
window.addEventListener("hashchange", () => { lvClose(true, true); storiesClose(true); sheetClose(true); });
document.addEventListener("keydown", e => {
  if (!LV.el || $("#detail")) return;
  if (e.key === "ArrowRight") lvGo(1); else if (e.key === "ArrowLeft") lvGo(-1); else if (e.key === "Escape") history.back();
});

/* =================================================================== long press: quick actions */
let SH = null;
function sheetOpen(it, list){
  sheetClose(true);
  haptic("long");
  const idx = Math.max(0, list.findIndex(x => x.i === it.i));
  const back = document.createElement("div"); back.className = "cvs-back";
  const sh = document.createElement("div"); sh.className = "cvs"; sh.id = "cvsheet";
  const ents = (it.e || []).map(id => S.entById.get(id)).filter(Boolean);
  sh.innerHTML = `<div class="grab"></div>
    <div class="cvs-head"><div class="th"><img alt=""></div><div style="min-width:0;flex:1"><b>${esc(titleOf(it))}</b>
      <span>${esc([it.w && it.h ? `${it.w}×${it.h}` : "", displayLabel(it.c), (it.dt || "").slice(0, 10)].filter(Boolean).join(" · "))}</span></div></div>
    <div class="cvs-row"><button class="fav ${it.fav ? "on" : ""}" data-q="fav">${it.fav ? "♥" : "♡"}</button><div class="lv-stars">${starsHtml(it.r)}</div></div>
    <button class="cvs-act" data-q="open">${ico("image")}Open</button>
    <button class="cvs-act fill" data-q="story">${ico("play")}Stories from here</button>
    <button class="cvs-act" data-q="info">${ico("info")}Details, notes and tags</button>
    <button class="cvs-act" data-q="dl" ${it.o ? "" : "disabled style=opacity:.45"}>${ico("download")}Download original</button>
    <button class="cvs-act" data-q="share">${ico("share")}Share</button>
    ${ents.map(e => `<button class="cvs-act" data-go="#/person/${encodeURIComponent(e.id)}">${ico("users")}${esc(e.name)}</button>`).join("")}`;
  document.body.append(back, sh);
  SH = {back, sh};
  history.pushState({cvsheet: 1}, "");
  coverUrl(it).then(u => { if (u) sh.querySelector(".th img").src = u; });
  const dismiss = () => { sheetClose(false); history.back(); };
  const swap = open => { sheetClose(false); open(); };        // the next screen replaces this history entry
  back.onclick = dismiss;
  sh.querySelector('[data-q="fav"]').onclick = async e => { await toggleFav(it); e.target.classList.toggle("on", !!it.fav); e.target.textContent = it.fav ? "♥" : "♡"; refreshTileBadge(it); };
  const bindStars = () => sh.querySelectorAll("[data-st]").forEach(b => b.onclick = async () => {
    await setRating(it, +b.dataset.st); sh.querySelector(".lv-stars").innerHTML = starsHtml(it.r); bindStars(); refreshTileBadge(it); });
  bindStars();
  sh.querySelector('[data-q="open"]').onclick = () => swap(() => lvOpen(list, idx, document.querySelector(`.grid img[data-id="${CSS.escape(it.i)}"]`)?.closest(".card"), true));
  sh.querySelector('[data-q="story"]').onclick = () => swap(() => storiesOpen(list, idx, {title: currentTitle || "Gallery", replace: true}));
  sh.querySelector('[data-q="info"]').onclick = () => swap(() => openInfo(list, idx, true));
  sh.querySelector('[data-q="dl"]').onclick = () => { dismiss(); downloadOriginal(it); };
  sh.querySelector('[data-q="share"]').onclick = () => { dismiss(); shareItem(it); };
  sh.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { sheetClose(false); history.replaceState(null, ""); location.hash = b.dataset.go; });
}
function sheetClose(silent){ if (!SH) return; SH.back.remove(); SH.sh.remove(); SH = null; }
window.addEventListener("popstate", () => { if (SH && !(history.state && history.state.cvsheet)) sheetClose(true); });
function refreshTileBadge(it){
  document.querySelectorAll(`.grid img[data-id="${CSS.escape(it.i)}"]`).forEach(img => {
    const card = img.closest(".card"); if (!card) return;
    card.querySelectorAll(".badge").forEach(b => { if (!b.textContent.includes("Video")) b.remove(); });
    if (it.fav || it.r) card.insertAdjacentHTML("beforeend", it.fav ? '<span class="badge">♥</span>' : `<span class="badge">★${it.r}</span>`);
  });
}
(function longPress(){
  let timer = 0, start = null, fired = false, target = null;
  const cancel = () => { clearTimeout(timer); timer = 0; target = null; };
  document.addEventListener("pointerdown", e => {
    if (!PREF.modern || e.pointerType === "mouse" && e.button !== 0) return;
    const card = e.target.closest?.(".grid .card"); if (!card) return;
    const img = card.querySelector("img[data-id]"); if (!img) return;
    fired = false; start = {x: e.clientX, y: e.clientY}; target = card;
    timer = setTimeout(() => {
      const it = S.byId.get(img.dataset.id); if (!it || !target) return;
      fired = true;
      const inMain = card.closest("#grid");
      sheetOpen(it, inMain ? S.list : S.index.images);
    }, 470);
  }, true);
  document.addEventListener("pointermove", e => { if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); }, true);
  document.addEventListener("pointerup", cancel, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("click", e => { if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("contextmenu", e => { if (e.target.closest?.(".grid .card, .lv, .st")) e.preventDefault(); });
})();

/* =================================================================== pinch to change gallery columns */
function applyCols(){
  const n = PREF.cols, html = document.documentElement;
  html.classList.toggle("cols-fixed", n >= 2);
  if (n >= 2) html.style.setProperty("--cols", n); else html.style.removeProperty("--cols");
}
(function pinchColumns(){
  let d0 = 0, base = 0, done = false;
  const span = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const current = () => PREF.cols || Math.max(2, Math.min(5, Math.round((document.querySelector("#grid")?.clientWidth || 360) / 114)));
  document.addEventListener("touchstart", e => {
    if (!PREF.modern || e.touches.length !== 2 || !e.target.closest?.("#grid")) return;
    d0 = span(e.touches); base = current(); done = false;
  }, {passive: true});
  document.addEventListener("touchmove", e => {
    if (!d0 || e.touches.length !== 2) return;
    e.preventDefault();
    if (done) return;
    const r = span(e.touches) / d0;
    let n = base;
    if (r < .78) n = Math.min(5, base + 1); else if (r > 1.28) n = Math.max(2, base - 1);
    if (n !== base) {
      done = true; setPref("cv_cols", n); haptic("tick");
      const run = () => applyCols();
      if (document.startViewTransition && !reduceMotion()) document.startViewTransition(run); else run();
      floatBadge(`${n} columns`);
    }
  }, {passive: false});
  document.addEventListener("touchend", e => { if (e.touches.length < 2) d0 = 0; }, {passive: true});
})();

/* =================================================================== stories and slideshow */
const ST = {el: null, list: [], idx: 0, title: "", paused: false, t0: 0, elapsed: 0, dur: 5000, raf: 0, anim: null,
  layer: 0, audio: null, landscape: false, fill: false, token: 0, video: null, wake: null};
const MUSIC = {url: "", name: ""};

function idb(){
  return new Promise((res, rej) => { const r = indexedDB.open("cv-ui", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbGet(key){ const db = await idb(); return new Promise(res => { const q = db.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); }
async function idbSet(key, value){ const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(value, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function idbDel(key){ const db = await idb(); return new Promise(res => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").delete(key); t.oncomplete = () => res(); t.onerror = () => res(); }); }
async function loadMusic(){
  try {
    const m = await idbGet("music");
    if (m?.blob) { if (MUSIC.url) URL.revokeObjectURL(MUSIC.url); MUSIC.url = URL.createObjectURL(m.blob); MUSIC.name = m.name || "Music"; }
  } catch (e) {}
}
function pickMusic(after){
  const input = document.createElement("input"); input.type = "file"; input.accept = "audio/*"; input.style.display = "none";
  input.onchange = async () => {
    const f = input.files?.[0]; input.remove(); if (!f) return;
    if (f.size > 60e6) { toast("Choose an audio file smaller than 60 MB."); return; }
    try { await idbSet("music", {name: f.name.replace(/\.[^.]+$/, ""), type: f.type, blob: f}); } catch (e) { toast("Cannot store the music on this device."); return; }
    setPref("cv_music_on", "1"); await loadMusic(); toast(`Music: ${MUSIC.name}`); after?.();
  };
  document.body.appendChild(input); input.click();
}
async function removeMusic(){ await idbDel("music"); if (MUSIC.url) URL.revokeObjectURL(MUSIC.url); MUSIC.url = ""; MUSIC.name = ""; setPref("cv_music_on", "0"); }

function musicStart(){
  if (!PREF.music || !MUSIC.url) return;
  const a = new Audio(MUSIC.url); a.loop = true; a.volume = 0;
  ST.audio = a;
  a.play().then(() => fadeVol(a, .8, 900)).catch(() => {});
  const n = ST.el?.querySelector(".st-music-name");
  if (n) { n.textContent = "♪ " + MUSIC.name; n.classList.add("show"); setTimeout(() => n.classList.remove("show"), 2600); }
}
function fadeVol(a, to, ms){
  const from = a.volume, t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / ms); a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function musicStop(){ const a = ST.audio; ST.audio = null; if (!a) return; fadeVol(a, 0, 400); setTimeout(() => { a.pause(); a.src = ""; }, 450); }

function storiesOpen(list, start, opts = {}){
  const items = (list || []).filter(Boolean);
  if (!items.length) { toast("Nothing to show."); return; }
  storiesClose(true);
  ST.list = opts.shuffle ? shuffled(items, items[start]) : items;
  ST.idx = opts.shuffle ? 0 : Math.max(0, Math.min(items.length - 1, start || 0));
  ST.title = opts.title || "Stories"; ST.paused = false; ST.landscape = false; ST.fill = false; ST.token++;
  ST.dur = PREF.storySec * 1000;
  const el = document.createElement("div"); el.className = "st"; el.id = "story";
  const many = ST.list.length > 30;
  el.innerHTML = `<div class="st-amb"></div><div class="st-layer"></div><div class="st-layer"></div>
    <div class="st-top"><div class="st-bars">${many ? "<i><b></b></i>" : ST.list.map(() => "<i><b></b></i>").join("")}</div>
      <div class="st-row">${logoSvg(34)}<div class="st-name"><b>${esc(ST.title)}</b><span></span></div>
        <button class="lv-btn" data-s="shuffle" aria-label="Shuffle">${ico("shuffle")}</button>
        <button class="lv-btn" data-s="music" aria-label="Music">${ico("music")}</button>
        <button class="lv-btn" data-s="rotate" aria-label="Slideshow">${ico("rotate")}</button>
        <button class="lv-btn" data-s="close" aria-label="Close">${ico("close")}</button></div></div>
    <div class="st-music-name"></div><div class="st-paused"><svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></div>
    <div class="st-spin"></div><button class="st-watch">▶ Watch the full video</button>
    <div class="st-bottom"><div class="st-cap"><b></b><span></span></div>
      <button class="lv-btn" data-s="fav" aria-label="Favorite">${ico("heart")}</button>
      <button class="lv-btn" data-s="open" aria-label="Open">${ico("info")}</button></div>`;
  document.body.appendChild(el); document.body.style.overflow = "hidden";
  ST.el = el;
  (opts.replace ? history.replaceState : history.pushState).call(history, {story: 1}, "");
  stBind();
  musicStart();
  keepAwake(true);
  if (nativeHas("immersive")) { try { window.CVNative.immersive(true, false); } catch (e) {} }
  if (opts.landscape) stLandscape(true);
  stShow(ST.idx);
}
function shuffled(items, first){
  const a = items.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (first) { const k = a.indexOf(first); if (k > 0) [a[0], a[k]] = [a[k], a[0]]; }
  return a;
}
function keepAwake(on){
  if (nativeHas("immersive")) return;   // the Android app keeps the screen on in immersive mode
  try {
    if (on && navigator.wakeLock) navigator.wakeLock.request("screen").then(l => { ST.wake = l; }).catch(() => {});
    else if (!on && ST.wake) { ST.wake.release(); ST.wake = null; }
  } catch (e) {}
}
function stLandscape(on){
  ST.landscape = on; ST.fill = on;
  ST.el?.classList.toggle("fill", on);
  ST.el?.querySelector('[data-s="rotate"]')?.classList.toggle("on", on);
  if (nativeHas("immersive")) { try { window.CVNative.immersive(true, on); } catch (e) {} return; }
  try {
    if (on) document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.("landscape").catch(() => {})).catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.();
  } catch (e) {}
}
function stBars(){
  const bars = ST.el?.querySelectorAll(".st-bars i"); if (!bars) return;
  if (bars.length === 1) return;
  bars.forEach((b, i) => { b.classList.toggle("done", i < ST.idx); b.querySelector("b").style.width = i < ST.idx ? "100%" : "0"; });
}
async function stShow(i){
  if (!ST.el) return;
  if (i >= ST.list.length) { storiesClose(false); history.back(); return; }
  ST.idx = Math.max(0, i);
  const token = ++ST.token, it = ST.list[ST.idx], el = ST.el;
  cancelAnimationFrame(ST.raf);
  const oldAnim = ST.anim; ST.anim = null; oldAnim?.pause();      // freeze, do not jump back while fading
  if (ST.video) { ST.video.pause(); ST.video = null; }
  el.classList.remove("can-watch");
  stBars();
  el.querySelector(".st-name span").textContent = `${ST.idx + 1} / ${ST.list.length}`;
  el.querySelector(".st-cap b").textContent = titleOf(it);
  el.querySelector(".st-cap span").textContent = [namesOf(it).join(", "), displayLabel(it.c)].filter(Boolean).join(" · ");
  const fav = el.querySelector('[data-s="fav"]'); fav.classList.toggle("on", !!it.fav);
  const spin = setTimeout(() => { if (token === ST.token) el.classList.add("loading"); }, 280);
  let node, dur = PREF.storySec * 1000, watch = false;
  try {
    const cover = await coverUrl(it);
    if (cover) el.querySelector(".st-amb").style.backgroundImage = `url("${cover}")`;
    if (isVideo(it)) {
      // Short clips play muted inside the story; longer videos show their cover and a Watch button.
      const short = it.o && Number(it.dur || 0) > 0 && Number(it.dur) <= 20;
      if (short) {
        const blob = await (await api(`${API}/files/${it.o}?alt=media&supportsAllDrives=true`)).blob();
        if (token !== ST.token) return;
        node = document.createElement("video"); node.muted = true; node.playsInline = true; node.autoplay = true; node.src = URL.createObjectURL(blob);
        await new Promise(r => { node.onloadeddata = r; node.onerror = r; setTimeout(r, 8000); });
        dur = Math.min(20000, Math.max(3000, (node.duration || it.dur || 5) * 1000));
        ST.video = node;
      } else {
        node = new Image(); node.src = cover || ""; watch = true;
      }
    } else {
      const src = (await fullUrl(it).catch(() => "")) || cover;
      if (token !== ST.token) return;
      node = new Image(); node.src = src;
      await node.decode().catch(() => {});
    }
  } catch (e) {
    node = new Image();
  }
  clearTimeout(spin);
  if (token !== ST.token || !ST.el) return;
  el.classList.remove("loading");
  const layers = el.querySelectorAll(".st-layer");
  const other = layers[0].classList.contains("on") ? layers[0] : layers[1];
  const layer = other === layers[0] ? layers[1] : layers[0];
  layer.querySelectorAll("video").forEach(v => { v.pause(); if (v.src.startsWith("blob:")) URL.revokeObjectURL(v.src); });
  layer.innerHTML = ""; layer.classList.toggle("nsfw", nsfw(it));
  layer.appendChild(node);
  if (watch) {
    el.classList.add("can-watch");
    el.querySelector(".st-watch").onclick = e => { e.stopPropagation(); stPause(true); if (it.o) playVideo(it.o, titleOf(it), layer); };
  }
  layer.classList.add("on"); other.classList.remove("on");
  setTimeout(() => { oldAnim?.cancel(); if (token === ST.token) { other.querySelectorAll("video").forEach(v => { v.pause(); if (v.src.startsWith("blob:")) URL.revokeObjectURL(v.src); }); other.innerHTML = ""; } }, 600);
  if (node.tagName === "IMG" && PREF.kenBurns && !reduceMotion()) ST.anim = kenBurns(node, dur);
  if (node.tagName === "VIDEO") node.play?.().catch(() => {});
  ST.dur = dur; ST.elapsed = 0; ST.t0 = performance.now();
  if (ST.paused) { ST.anim?.pause(); node.pause?.(); }
  const next = ST.list[ST.idx + 1]; if (next && fullId(next)) fullUrl(next).catch(() => {});
  stTick(token);
}
function kenBurns(img, dur){
  const presets = [
    [[1, 0, 0], [1.14, 0, -2.5]], [[1.15, 0, -2], [1, 0, 1]], [[1.1, -3, 0], [1.1, 3, -1]],
    [[1.1, 3, -1], [1.1, -3, 0]], [[1, 0, 2], [1.12, 0, -3]],
  ];
  const [a, b] = presets[Math.floor(Math.random() * presets.length)];
  const tf = ([s, x, y]) => `scale(${s}) translate(${x}%,${y}%)`;
  try { return img.animate([{transform: tf(a)}, {transform: tf(b)}], {duration: dur + 700, easing: "ease-in-out", fill: "forwards"}); } catch (e) { return null; }
}
function stTick(token){
  const step = now => {
    if (token !== ST.token || !ST.el) return;
    if (!ST.paused) {
      ST.elapsed = ST.video && ST.video.duration ? ST.video.currentTime * 1000 : ST.elapsed + (now - ST.t0);
    }
    ST.t0 = now;
    const k = Math.min(1, ST.elapsed / ST.dur);
    const bars = ST.el.querySelectorAll(".st-bars i b");
    if (bars.length === 1) bars[0].style.width = (100 * (ST.idx + k) / ST.list.length).toFixed(2) + "%";
    else if (bars[ST.idx]) bars[ST.idx].style.width = (k * 100).toFixed(2) + "%";
    if (k >= 1 && !ST.paused) { stShow(ST.idx + 1); return; }
    ST.raf = requestAnimationFrame(step);
  };
  ST.raf = requestAnimationFrame(step);
}
function stPause(on){
  if (!ST.el) return;
  ST.paused = on; ST.el.classList.toggle("paused", on);
  if (on) { ST.anim?.pause(); ST.video?.pause(); if (ST.audio) fadeVol(ST.audio, .25, 250); }
  else { ST.anim?.play(); ST.video?.play().catch(() => {}); if (ST.audio) { ST.audio.play().catch(() => {}); fadeVol(ST.audio, .8, 400); } }
}
function stBind(){
  const el = ST.el;
  el.querySelectorAll("[data-s]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const it = ST.list[ST.idx], a = b.dataset.s;
    if (a === "close") history.back();
    else if (a === "rotate") stLandscape(!ST.landscape);
    else if (a === "shuffle") { const cur = ST.list[ST.idx]; ST.list = shuffled(ST.list, cur); ST.idx = 0; floatBadge("Shuffled"); stShow(0); }
    else if (a === "music") {
      if (!MUSIC.url) { stPause(true); pickMusic(() => { musicStart(); stPause(false); }); return; }
      if (ST.audio) { setPref("cv_music_on", "0"); musicStop(); floatBadge("Music off"); }
      else { setPref("cv_music_on", "1"); musicStart(); }
    }
    else if (a === "fav") toggleFav(it).then(() => b.classList.toggle("on", !!it.fav));
    else if (a === "open") { const list = ST.list, i = ST.idx; storiesClose(true); lvOpen(list, i, null, true); }
  }));
  let down = null, hold = 0;
  el.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    down = {x: e.clientX, y: e.clientY, t: performance.now(), held: false};
    hold = setTimeout(() => { if (down) { down.held = true; stPause(true); } }, 200);
  });
  el.addEventListener("pointerup", e => {
    clearTimeout(hold);
    if (!down) return;
    const d = down; down = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.held) { stPause(false); if (dy < 120) return; }
    if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { storiesClose(false); history.back(); return; }
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { stShow(ST.idx + (dx < 0 ? 1 : -1)); return; }
    if (Math.hypot(dx, dy) < 12) {
      if (ST.landscape && e.clientY > window.innerHeight * .25 && e.clientY < window.innerHeight * .75 && e.clientX > window.innerWidth * .3 && e.clientX < window.innerWidth * .7) {
        el.classList.toggle("chrome-off"); return;
      }
      if (ST.paused) stPause(false);
      stShow(ST.idx + (e.clientX < window.innerWidth * .33 ? -1 : 1));
    }
  });
  el.addEventListener("pointercancel", () => { clearTimeout(hold); if (down?.held) stPause(false); down = null; });
}
function storiesClose(silent){
  if (!ST.el) return;
  ST.token++; cancelAnimationFrame(ST.raf); ST.anim?.cancel();
  ST.el.querySelectorAll("video").forEach(v => { v.pause(); if (v.src.startsWith("blob:")) URL.revokeObjectURL(v.src); });
  musicStop(); keepAwake(false);
  if (nativeHas("immersive")) { try { window.CVNative.immersive(false, false); } catch (e) {} }
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  const el = ST.el; ST.el = null; ST.video = null;
  el.style.transition = "opacity .2s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 220);
  if (!LV.el && !$("#detail")) document.body.style.overflow = "";
}
window.addEventListener("popstate", () => { if (ST.el && !(history.state && history.state.story)) storiesClose(true); });
document.addEventListener("keydown", e => {
  if (!ST.el) return;
  if (e.key === "ArrowRight") stShow(ST.idx + 1); else if (e.key === "ArrowLeft") stShow(ST.idx - 1);
  else if (e.key === " ") { e.preventDefault(); stPause(!ST.paused); } else if (e.key === "Escape") history.back();
});
// Home button, another app, screen off: stop the story and its music (not only lower the volume).
function appHidden(){ if (!ST.el) return; stPause(true); ST.audio?.pause(); }
window.__cvAppPaused = appHidden;                       // called by the Android app in onPause
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") appHidden(); });

/* =================================================================== hooks into the core screens */
const core = {openDetail, bindCommon, renderPerson, renderThing, renderSettings};

window.openDetail = function (id, list){
  if (!PREF.modern) return core.openDetail(id, list);
  const l = list || S.list, idx = l.findIndex(x => x.i === id);
  const from = document.querySelector(`.grid img[data-id="${CSS.escape(id)}"]`)?.closest(".card");
  lvOpen(l, idx, from);
};

window.bindCommon = function (){
  core.bindCommon();
  if (!PREF.modern || !["gallery", "person", "thing"].includes(S.view)) return;
  const row = document.querySelector(".searchrow"); if (!row || row.querySelector("#playall")) return;
  const b = document.createElement("button"); b.className = "icon-btn play"; b.id = "playall"; b.setAttribute("aria-label", "Stories");
  b.innerHTML = ico("play");
  b.onclick = () => storiesOpen(S.list, 0, {title: S.view === "gallery" ? (S.query ? `“${S.query}”` : "Gallery") : currentTitle});
  row.appendChild(b);
};

function hero(kind, obj, images){
  const main = document.querySelector("main"); if (!main || !obj) return;
  const cover = S.byId.get(obj.cover) || images[0];
  const sub = kind === "p" ? `${images.length} images${obj.type ? " · " + esc(obj.type) : ""}` : `${images.length} images${obj.kind ? " · " + esc(obj.kind) : ""}`;
  const h = document.createElement("section"); h.className = "hero";
  h.innerHTML = `<div class="hero-bg"><img alt=""></div><div class="hero-fg"><div class="hero-av"><img alt=""></div>
    <div class="hero-txt"><b>${esc(obj.name)}</b><span>${sub}</span>
      <div class="row"><button class="btn primary" data-h="story">${ico("play")} Stories</button><button class="btn" data-h="slide">${ico("rotate")} Slideshow</button></div></div></div>`;
  const title = main.querySelector(".section-title");
  main.insertBefore(h, title ? title.nextSibling : main.firstChild);
  if (title) title.querySelector("h2").style.visibility = "hidden";
  if (cover) coverUrl(cover).then(u => { if (!u) return; h.querySelectorAll("img").forEach(i => { i.onload = () => i.classList.add("ok"); i.src = u; }); });
  h.querySelector('[data-h="story"]').onclick = () => storiesOpen(S.list.length ? S.list : images, 0, {title: obj.name});
  h.querySelector('[data-h="slide"]').onclick = () => storiesOpen(S.list.length ? S.list : images, 0, {title: obj.name, landscape: true});
}
window.renderPerson = function (id){
  core.renderPerson(id);
  if (PREF.modern && S.view === "person") hero("p", S.entById.get(id), currentBase);
};
window.renderThing = function (id){
  core.renderThing(id);
  if (PREF.modern && S.view === "thing") hero("t", S.thingById.get(id), currentBase);
};

window.renderSettings = function (){
  core.renderSettings();
  const main = document.querySelector("main"); if (!main) return;
  const seg = (key, value, options) => `<div class="seg" data-pref="${key}">${options.map(([v, l]) => `<button data-v="${v}" class="${String(value) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const dynamic = (() => { try { return nativeHas("theme") && JSON.parse(window.CVNative.theme() || "{}").dynamic; } catch (e) { return false; } })();
  const p = document.createElement("div"); p.className = "panel appearance";
  p.innerHTML = `<h4>Appearance</h4>
    <div class="lbl">Interface</div>${seg("cv_ui", PREF.modern ? "modern" : "classic", [["modern", "Modern"], ["classic", "Classic"]])}
    <div class="muted" style="margin-top:6px">Modern: full-screen viewer with gestures, long-press menu, stories. Classic: the previous screens.</div>
    ${dynamic ? `<div class="lbl">Colors</div>${seg("cv_colors", PREF.colors, [["brand", "Character Vault"], ["system", "Material You"]])}` : ""}
    <div class="lbl">Gallery columns</div>${seg("cv_cols", PREF.cols || 0, [[0, "Auto"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]])}
    <div class="muted" style="margin-top:6px">Tip: pinch the gallery with two fingers to change columns.</div>
    <div class="lbl">Stories · seconds per photo</div>${seg("cv_story_sec", PREF.storySec, [[3, "3 s"], [5, "5 s"], [8, "8 s"], [12, "12 s"]])}
    <div class="switch"><span>Slow zoom effect on photos</span><input type="checkbox" id="kb" ${PREF.kenBurns ? "checked" : ""}></div>
    <div class="switch"><span>Background music in stories</span><input type="checkbox" id="mus" ${PREF.music ? "checked" : ""}></div>
    <div class="row"><span class="muted" id="musname" style="flex:1">${MUSIC.name ? "♪ " + esc(MUSIC.name) : "No music chosen"}</span>
      <button class="btn" id="muspick">${ico("music")} Choose</button>${MUSIC.name ? `<button class="btn" id="musdel">Remove</button>` : ""}</div>`;
  const title = main.querySelector(".section-title");
  main.insertBefore(p, title ? title.nextSibling : main.firstChild);
  p.querySelectorAll("[data-pref]").forEach(group => group.querySelectorAll("button").forEach(b => b.onclick = () => {
    setPref(group.dataset.pref, b.dataset.v); haptic("tick");
    if (group.dataset.pref === "cv_colors") applyTheme();
    if (group.dataset.pref === "cv_cols") applyCols();
    window.renderSettings();
  }));
  p.querySelector("#kb").onchange = e => setPref("cv_kenburns", e.target.checked ? "1" : "0");
  p.querySelector("#mus").onchange = e => { if (e.target.checked && !MUSIC.url) { e.target.checked = false; pickMusic(() => window.renderSettings()); return; } setPref("cv_music_on", e.target.checked ? "1" : "0"); };
  p.querySelector("#muspick").onclick = () => pickMusic(() => window.renderSettings());
  const del = p.querySelector("#musdel"); if (del) del.onclick = async () => { await removeMusic(); window.renderSettings(); };
};

/* =================================================================== start */
applyTheme();
applyCols();
loadMusic();
window.__cvUi72 = {lvOpen, storiesOpen, sheetOpen, applyTheme, PREF};   // used by the automated phone tests
})();
