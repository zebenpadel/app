/* =====================================================================
   ZEBEN · Mi Plan
   App para atletas (su plan, su progreso) y para el entrenador (fichas).
   ===================================================================== */
"use strict";

// ---------- Configuración (te la relleno yo cuando me envíes las claves) ----------
const CONFIG = {
  SUPABASE_URL: "https://yjuughhddnpweupdwqlp.supabase.co",          // https://xxxx.supabase.co
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqdXVnaGhkZG5wd2V1cGR3cWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MTI5MDgsImV4cCI6MjEwNzQ4ODkwOH0.T5tMNGOM-Bpri-asztWArEYQ-ZC3-nYyaz1xKAD5fOE",          // clave anon / publishable (es pública)
  TURNSTILE_SITE_KEY: "",    // Site Key de Cloudflare Turnstile (pública)
};

const EMAIL_DOMAIN = "zeben-app.com";
const SIDES = ["Derecha (drive)", "Izquierda (revés)", "Ambas"];
const DAY_KEYS = ["fuerza", "explo", "agil"];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Atlantic/Canary" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
const imc = (a) => (a.weight_kg && a.height_cm) ? (a.weight_kg / ((a.height_cm / 100) ** 2)).toFixed(1) : "—";
const store = { get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (_) { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

function normPhone(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("0034")) d = d.slice(4);
  else if (d.length === 11 && d.startsWith("34")) d = d.slice(2);
  return /^[6789]\d{8}$/.test(d) ? d : null;
}
const emailOf = (phone) => `${phone}@${EMAIL_DOMAIN}`;
const passwordOf = (phone, pin) => `zb-${pin}-${phone}`;

// Enlaces de vídeo: solo YouTube; lo demás se convierte en una búsqueda
function videoUrl(q) {
  q = String(q || "");
  if (/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(q)) return q;
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
}
const vid = (q) => `<a class="vid" href="${esc(videoUrl(q))}" target="_blank" rel="noopener noreferrer">▶ Ver vídeo</a>`;

// ---------- Estado ----------
let sb = null;
let me = null;        // mi ficha
let P = null;         // programa (solo si estoy activo)
let planProg = 1;     // programa que se ve en "Mi plan" (el entrenador puede mirar cualquiera)
const PROGRAMS = { 1: "Pádel", 2: "HYROX", 3: "Mantente activo", 4: "Musculación", 5: "Post parto" };
const progName = (id) => PROGRAMS[id] || "Pádel";
const myProg = () => (PROGRAMS[me?.program_id] ? me.program_id : 1);
async function loadProgram(id) { const row = await q(sb.from("program").select("data").eq("id", id).maybeSingle()); return row?.data || null; }
let tab = "plan";
let done = {};        // sesiones hechas "semana-dia"
let week = store.get("zb-week", 1);
// Semanas del plan: 1–4 = primer mes (1A–4A), 5–8 = segundo mes (1B–4B)
const wkLabel = (w) => `${((w - 1) % 4) + 1}${w <= 4 ? "A" : "B"}`;
const DOW = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DOW_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const plain = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const todayDow = () => (new Date().getDay() + 6) % 7;      // 0 = lunes
let selDow = todayDow(), showAllDays = false;
// Qué día de la semana es cada sesión según su campo "Día" (Lunes, Miércoles…)
// Sesiones que hace cada atleta según sus días por semana (3–6). Sin elegir: las del programa sin las "extra".
const FREQ_DAYS = { 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
function sessionsFor(prog, a) {
  if (!prog?.days) return [];
  const n = a?.custom?.freq, list = n && prog.freq?.[n];
  if (list) return list.map((k) => prog.days.find((d) => d.key === k)).filter(Boolean).map((d, i) => ({ ...d, title: String(d.title || "").replace(/^Día \d+\s*·\s*/i, ""), when: DOW[FREQ_DAYS[n]?.[i] ?? i] }));
  return prog.days.filter((d) => !d.extra);
}
const dowDefault = (d) => { const w = plain(d.when); for (let i = 0; i < 7; i++) if (w.includes(plain(DOW[i]))) return i; return -1; };
const dowOf = (d, sched) => { const v = (sched === undefined ? me?.schedule : sched)?.[d.key]; return Number.isInteger(v) && v >= 0 && v <= 6 ? v : dowDefault(d); };
let myLoads = [], myTests = [];
let athletes = [], openId = null, detail = null;
let captchaToken = null, turnstileId = null;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- Errores: se guardan y, si es nuevo, avisan al entrenador ----------
const KNOWN = /Inicia sesión|no está activo|Demasiadas|Revisa los datos|no válid|No puedes|no es tuyo|máximo|Solo el|no encontrado|No se puede|bloqueado|PIN|móvil|código/i;
function friendly(e) {
  const m = String(e?.message ?? e ?? "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sin conexión. Revisa internet y vuelve a intentarlo.";
  if (/Invalid login credentials/i.test(m)) return "El móvil o el PIN no son correctos.";
  if (/already registered|already exists/i.test(m)) return "Ya hay una cuenta con ese móvil. Entra con tu PIN.";
  if (/captcha/i.test(m)) return "No se ha podido comprobar que no eres un robot. Vuelve a intentarlo.";
  if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera unos minutos.";
  if (KNOWN.test(m)) return m.replace(/^ERROR:\s*/, "");
  return "Algo ha fallado. Inténtalo de nuevo.";
}
async function report(kind, err, ctx) {
  try {
    if (!sb || !me) return;
    const m = String(err?.message ?? err ?? "");
    if (KNOWN.test(m) || /Failed to fetch|NetworkError|Load failed/i.test(m)) return;
    const { data } = await sb.rpc("log_error", { p_kind: kind, p_message: m.slice(0, 300), p_detail: String(err?.stack ?? "").slice(0, 2000), p_context: ctx ?? { tab } });
    if (data) callFn("notify", { action: "error", error_id: data }).catch(() => {});
  } catch (_) { /* nada */ }
}
window.addEventListener("error", (e) => report("app", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => report("app", e.reason));

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) { report("rpc", error, { fn }); throw new Error(friendly(error)); }
  return data;
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) { report("consulta", error, { tab }); throw new Error(friendly(error)); }
  return data;
}
async function callFn(name, body, useUserToken = true) {
  let token = CONFIG.SUPABASE_KEY;
  if (useUserToken) { const { data } = await sb.auth.getSession(); token = data.session?.access_token || token; }
  const r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No se ha podido completar.");
  return j;
}

// ---------- Protección anti-robots (Cloudflare Turnstile) ----------
function loadTurnstile() {
  if (!CONFIG.TURNSTILE_SITE_KEY || window.turnstile || $("#cf-script")) return;
  const s = document.createElement("script");
  s.id = "cf-script"; s.async = true;
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.onload = mountTurnstile;
  document.head.appendChild(s);
}
function mountTurnstile() {
  const box = $("#cf"); if (!box || !CONFIG.TURNSTILE_SITE_KEY || !window.turnstile) return;
  captchaToken = null;
  turnstileId = window.turnstile.render(box, {
    sitekey: CONFIG.TURNSTILE_SITE_KEY, language: "es", theme: "auto",
    callback: (t) => (captchaToken = t), "expired-callback": () => (captchaToken = null),
  });
}
function resetTurnstile() { captchaToken = null; try { if (window.turnstile && turnstileId != null) window.turnstile.reset(turnstileId); } catch (_) {} }
function needCaptcha() { return CONFIG.TURNSTILE_SITE_KEY && !captchaToken; }

// =====================================================================
//  ACCESO: entrar, crear cuenta, recuperar PIN
// =====================================================================
function setHeader(loggedIn) {
  $("#tabs").hidden = !loggedIn; $("#who").hidden = !loggedIn;
  if (!loggedIn) { $("#progress").innerHTML = ""; $("#sub").hidden = false; }
}

function renderAuth(mode = "login", msg = "") {
  setHeader(false);
  const pinField = (id, label) => `<label class="field"><span class="label">${label}</span><input id="${id}" type="password" inputmode="numeric" autocomplete="${mode === "login" ? "current-password" : "new-password"}" maxlength="4" pattern="[0-9]*" placeholder="4 cifras"></label>`;
  const phoneField = `<label class="field"><span class="label">Móvil</span><input id="a-phone" type="tel" inputmode="tel" autocomplete="username" placeholder="600 000 000"></label>`;
  let body = "";
  if (mode === "login") {
    body = `<h3>Entrar</h3><p class="muted" style="margin:0;font-size:14px">Con tu móvil y tu PIN de 4 cifras.</p>
      ${phoneField}${pinField("a-pin", "PIN")}
      <div class="cf" id="cf"></div>
      <button class="btn" id="doLogin">Entrar</button>
      <div class="err" id="aErr">${esc(msg)}</div>
      <div class="row" style="justify-content:space-between"><button class="linkbtn" data-auth="signup">Crear cuenta</button><button class="linkbtn" data-auth="forgot">¿Has olvidado tu PIN?</button></div>`;
  } else if (mode === "signup") {
    body = `<h3>Crear cuenta</h3><p class="muted" style="margin:0;font-size:14px">Después, Zeben activará tu plan cuando confirme el pago.</p>
      <label class="field"><span class="label">Nombre y apellido</span><input id="a-name" autocomplete="name" maxlength="40"></label>
      ${phoneField}${pinField("a-pin", "Elige un PIN")}${pinField("a-pin2", "Repite el PIN")}
      <label class="check"><input type="checkbox" id="a-consent"><span>He leído la <a href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a> y acepto que ZEBEN guarde mis datos físicos (peso, altura, lesiones y resultados) para preparar y seguir mi plan.</span></label>
      <div class="cf" id="cf"></div>
      <button class="btn" id="doSignup">Crear cuenta</button>
      <div class="err" id="aErr">${esc(msg)}</div>
      <button class="linkbtn" data-auth="login">Ya tengo cuenta</button>`;
  } else {
    body = `<h3>Recuperar el PIN</h3><p class="muted" style="margin:0;font-size:14px">Usa el código de recuperación que guardaste al crear la cuenta. Si no lo tienes, pide a Zeben que te ponga un PIN nuevo.</p>
      ${phoneField}
      <label class="field"><span class="label">Código de recuperación</span><input id="a-code" autocomplete="off" autocapitalize="characters" maxlength="16" placeholder="XXXX-XXXX-XXXX"></label>
      ${pinField("a-pin", "PIN nuevo")}
      <button class="btn" id="doForgot">Cambiar PIN</button>
      <div class="err" id="aErr">${esc(msg)}</div>
      <button class="linkbtn" data-auth="login">Volver a entrar</button>`;
  }
  $("#app").innerHTML = `<div class="auth"><div class="panel">${body}</div></div>`;
  turnstileId = null;
  if (mode !== "forgot") { if (window.turnstile) mountTurnstile(); else loadTurnstile(); }
}

function readAuth() {
  const phone = normPhone($("#a-phone")?.value);
  const pin = ($("#a-pin")?.value || "").trim();
  return { phone, pin };
}
async function doLogin(btn) {
  const { phone, pin } = readAuth(); const err = $("#aErr");
  if (!phone) return (err.textContent = "Escribe un móvil español de 9 cifras.");
  if (!/^\d{4}$/.test(pin)) return (err.textContent = "El PIN tiene 4 cifras.");
  if (needCaptcha()) return (err.textContent = "Espera a que termine la comprobación anti-robots.");
  btn.disabled = true; err.textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: emailOf(phone), password: passwordOf(phone, pin), options: { captchaToken: captchaToken || undefined } });
  btn.disabled = false; resetTurnstile();
  if (error) { err.textContent = friendly(error); return; }
  await start();
}
async function doSignup(btn) {
  const { phone, pin } = readAuth(); const err = $("#aErr");
  const name = ($("#a-name").value || "").replace(/[<>]/g, "").trim();
  if (name.length < 2) return (err.textContent = "Escribe tu nombre.");
  if (!phone) return (err.textContent = "Escribe un móvil español de 9 cifras.");
  if (!/^\d{4}$/.test(pin)) return (err.textContent = "El PIN tiene que ser de 4 cifras.");
  if (/^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|4321)$/.test(pin)) return (err.textContent = "Ese PIN es muy fácil de adivinar. Elige otro.");
  if (pin !== $("#a-pin2").value.trim()) return (err.textContent = "Los dos PIN no coinciden.");
  if (!$("#a-consent").checked) return (err.textContent = "Para crear la cuenta tienes que aceptar la política de privacidad.");
  if (needCaptcha()) return (err.textContent = "Espera a que termine la comprobación anti-robots.");
  btn.disabled = true; err.textContent = "";
  const { data, error } = await sb.auth.signUp({ email: emailOf(phone), password: passwordOf(phone, pin), options: { data: { name, consent: "true" }, captchaToken: captchaToken || undefined } });
  btn.disabled = false; resetTurnstile();
  if (error) { err.textContent = friendly(error); return; }
  if (!data.session) { err.textContent = "Cuenta creada. Ahora entra con tu móvil y tu PIN."; return; }
  callFn("notify", { action: "signup" }).catch(() => {});
  await start({ newUser: true });
}
async function doForgot(btn) {
  const { phone, pin } = readAuth(); const err = $("#aErr");
  const code = ($("#a-code").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!phone) return (err.textContent = "Escribe un móvil español de 9 cifras.");
  if (code.length !== 12) return (err.textContent = "El código de recuperación tiene 12 caracteres.");
  if (!/^\d{4}$/.test(pin)) return (err.textContent = "El PIN nuevo tiene que ser de 4 cifras.");
  btn.disabled = true; err.textContent = "";
  try { await callFn("recover", { action: "reset", phone, code, pin }, false); renderAuth("login", ""); toast("PIN cambiado. Ya puedes entrar."); }
  catch (e) { err.textContent = /fetch|Load failed|NetworkError|completar/i.test(e.message) ? "Ahora mismo no se puede recuperar el PIN desde aquí. Pide a Zeben que te ayude." : e.message; }
  finally { btn.disabled = false; }
}

// Código de recuperación: 12 caracteres sin letras que se confundan
function newRecoveryCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = new Uint32Array(12); crypto.getRandomValues(b);
  return Array.from(b, (x) => A[x % A.length]).join("");
}
async function showRecovery(first) {
  const code = newRecoveryCode();
  try { await rpc("set_recovery_code", { p_code: code }); } catch (e) { toast(e.message); return; }
  const pretty = code.replace(/(.{4})(?=.)/g, "$1-");
  $("#app").innerHTML = `<div class="auth"><div class="panel">
    <h3>${first ? "Guarda tu código de recuperación" : "Tu código nuevo"}</h3>
    <p class="muted" style="margin:4px 0 0;font-size:14px">Si olvidas el PIN, con este código puedes poner uno nuevo. Solo se muestra ahora. Guárdalo en tus notas o hazle una captura.</p>
    <div class="code" id="rcode">${esc(pretty)}</div>
    <button class="btn ghost" id="copyCode" style="width:100%">Copiar código</button>
    <button class="btn" id="codeDone" style="width:100%;margin-top:10px">Ya lo he guardado</button>
  </div></div>`;
  $("#copyCode").onclick = () => navigator.clipboard?.writeText(pretty).then(() => toast("Copiado"), () => toast("Mantén pulsado el código para copiarlo"));
  $("#codeDone").onclick = () => { go(tab); };
}

// =====================================================================
//  ARRANQUE
// =====================================================================
async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  return await q(sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
}
const isActive = (p) => p && (p.is_admin || (p.active && (!p.paid_until || p.paid_until >= todayISO())));

async function start(opts = {}) {
  try {
    me = await loadMe();
    if (!me) { renderAuth("login"); return; }
    P = null;
    if (isActive(me)) {
      planProg = myProg();
      P = await loadProgram(planProg);
      const s = await q(sb.from("sessions_done").select("week,day").eq("user_id", me.id));
      done = {}; s.forEach((r) => (done[`${r.week}-${r.day}`] = true));
    }
    setHeader(true);
    $("#sub").hidden = true;
    $("#who").textContent = initials(me.name);
    const hash = location.hash.replace("#", "");
    if (opts.newUser) { await showRecovery(true); return; }
    go(hash || (me.is_admin ? "atletas" : "plan"));
  } catch (e) {
    $("#app").innerHTML = `<div class="empty" style="margin-top:24px"><b>No se ha podido cargar.</b><br>${esc(friendly(e))}<br><br><button class="btn" id="retry">Reintentar</button></div>`;
    $("#retry").onclick = () => start();
  }
}

const hasComp = () => !!(P && ((P.competition?.sessions || []).length || (P.matchday?.blocks || []).length));
const exRow = (w) => `<div class="ex"><span class="n">${esc(w[0])}</span><span class="rx" style="font-size:16px">${esc(w[1])}</span>${w[3] ? `<span class="cue">${esc(w[3])}</span>` : ""}${vid(w[2])}</div>`;
function renderTabs() {
  const t = [["plan", "Mi plan"], ["progreso", "Progreso"], ["perfil", "Perfil"]];
  if (me.is_admin) t.unshift(["atletas", "Atletas"]), t.splice(2, 0, ["editor", "Editar plan"]), t.push(["errores", "Errores"]);
  if (hasComp() || tab === "competicion") t.splice(t.findIndex(([k]) => k === "plan") + 1, 0, ["competicion", "Competición"]);
  $("#tabs").innerHTML = t.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join("");
}
function go(t) {
  const allowed = ["plan", "competicion", "progreso", "perfil"].concat(me.is_admin ? ["atletas", "editor", "errores"] : []);
  if (tab === "editor" && t !== "editor" && edDirty && !confirm("Tienes cambios del plan sin guardar. ¿Salir sin guardar?")) { renderTabs(); return; }
  if (t !== "editor") { ED = null; edDirty = false; }
  tab = allowed.includes(t) ? t : "plan";
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  renderTabs(); renderProgress();
  if (!me.consent_at) return renderConsent();
  ({ plan: renderPlan, competicion: renderCompetition, progreso: renderMyProgress, perfil: renderProfile, atletas: renderAthletes, editor: renderEditor, errores: renderErrors }[tab])();
  window.scrollTo(0, 0);
}
function renderProgress() {
  if (!P) { $("#progress").innerHTML = ""; return; }
  const SD = sessionsFor(P, me), keys = new Set(SD.map((d) => d.key)), total = SD.length * 8;
  const n = Object.keys(done).filter((k) => keys.has(k.split("-").slice(1).join("-"))).length;
  $("#progress").innerHTML = `<div class="bar"><span style="width:${Math.round(n / total * 100)}%"></span></div><div class="ptxt">${n} de ${total} sesiones completadas</div>`;
}

function renderConsent() {
  $("#app").innerHTML = `<div class="auth"><div class="panel"><h3>Antes de seguir</h3>
    <p style="font-size:14px">Para preparar tu plan, ZEBEN guarda tus datos físicos (peso, altura, lesiones y resultados). Puedes leer cómo se tratan en la <a href="privacidad.html" target="_blank" rel="noopener">política de privacidad</a>.</p>
    <button class="btn" id="giveConsent" style="width:100%">Acepto</button>
    <button class="btn ghost" id="logout2" style="width:100%;margin-top:10px">No acepto, salir</button></div></div>`;
  $("#giveConsent").onclick = async () => { try { await rpc("give_consent"); me.consent_at = new Date().toISOString(); go(tab); } catch (e) { toast(e.message); } };
  $("#logout2").onclick = logout;
}

// =====================================================================
//  MI PLAN
// =====================================================================
function lockedCard() {
  const expired = me.active && me.paid_until && me.paid_until < todayISO();
  return `<div class="panel lock"><div class="big">🔒</div>
    <h3 style="margin-top:10px">${expired ? "Tu plan ha caducado" : "Tu plan está pendiente de activar"}</h3>
    <p class="muted" style="font-size:14px">${expired ? `Venció el ${fmtDate(me.paid_until)}. Habla con Zeben para renovarlo.` : "Zeben lo activará en cuanto confirme el pago. Te llegará un aviso si los tienes activados en Perfil."}</p>
    <p style="font-size:14px">Mientras tanto, completa tus datos en <button class="linkbtn" data-tab="perfil">Perfil</button>.</p></div>`;
}

// =====================================================================
//  PLAN PERSONALIZADO: se adapta solo al objetivo y a las zonas de lesión,
//  y el entrenador puede cambiar o quitar ejercicios para cada atleta
// =====================================================================
const ZONES = { rodilla: "Rodilla", tobillo: "Tobillo", hombro: "Hombro", lumbar: "Zona lumbar", cadera: "Cadera", muneca: "Codo o muñeca", cuello: "Cuello" };
const X = (n, c, v) => ({ n, c, v });
// Para cada zona: [palabras del ejercicio, alternativa]. Gana la primera que encaje.
const INJ_RULES = {
  rodilla: [
    [/salto|jump|pliometr|burpee|comba|skipping|sprint|drop|bound|rebote/, [X("Elevación de talones lenta", "En lugar del ejercicio de impacto: sin saltos mientras te moleste la rodilla.", "elevación de talones técnica"), X("Gemelo sentado", "Sin impacto, recorrido completo y lento.", "gemelo sentado técnica"), X("Isometría de gemelo en escalón", "Aguanta 20–30 s de puntillas sin dolor.", "isometría gemelo")]],
    [/extension de cuadriceps|extension de cuádriceps/, X("Isometría de cuádriceps en pared", "Espalda en la pared, rodillas a 45–60°. Aguanta 30–45 s sin dolor.", "sentadilla isométrica pared")],
    [/sentadilla|squat|zancada|lunge|bulgara|step-up|step up|prensa|wall ball|thruster|hack|pistol|split/, [X("Hip thrust o puente de glúteo", "Pierna fuerte sin cargar la rodilla. Si no duele, más adelante volverás a la sentadilla.", "hip thrust técnica"), X("Abducción de cadera con banda", "Glúteo medio: estabiliza la rodilla. Sentada o tumbada de lado.", "abducción de cadera con banda"), X("Puente de glúteo a una pierna", "Cadera nivelada arriba, sin dolor en la rodilla.", "puente de glúteo a una pierna"), X("Curl femoral con fitball", "Isquios fuertes protegen la rodilla.", "curl femoral fitball")]],
    [/carrera|sled push|cambio de direccion|agilidad|t test|estrella|conos|desplazamiento|reaccion|shuffle|lateral/, [X("Bici estática o elíptica", "Mismo tiempo y esfuerzo, sin impacto en la rodilla.", "bicicleta estática intervalos"), X("Remo ergómetro", "Mismo tiempo y esfuerzo; para si molesta la rodilla.", "remo ergómetro técnica"), X("Ergómetro de brazos o bici suave", "Mantén el pulso alto sin cargar la rodilla.", "ergómetro de brazos")]],
  ],
  tobillo: [
    [/salto|jump|pliometr|burpee|comba|skipping|sprint|drop|bound|rebote|carrera|cambio de direccion|agilidad|t test|estrella|conos|desplazamiento|reaccion|shuffle|lateral|sled push/, [X("Bici estática o remo ergómetro", "Mismo tiempo y esfuerzo, sin impacto en el tobillo.", "bicicleta estática intervalos"), X("Remo ergómetro", "Sin impacto en el tobillo.", "remo ergómetro técnica"), X("Ergómetro de brazos o bici suave", "Mantén el pulso alto sin cargar el tobillo.", "ergómetro de brazos")]],
    [/talones|gemelo|calf/, X("Gemelo sentado con poco peso", "Recorrido sin dolor, sin rebotes.", "gemelo sentado técnica")],
  ],
  hombro: [
    [/press militar|press de hombro|push press|arnold|elevacion lateral|elevaciones laterales|wall ball|thruster|overhead|sobre la cabeza|fondos|dominada|pullover|skierg/, [X("Rotación externa de hombro con banda", "Codo pegado al cuerpo, sin dolor. Fortalece el hombro mientras se recupera.", "rotación externa hombro banda"), X("Elevación en Y tumbada boca abajo", "Brazos en Y, sin peso o muy ligero, sin dolor.", "y raise boca abajo"), X("Retracción escapular con banda", "Junta las escápulas sin subir los hombros.", "retracción escapular banda")]],
    [/press banca|flexion|press de pecho|press inclinado|aperturas|cruce de poleas|pec deck|floor press|press plano/, X("Press en el suelo con agarre neutro", "Mancuernas ligeras y palmas enfrentadas. Para si duele.", "floor press agarre neutro")],
    [/jalon|remo invertido|burpee|toques de hombro/, X("Face pull con banda", "Codos altos, peso ligero y sin dolor.", "face pull con banda elástica")],
  ],
  lumbar: [
    [/peso muerto|buenos dias|good morning/, X("Hip thrust", "Glúteo y cadena posterior sin cargar la zona lumbar.", "hip thrust técnica")],
    [/remo con barra|remo inclinado/, X("Remo con pecho apoyado", "Pecho en un banco inclinado: la espalda baja descansa.", "remo pecho apoyado banco")],
    [/sentadilla trasera|sentadilla frontal|thruster|sandbag|saco/, X("Sentadilla goblet ligera", "Peso delante del pecho, tronco erguido y recorrido sin dolor.", "sentadilla goblet técnica")],
    [/superman|russian twist|rueda abdominal|rotacion|giro|swing|sled pull|lanzamiento/, [X("Dead bug", "Zona lumbar pegada al suelo todo el tiempo.", "dead bug ejercicio técnica"), X("Bird dog", "Brazo y pierna contrarios sin mover la cadera.", "bird dog ejercicio técnica"), X("Plancha lateral de rodillas", "Cadera alta, sin dolor lumbar.", "plancha lateral de rodillas")]],
  ],
  cadera: [
    [/salto|jump|pliometr|burpee|bound|rebote/, X("Puente de glúteo con banda", "Sin impacto. Empuja las rodillas hacia fuera contra la banda.", "puente de glúteo con banda")],
    [/sentadilla profunda|zancada|lunge|bulgara|split|step-up|step up|90\/90|aductor|lateral|pistol/, [X("Puente de glúteo a una pierna", "Recorrido corto y sin dolor en la cadera.", "puente de glúteo a una pierna"), X("Abducción de cadera con banda", "Rango cómodo y sin dolor.", "abducción de cadera con banda"), X("Bird dog", "Estabilidad de cadera sin carga.", "bird dog ejercicio técnica")]],
  ],
  muneca: [
    [/flexion|fondos|plancha|toques de hombro|burpee|rueda abdominal|mountain|escaladores/, X("Plancha sobre antebrazos", "Apoyo en antebrazos: la muñeca no carga peso.", "plancha abdominal técnica")],
    [/curl|press|dominada|jalon|farmer|remo|wall ball|thruster|skierg/, null],
  ],
  cuello: [
    [/encogimiento|press militar|overhead|sobre la cabeza|push press|pullover|superman/, X("Face pull con banda", "Peso ligero, cuello relajado y mirada al frente.", "face pull con banda elástica")],
  ],
};
const GOAL_RULES = {
  "Ganar músculo": { sets: 1, txt: "1 serie más en cada ejercicio para ganar músculo." },
  "Perder grasa": { sets: 0, fin: true, txt: "Final quemagrasa de 8–10 minutos en cada sesión." },
  "Salud y bienestar": { sets: -1, cap: true, txt: "1 serie menos e intensidad moderada (RPE 7 como máximo)." },
  "Volver tras una lesión": { sets: -1, cap: true, txt: "1 serie menos e intensidad moderada mientras vuelves." },
  "Preparar una competición": { sets: 0, txt: "La semana de tu prueba, sigue la pestaña Competición." },
};
// Ajustes del atleta a partir de su ficha. custom: { auto, sets, swaps: { "clave|A|0": {n,c,v} | {skip:true} } }
function personalFor(a, prog) {
  const cu = a?.custom || {}, auto = cu.auto !== false, out = { notes: [], sets: 0, cap: false, fin: false, swaps: cu.swaps || {}, auto };
  if (!a) return out;
  const g = auto ? GOAL_RULES[a.goal] : null;
  if (g) { out.sets = g.sets; out.cap = !!g.cap; out.fin = !!g.fin; out.notes.push(`Objetivo «${a.goal}»: ${g.txt}`); }
  if (Number.isInteger(cu.sets)) { out.sets = cu.sets; out.notes = out.notes.filter((x) => !/serie/.test(x)); if (cu.sets) out.notes.push(`Tu entrenador ha ajustado las series: ${cu.sets > 0 ? "+" : ""}${cu.sets} por ejercicio.`); }
  out.zones = auto && a.has_injury ? (a.injury_zones || []).filter((z) => INJ_RULES[z]) : [];
  if (out.zones.length) out.notes.push(`Lesión (${out.zones.map((z) => ZONES[z].toLowerCase()).join(", ")}): los ejercicios que cargan esa zona están cambiados por alternativas seguras.`);
  out.prog = prog;
  return out;
}
// Ejercicio de una sesión tras aplicar lesión y retoques del entrenador. Devuelve null si se quita.
function personalEx(pz, dayKey, v, i, e, used) {
  const sw = pz.swaps[`${dayKey}|${v}|${i}`];
  if (sw?.skip) return null;
  if (sw?.n) return { e: [sw.n, sw.c || "", e[2], sw.v || sw.n], tag: "Cambiado por tu entrenador" };
  const name = plain(e[0]);
  for (const z of pz.zones || []) for (const [re, alt] of INJ_RULES[z]) {
    if (!re.test(name)) continue;
    if (alt === null) return { e: [e[0] + " (agarre neutro o con banda)", "Muñeca recta, peso ligero. Si molesta, sáltalo y coméntalo. " + e[1], e[2], e[3]], tag: `Adaptado por tu ${ZONES[z].toLowerCase()}` };
    const opts = Array.isArray(alt) ? alt : [alt];
    const pick = opts.find((o) => !used || !used.has(o.n)) || opts[0]; if (used) used.add(pick.n);
    return { e: [pick.n, pick.c, e[2], pick.v], tag: `Adaptado por tu ${ZONES[z].toLowerCase()} · antes: ${e[0]}` };
  }
  return { e, tag: "" };
}
// Series y repeticiones con los ajustes (series ±, intensidad moderada)
function personalDose(pz, dose) {
  let [main, extra] = String(dose).split(" · ");
  if (pz.sets) main = main.replace(/^(\d+)(?=\s*[×x ])/, (m, n) => String(Math.min(6, Math.max(1, +n + pz.sets))));
  if (pz.cap && extra) extra = extra.replace(/RPE\s*(\d+)(–\d+)?/g, (m, a, b) => (+a >= 8 || (b && +b.slice(1) >= 8) ? "RPE 6–7" : m)).replace(/\d+(–\d+)?\s*%\s*1RM/g, "carga moderada");
  return [main, extra];
}
function finisherHTML(pz) {
  if (!pz.fin) return "";
  const soft = (pz.zones || []).some((z) => z === "rodilla" || z === "tobillo") || pz.prog === 5;
  return `<div class="sec">Final quemagrasa · 8–10 min</div><div class="ex"><span class="n">${soft ? "Bici o elíptica en intervalos" : "Intervalos en bici, remo o cuesta"}</span><span class="rx">8–10 min</span><span class="cue">${pz.prog === 5 ? "Ritmo cómodo: 1 min algo más rápido y 1 min suave." : "30 s fuerte y 30 s suave. Termina con 2 minutos suaves."}</span>${vid("intervalos bicicleta estática")}</div>`;
}

function i18nToday() { const d = new Date(); return "Hoy es " + DOW[todayDow()].toLowerCase() + ", " + d.getDate() + " de " + ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][d.getMonth()]; }
function renderPlan() {
  if (!P) { $("#app").innerHTML = lockedCard(); return; }
  const LV = P.levels; let level = Math.max(0, LV.indexOf(me.level));
  const VAR = (w) => "ABC"[(w - 1) % 3];
  const phaseOf = (w) => P.phases.findIndex((p) => p.weeks.includes(w));
  week = Math.min(8, Math.max(1, +week || 1));
  const p = phaseOf(week);
  const WS = P.warmSecs || ["1 · Foam roller", "2 · Movilidad de tobillo (dorsiflexión)", (P.ankle?.length ? 3 : 2) + " · Movilidad y activación"];
  const row = (w) => `<div class="ex"><span class="n">${esc(w[0])}</span><span class="rx" style="font-size:16px">${esc(w[1])}</span>${w[3] ? `<span class="cue">${esc(w[3])}</span>` : ""}${vid(w[2])}</div>`;
  const SD = sessionsFor(P, me);
  const byDow = SD.map((d) => dowOf(d));
  const planned = byDow.some((x) => x >= 0);
  const todaySess = SD.filter((d, i) => byDow[i] === selDow);
  const visibleDays = (!planned || showAllDays ? SD : todaySess).slice().sort((x, y) => (dowOf(x) < 0 ? 9 : dowOf(x)) - (dowOf(y) < 0 ? 9 : dowOf(y)));
  const shortName = (d) => String(d.title || "").split("·").pop().trim();
  const dowPick = planned ? `<div class="weeks" style="grid-template-columns:repeat(7,minmax(0,1fr))">${DOW_SHORT.map((n, i) => {
      const ds = SD.filter((d, j) => byDow[j] === i);
      const ok = ds.length && ds.every((d) => done[`${week}-${d.key}`]);
      return `<button class="wk" data-dow="${i}" aria-pressed="${!showAllDays && i === selDow}" aria-label="${DOW[i]}${ds.length ? ": " + esc(ds.map(shortName).join(", ")) : ": descanso"}">${n}<small>${ds.length ? (ok ? "✓ hecho" : "entreno") : "libre"}</small></button>`; }).join("")}</div>
    <div class="row" style="margin-top:8px;justify-content:space-between"><span class="muted" style="font-size:13px">${i18nToday()}</span><button class="btn ghost sm" data-alldays="1">${showAllDays ? "Ver solo un día" : "Ver toda la semana"}</button></div>` : "";
  const restCard = planned && !showAllDays && !todaySess.length ? `<div class="panel"><h3>${selDow === todayDow() ? "Hoy" : DOW[selDow]} toca descanso</h3>
    <p class="muted" style="font-size:14px;margin:6px 0 0">Recuperar también es entrenar. Si te apetece moverte, da un paseo de 20–30 minutos o haz la movilidad del calentamiento.</p>
    <p style="font-size:14px;margin:8px 0 0">Tus sesiones de la semana: <b>${SD.map((d, i) => byDow[i] >= 0 ? `${DOW[byDow[i]]} (${esc(shortName(d))})` : "").filter(Boolean).join(", ")}</b>.</p></div>` : "";
  const pz = personalFor(me, planProg);
  const days = visibleDays.map((d) => {
    const [main, extra] = personalDose(pz, P.dose[d.key][level][p]);
    const k = `${week}-${d.key}`; const isDone = !!done[k];
    return `<article class="day" style="--c:var(${/^--f-(fuerza|explo|agil)$/.test(d.c) ? d.c : ["--f-fuerza", "--f-explo", "--f-agil"][SD.findIndex((x) => x.key === d.key) % 3]})">
      <div class="day-head"><div><div class="label">${esc(dowOf(d) >= 0 ? DOW[dowOf(d)] : d.when)}</div><h3>${esc(d.title)} · ${VAR(week)}</h3></div>
      <div class="dose">Descanso<br>${esc(P.rest[d.key][p])}</div></div>
      ${((u) => d.ex[VAR(week)].map((e0, i) => personalEx(pz, d.key, VAR(week), i, e0, u)))(new Set()).filter(Boolean).map(({ e, tag }) => `<div class="ex"><span class="n">${esc(e[0])}</span><span class="rx">${esc(main)}${e[2] ? ` <small class="muted" style="font:500 12px var(--body)">${esc(e[2])}</small>` : ""}</span><span class="cue">${tag ? `<b style="color:var(--ball-deep)">↻ ${esc(tag)}.</b> ` : ""}${esc(e[1])}${extra ? ` · ${esc(extra)}` : ""}</span>${vid(e[3])}</div>`).join("")}
      ${finisherHTML(pz)}
      <div class="note">${esc(d.note)}</div>
      <div class="done-row"><button class="btn ${isDone ? "ok" : ""}" data-done="${week}|${d.key}" aria-pressed="${isDone}">${isDone ? "✓ Sesión completada" : "Marcar sesión como hecha"}</button></div></article>`;
  }).join("");
  const progPick = me.is_admin ? `<div class="chips" style="margin-top:10px">${Object.entries(PROGRAMS).map(([id, n]) => `<button class="chip" data-plan-prog="${id}" aria-pressed="${+id === planProg}">${esc(n)}</button>`).join("")}</div>` : "";
  $("#app").innerHTML = `
    <h2>Tu programa</h2>
    <div class="phase"><b>${esc(P.name || progName(planProg))}</b><div class="muted" style="font-size:14px">${me.is_admin ? "Como entrenador puedes ver cualquier programa." : `2 meses (8 semanas) · ${SD.length} ${SD.length === 1 ? "sesión" : "sesiones"} por semana.`}</div>${progPick}</div>
    <h2>Semana del plan</h2>
    <p class="muted" style="font-size:13px;margin:-4px 0 0">A = primer mes · B = segundo mes</p>
    <div class="weeks">${Array.from({ length: 8 }, (_, i) => { const w = i + 1; return `<button class="wk" aria-pressed="${w === week}" data-w="${w}" aria-label="Semana ${wkLabel(w)}">${wkLabel(w)}<small>${SD.filter((d) => done[w + "-" + d.key]).length}/${SD.length}</small></button>`; }).join("")}</div>
    <div class="phase"><div class="label">Semana ${wkLabel(week)} · ${esc(LV[level])}</div><b>${esc(P.phases[p].name)} · ${esc(P.variants?.[VAR(week)] || "Rutina " + VAR(week))}</b><div class="muted" style="font-size:14px">${esc(P.phases[p].txt)}</div></div>
    ${pz.notes.length ? `<div class="panel" style="margin-top:14px"><h3>Plan adaptado a ti</h3><ul style="margin:8px 0 0;padding-left:18px;font-size:14px">${pz.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    ${planned ? `<h2>Día</h2>${dowPick}` : ""}
    ${restCard}
    ${visibleDays.length ? `<h2>Calentamiento</h2>
    <div class="day" style="--c:var(--ball-deep)">
      <div class="day-head"><div><div class="label">Antes de cada sesión · ${P.ankle?.length ? "15–20" : "10–15"} min</div><h3>${esc(P.warmTitle || "Foam roller + movilidad")}</h3></div><div class="dose">Ritmo<br>lento</div></div>
      ${P.warm?.length ? `<div class="sec">${esc(WS[0])}</div>${P.warm.map(row).join("")}` : ""}${P.ankle?.length ? `<div class="sec">${esc(WS[1])}</div>${P.ankle.map(row).join("")}` : ""}${P.mov?.length ? `<div class="sec">${esc(WS[2])}</div>${P.mov.map(row).join("")}` : ""}
      <div class="note">${esc(P.warmNote || "Rueda despacio (unos 2–3 cm por segundo) y para 10–20 s en los puntos cargados. Evita rodar sobre articulaciones y zona lumbar. Un tobillo con buena dorsiflexión frena mejor en las salidas laterales y protege rodilla y tendón de Aquiles. Deja al menos 48 h entre la sesión de explosividad y un partido de competición.")}</div>
    </div>
    <h2>${showAllDays || !planned ? "Sesiones" : "Tu sesión"}</h2>${days}` : ""}${hasComp() ? `<div class="banner" style="margin-top:18px">¿Semana de partidos o día de competición? Lo tienes en la pestaña <button class="linkbtn" data-tab="competicion">Competición</button>.</div>` : ""}
    <h2>${planProg === 1 ? "Tu nivel" : "Tu experiencia"}</h2>
    <div class="phase"><b>${esc(planProg === 1 ? LV[level] : LEVEL_TEXT[LV[level]] || LV[level])}</b><div class="muted" style="font-size:14px">${me.is_admin ? "Como entrenador puedes cambiarlo en Perfil para ver otros niveles." : "Si crees que no es el tuyo, cámbialo en Perfil o coméntalo con Zeben."}</div></div>`;
}

// Pestaña Competición: semana de competición y día de partido, aparte del plan diario
function renderCompetition() {
  if (!P) { $("#app").innerHTML = lockedCard(); return; }
  const progPick = me.is_admin ? `<div class="chips" style="margin-top:14px">${Object.entries(PROGRAMS).map(([id, n]) => `<button class="chip" data-comp-prog="${id}" aria-pressed="${+id === planProg}">${esc(n)}</button>`).join("")}</div>` : "";
  const body = competitionHTML(exRow) + matchdayHTML(exRow);
  $("#app").innerHTML = `${progPick}${body || `<div class="empty" style="margin-top:24px"><b>Este programa no tiene sesiones de competición.</b>${me.is_admin ? "<br>Puedes crearlas en Editar plan." : ""}</div>`}`;
}

// Sesiones para semanas de competición
function competitionHTML(row) {
  const c = P && P.competition; if (!c || !Array.isArray(c.sessions)) return "";
  return `<h2>${esc(c.title)}</h2><div class="phase"><div class="muted" style="font-size:14px">${esc(c.intro)}</div></div>` +
    c.sessions.map((s) => `<article class="day" style="--c:var(--f-fuerza)">
      <div class="day-head"><div><div class="label">${esc(s.label)}</div><h3>${esc(s.title)}</h3></div><div class="dose">Semana de<br>partidos</div></div>
      ${(s.blocks || []).map((b) => `<div class="sec">${esc(b.sec)}</div>${(b.rows || []).map(row).join("")}`).join("")}
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}</article>`).join("");
}

// Sesión extra para el día de partido (no cuenta en las 24 sesiones del plan)
function matchdayHTML(row) {
  const m = P && P.matchday; if (!m || !Array.isArray(m.blocks)) return "";
  return `<h2>${esc(m.heading || "Día de partido")}</h2>
    <article class="day" style="--c:var(--danger)">
      <div class="day-head"><div><div class="label">${esc(m.label)}</div><h3>${esc(m.title)}</h3></div><div class="dose">Antes de<br>competir</div></div>
      ${m.blocks.map((b) => `<div class="sec">${esc(b.sec)}</div>${(b.rows || []).map(row).join("")}`).join("")}
      ${m.note ? `<div class="note">${esc(m.note)}</div>` : ""}
    </article>`;
}

// =====================================================================
//  CARGAS Y TESTS (los usa el atleta para sí mismo y el entrenador en cada ficha)
// =====================================================================
function exerciseOptions() {
  if (!P) return "";
  return P.days.map((d) => "ABC".split("").map((v) => `<optgroup label="${esc(d.title)} · Rutina ${v}">${d.ex[v].map((e) => `<option>${esc(e[0])}</option>`).join("")}</optgroup>`).join("")).join("");
}
function recordsHTML(loads, tests, weight) {
  const best = {}; loads.forEach((r) => { if (best[r.exercise] == null || +r.kg > best[r.exercise]) best[r.exercise] = +r.kg; });
  return `
  <div class="panel">
    <h3>Registrar cargas</h3>
    <p class="muted" style="margin:4px 0 10px;font-size:14px">Anota el peso usado en cada ejercicio para ver el progreso.</p>
    <div class="grid2">
      <label class="field full"><span class="label">Ejercicio</span><select id="r-ej">${exerciseOptions()}</select></label>
      <label class="field"><span class="label">Peso (kg)</span><input id="r-kg" type="number" inputmode="decimal" step="0.5" min="0" max="400"></label>
      <label class="field"><span class="label">Series × reps</span><input id="r-sr" placeholder="4x8" maxlength="8"></label>
      <label class="field"><span class="label">Fecha</span><input id="r-fecha" type="date" value="${todayISO()}" max="${todayISO()}"></label>
      <label class="field"><span class="label">RPE (1–10)</span><input id="r-rpe" type="number" inputmode="numeric" min="1" max="10"></label>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" id="addReg">Añadir registro</button><span id="regMsg" class="err"></span></div>
    ${loads.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Ejercicio</th><th>Kg</th><th>Series</th><th>RPE</th><th></th></tr></thead><tbody>
      ${loads.map((r) => `<tr><td>${fmtDate(r.day)}</td><td>${esc(r.exercise)}</td><td class="${best[r.exercise] === +r.kg ? "best" : ""}">${esc(r.kg)}</td><td>${esc(r.sets_reps || "")}</td><td>${esc(r.rpe ?? "")}</td><td class="x"><button aria-label="Borrar registro" data-delload="${esc(r.id)}">✕</button></td></tr>`).join("")}
    </tbody></table></div><p class="muted" style="font-size:12px;margin:6px 0 0">En verde, la mejor marca en cada ejercicio.</p>` : `<div class="empty">Sin cargas registradas.</div>`}
  </div>
  <div class="panel">
    <h3>Tests físicos</h3>
    <p class="muted" style="margin:4px 0 10px;font-size:14px">Repite en la semana 1 y la semana 8 para medir la mejora.</p>
    <div class="grid2">
      <label class="field"><span class="label">Salto vertical (cm)</span><input id="t-salto" type="number" inputmode="decimal" step="0.5"></label>
      <label class="field"><span class="label">Sprint 10 m (s)</span><input id="t-sprint" type="number" inputmode="decimal" step="0.01"></label>
      <label class="field"><span class="label">Test de araña (s)</span><input id="t-agil" type="number" inputmode="decimal" step="0.01"></label>
      <label class="field"><span class="label">Peso ese día (kg)</span><input id="t-peso" type="number" inputmode="decimal" step="0.1" value="${esc(weight ?? "")}"></label>
      <label class="field"><span class="label">Fecha</span><input id="t-fecha" type="date" value="${todayISO()}" max="${todayISO()}"></label>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" id="addTest">Guardar test</button><span id="testMsg" class="err"></span></div>
    ${tests.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Salto</th><th>10 m</th><th>Araña</th><th>Peso</th><th></th></tr></thead><tbody>
      ${tests.map((t) => `<tr><td>${fmtDate(t.day)}</td><td>${esc(t.jump_cm ?? "—")} cm</td><td>${esc(t.sprint_s ?? "—")} s</td><td>${esc(t.agility_s ?? "—")} s</td><td>${esc(t.weight_kg ?? "—")} kg</td><td class="x"><button aria-label="Borrar test" data-deltest="${esc(t.id)}">✕</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Sin tests todavía.</div>`}
  </div>`;
}
const numOrNull = (id) => { const v = $(id)?.value; return v === "" || v == null ? null : +v; };
async function addLoadFor(userId) {
  const kg = numOrNull("#r-kg"); if (kg == null) { $("#regMsg").textContent = "Indica el peso en kg."; return false; }
  await rpc("add_load", { p_user: userId, p_exercise: $("#r-ej").value, p_kg: kg, p_sets: $("#r-sr").value.trim() || null, p_rpe: numOrNull("#r-rpe"), p_day: $("#r-fecha").value || todayISO() });
  return true;
}
async function addTestFor(userId) {
  const j = numOrNull("#t-salto"), s = numOrNull("#t-sprint"), a = numOrNull("#t-agil");
  if (j == null && s == null && a == null) { $("#testMsg").textContent = "Rellena al menos un test."; return false; }
  await rpc("add_test", { p_user: userId, p_jump: j, p_sprint: s, p_agility: a, p_weight: numOrNull("#t-peso"), p_day: $("#t-fecha").value || todayISO() });
  return true;
}
async function fetchRecords(userId) {
  const [l, t] = await Promise.all([
    q(sb.from("loads").select("*").eq("user_id", userId).order("day", { ascending: false }).order("created_at", { ascending: false }).limit(500)),
    q(sb.from("tests").select("*").eq("user_id", userId).order("day", { ascending: false }).limit(200)),
  ]);
  return { l, t };
}

async function renderMyProgress() {
  if (!P) { $("#app").innerHTML = lockedCard(); return; }
  $("#app").innerHTML = `<p class="muted" style="margin-top:24px">Cargando…</p>`;
  try { const r = await fetchRecords(me.id); myLoads = r.l; myTests = r.t; } catch (e) { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (tab !== "progreso") return;
  $("#app").innerHTML = `<h2>Mi progreso</h2>${recordsHTML(myLoads, myTests, me.weight_kg)}`;
}

// =====================================================================
//  PERFIL
// =====================================================================
// Nivel y posición: en pádel se ven tal cual; en los demás programas, nivel de experiencia y sin posición
const LEVEL_TEXT = { "Iniciación": "Empiezo ahora o hace mucho que no entreno", "Intermedio": "Entreno de vez en cuando", "Avanzado": "Entreno con regularidad", "Competición": "Entreno mucho o compito" };
function athleteFields(a, levels, progId = 1) {
  const padel = +progId === 1;
  const side = padel
    ? `<label class="field"><span class="label">Posición en pista</span><select id="f-lado">${SIDES.map((l) => `<option ${a.side === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`
    : `<input type="hidden" id="f-lado" value="${esc(SIDES.includes(a.side) ? a.side : SIDES[0])}">`;
  return `<div class="grid2">
    <label class="field full"><span class="label">Nombre</span><input id="f-nombre" value="${esc(a.name)}" maxlength="40"></label>
    <label class="field ${padel ? "" : "full"}"><span class="label">${padel ? "Nivel de pádel" : "Experiencia entrenando"}</span><select id="f-nivel">${levels.map((l) => `<option value="${esc(l)}" ${a.level === l ? "selected" : ""}>${esc(padel ? l : LEVEL_TEXT[l] || l)}</option>`).join("")}</select></label>
    ${side}
    <label class="field"><span class="label">Edad (años)</span><input id="f-edad" type="number" inputmode="numeric" min="10" max="90" value="${esc(a.age ?? "")}"></label>
    <label class="field"><span class="label">Altura (cm)</span><input id="f-altura" type="number" inputmode="decimal" min="120" max="230" value="${esc(a.height_cm ?? "")}"></label>
    <label class="field"><span class="label">Peso corporal (kg)</span><input id="f-peso" type="number" inputmode="decimal" step="0.1" min="30" max="200" value="${esc(a.weight_kg ?? "")}"></label>
    <label class="field full"><span class="label">Objetivo final</span><select id="f-objetivo"><option value="">Elige tu objetivo…</option>${GOALS.map((g) => `<option ${a.goal === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
    <label class="field full"><span class="label">Cuéntalo con tus palabras (opcional)</span><input id="f-objetivo-txt" value="${esc(a.goal_detail ?? "")}" maxlength="300" placeholder="Ej.: bajar 5 kg antes del verano, ganar el torneo de mi club…"></label>
    <label class="field full"><span class="label">¿Tienes alguna lesión, dolor o patología?</span><select id="f-lesion"><option value="">Elige…</option><option value="no" ${a.has_injury === false ? "selected" : ""}>No</option><option value="si" ${a.has_injury ? "selected" : ""}>Sí</option></select></label>
    <label class="field full" id="f-lesion-box" ${a.has_injury ? "" : "hidden"}><span class="label">¿Cuál? Desde cuándo y si te sigue molestando</span><input id="f-lesiones" value="${esc(a.injuries ?? "")}" maxlength="400" placeholder="Ej.: tendinitis rotuliana derecha desde 2024, hipertensión, asma…">
      <span class="label" style="margin-top:10px;display:block">¿Qué zona? Marca todas las que te molesten</span>
      <span class="chips" style="margin-top:6px">${Object.entries(ZONES).map(([k, n]) => `<label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="f-zona" value="${k}" ${(a.injury_zones || []).includes(k) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</span></label>
    <label class="field full"><span class="label">Otras notas</span><input id="f-notas" value="${esc(a.notes ?? "")}" maxlength="300"></label>
  </div>`;
}
const GOALS = ["Perder grasa", "Ganar músculo", "Rendir más en mi deporte", "Preparar una competición", "Salud y bienestar", "Volver tras una lesión", "Otro"];
function readHealth() {
  const l = $("#f-lesion").value;
  return { p_has_injury: l === "" ? null : l === "si", p_injuries: $("#f-lesiones").value.replace(/[<>]/g, "").trim(),
    p_goal: $("#f-objetivo").value || null, p_goal_detail: $("#f-objetivo-txt").value.replace(/[<>]/g, "").trim(),
    p_zones: [...document.querySelectorAll(".f-zona:checked")].map((x) => x.value) };
}
document.addEventListener("change", (e) => { if (e.target.id === "f-lesion") { const b = $("#f-lesion-box"); if (b) b.hidden = e.target.value !== "si"; } });
function readFields() {
  return { p_name: $("#f-nombre").value.replace(/[<>]/g, "").trim(), p_level: $("#f-nivel").value, p_side: $("#f-lado").value,
    p_age: numOrNull("#f-edad"), p_height: numOrNull("#f-altura"), p_weight: numOrNull("#f-peso"), p_notes: $("#f-notas").value.replace(/[<>]/g, "").trim() };
}
const LEVELS_DEFAULT = ["Iniciación", "Intermedio", "Avanzado", "Competición"];

async function renderProfile() {
  let hasCode = true; try { hasCode = await rpc("has_recovery_code"); } catch (_) {}
  const pushOn = await pushState();
  const status = me.is_admin ? `<span class="pill">Entrenador</span>` : isActive(me) ? `<span class="pill">Plan activo${me.paid_until ? " hasta " + fmtDate(me.paid_until) : ""}</span>` : `<span class="pill off">Pendiente de activar</span>`;
  $("#app").innerHTML = `
  <div class="row" style="gap:12px;margin-top:22px"><span class="avatar">${esc(initials(me.name))}</span>
    <div style="min-width:0;flex:1"><h2 style="margin:0">${esc(me.name)}</h2>${status}</div></div>
  <div class="panel"><h3>Mis datos</h3><div style="margin-top:12px">${athleteFields(me, P?.levels || LEVELS_DEFAULT, myProg())}</div>
    <div class="row" style="margin-top:14px"><button class="btn" id="saveMe">Guardar</button></div><div id="meMsg" class="err"></div></div>
  <div class="panel"><h3>Avisos en este móvil</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">${me.is_admin ? "Te avisa cuando se apunta un atleta nuevo y cuando la app tiene un error." : "Te avisa cuando Zeben active tu plan."} En iPhone, primero añade la app a la pantalla de inicio.</p>
    <button class="btn ${pushOn ? "ghost" : ""}" id="pushBtn">${pushOn ? "Desactivar avisos" : "Activar avisos en este móvil"}</button></div>
  <div class="panel"><h3>Seguridad</h3>
    ${hasCode ? "" : `<div class="banner" style="margin-top:8px">No tienes código de recuperación. Créalo para no perder el acceso si olvidas el PIN.</div>`}
    <div class="row" style="margin-top:12px"><button class="btn ghost" id="newCode">${hasCode ? "Crear código nuevo" : "Crear código de recuperación"}</button><button class="btn ghost" id="chPin">Cambiar PIN</button></div>
    <div id="pinBox"></div></div>
  <div class="panel"><h3>Mis datos y mi cuenta</h3>
    <div class="row" style="margin-top:12px"><button class="btn ghost" id="exportMe">Descargar mis datos</button><button class="btn ghost" id="logout">Cerrar sesión</button></div>
    ${me.is_admin ? "" : `<div style="margin-top:14px" id="delZone"><button class="btn danger sm" id="askDelMe">Borrar mi cuenta</button></div>`}
  </div>`;
}

async function savePin() {
  const a = $("#p1").value.trim(), b = $("#p2").value.trim(), m = $("#pinMsg");
  if (!/^\d{4}$/.test(a)) return (m.textContent = "El PIN tiene que ser de 4 cifras.");
  if (/^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|4321)$/.test(a)) return (m.textContent = "Ese PIN es muy fácil de adivinar.");
  if (a !== b) return (m.textContent = "Los dos PIN no coinciden.");
  const phone = me.phone || normPhone((await sb.auth.getUser()).data.user?.email?.split("@")[0]);
  const { error } = await sb.auth.updateUser({ password: passwordOf(phone, a) });
  if (error) { m.textContent = friendly(error); return; }
  $("#pinBox").innerHTML = ""; toast("PIN cambiado");
}

// ---------- Avisos (Web Push) ----------
async function pushState() {
  try { const r = await navigator.serviceWorker?.getRegistration(); const s = await r?.pushManager?.getSubscription(); return !!s; } catch (_) { return false; }
}
function b64ToBytes(b64) { const p = "=".repeat((4 - (b64.length % 4)) % 4); const s = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
async function togglePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) { toast("Este navegador no admite avisos. En iPhone, añade la app a la pantalla de inicio."); return; }
  const reg = await navigator.serviceWorker.ready;
  const cur = await reg.pushManager.getSubscription();
  if (cur) { await rpc("delete_push", { p_endpoint: cur.endpoint }).catch(() => {}); await cur.unsubscribe(); toast("Avisos desactivados"); return renderProfile(); }
  if ((await Notification.requestPermission()) !== "granted") { toast("Has bloqueado los avisos. Actívalos en los ajustes del navegador."); return; }
  const { publicKey } = await callFn("notify", { action: "key" });
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const j = sub.toJSON();
  await rpc("save_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  toast("Avisos activados"); renderProfile();
}

async function exportMine() {
  const data = await rpc("export_my_data");
  downloadJSON(data, `zeben-mis-datos-${todayISO()}.json`);
}
function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function logout() {
  try { const r = await navigator.serviceWorker?.getRegistration(); const s = await r?.pushManager?.getSubscription(); if (s) { await rpc("delete_push", { p_endpoint: s.endpoint }).catch(() => {}); await s.unsubscribe(); } } catch (_) {}
  await sb.auth.signOut(); me = null; P = null; done = {}; athletes = []; detail = null;
  history.replaceState(null, "", location.pathname); renderAuth("login");
}

// =====================================================================
//  ENTRENADOR: ATLETAS
// =====================================================================
function accessPill(a) {
  if (a.is_admin) return `<span class="pill">Entrenador</span>`;
  if (!a.active) return `<span class="pill off">Pendiente</span>`;
  if (a.paid_until && a.paid_until < todayISO()) return `<span class="pill warn">Caducado</span>`;
  return `<span class="pill">${a.paid_until ? "Hasta " + fmtDate(a.paid_until) : "Activo"}</span>`;
}
async function renderAthletes() {
  if (openId) return renderAthlete();
  $("#app").innerHTML = `<p class="muted" style="margin-top:24px">Cargando…</p>`;
  try { athletes = await q(sb.from("profiles").select("*").order("name")); } catch (e) { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (tab !== "atletas") return;
  const list = athletes.filter((a) => !a.is_admin);
  const pend = list.filter((a) => !a.active).length;
  $("#app").innerHTML = `
    <div class="row" style="justify-content:space-between;margin-top:22px"><h2 style="margin:0">Mis atletas</h2><span class="muted" style="font-size:14px">${list.length} en total${pend ? ` · ${pend} pendiente${pend > 1 ? "s" : ""}` : ""}</span></div>
    <div class="banner">Los atletas se registran solos desde la app. Tú activas su plan cuando te pagan y pones hasta qué fecha.</div>
    <div class="athletes">${list.length ? list.map((a) => `<button class="ath" data-open="${esc(a.id)}">
      <span class="avatar">${esc(initials(a.name))}</span>
      <span style="min-width:0"><div class="nm">${esc(a.name)}</div>
      <div class="meta">${a.has_injury ? `<b style="color:var(--danger)">⚠ Lesión</b> · ` : ""}${esc(progName(a.program_id))} · ${esc(a.level)} · ${a.age ?? "—"} años · ${a.height_cm ?? "—"} cm · ${a.weight_kg ?? "—"} kg</div></span>
      ${accessPill(a)}</button>`).join("") : `<div class="empty"><b>Todavía no hay atletas.</b><br>Pásales el enlace de la app para que creen su cuenta.</div>`}</div>`;
}

// Plan personalizado del atleta: lo automático y los retoques del entrenador
function customHTML() {
  const a = detail?.a, pr = detail?.prog; if (!a || !pr?.days) return "";
  const cu = detail.custom || {}, pz = personalFor({ ...a, custom: cu }, a.program_id || 1);
  const autoOn = cu.auto !== false, setsSel = Number.isInteger(cu.sets) ? String(cu.sets) : "auto";
  const day = (d) => {
    let changed = 0;
    const rows = "ABC".split("").map((v) => { const used = new Set(); return `<div class="label" style="margin-top:10px">Rutina ${v}</div>` + (d.ex[v] || []).map((e0, i) => {
      const id = `${d.key}|${v}|${i}`, r = personalEx(pz, d.key, v, i, e0, used), mine = !!cu.swaps?.[id];
      if (!r || r.tag) changed++;
      if (detail.editing === id) return `<div class="edrow" style="margin-top:6px"><div class="grid2">
          <label class="field full"><span class="label">Ejercicio para ${esc(a.name)}</span><input id="cx-n" maxlength="120" value="${esc(r ? r.e[0] : e0[0])}"></label>
          <label class="field full"><span class="label">Indicación</span><input id="cx-c" maxlength="300" value="${esc(r ? r.e[1] : e0[1])}"></label>
          <label class="field full"><span class="label">Vídeo: enlace de YouTube o palabras para buscar</span><input id="cx-v" maxlength="300" value="${esc(r ? r.e[3] : e0[3])}"></label></div>
          <div class="row" style="margin-top:8px"><button class="btn sm" data-cs="${esc(id)}">Guardar para ${esc(a.name)}</button><button class="btn ghost sm" data-cc="1">Cancelar</button></div></div>`;
      return `<div class="row" style="justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid var(--line)">
        <span style="min-width:0;flex:1;font-size:14px">${r ? esc(r.e[0]) : `<s class="muted">${esc(e0[0])}</s> <span class="muted">· quitado</span>`}${r && r.tag ? `<br><small style="color:var(--ball-deep)">↻ ${esc(r.tag)}</small>` : ""}</span>
        <span class="row" style="gap:4px">${mine ? `<button class="btn ghost sm" data-cr="${esc(id)}">Restaurar</button>` : `<button class="btn ghost sm" data-cx="${esc(id)}">Cambiar</button><button class="btn danger sm" data-cq="${esc(id)}" aria-label="Quitar ${esc(e0[0])}">Quitar</button>`}</span></div>`;
    }).join(""); }).join("");
    return `<details style="margin-top:10px" ${detail.open?.has(d.key) ? "open" : ""} data-cday="${esc(d.key)}"><summary><b>${esc(d.title)}</b> <span class="muted" style="font-size:13px">${changed ? `· ${changed} cambio${changed > 1 ? "s" : ""}` : ""}</span></summary>${rows}</details>`;
  };
  return `<div class="panel" id="customPanel"><h3>Plan personalizado</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">La app adapta el plan a su objetivo y a su lesión. Aquí lo ves y puedes cambiar o quitar ejercicios solo para ${esc(a.name)}.</p>
    <div class="label">Adaptación automática</div>
    <div class="chips" style="margin-top:6px"><button class="chip" data-cauto="1" aria-pressed="${autoOn}">Activada</button><button class="chip" data-cauto="0" aria-pressed="${!autoOn}">Desactivada</button></div>
    <div class="label" style="margin-top:12px">Días por semana</div>
    <div class="chips" style="margin-top:6px"><button class="chip" data-cfreq="def" aria-pressed="${!cu.freq}">Programa (${pr.days.filter((d) => !d.extra).length})</button>${Object.keys(pr.freq || {}).map((n) => `<button class="chip" data-cfreq="${n}" aria-pressed="${String(cu.freq) === n}">${n} días</button>`).join("")}</div>
    ${(a.program_id || 1) === 5 ? `<p class="muted" style="font-size:13px;margin:6px 0 0">En post parto, como mucho 5 días.</p>` : ""}
    <div class="label" style="margin-top:12px">Series</div>
    <div class="chips" style="margin-top:6px">${[["auto", "Según objetivo"], ["-1", "−1 serie"], ["0", "Normal"], ["1", "+1 serie"]].map(([k, n]) => `<button class="chip" data-csets="${k}" aria-pressed="${setsSel === k}">${n}</button>`).join("")}</div>
    ${pz.notes.length ? `<ul style="margin:12px 0 0;padding-left:18px;font-size:14px">${pz.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="muted" style="font-size:14px;margin:12px 0 0">Sin adaptaciones: el atleta no ha indicado objetivo ni lesión por zonas.</p>`}
    ${sessionsFor(pr, { custom: cu }).map(day).join("")}
    <div id="cxMsg" class="err"></div></div>`;
}
async function saveCustom(cu) {
  const clean = { ...cu }; if (clean.swaps && !Object.keys(clean.swaps).length) delete clean.swaps;
  if (clean.auto !== false) delete clean.auto; if (!Number.isInteger(clean.sets)) delete clean.sets; if (!Number.isInteger(clean.freq)) delete clean.freq;
  const val = Object.keys(clean).length ? clean : null;
  await rpc("admin_set_athlete_custom", { p_user: detail.a.id, p_custom: val });
  detail.custom = val || {}; detail.a.custom = val; const x = athletes.find((y) => y.id === detail.a.id); if (x) x.custom = val;
}
function redrawCustom() { const el = $("#customPanel"); if (el) el.outerHTML = customHTML(); }
document.addEventListener("toggle", (e) => { const k = e.target.dataset && e.target.dataset.cday; if (k && detail) { detail.open ||= new Set(); e.target.open ? detail.open.add(k) : detail.open.delete(k); } }, true);

// Días de entreno del atleta: un día de la semana para cada sesión
// Peso saludable según la altura (IMC 18,5–24,9) y resumen de objetivo y lesiones, solo para el entrenador
function weightInfo(a) {
  if (!a.height_cm) return null;
  const h = a.height_cm / 100, lo = Math.round(18.5 * h * h), hi = Math.round(24.9 * h * h);
  if (!a.weight_kg) return { lo, hi, txt: "Falta el peso", cls: "" };
  const b = a.weight_kg / (h * h);
  if (b < 18.5) return { lo, hi, bmi: b, txt: `Por debajo (${Math.round(lo - a.weight_kg)} kg para llegar al rango)`, cls: "warn" };
  if (b < 25) return { lo, hi, bmi: b, txt: "Dentro del rango saludable", cls: "ok" };
  if (b < 30) return { lo, hi, bmi: b, txt: `Por encima (${Math.round(a.weight_kg - hi)} kg sobre el rango)`, cls: "warn" };
  return { lo, hi, bmi: b, txt: `Bastante por encima (${Math.round(a.weight_kg - hi)} kg sobre el rango)`, cls: "bad" };
}
function healthHTML(a) {
  const w = weightInfo(a);
  const inj = a.has_injury ? `<div class="banner" style="border-left:4px solid var(--danger)"><b style="color:var(--danger)">Lesión o patología:</b> ${esc(a.injuries || "Sí, sin detallar")}</div>`
    : a.has_injury === false ? `<div class="banner"><b>Lesiones o patologías:</b> ninguna</div>` : `<div class="banner"><b>Lesiones o patologías:</b> sin contestar</div>`;
  const goal = `<div class="banner"><b>Objetivo:</b> ${a.goal ? esc(a.goal) : "sin contestar"}${a.goal_detail ? ` · ${esc(a.goal_detail)}` : ""}</div>`;
  const wt = w ? `<div class="panel"><h3>Peso óptimo</h3>
    <p style="margin:6px 0 0;font-size:15px">Para ${String(a.height_cm).replace(".", ",")} cm, el rango saludable es <b>${w.lo}–${w.hi} kg</b>.</p>
    ${a.weight_kg ? `<p style="margin:6px 0 0;font-size:15px">Pesa <b>${String(a.weight_kg).replace(".", ",")} kg</b> · IMC ${w.bmi.toFixed(1).replace(".", ",")} · <span class="pill" style="display:inline-block;margin-top:4px;line-height:1.35;white-space:normal;color:#fff;background:${w.cls === "ok" ? "#0F7A5A" : w.cls === "warn" ? "#B45309" : "#B42318"}">${esc(w.txt)}</span></p>` : `<p class="muted" style="margin:6px 0 0;font-size:14px">${esc(w.txt)}.</p>`}
    <p class="muted" style="margin:8px 0 0;font-size:13px">Cálculo por IMC (18,5–24,9). No distingue músculo de grasa: en atletas muy musculados puede salir alto sin que sobre peso.</p></div>` : "";
  return goal + inj + wt;
}
function schedHTML() {
  const pr = detail?.prog; if (!pr?.days) return "";
  const sc = detail.sched || {};
  const SDa = sessionsFor(pr, { custom: detail.custom });
  const used = {}; SDa.forEach((d) => { const v = dowOf(d, sc); if (v >= 0) used[v] = (used[v] || 0) + 1; });
  const rest = DOW.filter((_, i) => !used[i]);
  return `<div class="panel"><h3>Días de entreno</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">Elige qué día de la semana hace cada sesión. Puedes poner días seguidos y el descanso donde quieras.</p>
    ${SDa.map((d) => { const v = dowOf(d, sc); return `<div style="margin-top:10px"><b style="font-size:14px">${esc(d.title)}</b>
      <div class="weeks" style="grid-template-columns:repeat(7,minmax(0,1fr));margin-top:6px">${DOW_SHORT.map((n, i) => `<button class="wk" data-sched="${esc(d.key)}|${i}" aria-pressed="${i === v}" aria-label="${esc(d.title)}: ${DOW[i]}">${n}</button>`).join("")}</div></div>`; }).join("")}
    ${Object.values(used).some((n) => n > 1) ? `<div class="banner" style="margin-top:10px">Hay dos sesiones el mismo día. Se verán juntas ese día.</div>` : ""}
    <p class="muted" style="font-size:13px;margin:10px 0 0">Descanso: ${rest.length ? rest.join(", ") : "ningún día"}.</p>
    <div class="row" style="margin-top:12px"><button class="btn" id="saveSched">Guardar días</button><button class="btn ghost sm" id="resetSched">Volver a los días del programa</button></div>
    <div id="schedMsg" class="err"></div></div>`;
}
async function renderAthlete() {
  const a = athletes.find((x) => x.id === openId); if (!a) { openId = null; return renderAthletes(); }
  $("#app").innerHTML = `<p class="muted" style="margin-top:24px">Cargando ficha…</p>`;
  let r, s;
  let prog = null;
  try { [r, s, prog] = await Promise.all([fetchRecords(a.id), q(sb.from("sessions_done").select("week,day").eq("user_id", a.id)), loadProgram(a.program_id || 1).catch(() => null)]); }
  catch (e) { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (tab !== "atletas" || openId !== a.id) return;
  if (!detail || detail.a.id !== a.id || !detail.sched) detail = { a, sched: { ...(a.schedule || {}) }, custom: JSON.parse(JSON.stringify(a.custom || {})), open: new Set() };
  detail = { ...detail, a, loads: r.l, tests: r.t, prog };
  const t = todayISO();
  $("#app").innerHTML = `
  <button class="back" id="back">← Volver a atletas</button>
  <div class="row" style="gap:12px;margin-top:6px"><span class="avatar">${esc(initials(a.name))}</span>
    <div style="min-width:0;flex:1"><h2 style="margin:0">${esc(a.name)}</h2>${accessPill(a)} <span class="muted" style="font-size:13px">${esc(a.level)}${(a.program_id || 1) === 1 ? ` · ${esc(a.side)}` : ""}</span></div></div>
  <div class="stats">
    <div class="stat"><div class="label">Edad</div><div class="v">${a.age ?? "—"}<small>años</small></div></div>
    <div class="stat"><div class="label">Altura</div><div class="v">${a.height_cm ?? "—"}<small>cm</small></div></div>
    <div class="stat"><div class="label">Peso</div><div class="v">${a.weight_kg ?? "—"}<small>kg</small></div></div>
    <div class="stat"><div class="label">IMC</div><div class="v">${imc(a)}</div></div>
  </div>
  <div class="banner">Sesiones hechas: <b>${detail.prog?.days ? ((sd) => `${s.filter((x) => sd.some((d) => d.key === x.day)).length} de ${sd.length * 8}`)(sessionsFor(detail.prog, { custom: detail.custom })) : `${s.length} de 24`}</b>${a.phone ? ` · Móvil: <b>${esc(a.phone)}</b>` : ""} · Alta: ${fmtDate(a.created_at)}</div>
  ${healthHTML(a)}
  ${a.notes ? `<div class="banner"><b>Notas:</b> ${esc(a.notes)}</div>` : ""}

  <div class="panel"><h3>Programa</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">El atleta solo ve el programa que elijas aquí. Sus sesiones hechas, cargas y tests se conservan.</p>
    <div class="chips">${Object.entries(PROGRAMS).map(([id, n]) => `<button class="chip" data-ath-prog="${id}" aria-pressed="${+id === (a.program_id || 1)}">${esc(n)}</button>`).join("")}</div>
    <div id="progMsg" class="err"></div></div>

  ${customHTML()}

  ${schedHTML()}

  <div class="panel"><h3>Acceso al plan</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">Activa el plan cuando te pague. Al pasar la fecha se bloquea solo.</p>
    <div class="grid2">
      <label class="field"><span class="label">Estado</span><select id="ac-on"><option value="1" ${a.active ? "selected" : ""}>Activo</option><option value="0" ${a.active ? "" : "selected"}>Bloqueado</option></select></label>
      <label class="field"><span class="label">Pagado hasta</span><input id="ac-until" type="date" value="${esc(a.paid_until ?? "")}" min="${addDays(t, -30)}"></label>
    </div>
    <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-plus="30">+1 mes</button><button class="btn ghost sm" data-plus="61">+2 meses</button><button class="btn ghost sm" data-plus="91">+3 meses</button></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="saveAccess">Guardar acceso</button></div><div id="acMsg" class="err"></div></div>

  ${P ? recordsHTML(detail.loads, detail.tests, a.weight_kg) : ""}

  <div class="panel"><h3>Editar datos</h3><div style="margin-top:12px">${athleteFields(a, P?.levels || LEVELS_DEFAULT, a.program_id || 1)}</div>
    <div class="row" style="margin-top:14px"><button class="btn" id="saveEdit">Guardar cambios</button></div><div id="editMsg" class="err"></div></div>

  <div class="panel"><h3>PIN y cuenta</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">Si ha olvidado el PIN y no tiene código de recuperación, ponle uno nuevo y díselo en persona.</p>
    <div class="grid2"><label class="field"><span class="label">PIN nuevo</span><input id="rp-pin" type="password" inputmode="numeric" maxlength="4"></label></div>
    <div class="row" style="margin-top:12px;justify-content:space-between"><button class="btn ghost" id="resetPin">Poner PIN nuevo</button>
    <span id="delZone"><button class="btn danger sm" id="askDel">Borrar atleta</button></span></div><div id="rpMsg" class="err"></div></div>`;
}

// =====================================================================
//  ENTRENADOR: ERRORES Y COPIAS
// =====================================================================
async function renderErrors() {
  $("#app").innerHTML = `<p class="muted" style="margin-top:24px">Cargando…</p>`;
  let errs = [], backs = [];
  try {
    [errs, backs] = await Promise.all([
      q(sb.from("error_log").select("id,at,kind,message,detail").order("at", { ascending: false }).limit(50)),
      q(sb.from("backups").select("id,created_at,size_kb").order("created_at", { ascending: false })),
    ]);
  } catch (e) { $("#app").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (tab !== "errores") return;
  $("#app").innerHTML = `
  <div class="panel"><h3>Errores de la app</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 0">Se guardan 90 días. Te llega un aviso al móvil la primera vez que aparece cada error.</p>
    <div class="row" style="margin:12px 0"><button class="btn ghost sm" id="testErr">Enviar error de prueba</button>${errs.length ? `<button class="btn ghost sm" id="clearErr">Borrar todos</button>` : ""}</div>
    ${errs.length ? errs.map((e) => `<div class="errrow"><b>${esc(e.message)}</b><br><small>${esc(e.kind)} · ${esc(new Date(e.at).toLocaleString("es-ES"))}</small>${e.detail ? `<details><summary><small>Detalle</small></summary><pre style="white-space:pre-wrap;font-size:12px">${esc(e.detail)}</pre></details>` : ""}</div>`).join("") : `<div class="empty">Sin errores. Todo en orden.</div>`}
  </div>
  <div class="panel"><h3>Copias de seguridad</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 0">Se hace una cada lunes y se guardan las 8 últimas. No incluyen PINs.</p>
    <div class="row" style="margin:12px 0"><button class="btn ghost sm" id="backupNow">Hacer copia ahora</button></div>
    ${backs.length ? backs.map((b) => `<div class="errrow row" style="justify-content:space-between"><span>${esc(new Date(b.created_at).toLocaleString("es-ES"))} · ${esc(b.size_kb)} KB</span><button class="btn ghost sm" data-backup="${esc(b.id)}">Descargar</button></div>`).join("") : `<div class="empty">Todavía no hay copias.</div>`}
  </div>`;
}


// =====================================================================
//  ENTRENADOR: EDITAR EL PLAN (ejercicios, series, repeticiones, vídeos)
// =====================================================================
let ED = null, edDirty = false, edProg = 1;
const edOpen = new Set(["s-day-0"]);
const clone = (o) => JSON.parse(JSON.stringify(o));
const getAt = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function setAt(o, p, v) { const ks = p.split("."); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
// Columnas de cada tipo de lista: [etiqueta, posición en la fila]
const COLS = {
  day: [["Ejercicio", 0], ["Indicación técnica", 1], ["Unidad (ej.: por lado)", 2], ["Vídeo: enlace de YouTube o palabras para buscar", 3]],
  row: [["Ejercicio", 0], ["Series / reps / tiempo (ej.: 3×8)", 1], ["Indicación técnica", 3], ["Vídeo: enlace de YouTube o palabras para buscar", 2]],
};
const TPL = { day: () => ["Nuevo ejercicio", "", "", ""], row: () => ["Nuevo ejercicio", "3×8", "", ""] };
const inp = (path, val, label, wide) => `<label class="field ${wide ? "full" : ""}"><span class="label">${esc(label)}</span><input data-ed="${esc(path)}" value="${esc(val ?? "")}" maxlength="${wide ? 300 : 120}"></label>`;
const area = (path, val, label) => `<label class="field full"><span class="label">${esc(label)}</span><textarea data-ed="${esc(path)}" rows="2" maxlength="400" style="width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 11px;font:inherit;font-size:16px;background:var(--bg);color:var(--fg)">${esc(val ?? "")}</textarea></label>`;
function edList(path, type) {
  const arr = getAt(ED, path) || [];
  return `<div class="edlist">${arr.map((r, i) => `<div class="edrow">
      <div class="row" style="justify-content:space-between"><b>${i + 1}. ${esc(r[0] || "Ejercicio")}</b>
      <span class="row" style="gap:4px"><button class="btn ghost sm" data-ed-mv="${path}|${i}|-1" aria-label="Subir" ${i ? "" : "disabled"}>↑</button><button class="btn ghost sm" data-ed-mv="${path}|${i}|1" aria-label="Bajar" ${i < arr.length - 1 ? "" : "disabled"}>↓</button><button class="btn danger sm" data-ed-del="${path}.${i}" aria-label="Quitar">✕</button></span></div>
      <div class="grid2" style="margin-top:8px">${COLS[type].map(([l, c]) => inp(`${path}.${i}.${c}`, r[c], l, !(type === "row" && c === 1) && !(type === "day" && c === 2))).join("")}</div></div>`).join("")}
    <button class="btn ghost sm" data-ed-add="${path}|${type}" style="margin-top:8px">+ Añadir ejercicio</button></div>`;
}
const sec = (id, title, body) => `<details class="panel" data-sec="${id}" ${edOpen.has(id) ? "open" : ""}><summary><h3 style="display:inline">${esc(title)}</h3></summary><div style="margin-top:12px">${body}</div></details>`;
function edBlocks(path) {
  const blocks = getAt(ED, path) || [];
  return blocks.map((b, bi) => `<div class="edblock"><div class="row" style="justify-content:space-between;align-items:flex-end">${inp(`${path}.${bi}.sec`, b.sec, "Nombre del bloque")}<button class="btn danger sm" data-ed-del="${path}.${bi}">Quitar bloque</button></div>${edList(`${path}.${bi}.rows`, "row")}</div>`).join("") +
    `<button class="btn ghost sm" data-ed-addblock="${path}" style="margin-top:10px">+ Añadir bloque</button>`;
}
const cellInput = (path, val, w, max) => `<input data-ed="${path}" value="${esc(val)}" maxlength="${max}" style="width:${w}px;border:1px solid var(--line);border-radius:7px;padding:6px;font-size:14px;background:var(--bg);color:var(--fg)">`;
async function renderEditor() {
  if (!ED) {
    $("#app").innerHTML = `<p class="muted" style="margin-top:24px">Cargando programa…</p>`;
    let d = null; try { d = edProg === planProg && P ? P : await loadProgram(edProg); } catch (_) {}
    if (tab !== "editor") return;
    if (!d) { $("#app").innerHTML = `<h2>Editar el plan</h2>${edPicker()}<div class="empty" style="margin-top:12px">No se ha podido cargar este programa. Si es nuevo, revisa que hayas pegado la actualización de la base de datos en Supabase.</div>`; return; }
    ED = clone(d); edDirty = false;
  }
  const LV = ED.levels, PH = ED.phases;
  const days = ED.days.map((d, i) => {
    const dose = `<div class="tbl"><table><thead><tr><th>Fase</th>${LV.map((l) => `<th>${esc(l)}</th>`).join("")}<th>Descanso</th></tr></thead><tbody>${PH.map((p, pi) => `<tr><td><b>${esc(p.name)}</b></td>${LV.map((_, li) => `<td>${cellInput(`dose.${d.key}.${li}.${pi}`, ED.dose[d.key][li][pi], 120, 40)}</td>`).join("")}<td>${cellInput(`rest.${d.key}.${pi}`, ED.rest[d.key][pi], 90, 30)}</td></tr>`).join("")}</tbody></table></div>`;
    const weeksOf = (v) => [1, 2, 3, 4, 5, 6, 7, 8].filter((w) => "ABC"[(w - 1) % 3] === v).map(wkLabel).join(", ");
    return sec(`s-day-${i}`, d.title + (d.extra ? " · para 4–6 días" : ""), `<div class="row" style="justify-content:flex-end;margin-bottom:8px">${ED.days.length > 1 ? `<button class="btn danger sm" data-ed-delday="${i}">Quitar esta sesión</button>` : ""}</div><div class="grid2">${inp(`days.${i}.title`, d.title, "Nombre de la sesión")}${inp(`days.${i}.when`, d.when, "Día de la semana (Lunes, Martes…)")}${area(`days.${i}.note`, d.note, "Nota al final de la sesión")}</div>
      <h3 style="margin-top:14px">Series y repeticiones</h3><p class="muted" style="font-size:13px;margin:4px 0">Formato: «3×8 · RPE 7». Lo que va después del «·» sale como indicación.</p>${dose}
      ${"ABC".split("").map((v) => `<h3 style="margin-top:16px">Rutina ${v} <span class="muted" style="font:500 13px var(--body)">· semanas ${weeksOf(v)}</span></h3>${edList(`days.${i}.ex.${v}`, "day")}`).join("")}`);
  }).join("");
  const addDay = ED.days.length < 10 ? `<div class="panel"><div class="row" style="justify-content:space-between;align-items:center"><span class="muted" style="font-size:14px">${ED.days.length} ${ED.days.length === 1 ? "sesión" : "sesiones"} en este programa · máximo 10</span><button class="btn sm" id="edAddDay">+ Añadir sesión</button></div></div>` : `<div class="banner">Este programa ya tiene 10 sesiones, el máximo.</div>`;
  const phases = sec("s-phases", "Fases del plan", PH.map((p, pi) => `<div class="grid2" style="margin-bottom:10px">${inp(`phases.${pi}.name`, p.name, `Fase ${pi + 1} · semanas ${p.weeks.map(wkLabel).join(", ")}`)}${area(`phases.${pi}.txt`, p.txt, "Explicación")}</div>`).join(""));
  const WS = ED.warmSecs || ["1 · Foam roller", "2 · Movilidad de tobillo", "3 · Movilidad y activación"];
  const warm = sec("s-warm", ED.warmTitle || "Calentamiento", `<h3>${esc(WS[0])}</h3>${edList("warm", "row")}<h3 style="margin-top:16px">${esc(WS[1])}</h3>${edList("ankle", "row")}<h3 style="margin-top:16px">${esc(WS[2])}</h3>${edList("mov", "row")}`);
  const c = ED.competition;
  const comp = sec("s-comp", "Semana de competición", c ? `<div class="grid2">${inp("competition.title", c.title, "Título de la sección")}${area("competition.intro", c.intro, "Explicación")}</div>` +
    c.sessions.map((s, si) => `<div class="edblock" style="border-color:var(--court)"><div class="row" style="justify-content:space-between"><b>Sesión ${si + 1}</b><button class="btn danger sm" data-ed-del="competition.sessions.${si}">Quitar sesión</button></div>
      <div class="grid2">${inp(`competition.sessions.${si}.title`, s.title, "Nombre")}${inp(`competition.sessions.${si}.label`, s.label, "Cuándo y duración")}${area(`competition.sessions.${si}.note`, s.note, "Nota final")}</div>${edBlocks(`competition.sessions.${si}.blocks`)}</div>`).join("") +
    `<button class="btn sm" id="edAddSession" style="margin-top:12px">+ Añadir sesión de competición</button>` : `<button class="btn sm" id="edAddSession">+ Crear sección de competición</button>`);
  const m = ED.matchday;
  const match = m ? sec("s-match", edProg === 2 ? "Día de la prueba" : "Día de partido", `<div class="grid2">${inp("matchday.title", m.title, "Nombre")}${inp("matchday.label", m.label, "Cuándo y duración")}${area("matchday.note", m.note, "Nota final")}</div>${edBlocks("matchday.blocks")}`) : "";
  $("#app").innerHTML = `<h2>Editar el plan</h2>${edPicker()}
    <div class="banner">Estás editando <b>${esc(ED.name || progName(edProg))}</b>. Los cambios llegan a los atletas de este programa en cuanto pulses <b>Guardar cambios</b>. Si te equivocas, puedes deshacer el último guardado.</div>
    ${days}${addDay}${phases}${warm}${comp}${match}
    <div class="panel"><div class="row"><button class="btn ghost sm" id="edUndo">Deshacer último guardado</button></div></div>
    <div class="edbar"><span id="edState">${edDirty ? "Cambios sin guardar" : "Sin cambios"}</span><span class="row"><button class="btn ghost sm" id="edDiscard">Descartar</button><button class="btn sm" id="edSave">Guardar cambios</button></span></div>`;
}
function edPicker() { return `<div class="chips" style="margin:6px 0 12px">${Object.entries(PROGRAMS).map(([id, n]) => `<button class="chip" data-ed-prog="${id}" aria-pressed="${+id === edProg}">${esc(n)}</button>`).join("")}</div>`; }
function edMark() { edDirty = true; const s = $("#edState"); if (s) s.textContent = "Cambios sin guardar"; }
function edValidate() {
  const bad = [];
  const chk = (arr, where) => (arr || []).forEach((r, i) => { const n = String(r[0] || "").trim(); if (n.length < 2) bad.push(`${where}: el ejercicio ${i + 1} no tiene nombre`); });
  ED.days.forEach((d) => "ABC".split("").forEach((v) => chk(d.ex[v], `${d.title} · Rutina ${v}`)));
  chk(ED.warm, "Foam roller"); chk(ED.ankle, "Movilidad de tobillo"); chk(ED.mov, "Movilidad y activación");
  (ED.competition?.sessions || []).forEach((s) => s.blocks.forEach((b) => chk(b.rows, s.title)));
  (ED.matchday?.blocks || []).forEach((b) => chk(b.rows, "Día de partido"));
  if (/[<>]/.test(JSON.stringify(ED))) bad.push("No uses los signos < o >");
  return bad;
}
document.addEventListener("input", (e) => { const p = e.target.dataset && e.target.dataset.ed; if (p && ED && tab === "editor") { setAt(ED, p, e.target.value); edMark(); } });
document.addEventListener("toggle", (e) => { const id = e.target.dataset && e.target.dataset.sec; if (id) e.target.open ? edOpen.add(id) : edOpen.delete(id); }, true);
async function edClick(t) {
  if (t.dataset.edProg) {
    const id = +t.dataset.edProg; if (id === edProg) return true;
    if (edDirty && !confirm("Tienes cambios sin guardar en este programa. ¿Cambiar sin guardar?")) return true;
    edProg = id; ED = null; edDirty = false; renderEditor(); return true;
  }
  if (t.dataset.edAdd) { const [p, type] = t.dataset.edAdd.split("|"); getAt(ED, p).push(TPL[type]()); edMark(); renderEditor(); return true; }
  if (t.id === "edAddDay") {
    if (ED.days.length >= 10) return true;
    const keys = new Set(ED.days.map((d) => d.key)); let n = ED.days.length + 1; while (keys.has("d" + n)) n++;
    const key = "d" + n, used = new Set(ED.days.map((d) => dowDefault(d)));
    const free = [0, 1, 2, 3, 4, 5, 6].find((x) => !used.has(x)) ?? 0;
    const base = ED.days[0].key;
    ED.days.push({ key, title: `Día ${ED.days.length + 1} · Nueva sesión`, c: ["--f-fuerza", "--f-explo", "--f-agil"][ED.days.length % 3], when: DOW[free], note: "", ex: { A: [], B: [], C: [] } });
    ED.dose[key] = clone(ED.dose[base]); ED.rest[key] = clone(ED.rest[base]);
    edOpen.add(`s-day-${ED.days.length - 1}`); edMark(); renderEditor(); toast("Sesión añadida. Ponle nombre, día y ejercicios."); return true;
  }
  if (t.dataset.edDelday) {
    const i = +t.dataset.edDelday, d = ED.days[i]; if (!d || ED.days.length <= 1) return true;
    if (!confirm(`¿Quitar la sesión «${d.title}» de este programa?`)) return true;
    ED.days.splice(i, 1); delete ED.dose[d.key]; delete ED.rest[d.key]; edMark(); renderEditor(); return true;
  }
  if (t.dataset.edAddblock) { getAt(ED, t.dataset.edAddblock).push({ sec: "Nuevo bloque", rows: [] }); edMark(); renderEditor(); return true; }
  if (t.dataset.edDel) { const ks = t.dataset.edDel.split("."); const i = +ks.pop(); const arr = getAt(ED, ks.join(".")); if (!confirm("¿Quitar este elemento?")) return true; arr.splice(i, 1); edMark(); renderEditor(); return true; }
  if (t.dataset.edMv) { const [p, i, d] = t.dataset.edMv.split("|"); const arr = getAt(ED, p); const a = +i, b = a + +d; if (b < 0 || b >= arr.length) return true; [arr[a], arr[b]] = [arr[b], arr[a]]; edMark(); renderEditor(); return true; }
  if (t.id === "edAddSession") {
    if (!ED.competition) ED.competition = { title: "Semana de competición", intro: "Sesiones para las semanas con partidos.", sessions: [] };
    const n = ED.competition.sessions.length + 1;
    ED.competition.sessions.push({ label: `Sesión ${n} · cuándo · duración`, title: "Nueva sesión", blocks: [{ sec: "Calentamiento", rows: [] }, { sec: "Parte principal", rows: [] }], note: "" });
    edOpen.add("s-comp"); edMark(); renderEditor(); return true;
  }
  if (t.id === "edDiscard") { if (edDirty && !confirm("¿Descartar los cambios sin guardar?")) return true; ED = null; renderEditor(); toast("Cambios descartados"); return true; }
  if (t.id === "edSave") {
    const bad = edValidate(); if (bad.length) { toast(bad[0]); return true; }
    t.disabled = true;
    try { await rpc("admin_set_program", { p_data: ED, p_id: edProg }); if (edProg === planProg) P = clone(ED); edDirty = false; toast(`${progName(edProg)} guardado. Tus atletas ya lo ven.`); renderEditor(); }
    finally { t.disabled = false; }
    return true;
  }
  if (t.id === "edUndo") {
    if (edDirty && !confirm("Perderás los cambios sin guardar. ¿Seguir?")) return true;
    if (!confirm("¿Volver al plan que había antes del último guardado?")) return true;
    const d = await rpc("admin_undo_program", { p_id: edProg }); if (!d) { toast("No hay ningún guardado anterior"); return true; }
    if (edProg === planProg) P = d; ED = null; renderEditor(); toast("Plan anterior recuperado"); return true;
  }
  return false;
}

// =====================================================================
//  CLICS
// =====================================================================
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button,[data-tab]"); if (!t) return;
  try {
    if (t.dataset.auth) return renderAuth(t.dataset.auth);
    if (t.id === "doLogin") return await doLogin(t);
    if (t.id === "doSignup") return await doSignup(t);
    if (t.id === "doForgot") return await doForgot(t);
    if (!me) return;
    if (t.dataset.tab) { openId = null; return go(t.dataset.tab); }
    if (t.id === "who") { openId = null; return go("perfil"); }

    // Plan
    if (t.dataset.w) { week = +t.dataset.w; store.set("zb-week", week); return renderPlan(); }
    if (t.dataset.dow) { selDow = +t.dataset.dow; showAllDays = false; return renderPlan(); }
    if (t.dataset.alldays) { showAllDays = !showAllDays; return renderPlan(); }
    if (t.dataset.done) {
      const [w, d] = t.dataset.done.split("|"); t.disabled = true;
      const on = await rpc("toggle_session", { p_week: +w, p_day: d });
      if (on) done[`${w}-${d}`] = true; else delete done[`${w}-${d}`];
      renderProgress(); return renderPlan();
    }

    // Cargas y tests (mías o del atleta abierto)
    const target = tab === "atletas" && detail ? detail.a.id : me.id;
    const refresh = () => (tab === "atletas" ? renderAthlete() : renderMyProgress());
    if (t.id === "addReg") { t.disabled = true; try { if (await addLoadFor(target)) { toast("Registro guardado"); refresh(); } } catch (err) { $("#regMsg").textContent = err.message; } finally { t.disabled = false; } return; }
    if (t.id === "addTest") { t.disabled = true; try { if (await addTestFor(target)) { toast("Test guardado"); if (target === me.id) me = await loadMe(); else athletes = await q(sb.from("profiles").select("*").order("name")); refresh(); } } catch (err) { $("#testMsg").textContent = err.message; } finally { t.disabled = false; } return; }
    if (t.dataset.delload) { if (!confirm("¿Borrar este registro?")) return; await rpc("delete_load", { p_id: t.dataset.delload }); return refresh(); }
    if (t.dataset.deltest) { if (!confirm("¿Borrar este test?")) return; await rpc("delete_test", { p_id: t.dataset.deltest }); return refresh(); }

    // Perfil
    if (t.id === "saveMe") {
      const f = readFields(); if (f.p_name.length < 2) return ($("#meMsg").textContent = "Escribe tu nombre.");
      t.disabled = true;
      try { await rpc("update_my_profile", { ...f, p_notify: true }); await rpc("save_health_goal", { p_user: me.id, ...readHealth() }); me = await loadMe(); $("#who").textContent = initials(me.name); toast("Datos guardados"); $("#meMsg").textContent = ""; }
      catch (err) { $("#meMsg").textContent = err.message; } finally { t.disabled = false; }
      return;
    }
    if (t.id === "pushBtn") { t.disabled = true; try { await togglePush(); } finally { t.disabled = false; } return; }
    if (t.id === "newCode") { if (!confirm("El código anterior dejará de servir. ¿Crear uno nuevo?")) return; return showRecovery(false); }
    if (t.id === "chPin") {
      $("#pinBox").innerHTML = `<div class="grid2" style="margin-top:12px"><label class="field"><span class="label">PIN nuevo</span><input id="p1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label><label class="field"><span class="label">Repite el PIN</span><input id="p2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label></div><button class="btn" id="savePin" style="margin-top:10px">Guardar PIN</button><div class="err" id="pinMsg"></div>`;
      return;
    }
    if (t.id === "savePin") return await savePin();
    if (t.id === "exportMe") return await exportMine();
    if (t.id === "logout") return await logout();
    if (t.id === "askDelMe") { $("#delZone").innerHTML = `<span class="confirm">Se borrarán tu cuenta y todos tus datos. No se puede deshacer. <button class="btn danger sm" id="doDelMe">Sí, borrar</button><button class="btn ghost sm" id="noDel">No</button></span>`; return; }
    if (t.id === "doDelMe") { await rpc("delete_my_account"); await sb.auth.signOut().catch(() => {}); me = null; renderAuth("login"); toast("Cuenta borrada"); return; }
    if (t.id === "noDel") return tab === "atletas" ? renderAthlete() : renderProfile();

    // Entrenador
    if (!me.is_admin) return;
    if (tab === "editor" && (await edClick(t))) return;
    if (t.dataset.open) { openId = t.dataset.open; detail = null; return renderAthlete(); }
    if (t.dataset.cfreq) {
      const cu = JSON.parse(JSON.stringify(detail.custom || {}));
      if (t.dataset.cfreq === "def") delete cu.freq; else cu.freq = +t.dataset.cfreq;
      t.disabled = true;
      try {
        await saveCustom(cu);
        if (detail.a.schedule) { await rpc("admin_set_athlete_schedule", { p_user: detail.a.id, p_schedule: null }); detail.a.schedule = null; detail.sched = {}; }
        athletes = await q(sb.from("profiles").select("*").order("name"));
        toast(cu.freq ? `${cu.freq} días por semana. Los días se han repartido solos; puedes moverlos en Días de entreno.` : "Vuelve a las sesiones del programa.");
        renderAthlete();
      } catch (err) { $("#cxMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.dataset.cauto || t.dataset.csets || t.dataset.cq || t.dataset.cr || t.dataset.cs) {
      const cu = JSON.parse(JSON.stringify(detail.custom || {})); cu.swaps ||= {};
      if (t.dataset.cauto) cu.auto = t.dataset.cauto === "1";
      if (t.dataset.csets) cu.sets = t.dataset.csets === "auto" ? undefined : +t.dataset.csets;
      if (t.dataset.cq) cu.swaps[t.dataset.cq] = { skip: true };
      if (t.dataset.cr) delete cu.swaps[t.dataset.cr];
      if (t.dataset.cs) {
        const n = $("#cx-n").value.replace(/[<>]/g, "").trim(); if (n.length < 2) { $("#cxMsg").textContent = "Escribe el nombre del ejercicio."; return; }
        cu.swaps[t.dataset.cs] = { n, c: $("#cx-c").value.replace(/[<>]/g, "").trim(), v: $("#cx-v").value.replace(/[<>]/g, "").trim() };
      }
      t.disabled = true;
      try { await saveCustom(cu); detail.editing = null; toast("Guardado. El atleta ya lo ve."); redrawCustom(); }
      catch (err) { $("#cxMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.dataset.cx) { detail.editing = t.dataset.cx; redrawCustom(); $("#cx-n")?.focus(); return; }
    if (t.dataset.cc) { detail.editing = null; redrawCustom(); return; }
    if (t.dataset.sched) {
      const [k, i] = t.dataset.sched.split("|"); detail.sched = { ...(detail.sched || {}), [k]: +i };
      const box = t.closest(".panel"); box.outerHTML = schedHTML(); return;
    }
    if (t.id === "saveSched" || t.id === "resetSched") {
      const reset = t.id === "resetSched";
      if (reset && !confirm("¿Volver a los días que marca el programa?")) return;
      t.disabled = true;
      try {
        await rpc("admin_set_athlete_schedule", { p_user: detail.a.id, p_schedule: reset ? null : detail.sched });
        athletes = await q(sb.from("profiles").select("*").order("name"));
        detail.sched = reset ? {} : detail.sched; toast(reset ? "Días del programa recuperados" : "Días guardados. El atleta ya los ve."); renderAthlete();
      } catch (err) { $("#schedMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.dataset.athProg) {
      const id = +t.dataset.athProg, a = detail.a; if (id === (a.program_id || 1)) return;
      if (!confirm(`¿Cambiar a ${a.name} al programa ${progName(id)}?`)) return;
      t.disabled = true;
      try { await rpc("admin_set_athlete_program", { p_user: a.id, p_program: id }); athletes = await q(sb.from("profiles").select("*").order("name")); toast(`Programa cambiado a ${progName(id)}`); renderAthlete(); }
      catch (err) { $("#progMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.dataset.planProg) { const id = +t.dataset.planProg; t.disabled = true; const d = await loadProgram(id); if (!d) { t.disabled = false; return toast("Ese programa todavía no existe en la base de datos"); } planProg = id; P = d; renderTabs(); return renderPlan(); }
    if (t.dataset.compProg) { const id = +t.dataset.compProg; t.disabled = true; const d = await loadProgram(id); if (!d) { t.disabled = false; return toast("Ese programa todavía no existe en la base de datos"); } planProg = id; P = d; renderTabs(); return renderCompetition(); }
    if (t.id === "back") { openId = null; detail = null; return renderAthletes(); }
    if (t.dataset.plus) {
      const cur = $("#ac-until").value; const base = cur && cur > todayISO() ? cur : todayISO();
      $("#ac-until").value = addDays(base, +t.dataset.plus); $("#ac-on").value = "1"; return;
    }
    if (t.id === "saveAccess") {
      const a = detail.a; const on = $("#ac-on").value === "1"; const until = $("#ac-until").value || null;
      t.disabled = true;
      try {
        await rpc("admin_set_access", { p_user: a.id, p_active: on, p_paid_until: until });
        if (on && !a.active) callFn("notify", { action: "activated", user_id: a.id }).catch(() => {});
        athletes = await q(sb.from("profiles").select("*").order("name")); toast("Acceso guardado"); renderAthlete();
      } catch (err) { $("#acMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.id === "saveEdit") {
      const f = readFields(); if (f.p_name.length < 2) return ($("#editMsg").textContent = "El nombre no puede quedar vacío.");
      try { await rpc("admin_update_athlete", { p_user: detail.a.id, ...f }); await rpc("save_health_goal", { p_user: detail.a.id, ...readHealth() }); athletes = await q(sb.from("profiles").select("*").order("name")); toast("Guardado"); renderAthlete(); }
      catch (err) { $("#editMsg").textContent = err.message; }
      return;
    }
    if (t.id === "resetPin") {
      const pin = $("#rp-pin").value.trim(); const m = $("#rpMsg");
      if (!/^\d{4}$/.test(pin)) return (m.textContent = "El PIN tiene que ser de 4 cifras.");
      if (!detail.a.phone) return (m.textContent = "Este atleta no tiene móvil guardado.");
      t.disabled = true;
      try { await callFn("recover", { action: "admin_reset", phone: detail.a.phone, pin }); $("#rp-pin").value = ""; m.textContent = ""; toast("PIN cambiado. Díselo en persona."); }
      catch (err) { m.textContent = err.message; } finally { t.disabled = false; }
      return;
    }
    if (t.id === "askDel") { $("#delZone").innerHTML = `<span class="confirm">¿Seguro? Se borran su cuenta y todos sus datos. <button class="btn danger sm" id="doDel">Sí, borrar</button><button class="btn ghost sm" id="noDel">No</button></span>`; return; }
    if (t.id === "doDel") { await rpc("admin_delete_athlete", { p_user: detail.a.id }); openId = null; detail = null; toast("Atleta borrado"); return renderAthletes(); }
    if (t.id === "testErr") { const id = await rpc("log_error", { p_kind: "prueba", p_message: "Error de prueba " + new Date().toLocaleTimeString("es-ES") }); if (id) await callFn("notify", { action: "error", error_id: id }); toast("Error de prueba enviado"); return renderErrors(); }
    if (t.id === "clearErr") { if (!confirm("¿Borrar todos los errores?")) return; await rpc("clear_errors"); return renderErrors(); }
    if (t.id === "backupNow") { t.disabled = true; await rpc("backup_now"); toast("Copia hecha"); return renderErrors(); }
    if (t.dataset.backup) { const b = await q(sb.from("backups").select("data,created_at").eq("id", t.dataset.backup).single()); return downloadJSON(b.data, `zeben-copia-${String(b.created_at).slice(0, 10)}.json`); }
  } catch (err) {
    t.disabled = false; toast(err.message || friendly(err));
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.closest(".auth")) return;
  const b = $("#doLogin") || $("#doSignup") || $("#doForgot"); if (b) b.click();
});
window.addEventListener("hashchange", () => { if (me) { const h = location.hash.replace("#", ""); if (h && h !== tab) { openId = null; go(h); } } });
window.addEventListener("beforeunload", (e) => { if (tab === "editor" && edDirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- Inicio ----------
(async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY || !window.supabase) {
    $("#app").innerHTML = `<div class="empty" style="margin-top:24px"><b>Falta conectar la base de datos.</b><br>Envía a Claude la Project URL y la clave anon de Supabase.</div>`;
    return;
  }
  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && me) { me = null; renderAuth("login", "Tu sesión ha terminado. Vuelve a entrar."); } });
  const { data } = await sb.auth.getSession();
  if (data.session) await start(); else renderAuth("login");
})();
