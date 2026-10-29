/* Character Vault 8.2.1 — Genesis directly on the phone.
 *
 * The OpenAI key is saved by the native app (Android Keystore) and never comes back to this page: the page only
 * asks CVNative.genesisPhoneState() whether one is saved. The app calls the OpenAI Images API, shows the image and
 * uploads it to the Drive inbox like a phone photo; the PC that edits the archive imports it and Codex catalogs it.
 * There is no Codex on the phone: the character is drawn here from a random blueprint (same MASTER prompt and the
 * same CHARACTER SPECIFICATION fields as Genesis Studio) and can be edited before sending.
 */
(function () {
"use strict";
const MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const QUALITIES = ["low", "medium", "high", "xhigh", "max"];
const SIZES = ["1152x2048", "1024x1536"];
const FIELDS = ["genre", "species", "apparent_age", "physical_traits", "wardrobe", "pose", "expression", "setting", "lighting", "novelty"];
// Identical to character_vault/genesis/director.py MASTER (checked by tests/test_genesis_phone_v821.py).
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

const GENRES = [
  {g: "contemporary everyday realism", w: ["worn denim jacket over a faded band-less t-shirt, scuffed sneakers", "rain-spotted wool coat, knitted scarf, practical leather boots", "work apron with paint stains over a flannel shirt, canvas trousers", "hospital scrubs under an open puffer jacket, comfortable clogs"], s: ["a cluttered corner bakery at dawn", "a laundromat with humming machines", "a rooftop garden with mismatched planters", "a quiet bus depot after rain"]},
  {g: "near-future cyberpunk street life", w: ["patched techwear layers with reflective seams and a cracked visor pushed up", "second-hand armored jacket with exposed wiring repaired by hand", "oversized rain poncho over a modular utility harness"], s: ["a narrow market alley full of repair stalls and cables", "a noodle counter under flickering signs without readable text", "a parking structure turned into a night bazaar"]},
  {g: "historical late 1800s", w: ["layered wool skirt, fitted waistcoat and a weathered shawl", "tailored frock coat, high collar, mud on the boots", "railway worker overalls with brass buttons and a soot-stained cap"], s: ["a cobbled harbour street with crates and ropes", "a printing workshop with ink-stained presses", "a country railway platform in morning fog"]},
  {g: "medieval low fantasy", w: ["hand-stitched linen tunic, leather belt with pouches, wrapped boots", "dented mail shirt over a quilted gambeson, travel cloak", "herbalist robes with many sewn pockets and drying bundles"], s: ["a stone mill beside a fast stream", "a smoky village tavern with timber beams", "a forest charcoal-burners' camp"]},
  {g: "high fantasy", w: ["ceremonial robes of layered silk and hammered bronze plates", "living-bark armor grown in overlapping plates", "glass-bead embroidered mantle over practical riding leathers"], s: ["a moss-covered ruin with giant roots", "a cliffside monastery of pale stone", "a crystal-lit cave market"]},
  {g: "grounded science fiction", w: ["sun-bleached pressure suit with the helmet tucked under an arm", "orbital station work coverall with tool loops and mended elbows", "terraforming field gear with dust filters and sample pouches"], s: ["a cramped hydroponics bay", "a red desert outpost with solar sheets", "a cargo bay with stacked containers and straps"]},
  {g: "quiet gothic horror", w: ["mourning dress with tarnished silver clasps and frayed lace", "long rain-soaked coat, wide hat, a lantern in hand", "undertaker suit with chalk dust on the sleeves"], s: ["an overgrown cemetery chapel", "a candlelit apothecary with jars", "a fog-filled marsh boardwalk"]},
  {g: "post-apocalyptic survival", w: ["layered scavenged gear, hand-sewn patches, a gas mask hanging at the neck", "repurposed sports pads strapped over a thick hoodie", "desert wraps with a salvaged solar backpack"], s: ["a reclaimed supermarket with a vegetable garden", "a rusted highway overpass camp", "a flooded subway station with rafts"]},
  {g: "1970s retro", w: ["corduroy suit with wide lapels and a patterned shirt", "suede fringe jacket, high-waisted flares, platform boots", "mechanic jumpsuit with a name patch left blank"], s: ["a roadside diner with chrome stools", "a record shop with crates of vinyl", "a garage full of vintage cars"]},
  {g: "nautical adventure", w: ["oilskin coat, knitted sweater, salt-crusted boots", "captain's coat with worn brocade over a linen shirt", "diver's canvas suit with brass fittings"], s: ["a fishing boat deck in grey swell", "a lighthouse store room", "a busy dock with nets and barrels"]},
  {g: "mythic folklore", w: ["embroidered festival garments with bells and woven straps", "fur-trimmed shaman cloak with carved bone toggles", "masked ritual costume of straw and dyed cloth"], s: ["a snowy birch forest clearing", "a terraced rice field at dusk", "a hillside shrine with offerings"]},
  {g: "steampunk workshop", w: ["leather apron with brass tools, rolled sleeves, magnifier goggles", "pin-striped waistcoat with gear-driven prosthetic sleeve", "aviator coat with fur collar and map case"], s: ["a clockwork repair shop", "an airship hangar with patched balloons", "a boiler room with gauges"]},
  {g: "solarpunk", w: ["hand-dyed linen layers with solar-cell embroidery", "repairable modular jacket with seed pouches", "beekeeping suit with the veil pulled back"], s: ["a vertical farm in a reclaimed tower", "a community workshop with bicycles", "a rooftop apiary above a green city"]},
  {g: "deep-sea or alien biology", w: ["no clothing, natural bioluminescent skin patterns", "a simple woven harness carrying tools", "ceremonial shell ornaments on natural hide"], s: ["a tidal cave with glowing pools", "an alien salt flat under two suns", "a coral-like forest at low tide"]},
  {g: "desert caravan", w: ["indigo travel robes and a sun-faded headwrap", "layered leather and linen with brass water flasks", "embroidered merchant coat with many hidden pockets"], s: ["a caravanserai courtyard with camels", "a dune ridge at sunrise", "a spice market under woven awnings"]},
  {g: "Arctic expedition", w: ["frosted fur parka with a sealskin trim and snow goggles", "layered wool and windproof canvas, crampons strapped to the boots", "insulated research suit with an instrument case"], s: ["a frozen research hut with antennas", "a pressure-ridge ice field", "a dog-sled camp under pale sky"]}
];
const SPECIES_OTHER = ["a reptilian humanoid with fine iridescent scales", "a tall amphibian-like being with smooth damp skin", "a stocky mountain-dwelling humanoid with stone-grey skin", "an insectoid humanoid with a jointed chitin carapace", "a feline-featured humanoid with short spotted fur", "a lanky avian humanoid with patterned feathers", "a fungal humanoid with layered cap-like growths", "a half-mechanical android with visibly repaired synthetic skin", "a horned humanoid with ridged bark-like skin", "a deep-sea humanoid with translucent fins and bioluminescent spots", "an elderly troll-like humanoid with mossy skin", "a fox-featured humanoid with russet fur"];
const HUMAN = ["a human of West African heritage", "a human of East Asian heritage", "a human of South Asian heritage", "a human of Northern European heritage", "a human of Mediterranean heritage", "a human of Indigenous Andean heritage", "a human of Middle Eastern heritage", "a human of Pacific Islander heritage", "a human of mixed heritage", "a human of Central Asian heritage", "a human of Latin American heritage", "a human of Eastern European heritage"];
const AGES = ["early twenties", "late twenties", "early thirties", "mid thirties", "early forties", "late forties", "mid fifties", "early sixties", "seventies", "ageless but clearly adult"];
const BUILD = ["lean and wiry", "broad and heavyset", "short and sturdy", "very tall and slightly stooped", "soft and round", "muscular from manual work", "slender with long limbs", "average build with a slight belly"];
const FEATURE = ["a crooked nose broken long ago", "freckles across the face and arms", "a faded scar through one eyebrow", "heterochromatic eyes", "a gap between the front teeth", "vitiligo patches on the hands and neck", "deep laugh lines", "a prosthetic lower leg", "weathered, sun-damaged skin", "a shaved head with a tattoo of abstract lines", "thick grey-streaked braids", "a neatly trimmed beard with a white streak", "wild curly hair tied with string", "reading glasses on a cord", "calloused, ink-stained hands", "a missing fingertip"];
const POSE = ["leaning on one hip with arms crossed loosely", "mid-step, turning toward the camera", "sitting on a crate with elbows on knees, feet flat on the ground", "standing with weight on one leg, holding a tool", "crouching to pick something up, looking up at the lens", "standing tall with hands in pockets", "leaning against a wall with one foot raised behind", "holding a cup with both hands, shoulders relaxed"];
const EXPRESSION = ["a dry, knowing half-smile", "calm and attentive", "tired but kind", "openly amused", "guarded, slightly suspicious", "quietly proud", "curious, eyebrows raised", "serene and unhurried"];
const LIGHT = ["soft overcast daylight", "low golden hour sun from the side", "cool morning light through mist", "warm practical lamps mixed with window light", "open shade on a bright day", "diffuse light from a large window", "blue hour ambient light with warm accents"];
const NOVELTY = ["carries an unusual handmade object that hints at their trade", "a small animal companion perched nearby", "wears a single mismatched accessory with a story", "their hands show traces of today's work", "a detail of their clothing has been repaired many times", "an everyday object used in an unexpected way", "a regional craft pattern woven into one garment", "a weather detail interacts with them (wind, rain drops, snow)"];

function rnd(n){ const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function pick(list){ return list[rnd(list.length)]; }
function blueprint(){
  const genre = pick(GENRES);
  const human = rnd(100) < 60;
  return {
    genre: genre.g,
    species: human ? pick(HUMAN) : pick(SPECIES_OTHER),
    apparent_age: "adult, apparently in their " + pick(AGES),
    physical_traits: `${pick(BUILD)}, ${pick(FEATURE)}, ${pick(FEATURE)}`,
    wardrobe: pick(genre.w),
    pose: pick(POSE),
    expression: pick(EXPRESSION),
    setting: pick(genre.s),
    lighting: pick(LIGHT),
    novelty: pick(NOVELTY)
  };
}
function specText(b){ return FIELDS.map(k => k.toUpperCase() + ": " + b[k]).join("\n"); }
function buildPrompt(spec){ return MASTER + "\nCHARACTER SPECIFICATION:\n" + spec.trim(); }

const P = {state: null, started: 0, timer: null, spec: ""};
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
  $("#gp-go").disabled = busy || !st.has_key || !!(st.uncertain && st.uncertain.id);
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
async function create(){
  const st = readState(); if (!st) return;
  const s = selected(), cost = estimate();
  const spec = ($("#gp-spec").value || "").trim();
  if (spec.length < 20) { toast("Describe the character or tap New random character."); return; }
  const auto = $("#gp-auto").checked;
  const q = `Create 1 ${s.quality.toUpperCase()} image (${s.size.replace("x", "×")}) on this phone? It is a paid OpenAI request: about ${usd(cost, 4)}, ${usd(cost * (st.margin || 1.25), 4)} reserved from your local budget.`
    + (auto ? " It will be sent to the gallery automatically." : "");
  if (!await confirmBox(q, "Create")) return;
  save("cv_gp_spec", spec);
  const error = window.CVNative.genesisPhoneGenerate(s.model, s.quality, s.size, buildPrompt(spec), auto);
  if (error) { toast(error, 6000); return; }
  P.started = Date.now();
  try { window.CVNative.haptic && window.CVNative.haptic("confirm"); } catch (e) {}
  paintPhone();
}

window.__cvGenesisPhone = function (raw){
  let ev = {}; try { ev = JSON.parse(raw); } catch (e) {}
  if (ev.type === "generated") { toast("Image created."); if (S.view === "genesis") { paintPhone(); viewer(ev.name); } else toast("Genesis: image created on the phone.", 5000); }
  else if (ev.type === "failed") toast("Genesis: " + (ev.message || "failed") + " (not charged)", 8000);
  else if (ev.type === "uncertain") toast("Genesis: " + (ev.message || "uncertain request"), 9000);
  else if (ev.type === "sent") toast("Sent: the PC will import it and Codex will catalog it.", 5000);
  else if (ev.type === "send_failed") toast("Sending failed: " + (ev.message || "error") + ". Tap Send to gallery to retry.", 7000);
  if (S.view === "genesis") paintPhone();
};

function panelHtml(){
  const m = load("cv_gp_model", MODELS[0]), q = load("cv_gp_quality", "low"), z = load("cv_gp_size", SIZES[0]);
  const st = P.state || {};
  P.spec = load("cv_gp_spec", "") || specText(blueprint());
  return `<div class="panel" id="gp-panel"><h4>Create on this phone</h4>
    <p class="muted">The phone calls OpenAI with your key, shows the image and sends it to the gallery: the PC that edits the archive
      imports it (also an older version) and Codex catalogs it. The character comes from a random description you can edit.</p>
    <div id="gp-keystate" class="muted"></div>
    <input class="txt" id="gp-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…">
    <div class="row"><button class="btn" id="gp-savekey">Save key</button><button class="btn" id="gp-clearkey">Remove key</button></div>
    <div class="gp-limits"><label class="muted">Local budget $<input class="txt" id="gp-budget" type="number" min="0" step="0.5" value="${esc(st.budget || 0)}"></label>
      <label class="muted">Daily limit $<input class="txt" id="gp-daily" type="number" min="0" step="0.5" value="${esc(st.daily || 0)}"></label>
      <button class="btn" id="gp-savelimits">Save limits</button></div>
    <div id="gp-money" class="muted"></div>
    <label class="muted">Model</label><select id="gp-model">${MODELS.map(x => `<option value="${x}" ${x === m ? "selected" : ""}>${x === MODELS[0] ? "Flare · fast" : "Sunburst · most detailed"}</option>`).join("")}</select>
    <label class="muted">Quality</label><select id="gp-quality">${QUALITIES.map(x => `<option value="${x}" ${x === q ? "selected" : ""}>${x.toUpperCase()}</option>`).join("")}</select>
    <label class="muted">Resolution</label><select id="gp-size">${SIZES.map(x => `<option value="${x}" ${x === z ? "selected" : ""}>${x.replace("x", " × ")}${x === "1152x2048" ? " · 9:16" : ""}</option>`).join("")}</select>
    <label class="muted">Character</label><textarea class="txt" id="gp-spec" rows="9" spellcheck="false">${esc(P.spec)}</textarea>
    <div class="row"><button class="btn" id="gp-new">${ico("refresh")} New random character</button></div>
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
  $("#gp-new").onclick = () => { $("#gp-spec").value = specText(blueprint()); save("cv_gp_spec", $("#gp-spec").value); };
  $("#gp-spec").onchange = e => save("cv_gp_spec", e.target.value);
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
  const main = document.querySelector("#app main");
  const title = main && main.querySelector(".section-title");
  if (!main) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = panelHtml();
  main.insertBefore(wrap.firstElementChild, title ? title.nextSibling : main.firstChild);
  const pcTitle = main.querySelector("#gp-panel + .panel h4");
  if (pcTitle) pcTitle.textContent = "Or create with your PC (Codex)";
  bindPanel();
  paintPhone();
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.view === "genesis" && hasBridge()) paintPhone(); });
window.__cvGenesisPhone821 = {blueprint, specText, buildPrompt, MASTER, FIELDS};
})();
