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
let viewAs = null, viewDone = {}, viewKey = "", lastViewed = null;
// Carrera extra (5 o 10 km) que el entrenador añade a atletas de Musculación: custom.addon = { prog: 6|7, n: 1–3 }
let addonView = false, addonRender = false; const ADDON_P = {};
const addonOf = (a) => { const x = a?.custom?.addon; return x && [6, 7].includes(+x.prog) ? { prog: +x.prog, n: Math.min(3, Math.max(1, +x.n || 2)) } : null; };   // el entrenador ve "Mi plan" como un atleta concreto
let planProg = 1;     // programa que se ve en "Mi plan" (el entrenador puede mirar cualquiera)
const PROGRAMS = { 1: "Pádel", 2: "HYROX", 3: "Mantente activo", 4: "Musculación", 5: "Post parto", 6: "Carrera 5 km", 7: "Carrera 10 km", 8: "Strongman" };
const progName = (id) => PROGRAMS[id] || "Pádel";
const PROG_ICON = { 1: "🎾", 2: "🏋️", 3: "🌿", 4: "💪", 5: "🤱", 6: "🏃", 7: "🏃", 8: "🪨" };
// Portada: el atleta ve debajo del logo la modalidad que ha elegido (y la carrera extra si la tiene)
function setModality() {
  const el = $("#sub"); if (!el) return;
  if (!el.dataset.orig) el.dataset.orig = el.textContent;
  if (!me || me.is_admin) { el.hidden = true; return; }
  const id = myProg(), ad = typeof addonOf === "function" ? addonOf(me) : null;
  const pill = (pid) => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--ball);color:var(--ball-ink);border-radius:999px;padding:4px 12px;font:800 13px var(--body);letter-spacing:.06em;text-transform:uppercase">${PROG_ICON[pid] || ""} ${esc(progName(pid))}</span>`;
  el.innerHTML = `<span style="display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center">${pill(id)}${ad ? pill(ad.prog) : ""}</span>`;
  el.hidden = false;
}
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
const FREQ_DAYS = { 1: [2], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
// 1 o 2 días por semana: las sesiones más importantes de cada programa (Musculación 1 día = cuerpo completo)
const FREQ_LOW = { 1: { 1: ["fuerza"], 2: ["agil"], 3: ["fuerza"], 4: ["full"], 5: ["explo"], 6: ["agil"], 7: ["agil"], 8: ["fuerza"] }, 2: { 1: ["fuerza", "explo"], 2: ["fuerza", "agil"], 3: ["fuerza", "explo"], 4: ["fuerza", "mu_torso"], 5: ["fuerza", "explo"], 6: ["explo", "agil"], 7: ["explo", "agil"], 8: ["fuerza", "explo"] } };
function lowFreq(prog, n, pid) {
  const base = prog.days.filter((d) => !d.extra);
  let keys = FREQ_LOW[n]?.[pid] || base.slice(0, n).map((d) => d.key);
  if (keys[0] === "full") {   // cuerpo completo: 2 ejercicios de cada sesión del programa (misma dosis en las tres)
    const b3 = base.slice(0, 3); if (b3.length < 3) keys = [base[0].key];
    else return [{ ...b3[0], swapKey: "full", title: "Cuerpo completo", note: "Un poco de todo el cuerpo en una sola sesión: pierna, empuje y tirón.", ex: Object.fromEntries(["A", "B", "C"].map((V) => [V, b3.flatMap((d) => (d.ex[V] || []).slice(0, 2))])) }];
  }
  const out = keys.map((k) => prog.days.find((d) => d.key === k)).filter(Boolean);
  return out.length === n ? out : base.slice(0, n);
}
// Pádel con 1 o 2 días: las sesiones rotan cada semana en orden Fuerza → Explosividad → Agilidad
const ROTA = { 1: ["fuerza", "explo", "agil"] };
function rotating(prog, a) {
  const n = a?.custom?.freq || autoFreq(prog, a), pid = +(a?.program_id || planProg) || 1;
  const order = (ROTA[pid] || []).filter((k) => prog.days.some((d) => d.key === k));
  return (n === 1 || n === 2) && order.length === 3 ? { n, order } : null;
}
// w: semana del plan (1–8). w = "all": todas las sesiones distintas que puede hacer (para el entrenador)
function sessionsFor(prog, a, w) {
  if (!prog?.days) return [];
  const n = a?.custom?.freq || autoFreq(prog, a), rot = rotating(prog, a);
  const strip = (d) => String(d.title || "").replace(/^Día \d+\s*·\s*/i, "");
  if (rot) {
    if (w === "all") return rot.order.map((k) => prog.days.find((d) => d.key === k)).map((d) => ({ ...d, title: strip(d) }));
    const start = ((+w || 1) - 1) * n;
    return Array.from({ length: n }, (_, i) => { const d = prog.days.find((x) => x.key === rot.order[(start + i) % 3]);
      return { ...d, title: strip(d), schedKey: `slot${i + 1}`, when: DOW[FREQ_DAYS[n][i]] }; });
  }
  if (n === 1 || n === 2) return lowFreq(prog, n, +(a?.program_id || planProg) || 1).map((d, i) => ({ ...d, title: String(d.title || "").replace(/^Día \d+\s*·\s*/i, ""), when: DOW[FREQ_DAYS[n][i]] }));
  const list = n && prog.freq?.[n];
  if (list) return list.map((k) => prog.days.find((d) => d.key === k)).filter(Boolean).map((d, i) => ({ ...d, title: String(d.title || "").replace(/^Día \d+\s*·\s*/i, ""), when: DOW[FREQ_DAYS[n]?.[i] ?? i] }));
  return prog.days.filter((d) => !d.extra);
}
// Días que pidió el atleta en su ficha (si el entrenador no ha elegido otros). 2 días o menos: el programa base.
function autoFreq(prog, a) {
  const w = +a?.want_days, ks = Object.keys(prog?.freq || {}).map(Number).sort((x, y) => x - y);
  if (!w || !ks.length) return null;
  if (w < 3) return w;
  return ks.filter((k) => k <= w).pop() || null;
}
const dowDefault = (d) => { const w = plain(d.when); for (let i = 0; i < 7; i++) if (w.includes(plain(DOW[i]))) return i; return -1; };
const dowOf = (d, sched) => { const v = (sched === undefined ? me?.schedule : sched)?.[d.schedKey || d.key]; return Number.isInteger(v) && v >= 0 && v <= 6 ? v : dowDefault(d); };
const dowOfS = dowOf;
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
  if (!loggedIn) { $("#progress").innerHTML = ""; const sb0 = $("#sub"); if (sb0.dataset.orig) sb0.textContent = sb0.dataset.orig; sb0.hidden = false; }
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
      <label class="field"><span class="label">¿Qué quieres entrenar?</span><select id="a-prog"><option value="">Elige tu actividad…</option>${Object.entries(PROGRAMS).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("")}</select></label>
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
  const prog = $("#a-prog").value; if (!prog) return (err.textContent = "Elige qué quieres entrenar.");
  if (!phone) return (err.textContent = "Escribe un móvil español de 9 cifras.");
  if (!/^\d{4}$/.test(pin)) return (err.textContent = "El PIN tiene que ser de 4 cifras.");
  if (/^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|4321)$/.test(pin)) return (err.textContent = "Ese PIN es muy fácil de adivinar. Elige otro.");
  if (pin !== $("#a-pin2").value.trim()) return (err.textContent = "Los dos PIN no coinciden.");
  if (!$("#a-consent").checked) return (err.textContent = "Para crear la cuenta tienes que aceptar la política de privacidad.");
  if (needCaptcha()) return (err.textContent = "Espera a que termine la comprobación anti-robots.");
  btn.disabled = true; err.textContent = "";
  const { data, error } = await sb.auth.signUp({ email: emailOf(phone), password: passwordOf(phone, pin), options: { data: { name, consent: "true", program: prog }, captchaToken: captchaToken || undefined } });
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
      week = autoWeek();
    }
    setHeader(true); setWatermark();
    setModality();
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
  const [n, total] = doneCount(P, me, done);
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
const ZONES = { rodilla: "Rodilla", tobillo: "Tobillo", hombro: "Hombro", lumbar: "Zona lumbar", cadera: "Cadera", aductor: "Aductores", isquio: "Isquiotibiales", muneca: "Codo o muñeca", cuello: "Cuello" };
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
  aductor: [
    [/copenhague|copenhagen|aductor|sumo|zancada lateral|lateral lunge|cosaco|cossack|90\/90|apertura de piernas/, X("Isometría de aductores con balón", "Tumbado boca arriba, rodillas dobladas y un balón entre ellas. Aprieta 5 s al 50 % y suelta. Sin dolor.", "aductor squeeze isométrico balón")],
    [/salto lateral|desplazamiento|shuffle|cambio de direccion|agilidad|t test|estrella|conos|reaccion|sprint|split|skater|patinador/, X("Bici estática", "Mismo tiempo y esfuerzo, sin aperturas ni cambios de dirección mientras te molesta el aductor.", "bicicleta estática intervalos")],
  ],
  isquio: [
    [/nordic|nordico|curl femoral|curl de isquio|isquio|peso muerto|buenos dias|good morning|swing|bisagra|hip hinge/, X("Puente de glúteo isométrico", "Talones cerca del cuerpo, aguanta arriba 20–30 s. Sin dolor en la parte de atrás del muslo.", "puente de glúteo isométrico")],
    [/sprint|carrera|salto vertical|squat jump|broad jump|split jump|saltos en zancada|salto de longitud|bound|aceleraci|drop/, X("Bici estática o elíptica", "Mismo esfuerzo sin sprints ni saltos explosivos mientras te molesta el isquio.", "bicicleta estática intervalos")],
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

// Semana en la que va cada atleta según lo que ha hecho: un atleta nuevo empieza en la 1A.
// Si terminó todas las sesiones de su última semana, pasa a la siguiente.
// Semana por fecha: custom.start = lunes de su semana 1A (lo pone el entrenador). Sube sola cada lunes; tras la 4B vuelve a la 1A.
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mondayOf = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function calWeek(a) {
  const st = a?.custom?.start; if (!st || !/^\d{4}-\d{2}-\d{2}$/.test(st)) return null;
  const [y, m, d] = st.split("-").map(Number), n = Math.floor((mondayOf() - new Date(y, m - 1, d)) / (7 * 864e5));
  return n < 0 ? 1 : (n % 8) + 1;
}
const startFor = (w) => { const x = mondayOf(); x.setDate(x.getDate() - (w - 1) * 7); return isoDay(x); };
function autoWeek(who = me, D = done) {
  const cw = calWeek(who); if (cw) return cw;
  if (!sessionsFor(P, who, 1).length) return 1;
  let last = 0; for (let w = 1; w <= 8; w++) if (sessionsFor(P, who, w).some((d) => D[`${w}-${d.key}`])) last = w;
  if (!last) return 1;
  return sessionsFor(P, who, last).every((d) => D[`${last}-${d.key}`]) ? Math.min(8, last + 1) : last;
}
// Sesiones hechas y totales de las 8 semanas
function doneCount(prog, a, D) {
  let n = 0, t = 0; for (let w = 1; w <= 8; w++) { const sd = sessionsFor(prog, a, w); t += sd.length; n += sd.filter((d) => D[`${w}-${d.key}`]).length; }
  return [n, t];
}
// Musculación: bloque de carrera al final del 3.er día de entrenamiento de la semana
const RUN = [ // por fase: [iniciación, intermedio, avanzado/competición]
  ["10 × (1 min corriendo + 1 min andando)", "15–20 min de carrera suave", "20 min de carrera suave"],
  ["8 × (2 min corriendo + 1 min andando)", "20–25 min de carrera suave", "25–30 min de carrera suave"],
  ["6 × (1 min a buen ritmo + 2 min andando)", "5 min suave + 6 × (1 min rápido + 1 min suave) + 5 min suave", "5 min suave + 8 × (1 min rápido + 1 min suave) + 5 min suave"],
  ["15 min alternando correr y andar", "15 min de carrera suave", "15–20 min de carrera suave"],
];
function runHTML(pz, phase, level) {
  const soft = (pz.zones || []).some((z) => ["rodilla", "tobillo", "isquio"].includes(z));
  const t = RUN[phase]?.[Math.min(2, level)] || RUN[0][0];
  return `<div class="sec">Carrera · al terminar la sesión</div><div class="ex"><span class="n">${soft ? "Bici estática o elíptica (por tu lesión)" : "Carrera"}</span><span class="rx">${esc(t)}</span><span class="cue">${soft ? "Mismo tiempo y esfuerzo que la carrera, sin impacto." : "Ritmo suave: debes poder hablar mientras corres, salvo en los tramos rápidos. En cinta o en la calle."}</span>${vid(soft ? "bicicleta estática intervalos" : "técnica de carrera principiantes")}</div>`;
}
// % de la carga (1RM) según las repeticiones y el RPE/RIR de la fase. Solo ejercicios básicos con peso.
const PCT = [100, 100, 95, 92, 89, 86, 84, 81, 79, 76, 74, 71, 69, 67, 65, 63, 61, 59, 57, 55, 53];
const PCT_LIFT = /sentadilla (trasera|frontal|goblet|bulgara|hack)|^sentadilla goblet|peso muerto|press (banca|militar|inclinado|plano|de hombro|landmine|arnold)|push press|press de banca|sentadilla con pausa|peso muerto|log press|barra de eje|axle|viking press|rack pull|hip thrust|remo (con barra|con mancuerna|a una mano|en polea|en maquina)|jalon|prensa|zancada|step-up|thruster|dominadas lastradas/;
const PCT_NO = /banda|pallof|sin peso|asistid|isometr|cossack|lateral$|con saco|caminando$|alterna$|ligero/;
const PCT_POWER = { 1: ["55–60", "60–65", "70–75", "60"], 2: ["60–65", "65–70", "70–75", "60–65"] }; // push press, cargadas…
function pctFor(name, main, extra, phase) {
  if (![1, 2, 4, 6, 7, 8].includes(planProg)) return "";
  const n = plain(name); if (!PCT_LIFT.test(n) || PCT_NO.test(n)) return "";
  if (/push press|thruster/.test(n) && !/R[IP][RE]/.test(extra || "")) return PCT_POWER[planProg]?.[phase] || "";
  const m = String(main).match(/×\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*$/); if (!m) return "";
  const r1 = +m[1], r2 = +(m[2] || m[1]);
  let x = String(extra || "").match(/RIR\s*(\d+)(?:\s*[–-]\s*(\d+))?/), q1, q2;
  if (x) { q1 = +x[1]; q2 = +(x[2] || x[1]); }
  else if ((x = String(extra || "").match(/RPE\s*(\d+)(?:\s*[–-]\s*(\d+))?/))) { q1 = 10 - +(x[2] || x[1]); q2 = 10 - +x[1]; }
  else return "";
  const at = (k) => PCT[Math.min(PCT.length - 1, Math.max(1, k))];
  const lo = Math.round(at(r2 + Math.max(q1, q2)) / 5) * 5, hi = Math.round(at(r1 + Math.min(q1, q2)) / 5) * 5;
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}
// =====================================================================
//  VARIEDAD SEMANAL: cada semana, ejercicios distintos con el mismo objetivo.
//  Semanas 1A–3A usan las rutinas A, B y C. Desde la 4A cada ejercicio se cambia
//  por otro de su misma familia (mismo patrón de movimiento y mismo material).
// =====================================================================
const VX = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [n, c] = l.split("|"); const no5 = n.trim().startsWith("!"); return { n: n.trim().replace(/^!/, ""), c: (c || "").trim(), no5 }; });
// re: a qué ejercicios se aplica · ctx: gym (pádel, HYROX, musculación) o home (mantente activo, post parto)
const FAMILIES = [
  { re: /bulgara|zancada (inversa|atras|caminando|alterna|frontal)|zancadas? con saco|step-up(?! lateral)|sentadilla dividida/, ctx: "gym", pool: VX(`
    Sentadilla búlgara|Pie de atrás en el banco, baja recto y empuja con la pierna de delante.
    Zancada inversa con mancuernas|Paso atrás largo, rodilla de delante estable.
    Zancada caminando con mancuernas|Pasos largos y controlados, tronco erguido.
    Step-up al cajón con mancuernas|Sube empujando con el pie de arriba, sin impulsarte con el de abajo.
    Zancada frontal con mancuernas|Paso adelante, frena y vuelve con fuerza.
    Sentadilla dividida con barra|Pies fijos, baja vertical y controla la rodilla.
    Zancada en déficit|Pie de delante sobre un disco: más recorrido para el glúteo.
    Step-up alto con pausa|Cajón alto, pausa arriba de 1 s.` ) },
  { re: /bulgara|zancada (atras|alterna)|step-up|sentadilla dividida/, ctx: "home", pool: VX(`
    Zancada atrás|Paso atrás, baja controlando y vuelve.
    Zancada atrás con apoyo|Una mano en la pared o una silla para el equilibrio.
    Step-up a un escalón|Sube con todo el pie apoyado y baja despacio.
    Sentadilla dividida con apoyo|Pies fijos, baja recto apoyándote en una silla.
    Zancada alterna|Alterna piernas con ritmo cómodo.
    !Sentadilla búlgara en el sofá|Pie de atrás en el sofá, baja recto.
    !Zancada lateral suave|Paso al lado y vuelve, rodilla mirando a la punta del pie.`) },
  { re: /zancada lateral|cossack|step-up lateral/, ctx: "gym", pool: VX(`
    Zancada lateral con mancuerna|Cadera atrás y rodilla alineada con el pie.
    Sentadilla cossack|Baja hacia un lado con la otra pierna estirada.
    Step-up lateral al cajón|Sube de lado al cajón, rodilla estable.
    Zancada lateral con kettlebell en el pecho|Peso delante del pecho, tronco erguido.
    Zancada lateral deslizante|Pie en un deslizador o toalla, vuelve con el aductor.
    Zancada en diagonal hacia atrás|Paso atrás en diagonal, como en una recuperación de pista.`) },
  { re: /sentadilla (trasera|frontal|goblet|hack|con pausa|zercher)|^sentadilla goblet|prensa/, ctx: "gym", pool: VX(`
    Sentadilla trasera|Barra en la espalda, baja con el tronco firme.
    Sentadilla frontal|Barra delante, codos altos y tronco erguido.
    Sentadilla goblet|Mancuerna o kettlebell delante del pecho.
    Sentadilla hack|En máquina, espalda pegada al respaldo.
    Prensa de piernas|Recorrido completo sin despegar la zona lumbar.
    Sentadilla con pausa|Pausa de 2 s abajo, sube con fuerza.
    Sentadilla a caja con barra|Toca el cajón sin dejarte caer y sube.
    Sentadilla Zercher|Barra en el pliegue de los codos, tronco muy firme.`) },
  { re: /sentadilla (goblet|a una silla|a caja|a una caja|al aire|con salto|sumo|con pausa)/, ctx: "home", pool: VX(`
    Sentadilla goblet|Peso delante del pecho, baja hasta donde controles.
    Sentadilla a una silla|Roza la silla y sube sin dejarte caer.
    Sentadilla al aire lenta|3 s bajando, 1 s subiendo.
    Sentadilla sumo con mancuerna|Pies abiertos, puntas hacia fuera.
    Sentadilla con pausa|Pausa de 2 s abajo.
    Sentadilla a caja|Siéntate en el cajón o silla baja y levántate con fuerza.`) },
  { re: /peso muerto a una pierna|peso muerto rumano a una pierna/, ctx: "any", pool: VX(`
    Peso muerto a una pierna|Cadera atrás, espalda recta y pierna de atrás estirada.
    Peso muerto a una pierna con kettlebell|Peso en la mano contraria a la pierna de apoyo.
    Peso muerto rumano con apoyo (kickstand)|Pie de atrás de puntillas para equilibrar.
    Peso muerto a una pierna con apoyo en la pared|Una mano en la pared para centrarte en el isquio.`) },
  { re: /peso muerto|buenos dias|pull-through/, ctx: "gym", pool: VX(`
    Peso muerto rumano|Cadera atrás, barra pegada a las piernas.
    Peso muerto convencional|Empuja el suelo, espalda neutra.
    Peso muerto con trap bar|Barra hexagonal, empuja con las piernas.
    Peso muerto con kettlebell|Bisagra de cadera con la espalda neutra.
    Peso muerto sumo|Pies abiertos, rodillas hacia fuera.
    Peso muerto rumano con mancuernas|Mancuernas pegadas a las piernas.
    Buenos días con barra|Rodillas un poco dobladas, cadera atrás.
    Pull-through en polea|De espaldas a la polea, extiende la cadera con el glúteo.`) },
  { re: /peso muerto|buenos dias/, ctx: "home", pool: VX(`
    Peso muerto rumano con mancuernas|Cadera atrás y espalda recta.
    Buenos días con banda|Banda bajo los pies y por detrás del cuello.
    Peso muerto con kettlebell o garrafa|Bisagra de cadera, empuja con los talones.
    Peso muerto rumano ligero|Poco peso, recorrido controlado.
    Peso muerto rumano con banda|Banda bajo los pies, extiende la cadera con el glúteo.`) },
  { re: /hip thrust|puente de gluteo(?! con exhalacion)|patada de gluteo|frog pump/, ctx: "gym", pool: VX(`
    Hip thrust|Espalda en el banco, aprieta glúteo arriba 1 s.
    Hip thrust con barra|Barbilla al pecho y costillas abajo.
    Hip thrust a una pierna|Una pierna, cadera nivelada.
    Hip thrust con pausa|Pausa de 2 s arriba.
    Puente de glúteo con barra|Desde el suelo, empuja con los talones.
    Hip thrust en máquina|Recorrido completo y controlado.
    Patada de glúteo en polea|Tobillera en la polea, lleva la pierna atrás sin arquear.
    Frog pump con mancuerna|Plantas de los pies juntas, rodillas fuera.`) },
  { re: /hip thrust|puente de gluteo(?! con exhalacion)/, ctx: "home", pool: VX(`
    Puente de glúteo|Aprieta glúteo arriba 1 s.
    Puente de glúteo a una pierna|Cadera nivelada.
    Puente de glúteo con banda|Banda en las rodillas, empuja hacia fuera.
    Puente de glúteo con pausa|Pausa de 3 s arriba.
    Hip thrust en el sofá|Espalda en el sofá, empuja con los talones.
    Puente de glúteo con pies elevados|Pies en una silla o escalón.`) },
  { re: /curl femoral|curl nordico/, ctx: "gym", pool: VX(`
    Curl femoral tumbado|Cadera pegada al banco, baja en 3 s.
    Curl femoral sentado|Muslos bien sujetos, recorrido completo.
    Curl femoral a una pierna|Una pierna, controla la bajada.
    Curl nórdico asistido|Baja lo más lento que puedas, ayúdate con las manos.
    Curl femoral con fitball|Talones en la pelota, cadera arriba.
    Deslizamiento de isquios con toalla|Talones sobre toallas, desliza y recoge.`) },
  { re: /extension de cuadriceps/, ctx: "gym", pool: VX(`
    Extensión de cuádriceps|Pausa de 1 s arriba.
    Extensión de cuádriceps a una pierna|Una pierna, bajada lenta.
    Extensión de cuádriceps con pausa|2 s arriba apretando.
    Sentadilla sissy asistida|Agarrado a un soporte, rodillas adelante y tronco recto.
    Sentadilla española con banda|Banda detrás de las rodillas, tronco vertical.`) },
  { re: /gemelo|elevacion de talones/, ctx: "gym", pool: VX(`
    Elevación de gemelos de pie|Sube alto y baja lento.
    Gemelo sentado|Rodillas a 90°, pausa arriba.
    Elevación de gemelos a una pierna|Una pierna, recorrido completo.
    Gemelo en prensa|Solo los tobillos se mueven.
    Gemelo en escalón con pausa|Talón por debajo del escalón, pausa abajo.
    Elevación de talones con salto suave|Rebotes cortos y elásticos.`) },
  { re: /elevacion de talones|gemelo/, ctx: "home", pool: VX(`
    Elevación de talones|Sube alto y baja lento.
    Elevación de talones a una pierna|Apóyate en la pared.
    Elevación de talones en escalón|Talón por debajo del escalón.
    Elevación de talones con pausa|2 s arriba.`) },
  { re: /abduccion|paso lateral con banda|almeja|elevacion lateral de pierna|monster walk/, ctx: "gym", pool: VX(`
    Abducción de cadera en máquina|Empuja hacia fuera con el glúteo.
    Paso lateral con banda|Banda en las rodillas, pasos cortos.
    Monster walk con banda|Pasos en diagonal, rodillas hacia fuera.
    Abducción en polea|Tobillera, lleva la pierna al lado.
    Abducción sentado con banda|Banda en las rodillas, abre y aguanta.`) },
  { re: /abduccion|paso lateral con banda|almeja|elevacion lateral de pierna|monster walk/, ctx: "home", pool: VX(`
    Paso lateral con banda|Banda en las rodillas, pasos cortos.
    Almeja (clamshell)|Tumbado de lado, abre la rodilla sin girar la cadera.
    Elevación lateral de pierna tumbada|Pierna estirada, sube sin girar.
    Monster walk con banda|Pasos en diagonal, rodillas hacia fuera.
    Abducción sentado con banda|Banda en las rodillas, abre y aguanta.`) },
  { re: /escaladores|burpee sin salto|jumping jacks|skipping|sentadilla con salto suave|boxeo de sombra|rodillas al pecho de pie/, ctx: "home", pool: VX(`
    Escaladores|Rodillas al pecho, cadera baja.
    Burpee sin salto|Baja, estira las piernas atrás y vuelve.
    Jumping jacks (o sin salto)|Abre y cierra brazos y piernas.
    Skipping suave o comba|Rodillas a la altura de la cadera.
    !Sentadilla con salto suave|Aterriza suave.
    Boxeo de sombra|Golpes al aire con desplazamiento.
    Rodillas al pecho de pie|Alterna rápido con los brazos.`) },
  { re: /equilibrio|talon-punta/, ctx: "home", pool: VX(`
    Equilibrio a una pierna|Cerca de una pared por si acaso.
    Equilibrio en tándem|Un pie justo delante del otro.
    Caminar talón-punta|En línea recta, mirada al frente.
    Equilibrio a una pierna con alcance|Toca delante, al lado y atrás con la otra pierna.
    Equilibrio sobre un cojín|Superficie blanda, rodilla suave.
    Equilibrio a una pierna con ojos cerrados|Solo si ya controlas con los ojos abiertos.`) },
  // Prevención de lesiones (pádel y resto): hombro, muñeca y codo, rodilla y aductor
  { re: /rotacion externa|face pull|y-t-w|pull-apart|pajaros con banda/, ctx: "any", pool: VX(`
    Rotación externa de hombro con banda|Codo pegado al cuerpo, gira hacia fuera.
    Face pull con banda|Codos altos, tira hacia la cara.
    Y-T-W tumbado boca abajo|Dibuja las letras con los brazos, pulgares arriba.
    Rotación externa a 90° con banda|Brazo en cruz y codo a 90°, gira hacia arriba.
    Pull-apart con banda|Separa la banda a la altura del pecho.
    Rotación externa tumbado de lado|Mancuerna ligera, codo pegado.`) },
  { re: /muneca|pronacion|supinacion|antebrazo/, ctx: "any", pool: VX(`
    Extensión excéntrica de muñeca|Sube con ayuda y baja lento en 4 s.
    Pronación y supinación con mancuerna|Agarra por un extremo y gira despacio.
    Flexión de muñeca con mancuerna|Antebrazo apoyado, sube y baja.
    Desviación radial con martillo o mancuerna|Sube la punta hacia el techo.
    Apretar pelota de pádel|Aprieta 5 s y suelta, para el agarre.`) },
  { re: /sentadilla espanola|isometria de cuadriceps|step-down/, ctx: "any", pool: VX(`
    Sentadilla española con banda|Banda detrás de las rodillas, tronco vertical.
    Isometría de cuádriceps en pared|Espalda en la pared, rodillas a 60°.
    Step-down excéntrico|Desde un escalón, baja el talón al suelo en 3 s.
    Extensión de cuádriceps isométrica|Aguanta arriba 20–30 s.`) },
  { re: /copenhague|aductor/, ctx: "any", noProg: [5], pool: VX(`
    Copenhague en banco (rodilla apoyada)|Cadera alta, cuerpo en línea.
    Isometría de aductores con balón|Balón entre las rodillas, aprieta 5 s.
    Copenhague corto con pausa|Rodilla apoyada, aguanta 10–15 s.
    Aducción en polea|Tobillera, lleva la pierna hacia dentro.`) },
  { re: /fondos en paralelas|fondos asistidos/, ctx: "gym", pool: VX(`
    Fondos en paralelas|Tronco algo inclinado, baja a 90°.
    Fondos asistidos|Con banda o máquina, recorrido completo.
    Flexiones con pies elevados|Pies en un banco, cuerpo recto.
    Press banca agarre cerrado|Manos al ancho de hombros, codos pegados.`) },
  { re: /press (banca|plano|inclinado|de pecho)|floor press|flexiones lastradas|press en maquina de pecho/, ctx: "gym", pool: VX(`
    Press banca|Escápulas juntas, barra al pecho controlada.
    Press plano con mancuernas|Baja hasta el pecho, sube juntándolas.
    Press inclinado con barra|Banco a 30°, barra a la parte alta del pecho.
    Press inclinado con mancuernas|Banco a 30°, codos a 45°.
    Floor press con mancuernas|Tumbado en el suelo, codos tocan suave.
    Press de pecho en máquina|Recorrido completo, sin bloquear.
    Flexiones lastradas|Disco en la espalda, cuerpo en bloque.
    Press inclinado a una mano|Una mancuerna, el core no deja girar.`) },
  { re: /flexiones|press de pecho|press .*encimera/, ctx: "home", pool: VX(`
    Flexiones inclinadas|Manos en una mesa o banco, cuerpo recto.
    Flexiones (en suelo o de rodillas)|Pecho al suelo, codos a 45°.
    Press de pecho con mancuernas|Tumbado en el suelo o banco.
    Flexiones inclinadas en la encimera|Cuerpo recto, baja el pecho a la encimera.
    Press de pecho con banda|Banda por la espalda, empuja al frente.
    Flexiones con pausa abajo|Pausa de 1 s cerca del suelo.`) },
  { re: /aperturas|cruce de poleas|pec deck/, ctx: "gym", pool: VX(`
    Aperturas en polea|Brazos un poco doblados, abraza un árbol.
    Cruce de poleas|Junta las manos delante del pecho.
    Pec deck|Pausa de 1 s con los brazos juntos.
    Aperturas con mancuernas|Baja abriendo hasta notar el pecho estirado.
    Aperturas inclinadas con mancuernas|Banco a 30°.
    Cruce de poleas de abajo arriba|Poleas bajas, sube hacia la barbilla.`) },
  { re: /press (militar|arnold|de hombro|landmine)/, ctx: "gym", pool: VX(`
    Press militar de pie|Glúteo apretado, barra por encima de la cabeza.
    Press militar con mancuernas|Sentado o de pie, sin arquear la espalda.
    Press Arnold|Gira las palmas mientras subes.
    Press de hombro en máquina|Recorrido completo y controlado.
    Press landmine a una mano|Barra en ángulo, empuja hacia arriba y adelante.
    Press de hombro a una mano|De pie, el core no deja inclinarse.
    Press Z sentado en el suelo|Sin respaldo: tronco firme.`) },
  { re: /press de hombro/, ctx: "home", pool: VX(`
    Press de hombro con mancuernas|Sin arquear la espalda.
    Press de hombro sentada|Espalda apoyada.
    Press de hombro con banda|Banda bajo los pies, empuja arriba.
    Press de hombro a una mano|Un brazo cada vez, abdomen firme.`) },
  { re: /elevacion(es)? lateral(es)?(?! de pierna)/, ctx: "any", pool: VX(`
    Elevaciones laterales|Sube hasta los hombros, sin impulso.
    Elevación lateral en polea|Tensión constante.
    Elevaciones laterales con pausa|1 s arriba.
    Elevación lateral inclinada|Agarrado a un soporte, cuerpo inclinado.
    Elevación lateral en máquina|Codos guían el movimiento.
    Elevaciones laterales con banda|Banda bajo el pie.`) },
  { re: /pajaros|reverse pec deck/, ctx: "gym", pool: VX(`
    Pájaros con mancuernas|Inclinado, abre los brazos con los codos suaves.
    Pájaros en polea|Cruza los cables y abre.
    Reverse pec deck|Pausa con los brazos abiertos.
    Face pull|Codos altos, tira hacia la cara.
    Y en banco inclinado|Boca abajo, sube los brazos en Y.`) },
  { re: /dominadas|jalon/, ctx: "gym", pool: VX(`
    Dominadas o jalón al pecho|Pecho arriba, lleva los codos a los bolsillos.
    Jalón agarre estrecho|Agarre en V, baja al pecho.
    Jalón agarre neutro|Palmas enfrentadas, codos hacia abajo.
    Dominadas asistidas|Con banda o máquina, recorrido completo.
    Jalón a una mano|Un brazo, gira un poco el tronco al final.
    Dominadas supinas o jalón supino|Palmas hacia ti, bíceps y dorsal.
    Jalón con brazos rectos en polea|Brazos estirados, baja con el dorsal.`) },
  { re: /jalon|pull-apart/, ctx: "home", pool: VX(`
    Jalón con banda|Banda alta, lleva los codos abajo.
    Jalón con banda de rodillas|De rodillas, tira hacia el pecho.
    Pull-apart con banda|Separa la banda a la altura del pecho.
    Jalón con banda a una mano|Un brazo, sin girar el tronco.`) },
  { re: /remo (con barra|con mancuerna|a una mano|en polea|en maquina|invertido|pendlay|meadows)/, ctx: "gym", pool: VX(`
    Remo con barra|Espalda inclinada y firme, barra al ombligo.
    Remo con mancuerna|Apoyado en el banco, codo hacia la cadera.
    Remo en polea baja|Pecho alto, junta las escápulas.
    Remo en máquina con pecho apoyado|La espalda baja descansa.
    Remo invertido|Cuerpo recto bajo la barra, pecho a la barra.
    Remo Pendlay|Desde el suelo cada repetición, explosivo.
    Remo en polea a una mano|Gira un poco al final.
    Remo Meadows|Barra en esquina, tirón a una mano.`) },
  { re: /remo (con banda|con mancuerna|invertido en mesa)/, ctx: "home", pool: VX(`
    Remo con banda elástica|Junta las escápulas al final.
    Remo con mancuerna apoyada|Una mano en una silla, codo a la cadera.
    Remo invertido en mesa|Debajo de una mesa firme, pecho al borde.
    Remo con banda a una mano|Sin girar el tronco.
    Remo con banda sentada|Piernas estiradas, banda en los pies.`) },
  { re: /pullover/, ctx: "gym", pool: VX(`
    Pullover en polea|Brazos casi rectos, baja con el dorsal.
    Pullover con mancuerna|Tumbado en el banco, estira y vuelve.
    Pullover con banda|Banda alta, brazos rectos.`) },
  { re: /^curl (con|martillo|inclinado|predicador|concentrado|en polea|de biceps|arana)/, ctx: "gym", pool: VX(`
    Curl con barra|Codos pegados, sin balancear.
    Curl con barra Z|Agarre cómodo para las muñecas.
    Curl martillo|Palmas enfrentadas.
    Curl inclinado con mancuernas|Brazos colgando por detrás del cuerpo.
    Curl predicador|Brazos apoyados, baja del todo.
    Curl concentrado|Codo en el muslo, pausa arriba.
    Curl en polea|Tensión constante.
    Curl araña|Pecho apoyado en el banco inclinado.`) },
  { re: /^curl (de biceps|martillo|con banda)/, ctx: "home", pool: VX(`
    Curl de bíceps|Codos pegados al cuerpo.
    Curl martillo|Palmas enfrentadas.
    Curl con banda|Banda bajo los pies.
    Curl alterno con pausa|1 s arriba cada brazo.`) },
  { re: /triceps|press frances|fondos en (silla|banco)/, ctx: "any", pool: VX(`
    Extensión de tríceps en polea|Codos quietos, estira del todo.
    Extensión de tríceps en polea con cuerda|Separa la cuerda abajo.
    Extensión de tríceps sobre la cabeza|Codos apuntando al frente.
    Press francés|Barra Z a la frente, codos quietos.
    Patada de tríceps|Inclinado, estira el brazo atrás.
    Fondos entre bancos|Hombros abajo, baja a 90°.
    Extensión de tríceps con banda|Banda alta, estira hacia abajo.`) },
  { re: /encogimientos/, ctx: "gym", pool: VX(`
    Encogimientos con mancuernas|Sube los hombros a las orejas, pausa.
    Encogimientos con barra|Sin girar los hombros.
    Farmer's carry pesado|Camina erguido 30–40 m.`) },
  { re: /^farmer|suitcase|paseo de camarero/, ctx: "gym", noProg: [2], pool: VX(`
    Farmer's carry a una mano|No te inclines hacia el peso.
    Farmer's carry pesado|Pasos cortos, hombros atrás.
    Suitcase carry|Un peso a un lado, tronco recto.
    Paseo de camarero|Kettlebell por encima de la cabeza, brazo firme.
    Carry en rack con kettlebells|Pesos a la altura del pecho.`) },
  { re: /press pallof|pallof press|lenador|arrastre de disco|toques de hombro/, ctx: "any", pool: VX(`
    Press Pallof|Empuja al frente sin dejar que te gire.
    Pallof press con giro|Lleva las manos de lado a lado sin girar la cadera.
    Leñador con banda o polea|Gira desde la cadera, brazos rectos.
    Toques de hombro en plancha|Sin mover la cadera.
    Plancha con arrastre de disco|Arrastra el disco de lado a lado.
    Pallof press de rodillas|Medio arrodillado, tronco firme.`) },
  { re: /plancha lateral/, ctx: "any", noProg: [5], pool: VX(`
    Plancha lateral|Cuerpo en línea.
    Plancha lateral con elevación de cadera|Sube y baja la cadera controlado.
    Plancha lateral con rodilla al pecho|Lleva la rodilla de arriba al pecho.
    Plancha lateral con rotación|Mano de arriba bajo el cuerpo y vuelve.`) },
  { re: /^plancha( \(|$)|hollow|rueda abdominal/, ctx: "any", noProg: [5], pool: VX(`
    Plancha|Glúteo y abdomen apretados.
    Hollow hold o dead bug|Zona lumbar pegada al suelo.
    Rueda abdominal|Rodillas en el suelo, no arquees.
    Plancha con elevación de brazo|Alterna brazos sin mover la cadera.
    Plancha con caminata de manos|Baja y sube de codos a manos.`) },
  { re: /dead bug|bird dog|superman/, ctx: "any", noProg: [5], pool: VX(`
    Dead bug|Zona lumbar pegada al suelo.
    Bird dog|Brazo y pierna contrarios, sin mover la cadera.
    Bird dog con pausa|2 s estirado.
    Superman|Brazos y piernas arriba, mirada al suelo.
    Dead bug con banda|Banda sujeta por encima, más tensión en el abdomen.`) },
  { re: /russian twist|crunch bicicleta/, ctx: "any", pool: VX(`
    Russian twist con balón|Gira desde el tronco.
    Crunch bicicleta|Codo hacia la rodilla contraria, lento.
    Giro ruso con pies en el suelo|Más estable, mismo giro.
    Leñador con banda o polea|Gira desde la cadera.`) },
  { re: /kettlebell swing|push press|thruster|cargada/, ctx: "gym", pool: VX(`
    Kettlebell swing|Empuje de cadera, brazos relajados.
    Push press con mancuernas|Pequeña flexión de piernas y empuja arriba.
    Cargada colgante con mancuernas|Salto y recibe en los hombros.
    Kettlebell swing a una mano|El core no deja girar.
    Thruster con mancuernas|Sentadilla y empuje en un solo gesto.
    Push press|Barra: flexión rápida y empuje explosivo.`) },
  { re: /salto vertical|squat jump|pogo|split jumps|caida desde cajon|salto al cajon|tuck jump/, ctx: "gym", pool: VX(`
    Salto vertical con contramovimiento|Brazos arriba y aterriza suave.
    Squat jump (salto desde sentadilla)|Pausa abajo y salta.
    Saltos de tobillo (pogo jumps)|Rebotes rápidos con tobillos firmes.
    Saltos en zancada (split jumps)|Cambia de pierna en el aire.
    Caída desde cajón y estabiliza|Aterriza y aguanta 2 s.
    Salto al cajón|Sube de un salto y baja andando.
    Salto vertical a una pierna|Aterriza en la misma pierna y estabiliza.
    Salto con rodillas al pecho|Rodillas arriba, aterrizaje suave.`) },
  { re: /skater|salto lateral a una pierna|saltos laterales/, ctx: "gym", pool: VX(`
    Skater jumps (salto lateral)|Salta de lado y frena en una pierna.
    Salto lateral a una pierna y estabiliza|Aguanta 2 s al caer.
    Saltos laterales sobre valla|Pies juntos, rápido.
    Salto lateral al cajón|Sube de lado, baja andando.
    Saltos laterales a dos pies sobre línea|Rápidos y cortos.
    Salto lateral con rebote|Salta, frena y vuelve sin pausa.`) },
  { re: /lanzamiento|slam/, ctx: "gym", pool: VX(`
    Lanzamiento lateral balón medicinal|Contra la pared, gira la cadera.
    Lanzamiento por encima de la cabeza|Como un remate, contra la pared o el suelo.
    Lanzamiento rotacional frontal (scoop toss)|De abajo arriba con giro.
    Lanzamiento de pecho con balón medicinal|Explosivo al frente.
    Slam con balón medicinal|Arriba del todo y al suelo con fuerza.
    Slam lateral|Lanza al suelo a un lado, alterna.
    Lanzamiento de revés con balón medicinal|Gesto de revés, cadera primero.`) },
  { re: /sprint|salida de reaccion|salida hacia atras|salida en caida/, ctx: "gym", pool: VX(`
    Sprint 5 m desde split-step|Split-step y sal explosivo.
    Sprint 10 m reactivo|Sal a la señal del compañero.
    Salida hacia atrás + giro y sprint|Como cuando te pasan un globo.
    Sprint en abanico 3 conos|Sal a cada cono y vuelve al centro.
    Salida de reacción a señal|Atento a la señal y sal.
    Salto lateral y sprint|Salto lateral, frena y sprint.
    Desplazamiento lateral + sprint|Dos pasos laterales y sprint.
    Salida en caída|Déjate caer adelante y arranca.
    Sprint 5-10-5|5 m, cambio, 10 m, cambio, 5 m.`) },
  { re: /escalera|split-step \+|split step \+|desplazamiento|pasos cruzados|salida a (bola|pared)|test t|estrella de|atrapar pelota|red-fondo|juego de espejo|hexagono|cuatro esquinas|carioca|reaccion a colores|padel de sombra|caza de pelota|paso cruzado/, ctx: "gym", pool: VX(`
    Escalera de coordinación|Pies rápidos, mirada al frente.
    Split-step + reacción a señal|Split-step y sal hacia donde te indiquen.
    Desplazamientos en X por la pista|Red y fondo en diagonal.
    Pasos cruzados hacia atrás|Como para un globo.
    Desplazamiento lateral con banda|Banda en las rodillas, pasos cortos.
    Salida a bola tras pared|Gira y sal a buscar la bola.
    Test T de agilidad|Frontal, lateral y atrás.
    Estrella de 5 conos|Sal a cada cono y vuelve al centro.
    Atrapar pelota que cae|Suelta tu compañero, atrápala antes del segundo bote.
    Red-fondo con globo|Sube a la red y retrocede al globo.
    Juego de espejo|Copia los movimientos de tu compañero.
    Saltos en hexágono|Pies juntos, sal y vuelve al centro.
    Cuatro esquinas de la pista|Toca cada esquina y vuelve.
    Carioca|Cruza los pies por delante y por detrás.
    Reacción a colores|Sal al cono del color que digan.
    Salida a pared lateral|Sal a la pared y vuelve.
    Pádel de sombra|Golpes sin bola con desplazamiento real.
    Malabares con dos bolas|Coordinación ojo-mano: dos bolas en el aire.
    Botes alternos con la pala|Alterna cara y canto de la pala sin que caiga.
    Escalera + recepción de bola|Haz la escalera y atrapa la bola que te lanzan.`) },
  { re: /movilidad de cadera|gato-camello|perro boca abajo|postura del nino|mejor estiramiento|rotacion toracica|apertura (de pecho|toracica)|estiramiento de (flexor|isquios|pecho)|paloma|mariposa|torsion tumbado|saludo al sol/, ctx: "home", noProg: [], pool: VX(`
    Gato-camello|Columna de arriba abajo, respirando.
    Perro boca abajo|Talones hacia el suelo, espalda larga.
    Postura del niño|Respira hacia la espalda.
    El mejor estiramiento del mundo|Zancada, codo al suelo y giro.
    Rotación torácica en cuadrupedia|Mano en la nuca, abre el codo al techo.
    Apertura de pecho en pared|Brazo en la pared, gira el cuerpo.
    Movilidad de cadera 90/90|Cambia de lado sin manos si puedes.
    Estiramiento de flexor de cadera|Rodilla en el suelo, glúteo apretado.
    Estiramiento de isquios con banda|Pierna estirada, tira suave.
    Paloma (estiramiento de glúteo)|Respira y relaja.
    Mariposa sentado|Plantas juntas, rodillas al suelo.
    Torsión tumbado|Rodillas a un lado, hombros en el suelo.`) },
  { re: /marcha rapida|bici estatica|eliptica|caminar (rapido|en cuesta)|paseo a buen ritmo|paseo con cuestas|trote suave|remo ergometro o con banda/, ctx: "home", pool: VX(`
    Marcha rápida|Ritmo que te deje hablar con algo de esfuerzo.
    Bici estática con cambios de ritmo|1 min algo más rápido, 1 min suave.
    Caminar en cuesta o elíptica|Sube el ritmo poco a poco.
    Paseo con cuestas suaves|Brazos activos.
    Elíptica a ritmo constante|Respiración cómoda.
    Subir y bajar escaleras suave|Pisa entero cada escalón.
    Marcha con elevación de rodillas|Brazos coordinados.`) },
];
const FAM_NAMES = new Map(); // nombre → pista y vídeo para ejercicios nuevos
FAMILIES.forEach((f) => f.pool.forEach((x) => FAM_NAMES.set(plain(x.n), x)));
function famOf(name, prog) {
  const n = plain(name), ctx = [3, 5].includes(prog) ? "home" : "gym";
  if (prog === 2 && /skierg|remo ergometro|wall ball|sled|burpee|^carrera|zancadas con saco|farmer|bici de aire|progresivos/.test(n)) return null; // estaciones HYROX: siempre igual
  if (prog === 8 && /farmer|yoke|atlas|piedra|saco|log |tronco|eje|neumatico|trineo|arrastre|viking|zercher|cuerda|sosten|pinch|kroc|carry/.test(n)) return null; // strongman: eventos e implementos siempre iguales
  if (prog === 5 && /suelo pelvico|respiracion|exhalacion|toques de talon|dead bug|bird dog|plancha/.test(n)) return null; // post parto: el core se progresa, no se cambia
  return FAMILIES.find((f) => (f.ctx === ctx || f.ctx === "any") && !(f.noProg || []).includes(prog) && f.re.test(n)) || null;
}
// Ejercicio de la semana w para la rutina V de una sesión. Devuelve el ejercicio [nombre, pista, unidad, vídeo].
// Pádel: el día de agilidad alterna. Semanas impares agilidad; semanas pares pliometría (idea del vídeo de Zeben)
const PX = (n, c, u, v) => [n, c, u, v || n];
const PLIO = [
  [PX("Cambios de pie sobre el cajón", "Cajón bajo: pisa arriba con un pie y cambia rápido, contacto corto.", "· 20 contactos", "cambios de pie sobre cajón pliometría"),
   PX("Saltos en zancada con barra ligera", "Barra con discos pequeños. Cambia de pierna en el aire y aterriza suave.", "· 6 por pierna", "saltos en zancada con barra"),
   PX("Salto desde sentadilla con barra ligera", "Peso ligero (20–30 % de tu sentadilla). Salta alto y amortigua.", "· 5 saltos", "salto con barra ligera squat jump"),
   PX("Gemelo con rebote en escalón con mancuernas", "De pie en el borde del escalón: rebotes cortos y elásticos.", "· 12 rebotes", "rebotes de gemelo en escalón"),
   PX("Salto lateral alrededor del cajón (skater)", "Salta de lado y frena en una pierna, como una salida a la pared.", "· 6 por lado", "skater jumps técnica"),
   PX("Salto horizontal y estabiliza", "Salta lejos con los dos pies y aguanta 2 s al caer.", "· 5 saltos", "broad jump estabiliza")],
  [PX("Saltos de tobillo (pogo jumps)", "Rodillas casi rectas, rebotes rápidos.", "· 15 saltos", "pogo jumps técnica"),
   PX("Split-step + salto lateral", "Split-step y salida lateral explosiva, como en pista.", "· 6 por lado", "split step salto lateral"),
   PX("Salto lateral a una pierna y estabiliza", "Aguanta 2 s al caer, rodilla alineada.", "· 5 por pierna", "salto lateral a una pierna estabiliza"),
   PX("Saltos en zancada con barra ligera", "Cambia de pierna en el aire.", "· 6 por pierna", "saltos en zancada con barra"),
   PX("Cambios de pie sobre el cajón", "Rápido y ligero.", "· 20 contactos", "cambios de pie sobre cajón pliometría"),
   PX("Salto 180° (giro en el aire)", "Gira en el aire y aterriza mirando atrás, estable.", "· 4 por lado", "salto 180 grados")],
  [PX("Salto vertical reactivo", "Contacto con el suelo lo más corto posible.", "· 6 saltos", "salto reactivo contacto corto"),
   PX("Salto desde sentadilla con barra ligera", "Salta alto y amortigua.", "· 5 saltos", "salto con barra ligera squat jump"),
   PX("Bounding lateral", "Zancadas saltadas de lado, empuja con la pierna de fuera.", "· 6 por lado", "bounding lateral"),
   PX("Gemelo con rebote en escalón con mancuernas", "Rebotes cortos.", "· 12 rebotes", "rebotes de gemelo en escalón"),
   PX("Saltos en hexágono", "Pies juntos, sal y vuelve al centro.", "· 2 vueltas", "saltos en hexágono"),
   PX("Split-step reactivo + sprint 3 m", "Sal a la señal de tu compañero.", "· 6 salidas", "split step reacción sprint")],
];
const PLIO_SETS = [["2 series", "3 series", "3 series", "2 series"], ["3 series", "3 series", "4 series", "2 series"],
                   ["3 series", "4 series", "4 series", "2 series"], ["4 series", "4 series", "5 series", "3 series"]];
function plioDay(d, w, level, phase) {
  const ex = PLIO[(w / 2 - 1) % 3];
  return { ...d, title: "Pliometría", swapKey: "plio", plio: true, ex: { A: ex, B: ex, C: ex },
    doseOv: `${PLIO_SETS[Math.min(3, level)][phase]} · RPE 7–8`, restOv: "60–90 s entre series",
    note: "Semana de pliometría: saltos de calidad, no de cansancio. Aterriza suave y en silencio, rodilla alineada con el pie. Si un salto sale lento o feo, para la serie." };
}
// Pádel: cada semana de agilidad con ejercicios distintos (la 1A es la rutina original)
function agilDay(d, w) {
  const k = (w - 1) / 2; if (k < 1) return d;
  const fam = (re) => FAMILIES.find((f) => f.ctx === "gym" && f.re.test(re))?.pool || [];
  const seen = new Set((d.ex.A || []).map((x) => plain(x[0])));
  const pool = [...fam("escalera"), ...fam("sprint")].filter((x, i, a) => !seen.has(plain(x.n)) && a.findIndex((y) => y.n === x.n) === i);
  const n = (d.ex.A || []).length || 6, ex = Array.from({ length: n }, (_, i) => pool[((k - 1) * n + i) % pool.length]).map((x) => [x.n, x.c, "", x.n]);
  return { ...d, swapKey: "agil" + k, plio: true, ex: { A: ex, B: ex, C: ex } };
}
function weekEx(d, w, V, i, e, prog, used) {
  if (d.plio) return e;
  const base = ["A", "B", "C"];
  const same = (a, b) => (d.ex[a] || []).map((x) => plain(x[0])).join("|") === (d.ex[b] || []).map((x) => plain(x[0])).join("|");
  const dupC = V === "C" && same("C", "A"), dupB = V === "B" && same("B", "A");
  if (w <= 3 && !dupC && !dupB) return e;
  if (e[2] === "sec") return e;
  if (prog === 8 && i < 3) return e;
  if ((d.ex[V] || []).slice(0, i).some((x) => x[2] === "sec" && /^WOD/.test(x[0]))) return e;   // el WOD se queda tal cual   // strongman: los dos básicos pesados de cada día no cambian
  const f = famOf(e[0], prog); if (!f) return e;
  const ok = (x) => !(prog === 5 && x.no5) && !(prog === 1 && /salto.*cajon/.test(plain(x.n))) && !used.has(plain(x.n)); // pádel: sin saltos al cajón
  const names = (vs) => new Set(vs.flatMap((v) => (d.ex[v] || []).map((x) => plain(x[0]))));
  const allABC = names(base), near = names([V, "ABC"[(w + 1) % 3]]);   // esta rutina y la de la semana anterior
  let all = f.pool.filter((x) => ok(x) && !allABC.has(plain(x.n)));
  if (all.length < 5) all = f.pool.filter((x) => ok(x) && !near.has(plain(x.n)));
  if (!all.length) all = f.pool.filter((x) => ok(x) && plain(x.n) !== plain(e[0]));
  if (!all.length) return e;
  const pick = all[(w + i * 2 + d.key.length) % all.length];
  used.add(plain(pick.n));
  return [pick.n, pick.c || e[1], e[2], pick.n];
}

// =====================================================================
//  ISOMETRÍA: 2 ejercicios isométricos al final de cada sesión, en todos los programas.
//  Uno de tren inferior y otro de tren superior o core. Cambian cada semana.
// =====================================================================
const ISO = {
  gym: {
    low: VX(`
      Sentadilla isométrica en pared|Espalda en la pared, rodillas a 90°. Empuja el suelo.
      Sentadilla búlgara isométrica|Abajo del todo, rodilla de atrás a 2 dedos del suelo.
      Puente de glúteo isométrico a una pierna|Cadera alta y nivelada, glúteo apretado.
      Isometría de isquios en puente|Talones en un banco, cadera arriba, empuja con los talones.
      Copenhague isométrico|Rodilla en el banco, cadera alta y cuerpo en línea.
      Elevación de talones isométrica a una pierna|Arriba del todo, sin dejar caer el tobillo.
      Zancada isométrica con mancuernas|Abajo, tronco recto y peso repartido.
      Peso muerto isométrico a una pierna|Tronco paralelo al suelo, cadera nivelada.`),
    up: VX(`
      Plancha con toque de hombros lenta|Sin mover la cadera.
      Dominada isométrica arriba|Barbilla por encima de la barra. Si no puedes, con banda.
      Remo invertido isométrico|Pecho pegado a la barra, cuerpo recto.
      Flexión isométrica a mitad de recorrido|Codos a 90°, cuerpo en bloque.
      Press Pallof isométrico|Brazos estirados, no dejes que la polea te gire.
      Hollow hold|Zona lumbar pegada al suelo, brazos y piernas largos.
      Plancha lateral|Cuerpo en línea, cadera alta.
      Farmer's hold pesado|De pie, mancuernas pesadas, hombros atrás.`),
    padel: VX(`
      Rotación externa isométrica en pared|Codo a 90°, empuja la pared hacia fuera con el dorso de la mano.
      Agarre isométrico con la pala|Aprieta el mango de la pala al 70 %, muñeca recta.
      Posición de espera isométrica (split-step)|Piernas flexionadas, peso delante, como esperando el resto.
      Isometría de muñeca contra resistencia|Empuja la mano contra la otra hacia arriba, sin mover.`),
  },
  home: {
    low: VX(`
      Sentadilla isométrica en pared|Espalda en la pared, rodillas a 90° o más alto si cuesta.
      Puente de glúteo isométrico|Cadera arriba, glúteo apretado.
      Zancada isométrica|Abajo, tronco recto, apóyate en una silla si hace falta.
      Elevación de talones isométrica|Arriba del todo, apóyate en la pared.
      Isometría de aductores con balón|Tumbado, balón o cojín entre las rodillas, aprieta.
      Puente de glúteo isométrico a una pierna|Cadera nivelada.`),
    up: VX(`
      Plancha|De rodillas si hace falta, abdomen firme.
      Plancha lateral|De rodillas si hace falta.
      Flexión isométrica en la encimera|Pecho cerca del borde, cuerpo recto.
      Remo isométrico con banda|Codos atrás, junta las escápulas y aguanta.
      Superman isométrico|Brazos y piernas un poco arriba, mirada al suelo.
      Dead bug isométrico|Brazos y piernas arriba, zona lumbar pegada al suelo.`),
  },
  pp: { // post parto: suave y respirando
    low: VX(`
      Puente de glúteo isométrico con exhalación|Sube soltando el aire y aguanta respirando.
      Sentadilla isométrica en pared alta|Poca flexión de rodillas, espalda en la pared.
      Isometría de aductores con cojín|Aprieta suave el cojín entre las rodillas.
      Elevación de talones isométrica|Apoyada en la pared.`),
    up: VX(`
      Plancha lateral de rodillas|Cadera alta, respira.
      Flexión isométrica en la encimera|Cuerpo recto, sin abombar la tripa.
      Remo isométrico con banda|Junta las escápulas y aguanta.
      Bird dog isométrico|Brazo y pierna contrarios, aguanta respirando.`),
  },
};
const ISO_DOSE = { // por fase: [normal, post parto]
  0: ["3 × 20 s", "2 × 15–20 s"], 1: ["3 × 30 s", "2 × 20–30 s"], 2: ["4 × 30–40 s", "3 × 30 s"], 3: ["2 × 20 s", "2 × 20 s"],
};
function isoHTML(pz, prog, d, w, phase, sessIdx) {
  const set = prog === 5 ? ISO.pp : [3].includes(prog) ? ISO.home : ISO.gym;
  const pick = (pool, k) => pool[(w * 2 + sessIdx * 3 + k) % pool.length];
  const second = prog === 1 && (w + sessIdx) % 2 === 0 ? pick(set.padel, 0) : pick(set.up, 1);
  const list = [pick(set.low, 0), second];
  const dose = (ISO_DOSE[phase] || ISO_DOSE[0])[prog === 5 ? 1 : 0];
  const used = new Set();
  const rows = list.map((x, i) => personalEx({ ...pz, swaps: {} }, "iso", "A", 100 + i, [x.n, x.c, "", x.n], used)).filter(Boolean).map(({ e, tag }) =>
    `<div class="ex"><span class="n">${esc(e[0])}</span><span class="rx">${esc(dose)}</span><span class="cue">${tag ? `<b style="color:var(--ball-deep)">↻ ${esc(tag)}.</b> ` : ""}${esc(e[1])} Respira normal, sin aguantar el aire.</span>${vid(e[3] + " isométrico")}</div>`).join("");
  return rows ? `<div class="sec">Isometría · al final de la sesión</div>${rows}` : "";
}
function i18nToday() { const d = new Date(); return "Hoy es " + DOW[todayDow()].toLowerCase() + ", " + d.getDate() + " de " + ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][d.getMonth()]; }
// "Mi plan" con pestañas: plan principal y carrera extra
function renderPlan() {
  const who0 = me?.is_admin && viewAs ? viewAs : me, ad = addonOf(who0);
  const bar = ad ? `<div class="chips" style="margin-top:18px"><button class="chip" data-addon="0" aria-pressed="${!addonView}">${esc(progName(who0.program_id))}</button><button class="chip" data-addon="1" aria-pressed="${addonView}">🏃 ${esc(progName(ad.prog))}</button></div>` : "";
  if (!ad || !addonView) { addonView = false; renderPlanCore(); if (bar) $("#app").insertAdjacentHTML("afterbegin", bar); return; }
  const AP = ADDON_P[ad.prog];
  if (!AP) { $("#app").innerHTML = bar + `<p class="muted" style="margin-top:24px">Cargando tu plan de carrera…</p>`; loadProgram(ad.prog).then((d) => { if (d) ADDON_P[ad.prog] = d; else { addonView = false; toast("El plan de carrera no está en la base de datos"); } if (tab === "plan") renderPlan(); }); return; }
  const save = { P, planProg, me, viewAs, done, viewDone, viewKey };
  // Solo sesiones de carrera (la fuerza ya la hace en musculación): 1 = tirada larga; 2 = series + tirada; 3 = series + rodaje + tirada
  const keys = { 1: ["agil"], 2: ["explo", "agil"], 3: ["explo", "run_easy", "agil"] }[ad.n];
  const runSched = { 1: { agil: 5 }, 2: { explo: 1, agil: 5 }, 3: { explo: 1, run_easy: 3, agil: 5 } }[ad.n];   // martes, jueves y sábado
  const run = { ...who0, program_id: ad.prog, schedule: runSched, custom: { freq: ad.n === 3 ? 3 : ad.n } };
  const AP2 = { ...AP, freq: { ...AP.freq, 3: keys } };
  try {
    P = AP2; planProg = ad.prog; done = {}; viewDone = {}; viewKey = (who0 === me ? "me" : who0.id + "|" + ad.prog); addonRender = true;
    if (who0 === me) me = run; else viewAs = run;
    renderPlanCore();
  } finally { ({ P, planProg, me, viewAs, done, viewDone, viewKey } = save); addonRender = false; }
  $("#app").insertAdjacentHTML("afterbegin", bar + `<div class="banner" style="margin-top:12px">🏃 <b>Carrera extra</b>: ${ad.n} ${ad.n > 1 ? "sesiones" : "sesión"} de carrera a la semana, además de tu plan de ${esc(progName(who0.program_id))}. Las sesiones de carrera no hace falta marcarlas.</div>`);
}
function renderPlanCore() {
  const who = me.is_admin && viewAs ? viewAs : me, other = who !== me;
  if (other && planProg !== (PROGRAMS[who.program_id] ? who.program_id : 1)) {
    const id = PROGRAMS[who.program_id] ? who.program_id : 1;
    $("#app").innerHTML = `<p class="muted" style="margin-top:24px">Cargando el plan de ${esc(who.name)}…</p>`;
    loadProgram(id).then((d) => { if (!d) { viewAs = null; toast("Ese programa todavía no existe en la base de datos"); } else { planProg = id; P = d; } renderTabs(); if (tab === "plan") renderPlan(); });
    return;
  }
  if (!P) { $("#app").innerHTML = lockedCard(); return; }
  const D = other ? viewDone : done, sch = other ? (who.schedule || null) : undefined;
  const k0 = other ? who.id + "|" + planProg : "me";
  if (k0 !== viewKey && !addonRender) { viewKey = k0; week = autoWeek(who, D); selDow = todayDow(); }
  const dowOf = (d) => dowOfS(d, sch);
  const LV = P.levels; let level = Math.max(0, LV.indexOf(who.level));
  const VAR = (w) => "ABC"[(w - 1) % 3];
  const phaseOf = (w) => P.phases.findIndex((p) => p.weeks.includes(w));
  week = Math.min(8, Math.max(1, +week || 1));
  const p = phaseOf(week);
  const WS = P.warmSecs || ["1 · Foam roller", "2 · Movilidad de tobillo (dorsiflexión)", (P.ankle?.length ? 3 : 2) + " · Movilidad y activación"];
  const row = (w) => `<div class="ex"><span class="n">${esc(w[0])}</span><span class="rx" style="font-size:16px">${esc(w[1])}</span>${w[3] ? `<span class="cue">${esc(w[3])}</span>` : ""}${vid(w[2])}</div>`;
  const SD = sessionsFor(P, who, week);
  const byDow = SD.map((d) => dowOf(d));
  const planned = byDow.some((x) => x >= 0);
  const todaySess = SD.filter((d, i) => byDow[i] === selDow);
  const visibleDays = (!planned || showAllDays ? SD : todaySess).slice().sort((x, y) => (dowOf(x) < 0 ? 9 : dowOf(x)) - (dowOf(y) < 0 ? 9 : dowOf(y)));
  const shortName = (d) => String(d.title || "").split("·").pop().trim();
  const dowPick = planned ? `<div class="weeks" style="grid-template-columns:repeat(7,minmax(0,1fr))">${DOW_SHORT.map((n, i) => {
      const ds = SD.filter((d, j) => byDow[j] === i);
      const ok = ds.length && ds.every((d) => D[`${week}-${d.key}`]);
      return `<button class="wk" data-dow="${i}" aria-pressed="${!showAllDays && i === selDow}" aria-label="${DOW[i]}${ds.length ? ": " + esc(ds.map(shortName).join(", ")) : ": descanso"}">${n}<small>${ds.length ? (ok ? "✓ hecho" : "entreno") : "libre"}</small></button>`; }).join("")}</div>
    <div class="row" style="margin-top:8px;justify-content:space-between"><span class="muted" style="font-size:13px">${i18nToday()}</span><button class="btn ghost sm" data-alldays="1">${showAllDays ? "Ver solo un día" : "Ver toda la semana"}</button></div>` : "";
  const restCard = planned && !showAllDays && !todaySess.length ? `<div class="panel"><h3>${selDow === todayDow() ? "Hoy" : DOW[selDow]} toca descanso</h3>
    <p class="muted" style="font-size:14px;margin:6px 0 0">Recuperar también es entrenar. Si te apetece moverte, da un paseo de 20–30 minutos o haz la movilidad del calentamiento.</p>
    <p style="font-size:14px;margin:8px 0 0">Tus sesiones de la semana: <b>${SD.map((d, i) => byDow[i] >= 0 ? `${DOW[byDow[i]]} (${esc(shortName(d))})` : "").filter(Boolean).join(", ")}</b>.</p></div>` : "";
  const pz = personalFor(who, planProg);
  const runKey = planProg === 4 && !addonOf(who) ? (SD.slice().sort((x, y) => (dowOf(x) < 0 ? 9 : dowOf(x)) - (dowOf(y) < 0 ? 9 : dowOf(y)))[2]?.key) : null;
  let anyPct = false;
  const days = visibleDays.map((d) => {
    if (planProg === 1 && d.key === "agil") d = week % 2 === 0 ? plioDay(d, week, level, p) : agilDay(d, week);
    const doseParts = String(d.doseOv || P.dose[d.key][level][p]).split("|");
    const doseAt = (i) => personalDose(pz, doseParts[Math.min(i, doseParts.length - 1)]);
    const k = `${week}-${d.key}`; const isDone = !!D[k];
    return `<article class="day" style="--c:var(${/^--f-(fuerza|explo|agil)$/.test(d.c) ? d.c : ["--f-fuerza", "--f-explo", "--f-agil"][SD.findIndex((x) => x.key === d.key) % 3]})">
      <div class="day-head"><div><div class="label">${esc(dowOf(d) >= 0 ? DOW[dowOf(d)] : d.when)}</div><h3>${esc(d.title)} · ${VAR(week)}</h3></div>
      <div class="dose">Descanso<br>${esc(d.restOv || P.rest[d.key][p])}</div></div>
      ${((u, uw) => d.ex[VAR(week)].map((e0, i) => { const r = personalEx(pz, d.swapKey || d.key, VAR(week), i, weekEx(d, week, VAR(week), i, e0, planProg, uw), u); return r && { ...r, i }; }))(new Set(), new Set()).filter(Boolean).map(({ e, tag, i }) => { const [main, extra] = doseAt(i);
        if (e[2] === "sec") return `<div class="sec">${esc(e[0])}${main ? ` · ${esc(main)}` : ""}${extra ? ` · ${esc(extra)}` : ""}</div>`;   // cabecera de parte (Fuerza / WOD)
        const pc = pctFor(e[0], main, extra, p); if (pc) anyPct = true; return `<div class="ex"><span class="n">${esc(e[0])}</span><span class="rx">${esc(main)}${pc ? ` <span class="pct">${pc} %</span>` : ""}${e[2] ? ` <small class="muted" style="font:500 12px var(--body)">${esc(e[2])}</small>` : ""}</span><span class="cue">${tag ? `<b style="color:var(--ball-deep)">↻ ${esc(tag)}.</b> ` : ""}${esc(e[1])}${extra ? ` · ${esc(extra)}` : ""}</span>${vid(e[3])}</div>`; }).join("")}
      ${isoHTML(pz, planProg, d, week, p, SD.findIndex((x) => x.key === d.key))}
      ${d.key === runKey ? runHTML(pz, p, level) : [6, 7].includes(planProg) ? "" : finisherHTML(pz)}
      <div class="note">${esc(d.note)}</div>
      <div class="done-row">${addonRender ? `<span class="pill">Sesión de carrera extra</span>` : other ? `<span class="pill ${isDone ? "" : "off"}">${isDone ? "✓ Hecha por " + esc(who.name.split(" ")[0]) : "Aún sin hacer"}</span>` : `<button class="btn ${isDone ? "ok" : ""}" data-done="${week}|${d.key}" aria-pressed="${isDone}">${isDone ? "✓ Sesión completada" : "Marcar sesión como hecha"}</button>`}</div></article>`;
  }).join("");
  const lastA = me.is_admin && !other ? lastViewed : null;
  const progPick = me.is_admin && !other ? `<div class="chips" style="margin-top:10px">${Object.entries(PROGRAMS).map(([id, n]) => `<button class="chip" data-plan-prog="${id}" aria-pressed="${+id === planProg}">${esc(n)}</button>`).join("")}</div>${lastA ? `<button class="btn ghost sm" style="margin-top:10px" data-plan-ath="${esc(lastA.id)}">Ver el plan de ${esc(lastA.name)}</button>` : ""}` : "";
  $("#app").innerHTML = `
    ${other ? `<div class="banner" style="margin-top:18px;border-left:4px solid var(--ball)"><b>Estás viendo el plan de ${esc(who.name)}</b>, tal como lo ve en su móvil: su programa, sus días y sus adaptaciones.<div class="row" style="margin-top:10px;gap:8px"><button class="btn sm" data-plan-general="1">Ver planes generales</button><button class="btn ghost sm" data-ficha="${esc(who.id)}">Ficha de ${esc(who.name.split(" ")[0])}</button></div></div>` : ""}
    <h2>${other ? "Su programa" : "Tu programa"}</h2>
    <div class="phase"><b>${esc(P.name || progName(planProg))}</b><div class="muted" style="font-size:14px">${me.is_admin && !other ? "Planes generales: elige el programa que quieras ver." : `2 meses (8 semanas) · ${SD.length} ${SD.length === 1 ? "sesión" : "sesiones"} por semana.`}</div>${progPick}</div>
    <h2>Semana del plan</h2>
    <p class="muted" style="font-size:13px;margin:-4px 0 0">A = primer mes · B = segundo mes</p>
    <div class="weeks">${Array.from({ length: 8 }, (_, i) => { const w = i + 1; return `<button class="wk" aria-pressed="${w === week}" data-w="${w}" aria-label="Semana ${wkLabel(w)}">${wkLabel(w)}<small>${((sw) => `${sw.filter((d) => D[w + "-" + d.key]).length}/${sw.length}`)(sessionsFor(P, who, w))}</small></button>`; }).join("")}</div>
    <div class="phase"><div class="label">Semana ${wkLabel(week)} · ${esc(LV[level])}</div><b>${esc(P.phases[p].name)} · ${esc(P.variants?.[VAR(week)] || "Rutina " + VAR(week))}</b><div class="muted" style="font-size:14px">${esc(P.phases[p].txt)}</div>${anyPct ? `<div style="font-size:13px;margin-top:8px"><span class="pct">% </span> Carga en % de tu máximo (1RM): el peso que podrías levantar 1 sola vez. Si no lo sabes, elige un peso con el que te sobren las repeticiones que marca el RPE/RIR.</div>` : ""}</div>
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
    ${weekFields(a, padel)}
    <label class="field full"><span class="label">¿Tienes alguna lesión, dolor o patología?</span><select id="f-lesion"><option value="">Elige…</option><option value="no" ${a.has_injury === false ? "selected" : ""}>No</option><option value="si" ${a.has_injury ? "selected" : ""}>Sí</option></select></label>
    <label class="field full" id="f-lesion-box" ${a.has_injury ? "" : "hidden"}><span class="label">¿Cuál? Desde cuándo y si te sigue molestando</span><input id="f-lesiones" value="${esc(a.injuries ?? "")}" maxlength="400" placeholder="Ej.: tendinitis rotuliana derecha desde 2024, hipertensión, asma…">
      <span class="label" style="margin-top:10px;display:block">¿Qué zona? Marca todas las que te molesten</span>
      <span class="pick" style="margin-top:6px">${Object.entries(ZONES).map(([k, n]) => `<label class="pick-i"><input type="checkbox" class="f-zona" value="${k}" ${(a.injury_zones || []).includes(k) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</span></label>
    <label class="field full"><span class="label">Otras notas</span><input id="f-notas" value="${esc(a.notes ?? "")}" maxlength="300"></label>
  </div>`;
}
// Disponibilidad semanal: días de físico y, en pádel, días de pista
function weekFields(a, padel) {
  const opt = (v, t, cur) => `<option value="${v}" ${String(cur ?? "") === String(v) ? "selected" : ""}>${t}</option>`;
  const fis = `<label class="field full"><span class="label">${padel ? "¿Cuántos días a la semana puedes entrenar el físico (gimnasio)?" : "¿Cuántos días a la semana puedes entrenar?"}</span><select id="f-dias"><option value="">Elige…</option>${[1, 2, 3, 4, 5, 6].map((n) => opt(n, n === 1 ? "1 día" : `${n} días`, a.want_days)).join("")}</select></label>`;
  if (!padel) return fis + `<input type="hidden" id="f-padel" value=""><span hidden id="f-padel-box"></span>`;
  const pd = a.padel_dows || [];
  return fis + `<label class="field full"><span class="label">¿Cuántos días a la semana juegas o entrenas pádel?</span><select id="f-padel"><option value="">Elige…</option>${opt(0, "Ahora mismo ninguno", a.padel_days)}${[1, 2, 3, 4, 5, 6, 7].map((n) => opt(n, n === 1 ? "1 día" : `${n} días`, a.padel_days)).join("")}</select></label>
    <label class="field full" id="f-padel-box" ${a.padel_days > 0 ? "" : "hidden"}><span class="label">¿Qué días juegas normalmente? Marca los que sean</span>
      <span class="pick days" style="margin-top:6px">${DOW_SHORT.map((d, i) => `<label class="pick-i"><input type="checkbox" class="f-pdia" value="${i}" ${pd.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</span>
      <span class="muted" style="display:block;font-size:13px;margin-top:6px">Así coloco el físico para que llegues fresco a tus partidos.</span></label>`;
}
// Casillas de zonas y días: cuadrícula para que ningún nombre se corte en el móvil
(() => { const st = document.createElement("style"); st.textContent = `
.pick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.pick.days{grid-template-columns:repeat(4,minmax(0,1fr))}
.pick-i{display:flex;align-items:center;gap:8px;min-width:0;border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:12px;padding:10px 12px;font-weight:600;font-size:15px;line-height:1.25;cursor:pointer;text-transform:none;letter-spacing:0}
.pick.days .pick-i{justify-content:center;padding:10px 4px;gap:5px;font-size:14px}
.pick-i input{flex:none;width:18px;height:18px;margin:0;accent-color:var(--fg)}
.pick-i:has(input:checked){border-color:var(--fg);background:var(--fg);color:var(--bg)}
.pick-i:has(input:checked) input{accent-color:var(--bg)}
.pct{display:inline-block;background:var(--pelota,#DCF23F);color:#111113;border-radius:999px;padding:1px 8px;font:800 12px var(--body);vertical-align:middle;white-space:nowrap}
.pick.days .pick-i{position:relative;padding:11px 2px}
.pick.days input{position:absolute;opacity:0;pointer-events:none}
.pick-i:has(input:focus-visible){outline:2px solid var(--fg);outline-offset:2px}
@media (max-width:380px){.pick:not(.days){grid-template-columns:1fr}}`; document.head.appendChild(st); })();
const GOALS = ["Perder grasa", "Ganar músculo", "Rendir más en mi deporte", "Preparar una competición", "Salud y bienestar", "Volver tras una lesión", "Otro"];
function readHealth() {
  const l = $("#f-lesion").value;
  return { p_has_injury: l === "" ? null : l === "si", p_injuries: $("#f-lesiones").value.replace(/[<>]/g, "").trim(),
    p_goal: $("#f-objetivo").value || null, p_goal_detail: $("#f-objetivo-txt").value.replace(/[<>]/g, "").trim(),
    p_zones: [...document.querySelectorAll(".f-zona:checked")].map((x) => x.value),
    p_want_days: $("#f-dias")?.value ? +$("#f-dias").value : null,
    p_padel_days: $("#f-padel")?.value !== "" && $("#f-padel") ? +$("#f-padel").value : null,
    p_padel_dows: $("#f-padel")?.value > 0 ? [...document.querySelectorAll(".f-pdia:checked")].map((x) => +x.value) : null };
}
document.addEventListener("change", (e) => { if (e.target.id === "f-lesion") { const b = $("#f-lesion-box"); if (b) b.hidden = e.target.value !== "si"; } if (e.target.id === "f-padel") { const b = $("#f-padel-box"); if (b) b.hidden = !(+e.target.value > 0); } });
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
  ${me.is_admin ? "" : `<div class="panel"><h3>Tu actividad</h3>${isActive(me)
    ? `<p style="margin:6px 0 0;font-size:15px"><b>${esc(progName(myProg()))}</b></p><p class="muted" style="font-size:14px;margin:4px 0 0">Si quieres cambiar de actividad, coméntalo con Zeben.</p>`
    : `<p class="muted" style="font-size:14px;margin:4px 0 10px">Elige qué quieres entrenar. Zeben lo verá al activar tu plan.</p><div class="chips">${Object.entries(PROGRAMS).map(([id, n]) => `<button class="chip" data-myprog="${id}" aria-pressed="${+id === myProg()}">${esc(n)}</button>`).join("")}</div>`}</div>`}
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
// Protección del contenido: sin copiar texto y plan desenfocado al salir de la app (sin marca de agua)
function setWatermark() {
  document.getElementById("wm")?.remove();
  document.body.classList.toggle("protect", !!me && !me.is_admin);
}
document.addEventListener("visibilitychange", () => { document.body.classList.toggle("hidden-app", document.hidden && document.body.classList.contains("protect")); });
document.addEventListener("copy", (e) => { if (document.body.classList.contains("protect") && !e.target.closest?.("input,textarea")) e.preventDefault(); });
document.addEventListener("contextmenu", (e) => { if (document.body.classList.contains("protect") && e.target.closest?.("#app") && !e.target.closest("input,textarea,a")) e.preventDefault(); });

async function logout() {
  try { const r = await navigator.serviceWorker?.getRegistration(); const s = await r?.pushManager?.getSubscription(); if (s) { await rpc("delete_push", { p_endpoint: s.endpoint }).catch(() => {}); await s.unsubscribe(); } } catch (_) {}
  await sb.auth.signOut(); me = null; P = null; done = {}; viewAs = null; lastViewed = null; viewKey = ""; athletes = []; detail = null; setWatermark();
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
      if (e0[2] === "sec") return `<div class="muted" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:8px 0 2px">${esc(e0[0])}</div>`;
      const id = `${d.swapKey || d.key}|${v}|${i}`, r = personalEx(pz, d.swapKey || d.key, v, i, e0, used), mine = !!cu.swaps?.[id];
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
    <p class="muted" style="font-size:14px;margin:4px 0 10px">Aquí ves las rutinas A, B y C. Desde la semana 4A la app cambia sola cada ejercicio por otro con el mismo objetivo, para que cada semana sea distinta. La app adapta el plan a su objetivo y a su lesión. Aquí lo ves y puedes cambiar o quitar ejercicios solo para ${esc(a.name)}.</p>
    <div class="label">Adaptación automática</div>
    <div class="chips" style="margin-top:6px"><button class="chip" data-cauto="1" aria-pressed="${autoOn}">Activada</button><button class="chip" data-cauto="0" aria-pressed="${!autoOn}">Desactivada</button></div>
    <div class="label" style="margin-top:12px">Semana del plan</div>
    <p style="margin:4px 0 6px;font-size:14px">${calWeek({ custom: cu }) ? `Va en la <b>semana ${wkLabel(calWeek({ custom: cu }))}</b>. Sube sola cada lunes.` : `<span class="muted">Automática por sesiones hechas: avanza cuando marca todas las de su semana.</span>`}</p>
    <div class="chips" style="margin-top:6px">${[1, 2, 3, 4, 5, 6, 7, 8].map((w) => `<button class="chip" data-cweek="${w}" aria-pressed="${calWeek({ custom: cu }) === w}">${wkLabel(w)}</button>`).join("")}</div>
    ${cu.start ? `<button class="btn ghost sm" style="margin-top:8px" data-cweek="0">Volver a automática por sesiones</button>` : ""}
    <div class="label" style="margin-top:12px">Días por semana</div>
    <div class="chips" style="margin-top:6px"><button class="chip" data-cfreq="def" aria-pressed="${!cu.freq}">${autoFreq(pr, a) ? `Lo que pidió (${autoFreq(pr, a)})` : `Programa (${pr.days.filter((d) => !d.extra).length})`}</button>${[...new Set(["1", "2", ...Object.keys(pr.freq || {})])].map((n) => `<button class="chip" data-cfreq="${n}" aria-pressed="${String(cu.freq) === n}">${n === "1" ? "1 día" : n + " días"}</button>`).join("")}</div>
    ${(a.program_id || 1) === 5 ? `<p class="muted" style="font-size:13px;margin:6px 0 0">En post parto, como mucho 5 días.</p>` : ""}
    ${(a.program_id || 1) === 4 ? `<div class="label" style="margin-top:12px">Carrera extra</div>
    <div class="chips" style="margin-top:6px">${[["0", "Sin carrera"], ["6", "5 km"], ["7", "10 km"]].map(([k, n]) => `<button class="chip" data-cadd="${k}" aria-pressed="${String(cu.addon?.prog || 0) === k}">${n}</button>`).join("")}</div>
    ${cu.addon ? `<div class="chips" style="margin-top:6px">${[1, 2, 3].map((n) => `<button class="chip" data-caddn="${n}" aria-pressed="${(cu.addon.n || 2) === n}">${n} día${n > 1 ? "s" : ""} de carrera</button>`).join("")}</div>` : ""}
    <p class="muted" style="font-size:13px;margin:6px 0 0">Le sale una pestaña más en Mi plan con su plan de carrera, además de musculación.</p>` : ""}
    <div class="label" style="margin-top:12px">Series</div>
    <div class="chips" style="margin-top:6px">${[["auto", "Según objetivo"], ["-1", "−1 serie"], ["0", "Normal"], ["1", "+1 serie"]].map(([k, n]) => `<button class="chip" data-csets="${k}" aria-pressed="${setsSel === k}">${n}</button>`).join("")}</div>
    ${pz.notes.length ? `<ul style="margin:12px 0 0;padding-left:18px;font-size:14px">${pz.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="muted" style="font-size:14px;margin:12px 0 0">Sin adaptaciones: el atleta no ha indicado objetivo ni lesión por zonas.</p>`}
    ${sessionsFor(pr, { ...detail.a, custom: cu }, "all").map(day).join("")}
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
  const pdw = (a.padel_dows || []).slice().sort().map((i) => DOW_SHORT[i]).join(", ");
  const wk = `<div class="banner"><b>Su semana:</b> ${a.want_days ? `quiere entrenar el físico <b>${a.want_days} días</b>` : "días de físico sin contestar"}${(a.program_id || 1) === 1 ? ` · pádel: ${a.padel_days == null ? "sin contestar" : a.padel_days === 0 ? "ahora mismo no juega" : `<b>${a.padel_days} día${a.padel_days > 1 ? "s" : ""}</b>${pdw ? ` (${pdw})` : ""}`}` : ""}</div>`;
  return goal + wk + inj + wt;
}
function schedHTML() {
  const pr = detail?.prog; if (!pr?.days) return "";
  const sc = detail.sched || {};
  const rot = rotating(pr, { ...detail.a, custom: detail.custom });
  const SDa = sessionsFor(pr, { ...detail.a, custom: detail.custom }, 1).map((d, i) => rot ? { ...d, title: `Sesión ${i + 1} de la semana (va rotando: Fuerza → Explosividad → Agilidad)` } : d);
  const used = {}; SDa.forEach((d) => { const v = dowOf(d, sc); if (v >= 0) used[v] = (used[v] || 0) + 1; });
  const rest = DOW.filter((_, i) => !used[i]);
  return `<div class="panel"><h3>Días de entreno</h3>
    <p class="muted" style="font-size:14px;margin:4px 0 10px">Elige qué día de la semana hace cada sesión. Puedes poner días seguidos y el descanso donde quieras.</p>
    ${SDa.map((d) => { const v = dowOf(d, sc); return `<div style="margin-top:10px"><b style="font-size:14px">${esc(d.title)}</b>
      <div class="weeks" style="grid-template-columns:repeat(7,minmax(0,1fr));margin-top:6px">${DOW_SHORT.map((n, i) => `<button class="wk" data-sched="${esc(d.schedKey || d.key)}|${i}" aria-pressed="${i === v}" aria-label="${esc(d.title)}: ${DOW[i]}">${n}</button>`).join("")}</div></div>`; }).join("")}
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
  if (!viewAs || viewAs.id !== a.id) viewKey = "";
  viewAs = a; viewDone = {}; s.forEach((x) => (viewDone[`${x.week}-${x.day}`] = true));
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
  <div class="banner">Sesiones hechas: <b>${detail.prog?.days ? ((c) => `${c[0]} de ${c[1]}`)(doneCount(detail.prog, { ...detail.a, custom: detail.custom }, Object.fromEntries(s.map((x) => [`${x.week}-${x.day}`, true])))) : `${s.length} de 24`}</b>${a.phone ? ` · Móvil: <b>${esc(a.phone)}</b>` : ""} · Alta: ${fmtDate(a.created_at)}</div>
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
    if (t.dataset.addon) { addonView = t.dataset.addon === "1"; return renderPlan(); }
    if (t.dataset.myprog) { t.disabled = true; try { await rpc("set_my_program", { p_program: +t.dataset.myprog }); me = await loadMe(); setModality(); toast(`Actividad: ${progName(myProg())}`); renderProfile(); } catch (err) { toast(err.message); t.disabled = false; } return; }
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
    if (t.dataset.cweek) {
      const cu = JSON.parse(JSON.stringify(detail.custom || {})), w = +t.dataset.cweek;
      if (w) cu.start = startFor(w); else delete cu.start;
      t.disabled = true;
      try { await saveCustom(cu); viewKey = ""; toast(w ? `${detail.a.name.split(" ")[0]} va en la semana ${wkLabel(w)}. Cada lunes pasará a la siguiente.` : "Semana automática por sesiones hechas"); redrawCustom(); }
      catch (err) { $("#cxMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.dataset.cadd || t.dataset.caddn) {
      const cu = JSON.parse(JSON.stringify(detail.custom || {}));
      if (t.dataset.cadd === "0") delete cu.addon;
      else if (t.dataset.cadd) cu.addon = { prog: +t.dataset.cadd, n: cu.addon?.n || 2 };
      else if (cu.addon) cu.addon.n = +t.dataset.caddn;
      t.disabled = true;
      try { await saveCustom(cu); toast(cu.addon ? `Carrera ${cu.addon.prog === 6 ? "5" : "10"} km · ${cu.addon.n} día${cu.addon.n > 1 ? "s" : ""} por semana` : "Sin carrera extra"); redrawCustom(); }
      catch (err) { $("#cxMsg").textContent = err.message; t.disabled = false; }
      return;
    }
    if (t.dataset.cfreq) {
      const cu = JSON.parse(JSON.stringify(detail.custom || {}));
      if (t.dataset.cfreq === "def") delete cu.freq; else cu.freq = +t.dataset.cfreq;
      t.disabled = true;
      try {
        await saveCustom(cu);
        if (detail.a.schedule) { await rpc("admin_set_athlete_schedule", { p_user: detail.a.id, p_schedule: null }); detail.a.schedule = null; detail.sched = {}; }
        athletes = await q(sb.from("profiles").select("*").order("name"));
        toast(cu.freq ? `${cu.freq} días por semana. Los días se han repartido solos; puedes moverlos en Días de entreno.` : (autoFreq(detail.prog, detail.a) ? `Vuelve a los ${autoFreq(detail.prog, detail.a)} días que pidió el atleta.` : "Vuelve a las sesiones del programa."));
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
    if (t.dataset.planGeneral) { lastViewed = viewAs; viewAs = null; viewKey = ""; return renderPlan(); }
    if (t.dataset.ficha) { openId = t.dataset.ficha; detail = null; return go("atletas"); }
    if (t.dataset.planAth) { const a = athletes.find((x) => x.id === t.dataset.planAth); if (a) { viewAs = a; viewDone = {}; try { (await q(sb.from("sessions_done").select("week,day").eq("user_id", a.id))).forEach((r) => (viewDone[`${r.week}-${r.day}`] = true)); } catch (_) {} } viewKey = ""; return renderPlan(); }
    if (t.dataset.planProg) { if (viewAs) lastViewed = viewAs; viewAs = null; viewKey = ""; const id = +t.dataset.planProg; t.disabled = true; const d = await loadProgram(id); if (!d) { t.disabled = false; return toast("Ese programa todavía no existe en la base de datos"); } planProg = id; P = d; renderTabs(); return renderPlan(); }
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
        if (on && !a.active && !(detail.custom || {}).start) await saveCustom({ ...(detail.custom || {}), start: startFor(1) }).catch(() => {});   // al activarlo empieza su 1A esta semana
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
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && me) { me = null; setWatermark(); renderAuth("login", "Tu sesión ha terminado. Vuelve a entrar."); } });
  const { data } = await sb.auth.getSession();
  if (data.session) await start(); else renderAuth("login");
})();
