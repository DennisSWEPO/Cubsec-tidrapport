/* Tidrapport & utlägg – fristående webbapp.
   All data sparas lokalt i webbläsarens IndexedDB på användarens enhet.
   Appen gör inga nätverksanrop utöver att läsa sina egna filer (config.json, mallen). */
"use strict";
(() => {
const APP_VERSION = "1.4.0";
const MONTHS = ["Januari","Februari","Mars","April","Maj","Juni","Juli","Augusti","September","Oktober","November","December"];
const TYPES = ["work","travel","expense","absence"];
const TYPE_LABEL = {work:"Arbete", travel:"Resa", expense:"Utlägg", absence:"Frånvaro"};
const VEHICLES = ["own","benefit","benefit_el","none"];
const VEH_LABEL = {own:"Egen bil", benefit:"Förmånsbil", benefit_el:"Förmånsbil el", none:"Ingen bil"};
const CATS = ["Måltid","Representation","Hotell/logi","Tåg/flyg/taxi","Parkering","Drivmedel","Kontorsmaterial","Programvara","Övrigt"];
const KINDS = ["Semester","Sjukdom","VAB","Föräldraledighet","Tjänstledighet","Kompledighet","Övrigt"];
const VAT_RATES = [25,12,6,0];
const PAYMENTS = ["private","company"];
const DEFAULT_CFG = {foretag:"", lonekontor:"", kvittoredovisning:"", rateOwn:25, rateBenefit:12, rateBenefitEl:9.5};
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const $ = (id) => document.getElementById(id);
const S = {cfg:{...DEFAULT_CFG}, profile:null, kFrom:"", kTo:"", ym:null, items:[], months:{}, type:"work",
  editId:null, editItem:null, receipt:undefined, previewUrl:null, installEvt:null};

/* ---------- små hjälpfunktioner ---------- */
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const ymOf = (ds) => ds.slice(0, 7);
const ymLabel = (ym) => `${MONTHS[+ym.slice(5,7)-1]} ${ym.slice(0,4)}`;
const daysIn = (ym) => new Date(+ym.slice(0,4), +ym.slice(5,7), 0).getDate();
const shiftYm = (ym, d) => { let y = +ym.slice(0,4), m = +ym.slice(5,7) - 1 + d; y += Math.floor(m/12); m = ((m % 12) + 12) % 12; return `${y}-${pad(m+1)}`; };
const parseNum = (v) => { const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const r2 = (n) => Math.round(n * 100) / 100;
const fmtN = (n, d = 2) => (Math.round(n * 10**d) / 10**d).toLocaleString("sv-SE", {maximumFractionDigits:d});
const fmtH = (n) => fmtN(n) + " h";
const fmtAmt = (n) => n.toLocaleString("sv-SE", {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtKr = (n) => n.toLocaleString("sv-SE", {minimumFractionDigits:2, maximumFractionDigits:2}) + " kr";
const fmtDate = (ts) => new Date(ts).toLocaleDateString("sv-SE", {day:"numeric", month:"short"}).replace(/\.$/, "");
const weekday = (ds) => new Date(ds + "T12:00:00").toLocaleDateString("sv-SE", {weekday:"short"});
const isWeekend = (ds) => [0,6].includes(new Date(ds + "T12:00:00").getDay());
const newId = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20); };
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, " ").trim().slice(0, max);
/* Medvetet strikt: bara tecken som är säkra i mejlhuvuden och mailto-länkar. */
const isEmail = (s) => typeof s === "string" && s.length <= 254 && /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s);
class UserError extends Error {}
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "Anstalld";
function isValidDate(ds){ if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return false; const d = new Date(ds + "T12:00:00"); return !isNaN(d) && d.toISOString().slice(0,10) === ds; }

/* Bygger DOM-element. Text sätts alltid som textnoder, aldrig som HTML. */
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}
function toast(msg){ const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200); }
function showBanner(msg){ const b = $("banner"); b.textContent = msg; b.hidden = !msg; }

function workHours(start, end, brk){
  if (!/^\d{2}:\d{2}$/.test(start || "") || !/^\d{2}:\d{2}$/.test(end || "")) return 0;
  const [a, b] = start.split(":").map(Number), [c, d] = end.split(":").map(Number);
  let m = (c*60 + d) - (a*60 + b); if (m < 0) m += 1440;
  return Math.max(0, r2((m - (Number(brk) || 0)) / 60));
}
function rateFor(v){ return v === "own" ? S.cfg.rateOwn : v === "benefit" ? S.cfg.rateBenefit : v === "benefit_el" ? S.cfg.rateBenefitEl : 0; }
function totals(items){
  const t = {work:0, travel:0, absence:0, expPrivate:0, expCompany:0, vatPrivate:0, km:0, mileAmt:0, absByKind:{}};
  for (const it of items) {
    if (it.type === "work") t.work += it.hours;
    else if (it.type === "travel") { t.travel += it.travelHours; t.km += it.km; t.mileAmt += it.km / 10 * rateFor(it.vehicle); }
    else if (it.type === "absence") { t.absence += it.hours; t.absByKind[it.kind] = (t.absByKind[it.kind] || 0) + it.hours; }
    else if (it.type === "expense") { if (it.payment === "company") t.expCompany += it.amount; else { t.expPrivate += it.amount; t.vatPrivate += it.vat; } }
  }
  for (const k of ["work","travel","absence","expPrivate","expCompany","vatPrivate","km","mileAmt"]) t[k] = r2(t[k]);
  return t;
}
const isPrivateExpense = (i) => i.type === "expense" && i.payment !== "company";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sortItems = (arr) => arr.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt - b.createdAt));

/* ---------- validering (används för allt som sparas och allt som läses in) ---------- */
function num(v, min, max){ const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? r2(n) : null; }
function sanitizeItem(raw){
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || ""), type = raw.type, date = String(raw.date || "");
  if (!ID_RE.test(id) || !TYPES.includes(type) || !isValidDate(date)) return null;
  const base = {id, type, date, month: ymOf(date), desc: clean(raw.desc, 160),
    createdAt: num(raw.createdAt, 0, 1e14) ?? Date.now(), updatedAt: num(raw.updatedAt, 0, 1e14) ?? Date.now()};
  if (type === "work") {
    const start = /^\d{2}:\d{2}$/.test(raw.start) ? raw.start : null, end = /^\d{2}:\d{2}$/.test(raw.end) ? raw.end : null;
    const breakMin = num(raw.breakMin, 0, 600) ?? 0;
    if (!start || !end) return null;
    const hours = workHours(start, end, breakMin);
    return hours > 0 ? {...base, start, end, breakMin, hours} : null;
  }
  if (type === "travel") {
    const travelHours = num(raw.travelHours, 0, 24) ?? 0, km = num(raw.km, 0, 5000) ?? 0;
    const vehicle = VEHICLES.includes(raw.vehicle) ? raw.vehicle : "own";
    return (travelHours > 0 || km > 0) ? {...base, travelHours, km, vehicle} : null;
  }
  if (type === "expense") {
    const amount = num(raw.amount, 0.01, 1e6); if (amount == null) return null;
    const vatRate = VAT_RATES.includes(Number(raw.vatRate)) ? Number(raw.vatRate) : 25;
    return {...base, amount, vatRate, vat: r2(amount - amount / (1 + vatRate/100)),
      category: CATS.includes(raw.category) ? raw.category : "Övrigt",
      payment: PAYMENTS.includes(raw.payment) ? raw.payment : "private",
      receiptId: ID_RE.test(String(raw.receiptId || "")) ? String(raw.receiptId) : null};
  }
  const hours = num(raw.hours, 0.01, 24); if (hours == null) return null;
  return {...base, hours, kind: KINDS.includes(raw.kind) ? raw.kind : "Övrigt"};
}
function sanitizeProfile(raw){
  raw = raw && typeof raw === "object" ? raw : {};
  const mail = (v) => { const s = clean(v, 254).toLowerCase(); return isEmail(s) ? s : ""; };
  return {name: clean(raw.name, 80), empNo: clean(raw.empNo, 30), chefMail: mail(raw.chefMail), lonTid: mail(raw.lonTid), kvitto: mail(raw.kvitto ?? raw.lonFragor)};
}
async function sniff(blob){
  const b = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D) return "application/pdf";
  return null;
}

/* ---------- lokal databas (IndexedDB) ---------- */
const DB = {
  db: null,
  open(){
    return new Promise((res, rej) => {
      const r = indexedDB.open("tidrapport", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("items", {keyPath:"id"}).createIndex("month", "month");
        d.createObjectStore("receipts", {keyPath:"id"});
        d.createObjectStore("meta", {keyPath:"key"});
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("blocked"));
    });
  },
  run(stores, mode, fn){
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, mode); let out;
      const r = fn(t); if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  get(s, k){ return this.run(s, "readonly", (t) => t.objectStore(s).get(k)); },
  put(s, v){ return this.run(s, "readwrite", (t) => t.objectStore(s).put(v)); },
  del(s, k){ return this.run(s, "readwrite", (t) => t.objectStore(s).delete(k)); },
  all(s){ return this.run(s, "readonly", (t) => t.objectStore(s).getAll()); },
  byMonth(ym){ return this.run("items", "readonly", (t) => t.objectStore("items").index("month").getAll(ym)); },
  wipe(){ return this.run(["items","receipts","meta"], "readwrite", (t) => { ["items","receipts","meta"].forEach((s) => t.objectStore(s).clear()); }); }
};

/* Kvitton sparas som bytes (ArrayBuffer) – det fungerar stabilt i alla mobilwebbläsare.
   Äldre kvitton som sparats som Blob läses fortfarande. */
async function getReceipt(id){
  const r = await DB.get("receipts", id);
  if (!r) return null;
  if (r.data instanceof ArrayBuffer) r.blob = new Blob([r.data], {type: r.type || (r.kind === "pdf" ? "application/pdf" : "image/jpeg")});
  return r.blob instanceof Blob ? r : null;
}
async function putReceipt(rec){
  const data = await rec.blob.arrayBuffer();
  await DB.put("receipts", {id: rec.id, kind: rec.kind, type: rec.type, name: rec.name, data, createdAt: rec.createdAt});
}

/* ---------- start ---------- */
document.addEventListener("DOMContentLoaded", init);
async function init(){
  fillSelect($("f-cat"), CATS); fillSelect($("f-kind"), KINDS);
  $("versionInfo").textContent = `Version ${APP_VERSION}. Uppgifterna lämnar bara enheten när du själv skickar ett mejl eller sparar en fil.`;
  bindUI();
  if (!("indexedDB" in window)) { showBanner("Webbläsaren saknar lokal lagring. Använd en aktuell version av Safari, Chrome eller Edge."); return; }
  try { await DB.open(); }
  catch (e) { showBanner("Kunde inte öppna den lokala lagringen. Privat surfläge stöds inte – öppna appen i ett vanligt fönster."); return; }
  await loadConfig();
  const stored = (await DB.get("meta", "profile"))?.value;
  S.profile = stored ? sanitizeProfile(stored) : null; // gamla profiler (lonFragor) flyttas till kvitto
  S.ym = ymOf(todayStr());
  registerSW();
  if (!profileComplete()) showSetup(); else showMain();
}
function fillSelect(sel, list){ sel.replaceChildren(...list.map((v) => h("option", {value:v}, v))); }

async function loadConfig(){
  let raw = {};
  try { const r = await fetch("config.json", {cache:"no-store"}); if (r.ok) raw = await r.json(); } catch (e) { /* offline: service workern svarar med cachad kopia */ }
  const ms = raw && typeof raw.milersattning === "object" ? raw.milersattning : {};
  const rate = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : d; };
  const mail = (v) => { const s = clean(v, 254).toLowerCase(); return isEmail(s) ? s : ""; };
  S.cfg = {foretag: clean(raw.foretag, 80), lonekontor: mail(raw.lonekontor ?? raw.lonekontorTidrapport), kvittoredovisning: mail(raw.kvittoredovisning ?? raw.lonekontorLonefragor),
    rateOwn: rate(ms.egenBil, 25), rateBenefit: rate(ms.formansbil, 12), rateBenefitEl: rate(ms.formansbilEl, 9.5)};
}
const lonMail = () => S.cfg.lonekontor || S.profile?.lonTid || "";
const kvittoMail = () => S.cfg.kvittoredovisning || S.profile?.kvitto || "";
const profileComplete = () => !!(S.profile && S.profile.name && isEmail(S.profile.chefMail) && lonMail() && kvittoMail());

function registerSW(){
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; $("installBtn").hidden = false; });
}

function showView(v){
  ["setup","main","settings"].forEach((n) => { $("view-" + n).hidden = n !== v; });
  $("monthnav").hidden = v !== "main"; $("settingsBtn").hidden = v !== "main";
  window.scrollTo(0, 0);
}
function showSetup(){
  const p = S.profile || {};
  $("su-name").value = p.name || ""; $("su-emp").value = p.empNo || ""; $("su-chef").value = p.chefMail || "";
  $("su-lontid-wrap").hidden = !!S.cfg.lonekontor; $("su-kvitto-wrap").hidden = !!S.cfg.kvittoredovisning;
  $("su-lontid").value = p.lonTid || ""; $("su-kvitto").value = p.kvitto || "";
  $("who").textContent = S.cfg.foretag;
  showView("setup");
}
function showMain(){ renderWho(); renderMonthLabel(); resetForm(); setKvittoPeriod(S.ym); showView("main"); loadMonth(); }
function renderWho(){ $("who").textContent = [S.profile?.name, S.cfg.foretag].filter(Boolean).join(" · "); }

/* ---------- händelser ---------- */
function bindUI(){
  $("setupForm").addEventListener("submit", (e) => { e.preventDefault(); saveProfileFrom("su", "setupErr", true); });
  $("profileForm").addEventListener("submit", (e) => { e.preventDefault(); saveProfileFrom("p", "profileErr", false); });
  $("settingsBtn").onclick = openSettings; $("backBtn").onclick = showMain;
  $("prev").onclick = () => changeMonth(-1); $("next").onclick = () => changeMonth(1);
  $("seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-type]"); if (b && !S.editId) setType(b.dataset.type); });
  ["f-start","f-end","f-break","f-km","f-vehicle","f-amount","f-vatrate"].forEach((id) => $(id).addEventListener("input", updateCalcs));
  $("entryForm").addEventListener("submit", (e) => { e.preventDefault(); saveEntry(); });
  $("cancelEdit").onclick = resetForm; $("deleteBtn").onclick = deleteEntry;
  $("f-photo").addEventListener("change", onReceiptPicked); $("f-file").addEventListener("change", onReceiptPicked);
  $("receiptClear").onclick = () => { S.receipt = null; showReceiptPreview(null); };
  $("days").addEventListener("click", onDaysClick);
  $("days").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("entry")) { e.preventDefault(); onDaysClick(e); } });
  $("sendChef").onclick = () => openSend("chef"); $("sendLon").onclick = () => openSend("lon");
  $("sendKvitto").onclick = openKvittoSend;
  ["k-from","k-to"].forEach((id) => $(id).addEventListener("change", () => { S.kFrom = $("k-from").value; S.kTo = $("k-to").value; renderKvitto(); }));
  $("sdClose").onclick = () => $("sendDialog").close();
  $("imgClose").onclick = () => $("imgDialog").close();
  $("imgDialog").addEventListener("close", () => { const i = $("imgDialogImg"); if (i.src.startsWith("blob:")) URL.revokeObjectURL(i.src); i.removeAttribute("src"); });
  $("backupBtn").onclick = saveBackup; $("restoreFile").addEventListener("change", restoreBackup);
  $("wipeBtn").onclick = wipeAll;
  $("installBtn").onclick = async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice.catch(() => {}); S.installEvt = null; $("installBtn").hidden = true; };
}

/* ---------- profil ---------- */
async function saveProfileFrom(prefix, errId, first){
  const g = (id) => $(prefix + "-" + id);
  const raw = {name: g("name").value, empNo: g("emp").value, chefMail: g("chef").value,
    lonTid: S.cfg.lonekontor ? (S.profile?.lonTid || "") : g("lontid").value,
    kvitto: S.cfg.kvittoredovisning ? (S.profile?.kvitto || "") : g("kvitto").value};
  const err = [];
  if (!clean(raw.name, 80)) err.push("Fyll i ditt namn.");
  if (!isEmail(clean(raw.chefMail, 254).toLowerCase())) err.push("Fyll i chefens e-postadress, t.ex. namn@foretag.se.");
  if (!S.cfg.lonekontor && !isEmail(clean(raw.lonTid, 254).toLowerCase())) err.push("Fyll i lönekontorets e-postadress för utlägg.");
  if (!S.cfg.kvittoredovisning && !isEmail(clean(raw.kvitto, 254).toLowerCase())) err.push("Fyll i e-postadressen för kvittoredovisning.");
  const e = $(errId); e.textContent = err.join(" "); e.hidden = !err.length;
  if (err.length) return;
  S.profile = sanitizeProfile(raw);
  try { await DB.put("meta", {key:"profile", value:S.profile}); }
  catch (x) { toast("Kunde inte spara uppgifterna."); return; }
  if (first && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  toast(first ? "Klart! Nu kan du börja registrera." : "Uppgifterna är sparade");
  showMain();
}
function openSettings(){
  const p = S.profile || {};
  $("p-name").value = p.name || ""; $("p-emp").value = p.empNo || ""; $("p-chef").value = p.chefMail || "";
  $("p-lontid").value = lonMail(); $("p-kvitto").value = kvittoMail();
  $("p-lontid").readOnly = !!S.cfg.lonekontor; $("p-kvitto").readOnly = !!S.cfg.kvittoredovisning;
  $("lonHint").hidden = !(S.cfg.lonekontor || S.cfg.kvittoredovisning);
  $("profileErr").hidden = true; delete $("wipeBtn").dataset.armed; $("wipeBtn").textContent = "Radera all data";
  showView("settings");
}

/* ---------- månad ---------- */
function changeMonth(d){ S.ym = shiftYm(S.ym, d); renderMonthLabel(); resetForm(); setKvittoPeriod(S.ym); loadMonth(); }
function renderMonthLabel(){ $("monthLabel").textContent = ymLabel(S.ym); }
async function loadMonth(){
  const ym = S.ym;
  const [items, meta] = await Promise.all([DB.byMonth(ym), DB.get("meta", "month:" + ym)]);
  if (ym !== S.ym) return;
  S.items = items.map(sanitizeItem).filter(Boolean);
  S.months[ym] = meta?.value || {};
  render(); renderKvitto();
}
async function touchMonth(ym){
  const m = {...(S.months[ym] || {}), changedAt: Date.now()};
  S.months[ym] = m; await DB.put("meta", {key:"month:" + ym, value:m});
}

/* ---------- formulär ---------- */
function setType(t){
  S.type = t;
  $("seg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === t)));
  document.querySelectorAll("[data-for]").forEach((el) => { el.hidden = el.dataset.for !== t; });
  $("f-desc").placeholder = {work:"t.ex. Anbud Region Stockholm", travel:"t.ex. Stockholm – Uppsala, kundmöte", expense:"t.ex. Lunch med kund, Restaurang X", absence:"Valfri kommentar"}[t];
  updateCalcs();
}
function defaultDate(){ const t = todayStr(); return ymOf(t) === S.ym ? t : `${S.ym}-01`; }
function resetForm(){
  S.editId = null; S.editItem = null; S.receipt = undefined;
  $("entryForm").reset(); $("f-photo").value = ""; $("f-file").value = "";
  $("f-date").value = defaultDate(); $("f-date").min = `${S.ym}-01`; $("f-date").max = `${S.ym}-${pad(daysIn(S.ym))}`;
  $("formTitle").textContent = "Registrera"; $("saveBtn").textContent = "Spara";
  $("cancelEdit").hidden = true; $("deleteBtn").hidden = true; delete $("deleteBtn").dataset.armed; $("deleteBtn").textContent = "Ta bort";
  showReceiptPreview(null); setType(S.type);
  document.querySelectorAll(".entry.editing").forEach((e) => e.classList.remove("editing"));
}
function updateCalcs(){
  $("workCalc").textContent = fmtH(workHours($("f-start").value, $("f-end").value, $("f-break").value));
  const km = parseNum($("f-km").value) || 0, rate = rateFor($("f-vehicle").value);
  $("mileCalc").textContent = `${fmtN(km/10, 1)} mil × ${fmtN(rate)} kr = ${fmtKr(r2(km/10*rate))}`;
  const a = parseNum($("f-amount").value) || 0, p = Number($("f-vatrate").value);
  $("vatCalc").textContent = fmtKr(r2(a - a / (1 + p/100)));
}

/* ---------- kvitton ---------- */
async function onReceiptPicked(e){
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (f.size > MAX_RECEIPT_BYTES * 3) { toast("Filen är för stor."); return; }
  $("receiptNote").textContent = "Bearbetar…";
  try {
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      if (f.size > MAX_RECEIPT_BYTES) throw new UserError("PDF-filen är större än 10 MB.");
      if (await sniff(f) !== "application/pdf") throw new UserError("Filen är ingen giltig PDF.");
      S.receipt = {kind:"pdf", type:"application/pdf", name: clean(f.name, 80) || "kvitto.pdf", blob: f};
    } else if (f.type.startsWith("image/")) {
      S.receipt = {kind:"image", type:"image/jpeg", name:"kvitto.jpg", blob: await compressImage(f)};
    } else throw new UserError("Välj en bild eller en PDF.");
    showReceiptPreview(S.receipt);
  } catch (err) {
    toast(err instanceof UserError ? err.message : "Kunde inte läsa filen. Prova en annan.");
    showReceiptPreview(S.receipt || null);
  }
}
function compressImage(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sc = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth*sc)); c.height = Math.max(1, Math.round(img.naturalHeight*sc));
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.78);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load")); };
    img.src = url;
  });
}
function showReceiptPreview(r){
  if (S.previewUrl) { URL.revokeObjectURL(S.previewUrl); S.previewUrl = null; }
  const img = $("receiptPreview");
  if (r && r.kind === "image") { S.previewUrl = URL.createObjectURL(r.blob); img.src = S.previewUrl; img.hidden = false; }
  else { img.hidden = true; img.removeAttribute("src"); }
  $("receiptClear").hidden = !r;
  $("receiptNote").textContent = !r ? "Inget kvitto valt" : r.kind === "pdf" ? `PDF bifogad: ${r.name}` : "Kvitto bifogat";
}
async function openReceipt(rid){
  const r = await getReceipt(rid);
  if (!r) { toast("Kvittot hittades inte."); return; }
  const url = URL.createObjectURL(r.blob);
  if (r.kind === "pdf") { downloadBlob(r.blob, `Kvitto_${slug(r.name.replace(/\.pdf$/i, ""))}.pdf`); URL.revokeObjectURL(url); return; }
  $("imgDialogImg").src = url; $("imgDialog").showModal();
}

/* ---------- spara / ändra / ta bort ---------- */
async function saveEntry(){
  const date = $("f-date").value;
  if (!isValidDate(date) || ymOf(date) !== S.ym) { toast(`Välj ett datum i ${ymLabel(S.ym).toLowerCase()}.`); return; }
  const now = Date.now();
  const raw = {id: S.editId || newId(), type: S.type, date, desc: $("f-desc").value, createdAt: S.editItem?.createdAt || now, updatedAt: now};
  if (S.type === "work") {
    Object.assign(raw, {start:$("f-start").value, end:$("f-end").value, breakMin: Number($("f-break").value) || 0});
    if (workHours(raw.start, raw.end, raw.breakMin) <= 0) { toast("Kontrollera start, slut och rast."); return; }
  } else if (S.type === "travel") {
    const th = parseNum($("f-thours").value), km = parseNum($("f-km").value);
    Object.assign(raw, {travelHours: Number.isNaN(th) ? 0 : th, km: Number.isNaN(km) ? 0 : km, vehicle: $("f-vehicle").value});
    if (raw.travelHours > 24 || raw.km > 5000 || raw.travelHours < 0 || raw.km < 0) { toast("Kontrollera restid och km."); return; }
    if (!(raw.travelHours > 0 || raw.km > 0)) { toast("Ange restid eller körda km."); return; }
    if (!clean(raw.desc, 160)) { toast("Beskriv resan, t.ex. från – till och syfte."); return; }
  } else if (S.type === "expense") {
    Object.assign(raw, {amount: parseNum($("f-amount").value), vatRate: Number($("f-vatrate").value), category: $("f-cat").value, payment: $("f-pay").value, receiptId: S.editItem?.receiptId || null});
    if (!(raw.amount > 0 && raw.amount <= 1e6)) { toast("Ange ett belopp."); return; }
    if (!clean(raw.desc, 160)) { toast("Beskriv utlägget."); return; }
  } else {
    Object.assign(raw, {hours: parseNum($("f-ahours").value), kind: $("f-kind").value});
    if (!(raw.hours > 0 && raw.hours <= 24)) { toast("Ange antal timmar (högst 24)."); return; }
  }
  $("saveBtn").disabled = true;
  try {
    if (S.type === "expense") {
      const oldRid = raw.receiptId;
      if (S.receipt) {
        const rid = newId();
        await putReceipt({id: rid, kind: S.receipt.kind, type: S.receipt.type, name: S.receipt.name, blob: S.receipt.blob, createdAt: now});
        raw.receiptId = rid;
        if (oldRid) await DB.del("receipts", oldRid);
      } else if (S.receipt === null && oldRid) { await DB.del("receipts", oldRid); raw.receiptId = null; }
    }
    const item = sanitizeItem(raw);
    if (!item) { toast("Kontrollera uppgifterna."); return; }
    await DB.put("items", item);
    await touchMonth(S.ym);
    toast(S.editId ? "Ändringen är sparad" : "Sparat");
    const keep = S.type; resetForm(); setType(keep); $("f-date").value = date;
    await loadMonth();
  } catch (e) {
    toast(e && e.name === "QuotaExceededError" ? "Lagringen i enheten är full. Spara en säkerhetskopia och rensa gamla månader." : "Kunde inte spara. Försök igen.");
  } finally { $("saveBtn").disabled = false; }
}
function onDaysClick(e){
  const rb = e.target.closest("[data-receipt]");
  if (rb) { e.stopPropagation(); openReceipt(rb.dataset.receipt); return; }
  const row = e.target.closest(".entry"); if (!row) return;
  const it = S.items.find((i) => i.id === row.dataset.id); if (!it) return;
  editEntry(it);
  document.querySelectorAll(".entry.editing").forEach((x) => x.classList.remove("editing")); row.classList.add("editing");
  if (window.innerWidth < 860) $("formCard").scrollIntoView({behavior:"smooth", block:"start"});
}
function editEntry(it){
  resetForm(); setType(it.type); S.editId = it.id; S.editItem = it;
  $("f-date").value = it.date; $("f-desc").value = it.desc;
  if (it.type === "work") { $("f-start").value = it.start; $("f-end").value = it.end; $("f-break").value = it.breakMin; }
  if (it.type === "travel") { $("f-thours").value = it.travelHours ? fmtN(it.travelHours) : ""; $("f-km").value = it.km ? fmtN(it.km) : ""; $("f-vehicle").value = it.vehicle; }
  if (it.type === "expense") {
    $("f-amount").value = fmtN(it.amount); $("f-vatrate").value = String(it.vatRate); $("f-cat").value = it.category; $("f-pay").value = it.payment;
    if (it.receiptId) getReceipt(it.receiptId).then((r) => { if (r && S.editId === it.id && S.receipt === undefined) showReceiptPreview(r); });
  }
  if (it.type === "absence") { $("f-kind").value = it.kind; $("f-ahours").value = fmtN(it.hours); }
  $("formTitle").textContent = "Ändra registrering"; $("saveBtn").textContent = "Spara ändring";
  $("cancelEdit").hidden = false; $("deleteBtn").hidden = false; updateCalcs();
}
async function deleteEntry(){
  const b = $("deleteBtn");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Bekräfta borttagning"; setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "Ta bort"; } }, 4000); return; }
  const it = S.editItem; if (!it) return;
  try {
    await DB.del("items", it.id);
    if (it.receiptId) await DB.del("receipts", it.receiptId);
    await touchMonth(S.ym);
    toast("Borttagen"); resetForm(); await loadMonth();
  } catch (e) { toast("Kunde inte ta bort. Försök igen."); }
}

/* ---------- visning ---------- */
function render(){
  const t = totals(S.items);
  const tile = (label, value, extra) => h("div", {class:"tile"}, h("small", null, label), h("b", {class:"num"}, value), extra ? h("em", {class:"num"}, extra) : null);
  $("tiles").replaceChildren(
    tile("Närvaro", fmtH(t.work)), tile("Restid", fmtH(t.travel)), tile("Frånvaro", fmtH(t.absence)),
    tile("Utlägg att ersätta", fmtKr(t.expPrivate), t.expCompany ? `Företagskort ${fmtKr(t.expCompany)}` : null),
    tile("Körda mil", fmtN(t.km/10, 1), `Milersättning ${fmtKr(t.mileAmt)}`));
  renderSendStatus();

  const box = $("days");
  if (!S.items.length) {
    box.replaceChildren(h("div", {class:"empty"}, h("b", null, `Inga registreringar för ${ymLabel(S.ym).toLowerCase()}`), "Lägg till arbetstid, en resa, ett utlägg eller frånvaro i formuläret."));
    return;
  }
  const byDate = {};
  for (const it of sortItems(S.items)) (byDate[it.date] = byDate[it.date] || []).push(it);
  box.replaceChildren(...Object.keys(byDate).sort().map((d) => h("div", {class:"day"},
    h("div", {class: "dlabel" + (isWeekend(d) ? " we" : "")}, `${+d.slice(8)} ${MONTHS[+d.slice(5,7)-1].slice(0,3).toLowerCase()}`, h("small", null, weekday(d))),
    h("div", null, byDate[d].map(entryEl)))));
  if (S.editId) box.querySelector(`.entry[data-id="${S.editId}"]`)?.classList.add("editing");
}
function entryEl(it){
  let main = "", sub = [], val = "";
  if (it.type === "work") { main = it.desc || "Arbete"; sub = [`${it.start}–${it.end}${it.breakMin ? `, rast ${it.breakMin} min` : ""}`]; val = fmtH(it.hours); }
  else if (it.type === "travel") {
    main = it.desc || "Resa";
    sub = [it.travelHours ? `restid ${fmtH(it.travelHours)}` : null, it.km ? `${fmtN(it.km, 1)} km, ${VEH_LABEL[it.vehicle]}` : null].filter(Boolean).join(" · ");
    sub = [sub]; val = it.km && rateFor(it.vehicle) ? fmtKr(r2(it.km/10*rateFor(it.vehicle))) : fmtH(it.travelHours);
  } else if (it.type === "expense") {
    main = it.desc || it.category;
    sub = [`${it.category} · moms ${fmtKr(it.vat)} · ${it.payment === "company" ? "företagskort" : "privat"} · `,
      it.receiptId ? h("button", {class:"btn small", type:"button", dataset:{receipt: it.receiptId}}, "Visa kvitto") : h("span", {class:"missing"}, "kvitto saknas")];
    val = fmtKr(it.amount);
  } else { main = it.kind; sub = it.desc ? [it.desc] : []; val = fmtH(it.hours); }
  return h("div", {class:"entry", tabindex:"0", role:"button", dataset:{id: it.id}, "aria-label": `Ändra ${TYPE_LABEL[it.type]} ${it.date}`},
    h("span", {class:"tag " + it.type}, TYPE_LABEL[it.type]),
    h("div", {class:"desc"}, main, sub.length ? h("small", null, sub) : null),
    h("div", {class:"val num"}, val));
}
function renderSendStatus(){
  const m = S.months[S.ym] || {};
  const set = (id, sentAt) => {
    const el = $(id);
    if (!sentAt) { el.textContent = "Ej skickad"; el.className = "sendstatus"; return; }
    const changed = (m.changedAt || 0) > sentAt;
    el.textContent = changed ? `Skickad ${fmtDate(sentAt)} – ändrad efteråt, skicka igen` : `Skickad ${fmtDate(sentAt)}`;
    el.className = "sendstatus " + (changed ? "changed" : "ok");
  };
  set("statusChef", m.sentChef); set("statusLon", m.sentLon);
}

/* ---------- skicka ---------- */
/* Gemensam dialog för alla utskick. spec: {title, to, subject, emlName, build: async () => files, body: (files) => text, onSent} */
async function openSendDialog(spec){
  const {title, to, subject, emlName} = spec;
  const dlg = $("sendDialog");
  $("sdTitle").textContent = title;
  $("sdTo").replaceChildren(h("span", {class:"addr"}, to.join(", "), h("button", {class:"btn small", type:"button", onclick: () => copyText(to.join(", "))}, "Kopiera")));
  $("sdSubject").textContent = subject;
  $("sdFiles").textContent = "Skapar bilagor…"; $("sdOpts").replaceChildren(); $("sdHelp").textContent = ""; $("sdHelp").classList.remove("manual"); $("sdWarn").hidden = true; $("sdStatus").hidden = true;
  if (!dlg.open) dlg.showModal();

  let files;
  try { files = await spec.build(); }
  catch (e) {
    console.error("Bilagorna kunde inte skapas", e);
    $("sdFiles").textContent = "Kunde inte skapa bilagorna. Stäng appen helt och öppna den igen. Kvarstår felet, skicka den tekniska informationen nedan till administratören.";
    $("sdWarn").textContent = `Teknisk information: ${clean(e && e.name, 60)}: ${clean(e && e.message, 200)} (version ${APP_VERSION})`; $("sdWarn").hidden = false;
    return;
  }
  if (!dlg.open) return;
  const total = files.reduce((s, f) => s + f.blob.size, 0);
  $("sdFiles").textContent = files.map((f) => f.name).join(", ") + ` (${fmtN(total/1048576, 1)} MB)`;
  if (total > 20 * 1048576) { $("sdWarn").textContent = "Bilagorna är större än 20 MB och kan stoppas av mejlservern. Dela i så fall upp perioden i två redovisningar."; $("sdWarn").hidden = false; }

  const body = spec.body(files);
  const markSent = async () => { try { await spec.onSent(); } catch (e) { /* statusen är bara en påminnelse */ } };
  const fileObjs = files.map((f) => new File([f.blob], f.name, {type: f.type}));
  let shareFiles = null;
  if (navigator.canShare) {
    if (navigator.canShare({files: fileObjs})) shareFiles = fileObjs;
    else { const pdfs = fileObjs.filter((f) => f.type === "application/pdf"); if (pdfs.length && navigator.canShare({files: pdfs})) shareFiles = pdfs; }
  }
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const recipients = to.join(", ");
  const createEml = async () => { downloadBlob(await buildEml({to, subject, body, files}), emlName); await markSent(); };

  // Delning (mobil): mottagaren kopieras först, eftersom delningsmenyn inte kan fylla i Till-fältet.
  const optShare = shareFiles && h("button", {class:"btn " + (touch ? "primary" : ""), type:"button", onclick: async () => {
    try { navigator.clipboard?.writeText(recipients).catch(() => {}); } catch (e) { /* kopiering är en bekvämlighet */ }
    try { await navigator.share({files: shareFiles, title: subject, text: body}); await markSent(); toast("Markerad som skickad"); }
    catch (e) { if (e && e.name !== "AbortError") toast("Delningen misslyckades. Prova ett annat alternativ."); }
  }}, touch ? "Öppna e-post med bilagor" : "Dela med bilagor (välj e-postappen)");
  const optEml = h("button", {class:"btn " + (!touch || !shareFiles ? "primary" : ""), type:"button", onclick: async () => {
    await createEml(); toast("Utkastet är sparat – öppna filen så öppnas mejlet med bilagor");
  }}, spec.auto ? "Skapa mejlet igen (Outlook)" : "Skapa mejlutkast med bilagor (Outlook)");
  const optManual = h("button", {class:"btn", type:"button", onclick: () => {
    $("sdHelp").replaceChildren(
      h("span", null, "1. Spara bilagorna:"),
      h("span", {class:"actions"}, files.map((f) => h("button", {class:"btn small", type:"button", onclick: () => downloadBlob(f.blob, f.name)}, f.name))),
      h("span", null, "2. Öppna e-posten och bifoga filerna från Hämtade filer:"),
      h("button", {class:"btn small primary", type:"button", onclick: async () => { location.href = mailtoUrl(to, subject, body); await markSent(); }}, "Öppna e-post"));
    $("sdHelp").classList.add("manual");
  }}, "Öppna e-post och bifoga själv");
  const status = $("sdStatus");
  status.hidden = true;

  if (spec.auto && touch && shareFiles) {
    // Mobil: öppna delningsmenyn direkt med PDF, ämne och text. Mottagaren kopierades redan vid klicket.
    try {
      await navigator.share({files: shareFiles, title: subject, text: body});
      await markSent(); dlg.close(); toast("Kvittoredovisningen är överlämnad till e-postappen");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") { status.textContent = "Delningen avbröts. Tryck på knappen för att försöka igen."; }
      else { status.textContent = "PDF:en är klar. Tryck på knappen och välj Outlook."; }
    }
    status.textContent += ` Mottagaren (${recipients}) är kopierad – tryck länge i Till-fältet och välj Klistra in.`;
    status.hidden = false;
    $("sdOpts").replaceChildren(optShare, optManual);
    $("sdHelp").textContent = "";
    return;
  }
  if (spec.auto) {
    // Dator: mejlet med mottagare och bilaga skapas direkt och öppnas i Outlook.
    await createEml();
    status.textContent = "Mejlet med mottagare och PDF skapas och öppnas i Outlook. Kontrollera och tryck Skicka.";
    status.hidden = false;
    $("sdOpts").replaceChildren(...[optEml, optShare, optManual].filter(Boolean));
    $("sdHelp").textContent = "Öppnas inget mejl? Klicka på den hämtade filen (.eml) i webbläsarens nedladdningar. "
      + "Så öppnas den automatiskt nästa gång: i Chrome eller Edge, klicka på ”…” vid nedladdningen och välj ”Öppna alltid filer av den här typen”. "
      + "Används inte Outlook: välj ”Öppna e-post och bifoga själv”.";
    return;
  }
  $("sdOpts").replaceChildren(...(touch && optShare ? [optShare, optEml, optManual] : [optEml, optShare, optManual]).filter(Boolean));
  $("sdHelp").textContent = (shareFiles ? "Dela: mottagaren kopieras automatiskt – klistra in den i Till-fältet om det är tomt. " : "")
    + "Mejlutkast: öppna den sparade .eml-filen, så öppnas ett färdigt mejl i Outlook. Kontrollera och tryck Skicka. "
    + "Fungerar inget av det: välj det sista alternativet och bifoga filerna själv.";
}
const signature = () => ["", "Med vänliga hälsningar", S.profile.name + (S.profile.empNo ? ` (anst.nr ${S.profile.empNo})` : "")];

/* Tidrapport till attesterande chef: arbete, resor, frånvaro och utlägg som ska ersättas (privat kort/kontant). */
function openSend(target){
  if (target === "lon") { openLonSend(); return; }
  if (!profileComplete()) { toast("Fyll i dina uppgifter först."); openSettings(); return; }
  if (!S.items.length) { toast(`Det finns inget registrerat för ${ymLabel(S.ym).toLowerCase()}.`); return; }
  const ym = S.ym, items = S.items.slice(), t = totals(items), p = S.profile;
  const base = `Tidrapport_${ym}_${slug(p.name)}`;
  openSendDialog({
    title: "Skicka tidrapport till chef",
    to: [p.chefMail],
    subject: `Tidrapport ${ymLabel(ym)} – ${p.name} (för attest)`,
    emlName: base + ".eml",
    build: async () => [
      {name: base + ".xlsx", type: XLSX_TYPE, blob: await buildXlsx(p, ym, items)},
      {name: base + ".pdf", type:"application/pdf", blob: await buildPdf(p, ym, items)}],
    body: (files) => {
      const abs = Object.entries(t.absByKind).map(([k, v]) => `${k} ${fmtH(v)}`).join(", ");
      const lines = ["Hej,", "", `Här kommer min tidrapport för ${ymLabel(ym).toLowerCase()} för attest.`, "",
        `Närvaro: ${fmtH(t.work)}`, `Restid: ${fmtH(t.travel)}`, `Frånvaro: ${fmtH(t.absence)}${abs ? ` (${abs})` : ""}`,
        `Utlägg att ersätta (privat kort/kontant): ${fmtKr(t.expPrivate)}`, `Milersättning: ${fmtKr(t.mileAmt)} (${fmtN(t.km/10, 1)} mil)`,
        `Totalt att utbetala: ${fmtKr(r2(t.expPrivate + t.mileAmt))}`];
      if (t.expPrivate) lines.push("Kvitton för utläggen skickas separat i kvittoredovisningen.");
      lines.push("", "Bilagor: " + files.map((f) => f.name).join(", "), ...signature());
      return lines.join("\n");
    },
    onSent: () => markMonth(ym, "sentChef")
  });
}
async function markMonth(ym, key){
  const m = {...(S.months[ym] || {})}; m[key] = Date.now();
  S.months[ym] = m; await DB.put("meta", {key:"month:" + ym, value:m});
  if (ym === S.ym) renderSendStatus();
}

/* Utlägg till lönekontoret: privata utlägg (ersätts) och milersättning – inga timmar, ingen frånvaro, inga kvitton. */
function openLonSend(){
  if (!profileComplete()) { toast("Fyll i dina uppgifter först."); openSettings(); return; }
  const ym = S.ym, items = S.items.slice(), t = totals(items), p = S.profile;
  if (!t.expPrivate && !t.mileAmt) { toast(`Det finns inga utlägg eller någon milersättning att skicka för ${ymLabel(ym).toLowerCase()}.`); return; }
  const n = items.filter(isPrivateExpense).length;
  const base = `Utlagg_${ym}_${slug(p.name)}`;
  openSendDialog({
    title: "Skicka utlägg till lönekontoret",
    to: [lonMail()],
    subject: `Utlägg och milersättning ${ymLabel(ym)} – ${p.name}`,
    emlName: base + ".eml",
    build: async () => [
      {name: base + ".pdf", type:"application/pdf", blob: await buildLonPdf(p, ym, items)},
      {name: base + ".xlsx", type: XLSX_TYPE, blob: await buildLonXlsx(p, ym, items)}],
    body: (files) => {
      const sc = S.months[ym]?.sentChef;
      return ["Hej,", "", `Här kommer mina utlägg och min milersättning för ${ymLabel(ym).toLowerCase()} att betalas ut med lönen.`, "",
        `Utlägg, privat kort/kontant: ${fmtKr(t.expPrivate)} (${n} st, varav moms ${fmtKr(t.vatPrivate)})`,
        `Milersättning: ${fmtKr(t.mileAmt)} (${fmtN(t.km/10, 1)} mil)`,
        `Totalt att utbetala: ${fmtKr(r2(t.expPrivate + t.mileAmt))}`, "",
        sc ? `Tidrapporten med utläggen skickades till ${p.chefMail} för attest ${fmtDate(sc)}.` : `Attesterande chef: ${p.chefMail} (tidrapporten är ännu inte skickad för attest).`,
        t.expPrivate ? "Kvittona skickas separat i kvittoredovisningen." : "",
        "", "Bilagor: " + files.map((f) => f.name).join(", "), ...signature()].filter((l, i, a) => !(l === "" && a[i-1] === "")).join("\n");
    },
    onSent: () => markMonth(ym, "sentLon")
  });
}

/* ---------- kvittoredovisning ---------- */
function setKvittoPeriod(ym){ S.kFrom = `${ym}-01`; S.kTo = `${ym}-${pad(daysIn(ym))}`; $("k-from").value = S.kFrom; $("k-to").value = S.kTo; }
const validPeriod = () => isValidDate(S.kFrom || "") && isValidDate(S.kTo || "") && S.kFrom <= S.kTo;
async function kvittoExpenses(){
  const all = (await DB.all("items")).map(sanitizeItem).filter(Boolean);
  return sortItems(all.filter((i) => i.type === "expense" && i.date >= S.kFrom && i.date <= S.kTo));
}
async function getKvittoSent(){
  const v = (await DB.get("meta", "kvittoSent"))?.value;
  return v && typeof v === "object" ? {ids: v.ids && typeof v.ids === "object" ? v.ids : {}, last: v.last || null} : {ids:{}, last:null};
}
async function renderKvitto(){
  const info = $("kvittoInfo"), btn = $("sendKvitto");
  if (!validPeriod()) { info.textContent = "Välj ett giltigt datumintervall (från och med måste vara före till och med)."; btn.disabled = true; return; }
  const [exps, sent] = await Promise.all([kvittoExpenses(), getKvittoSent()]);
  const sum = r2(exps.reduce((s, e) => s + e.amount, 0)), missing = exps.filter((e) => !e.receiptId).length;
  const already = exps.filter((e) => sent.ids[e.id]).length;
  info.textContent = !exps.length ? "Inga utlägg under perioden."
    : [`${exps.length} utlägg`, fmtKr(sum), missing ? `${missing} utan kvitto` : null, already ? `${already} redan redovisade` : null].filter(Boolean).join(" · ");
  btn.disabled = !exps.length;
  const st = $("statusKvitto"), l = sent.last;
  if (l && isValidDate(l.from) && isValidDate(l.to) && l.at) { st.textContent = `Senast skickad ${fmtDate(l.at)} (${l.from} – ${l.to})`; st.className = "sendstatus ok"; }
  else { st.textContent = "Ingen kvittoredovisning skickad ännu"; st.className = "sendstatus"; }
}
async function openKvittoSend(){
  // Kopiera mottagaren direkt vid klicket (kräver att användaren just har tryckt), så att den kan klistras in i e-postappen.
  try { if (kvittoMail()) navigator.clipboard?.writeText(kvittoMail()).catch(() => {}); } catch (e) { /* bekvämlighet */ }
  if (!profileComplete()) { toast("Fyll i dina uppgifter först."); openSettings(); return; }
  if (!validPeriod()) { toast("Välj ett giltigt datumintervall."); return; }
  const from = S.kFrom, to = S.kTo, p = S.profile, exps = await kvittoExpenses();
  if (!exps.length) { toast("Det finns inga utlägg under perioden."); return; }
  const base = `Kvittoredovisning_${from}_${to}_${slug(p.name)}`;
  const priv = r2(exps.filter((e) => e.payment !== "company").reduce((s, e) => s + e.amount, 0));
  const comp = r2(exps.filter((e) => e.payment === "company").reduce((s, e) => s + e.amount, 0));
  const vat = r2(exps.reduce((s, e) => s + e.vat, 0)), missing = exps.filter((e) => !e.receiptId).length;
  openSendDialog({
    title: "Skicka kvittoredovisning",
    auto: true,
    to: [kvittoMail()],
    subject: `Kvittoredovisning ${from} – ${to} – ${p.name}`,
    emlName: base + ".eml",
    build: async () => { const {pdf, extra} = await buildKvittoPdf(p, from, to, exps); return [{name: base + ".pdf", type:"application/pdf", blob: pdf}, ...extra]; },
    body: (files) => ["Hej,", "", `Här kommer min kvittoredovisning för perioden ${from} – ${to}.`, "",
      `Antal utlägg: ${exps.length}${missing ? ` (varav ${missing} utan kvitto)` : ""}`,
      `Privat betalt, att ersätta: ${fmtKr(priv)}`, `Företagskort: ${fmtKr(comp)}`, `Varav moms: ${fmtKr(vat)}`,
      `Attesterande chef: ${p.chefMail}`, "", "Bilagor: " + files.map((f) => f.name).join(", "), ...signature()].join("\n"),
    onSent: async () => {
      const s = await getKvittoSent(), now = Date.now();
      exps.forEach((e) => { s.ids[e.id] = now; });
      await DB.put("meta", {key:"kvittoSent", value:{ids: s.ids, last:{from, to, at: now}}});
      renderKvitto();
    }
  });
}
function mailtoUrl(to, subject, body){
  return `mailto:${to.filter(isEmail).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`;
}
async function copyText(s){
  try { await navigator.clipboard.writeText(s); toast("Adressen är kopierad"); }
  catch (e) { toast(s); }
}
function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = h("a", {href:url, download:name, rel:"noopener"}); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* .eml-utkast (RFC 5322/2045). X-Unsent gör att Outlook öppnar filen som ett nytt mejl som kan skickas. */
function utf8B64(s){ const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
function encHeader(s){
  s = clean(s, 300);
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const parts = []; let cur = "";
  for (const ch of s) { if (new TextEncoder().encode(cur + ch).length > 40) { parts.push(cur); cur = ""; } cur += ch; }
  if (cur) parts.push(cur);
  return parts.map((p) => `=?UTF-8?B?${utf8B64(p)}?=`).join("\r\n ");
}
async function blobB64(blob){
  const b = new Uint8Array(await blob.arrayBuffer()); let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}/g, "$&\r\n");
}
async function buildEml({to, subject, body, files}){
  const addr = to.filter(isEmail);
  const boundary = "----=_Tidrapport_" + newId();
  const out = ["MIME-Version: 1.0", "X-Unsent: 1", `To: ${addr.join(", ")}`, `Subject: ${encHeader(subject)}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "", "This is a multi-part message in MIME format.", "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    utf8B64(body.replace(/\r?\n/g, "\r\n")).replace(/.{76}/g, "$&\r\n"), ""];
  for (const f of files) {
    const name = f.name.replace(/[^A-Za-z0-9._-]/g, "_");
    out.push(`--${boundary}`, `Content-Type: ${f.type}; name="${name}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`, "", await blobB64(f.blob), "");
  }
  out.push(`--${boundary}--`, "");
  return new Blob([out.join("\r\n")], {type:"message/rfc822"});
}

/* ---------- bilagor: Excel (lönekontorets mall) + PDF ---------- */
function dayRows(items){
  const days = []; for (let d = 1; d <= 31; d++) days.push({d, desc:[], work:0, travel:0, exp:0, abs:0, km:0});
  for (const it of sortItems(items)) {
    const x = days[+it.date.slice(8) - 1];
    if (it.type === "work") { x.work += it.hours; if (it.desc) x.desc.push(it.desc); }
    if (it.type === "travel") { x.travel += it.travelHours; x.km += it.km; x.desc.push(`Resa: ${it.desc}${it.km ? ` (${fmtN(it.km, 1)} km)` : ""}`); }
    if (isPrivateExpense(it)) { x.exp += it.amount; x.desc.push(`Utlägg: ${it.desc || it.category}`); }
    if (it.type === "absence") { x.abs += it.hours; x.desc.push(`${it.kind}${it.desc ? ` – ${it.desc}` : ""}`); }
  }
  days.forEach((x) => { x.work = r2(x.work); x.travel = r2(x.travel); x.exp = r2(x.exp); x.abs = r2(x.abs); x.mil = r2(x.km / 10); });
  return days;
}
let tplCache = null;
async function getTemplate(){
  if (!tplCache) { const r = await fetch("tidrapport-mall.xlsx"); if (!r.ok) throw new Error("mall"); tplCache = await r.arrayBuffer(); }
  return tplCache;
}
async function buildXlsx(profile, ym, items){
  const zip = await JSZip.loadAsync(await getTemplate());
  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace("spreadsheetml.template.main+xml", "spreadsheetml.sheet.main+xml").replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, "");
  zip.file("[Content_Types].xml", ct); zip.remove("xl/calcChain.xml");
  let rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, ""));
  let wb = await zip.file("xl/workbook.xml").async("string");
  zip.file("xl/workbook.xml", wb.replace(/<calcPr([^>]*?)\/>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`));

  const xml = (await zip.file("xl/worksheets/sheet1.xml").async("string")).replace('width="25.7265625"', 'width="52"');
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const NS = doc.documentElement.namespaceURI;
  const sheetData = doc.getElementsByTagNameNS(NS, "sheetData")[0];
  const colNum = (ref) => { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n*26 + ch.charCodeAt(0) - 64; return n; };
  function getRow(r){
    for (const row of sheetData.getElementsByTagNameNS(NS, "row")) {
      const n = +row.getAttribute("r"); if (n === r) return row;
      if (n > r) { const nr = doc.createElementNS(NS, "row"); nr.setAttribute("r", r); sheetData.insertBefore(nr, row); return nr; }
    }
    const nr = doc.createElementNS(NS, "row"); nr.setAttribute("r", r); sheetData.appendChild(nr); return nr;
  }
  function cell(ref){
    const row = getRow(+ref.match(/\d+/)[0]);
    for (const c of row.getElementsByTagNameNS(NS, "c")) {
      if (c.getAttribute("r") === ref) return c;
      if (colNum(c.getAttribute("r")) > colNum(ref)) { const nc = doc.createElementNS(NS, "c"); nc.setAttribute("r", ref); row.insertBefore(nc, c); return nc; }
    }
    const nc = doc.createElementNS(NS, "c"); nc.setAttribute("r", ref); row.appendChild(nc); return nc;
  }
  const clear = (c) => { while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute("t"); };
  // Text skrivs som inlineStr – Excel tolkar den aldrig som formel, även om den börjar med "=".
  function setStr(ref, v, style){ const c = cell(ref); clear(c); if (style != null) c.setAttribute("s", style); if (!v) return; c.setAttribute("t", "inlineStr"); const is = doc.createElementNS(NS, "is"), t = doc.createElementNS(NS, "t"); t.setAttribute("xml:space", "preserve"); t.textContent = String(v).slice(0, 1000); is.appendChild(t); c.appendChild(is); }
  function setNum(ref, v, style){ const c = cell(ref); clear(c); if (style != null) c.setAttribute("s", style); if (!v) return; const e = doc.createElementNS(NS, "v"); e.textContent = String(v); c.appendChild(e); }
  function setF(ref, f, v, style){ const c = cell(ref); clear(c); if (style != null) c.setAttribute("s", style); const fe = doc.createElementNS(NS, "f"); fe.textContent = f; const ve = doc.createElementNS(NS, "v"); ve.textContent = String(v || 0); c.append(fe, ve); }

  setStr("D5", profile.name + (profile.empNo ? `  (anst.nr ${profile.empNo})` : ""));
  setStr("D6", MONTHS[+ym.slice(5,7) - 1]); setNum("G6", +ym.slice(0,4));
  setStr("I9", "Mil", 5);
  const t = totals(items), dim = daysIn(ym);
  dayRows(items).forEach((x) => {
    const r = 9 + x.d;
    setStr("D" + r, x.d > dim ? "" : x.desc.join("; "));
    setNum("E" + r, x.work); setNum("F" + r, x.travel); setNum("G" + r, x.exp); setNum("H" + r, x.abs); setNum("I" + r, x.mil, 10);
  });
  setF("E41", "SUM(E10:E40)", t.work); setF("F41", "SUM(F10:F40)", t.travel); setF("G41", "SUM(G10:G40)", t.expPrivate);
  setF("H41", "SUM(H10:H40)", t.absence); setF("I41", "SUM(I10:I40)", r2(t.km/10), 11);
  const byVeh = {}; for (const it of items) if (it.type === "travel" && it.km) byVeh[it.vehicle] = (byVeh[it.vehicle] || 0) + it.km;
  let row = 43;
  setStr("D" + row, "Sammanställning", 1); row++;
  setStr("D" + row, "Utlägg att ersätta (privat betalda)"); setF("G" + row, "G41", t.expPrivate, 8); row++;
  for (const [k, km] of Object.entries(byVeh)) { const rate = rateFor(k); if (!rate) continue;
    setStr("D" + row, `Milersättning ${VEH_LABEL[k].toLowerCase()}: ${fmtN(km/10, 1)} mil × ${fmtN(rate)} kr`); setNum("G" + row, r2(km/10*rate), 8); row++; }
  setStr("D" + row, "Totalt att utbetala (utlägg + milersättning)"); setF("G" + row, `SUM(G44:G${row-1})`, r2(t.expPrivate + t.mileAmt), 8); row++;
  if (t.vatPrivate) { setStr("D" + row, "Varav ingående moms, utlägg att ersätta"); setNum("G" + row, t.vatPrivate, 8); row++; }
  for (const [k, hrs] of Object.entries(t.absByKind)) { setStr("D" + row, `Frånvaro – ${k}`); setNum("H" + row, r2(hrs)); row++; }
  if (t.expPrivate) { setStr("D" + row, "Kvitton redovisas separat i kvittoredovisningen."); row++; }
  setStr("D" + (row + 1), `Attesterande chef: ${profile.chefMail}`);

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith("<?xml")) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  zip.file("xl/worksheets/sheet1.xml", out);
  return zip.generateAsync({type:"blob", compression:"DEFLATE", compressionOptions:{level:6}, mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

function blobToDataUrl(blob){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
function imgSize(src){ return new Promise((res) => { const i = new Image(); i.onload = () => res({w:i.naturalWidth, h:i.naturalHeight}); i.onerror = () => res(null); i.src = src; }); }
let logoCache;
async function getLogo(){
  if (logoCache === undefined) {
    try { const r = await fetch("icons/logo.png"); const d = await blobToDataUrl(await r.blob()); logoCache = {d, s: await imgSize(d)}; }
    catch (e) { logoCache = null; }
  }
  return logoCache;
}
/* Gemensam sidmall för PDF:erna: logotyp, rubrik, anställd och sammanfattningsruta. */
const PDF_C = {INK:[30,58,74], ACC:[48,87,110], MUTED:[100,115,122], LINE:[210,220,224], WARN:[154,85,18]};
async function pdfStart(title, subtitle, profile, summary){
  const {jsPDF} = window.jspdf; const pdf = new jsPDF({unit:"mm", format:"a4", compress:true});
  const W = 210, M = 16, C = PDF_C;
  const ctx = {pdf, W, M, y: M};
  ctx.pageBreak = (need) => { if (ctx.y + need > 297 - M) { pdf.addPage(); ctx.y = M; return true; } return false; };
  ctx.sect = (t) => { ctx.y += 8; ctx.pageBreak(20); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(...C.INK); pdf.text(t, M, ctx.y); pdf.setFont("helvetica", "normal"); ctx.y += 6; pdf.setFontSize(8.5); };
  const logo = await getLogo();
  try { if (logo && logo.s) pdf.addImage(logo.d, "PNG", W - M - 38, M - 4, 38, 38 * logo.s.h / logo.s.w, "logo", "FAST"); } catch (x) { /* logotypen är valfri */ }
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.setTextColor(...C.INK); pdf.text(title, M, ctx.y + 4);
  pdf.setFontSize(11); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...C.MUTED);
  pdf.text([subtitle, S.cfg.foretag].filter(Boolean).join("  ·  "), M, ctx.y + 11);
  ctx.y += 20; pdf.setTextColor(...C.INK); pdf.setFontSize(10);
  pdf.text(`Anställd: ${profile.name}${profile.empNo ? `   Anst.nr: ${profile.empNo}` : ""}`, M, ctx.y); ctx.y += 5;
  pdf.setTextColor(...C.MUTED); pdf.text(`Attesterande chef: ${profile.chefMail}`, M, ctx.y); ctx.y += 7;
  pdf.setFillColor(238, 243, 245); pdf.rect(M, ctx.y, W - 2*M, 26, "F");
  summary.forEach(([k, v], i) => { const cx = M + 4 + (i % 3) * ((W - 2*M) / 3), cy = ctx.y + 7 + Math.floor(i / 3) * 11;
    pdf.setFontSize(8); pdf.setTextColor(...C.MUTED); pdf.text(k.toUpperCase(), cx, cy);
    pdf.setFontSize(11); pdf.setTextColor(...C.INK); pdf.setFont("helvetica", "bold"); pdf.text(v, cx, cy + 5); pdf.setFont("helvetica", "normal"); });
  ctx.y += 34;
  return ctx;
}
function pdfTable(ctx, cols, rows){
  const {pdf, W, M} = ctx, C = PDF_C;
  const head = () => { pdf.setFillColor(...C.ACC); pdf.rect(M, ctx.y, W - 2*M, 7, "F"); pdf.setTextColor(255, 255, 255); pdf.setFontSize(8.5); pdf.setFont("helvetica", "bold");
    let x = M; cols.forEach((c) => { pdf.text(c.h, c.r ? x + c.w - 2 : x + 2, ctx.y + 4.8, {align: c.r ? "right" : "left"}); x += c.w; }); pdf.setFont("helvetica", "normal"); ctx.y += 7; };
  head(); pdf.setFontSize(8.5);
  for (const row of rows) {
    const cells = row.cells.map((v, i) => cols[i].wrap ? pdf.splitTextToSize(String(v || "–"), cols[i].w - 4) : String(v));
    const n = Math.max(1, ...cells.map((c) => Array.isArray(c) ? c.length : 1)), rh = Math.max(6, n * 3.8 + 2.4);
    if (ctx.pageBreak(rh)) { head(); pdf.setFontSize(8.5); }
    let x = M;
    cells.forEach((v, i) => { pdf.setTextColor(...(row.warn === i ? C.WARN : C.INK)); pdf.text(v, cols[i].r ? x + cols[i].w - 2 : x + 2, ctx.y + 4.2, {align: cols[i].r ? "right" : "left"}); x += cols[i].w; });
    ctx.y += rh; pdf.setDrawColor(...C.LINE); pdf.line(M, ctx.y, W - M, ctx.y);
  }
}
function pdfSignatures(ctx, right){
  const {pdf, W, M} = ctx;
  ctx.y += 14; ctx.pageBreak(24); pdf.setDrawColor(...PDF_C.MUTED);
  pdf.line(M, ctx.y, M + 70, ctx.y); pdf.line(W - M - 70, ctx.y, W - M, ctx.y); pdf.setFontSize(8); pdf.setTextColor(...PDF_C.MUTED);
  pdf.text("Anställd, underskrift och datum", M, ctx.y + 4); pdf.text(right, W - M - 70, ctx.y + 4);
}

/* Tidrapportens PDF till chefen: tid, resor, frånvaro och utlägg som ska ersättas – inga kvittobilder, inget företagskort. */
async function buildPdf(profile, ym, items){
  const t = totals(items), sorted = sortItems(items);
  const ctx = await pdfStart("Tidrapport", ymLabel(ym), profile, [["Närvaro", fmtH(t.work)], ["Restid", fmtH(t.travel)], ["Frånvaro", fmtH(t.absence)],
    ["Utlägg att ersätta", fmtKr(t.expPrivate)], ["Milersättning", `${fmtKr(t.mileAmt)} (${fmtN(t.km/10, 1)} mil)`], ["Totalt att utbetala", fmtKr(r2(t.expPrivate + t.mileAmt))]]);
  pdfTable(ctx, [{h:"Datum", w:18}, {h:"Beskrivning", w:76, wrap:1}, {h:"Närvaro", w:17, r:1}, {h:"Restid", w:15, r:1}, {h:"Utlägg", w:24, r:1}, {h:"Frånvaro", w:17, r:1}, {h:"Mil", w:11, r:1}],
    dayRows(items).filter((d) => d.desc.length || d.work || d.travel || d.exp || d.abs || d.mil).map((x) => ({cells: [
      `${x.d} ${weekday(`${ym}-${pad(x.d)}`)}`, x.desc.join("; "), x.work ? fmtN(x.work) : "", x.travel ? fmtN(x.travel) : "", x.exp ? fmtKr(x.exp) : "", x.abs ? fmtN(x.abs) : "", x.mil ? fmtN(x.mil, 1) : ""]})));
  const exps = sorted.filter(isPrivateExpense);
  if (exps.length) {
    ctx.sect("Utlägg att ersätta (privat kort/kontant)");
    pdfTable(ctx, [{h:"Datum", w:22}, {h:"Beskrivning", w:66, wrap:1}, {h:"Kategori", w:30, wrap:1}, {h:"Kvitto", w:16}, {h:"Moms", w:22, r:1}, {h:"Belopp", w:22, r:1}],
      exps.map((e) => ({cells: [e.date, e.desc, e.category, e.receiptId ? "finns" : "saknas", fmtKr(e.vat), fmtKr(e.amount)], warn: e.receiptId ? -1 : 3})));
    ctx.y += 4; ctx.pageBreak(6); ctx.pdf.setFontSize(8.5); ctx.pdf.setTextColor(...PDF_C.MUTED);
    ctx.pdf.text("Kvittona redovisas separat i kvittoredovisningen.", ctx.M, ctx.y + 2); ctx.y += 4;
  }
  const trs = sorted.filter((i) => i.type === "travel" && i.km);
  if (trs.length) {
    ctx.sect("Körjournal");
    pdfTable(ctx, [{h:"Datum", w:22}, {h:"Resa", w:84, wrap:1}, {h:"Km", w:16, r:1}, {h:"Fordon", w:30}, {h:"Ersättning", w:26, r:1}],
      trs.map((tr) => ({cells: [tr.date, tr.desc, fmtN(tr.km, 1), VEH_LABEL[tr.vehicle], rateFor(tr.vehicle) ? fmtKr(r2(tr.km/10*rateFor(tr.vehicle))) : "–"]})));
  }
  pdfSignatures(ctx, "Attest chef");
  return ctx.pdf.output("blob");
}

/* Utläggsunderlag till lönekontoret (PDF): privata utlägg och milersättning. */
async function buildLonPdf(profile, ym, items){
  const t = totals(items), sorted = sortItems(items), exps = sorted.filter(isPrivateExpense), trs = sorted.filter((i) => i.type === "travel" && i.km && rateFor(i.vehicle));
  const ctx = await pdfStart("Utlägg och milersättning", ymLabel(ym), profile, [["Utlägg, privat kort/kontant", fmtKr(t.expPrivate)], ["Antal utlägg", String(exps.length)], ["Varav moms", fmtKr(t.vatPrivate)],
    ["Milersättning", fmtKr(t.mileAmt)], ["Körda mil", fmtN(t.km/10, 1)], ["Totalt att utbetala", fmtKr(r2(t.expPrivate + t.mileAmt))]]);
  if (exps.length) {
    ctx.sect("Utlägg att ersätta (privat kort/kontant)");
    pdfTable(ctx, [{h:"Datum", w:22}, {h:"Beskrivning", w:66, wrap:1}, {h:"Kategori", w:30, wrap:1}, {h:"Kvitto", w:16}, {h:"Moms", w:22, r:1}, {h:"Belopp", w:22, r:1}],
      exps.map((e) => ({cells: [e.date, e.desc, e.category, e.receiptId ? "finns" : "saknas", fmtKr(e.vat), fmtKr(e.amount)], warn: e.receiptId ? -1 : 3})));
  }
  if (trs.length) {
    ctx.sect("Milersättning");
    pdfTable(ctx, [{h:"Datum", w:22}, {h:"Resa", w:70, wrap:1}, {h:"Km", w:16, r:1}, {h:"Fordon", w:28}, {h:"Kr/mil", w:16, r:1}, {h:"Ersättning", w:26, r:1}],
      trs.map((tr) => ({cells: [tr.date, tr.desc, fmtN(tr.km, 1), VEH_LABEL[tr.vehicle], fmtN(rateFor(tr.vehicle)), fmtKr(r2(tr.km/10*rateFor(tr.vehicle)))]})));
  }
  ctx.y += 4; ctx.pageBreak(10); ctx.pdf.setFontSize(8.5); ctx.pdf.setTextColor(...PDF_C.MUTED);
  const sc = S.months[ym]?.sentChef;
  ctx.pdf.text(sc ? `Skickad till ${profile.chefMail} för attest ${fmtDate(sc)}.` : `Attesteras av ${profile.chefMail}.`, ctx.M, ctx.y + 2); ctx.y += 5;
  if (exps.length) { ctx.pdf.text("Kvittona redovisas separat i kvittoredovisningen.", ctx.M, ctx.y + 2); ctx.y += 4; }
  pdfSignatures(ctx, "Attest chef");
  return ctx.pdf.output("blob");
}

/* Utläggsunderlag till lönekontoret (Excel): en enkel lista för registrering i lönesystemet.
   Byggs från grunden med textceller (inlineStr), så att inget kan tolkas som formel. */
async function buildLonXlsx(profile, ym, items){
  const xe = (v) => String(v).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const col = (i) => String.fromCharCode(65 + i);
  const rows = [];
  const add = (cells, style) => rows.push({cells, style});
  const t = totals(items), sorted = sortItems(items);
  add(["Utlägg och milersättning"], 1);
  add(["Anställd", profile.name]); add(["Anställningsnummer", profile.empNo || ""]); add(["Period", ymLabel(ym)]);
  add(["Attesterande chef", profile.chefMail]); add(["Företag", S.cfg.foretag || ""]); add([]);
  add(["Datum", "Typ", "Beskrivning", "Kategori / fordon", "Km", "Moms (kr)", "Belopp (kr)"], 1);
  for (const e of sorted.filter(isPrivateExpense)) add([e.date, "Utlägg", e.desc, e.category, null, e.vat, e.amount]);
  for (const tr of sorted.filter((i) => i.type === "travel" && i.km && rateFor(i.vehicle)))
    add([tr.date, "Milersättning", tr.desc, `${VEH_LABEL[tr.vehicle]} (${fmtN(rateFor(tr.vehicle))} kr/mil)`, tr.km, null, r2(tr.km/10*rateFor(tr.vehicle))]);
  add([]);
  add(["Summa utlägg", null, null, null, null, t.vatPrivate, t.expPrivate], 3);
  add(["Summa milersättning", null, null, null, t.km, null, t.mileAmt], 3);
  add(["Totalt att utbetala", null, null, null, null, null, r2(t.expPrivate + t.mileAmt)], 3);
  const sheetRows = rows.map((r, ri) => `<row r="${ri+1}">` + r.cells.map((v, ci) => {
    if (v == null || v === "") return "";
    const ref = col(ci) + (ri + 1), bold = r.style === 1 || r.style === 3;
    if (typeof v === "number") return `<c r="${ref}" s="${bold ? 3 : 2}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${xe(String(v).slice(0, 1000))}</t></is></c>`;
  }).join("") + "</row>").join("");
  const z = new JSZip();
  z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Utlägg" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="4" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>');
  z.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="15" customWidth="1"/><col min="3" max="3" width="42" customWidth="1"/><col min="4" max="4" width="28" customWidth="1"/><col min="5" max="5" width="9" customWidth="1"/><col min="6" max="7" width="13" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`);
  return z.generateAsync({type:"blob", compression:"DEFLATE", mimeType: XLSX_TYPE});
}

/* Kvittoredovisningens PDF: översikt över alla utlägg i perioden, därefter ett kvitto per sida med
   datum, beskrivning, kategori, belopp inkl. moms, moms i % och kvittobilden. PDF-kvitton läggs in direkt efter sin uppgiftssida. */
async function buildKvittoPdf(profile, from, to, exps){
  const priv = r2(exps.filter((e) => e.payment !== "company").reduce((s, e) => s + e.amount, 0));
  const comp = r2(exps.filter((e) => e.payment === "company").reduce((s, e) => s + e.amount, 0));
  const vat = r2(exps.reduce((s, e) => s + e.vat, 0));
  // Läs in kvittona först, så att översikten kan säga exakt hur varje kvitto redovisas.
  const recs = [];
  for (const e of exps) {
    // Ett kvitto som inte går att läsa får aldrig stoppa hela redovisningen – det markeras i stället.
    let r = null, kind = "missing", src = null, img = null;
    if (e.receiptId) {
      try {
        r = await getReceipt(e.receiptId);
        if (!r) kind = "missing";
        else if (r.kind === "pdf") {
          kind = "badpdf";
          if (window.PDFLib && await sniff(r.blob) === "application/pdf") {
            try { src = await PDFLib.PDFDocument.load(await r.blob.arrayBuffer(), {updateMetadata:false}); if (src.getPageCount()) kind = "pdf"; } catch (x) { src = null; }
          }
        } else {
          kind = "error";
          // Bilder som inte redan är JPEG kodas om, så att PDF:en alltid kan bädda in dem.
          const jpeg = await sniff(r.blob) === "image/jpeg" ? r.blob : await compressImage(r.blob);
          const data = await blobToDataUrl(jpeg), sz = await imgSize(data);
          if (sz && data.startsWith("data:image/jpeg")) { kind = "image"; img = {data, sz}; }
        }
      } catch (x) { console.warn("Kvitto kunde inte läsas", e.id, x); kind = "error"; }
    }
    recs.push({e, r, kind, src, img});
  }
  const missing = recs.filter((x) => x.kind === "missing").length;
  const ctx = await pdfStart("Kvittoredovisning", `${from} – ${to}`, profile, [["Antal kvitton", String(exps.length)], ["Privat betalt, att ersätta", fmtKr(priv)], ["Företagskort", fmtKr(comp)],
    ["Varav moms", fmtKr(vat)], ["Kvitto saknas", String(missing)], ["Totalt inkl. moms", fmtKr(r2(priv + comp))]]);
  const {pdf, W, M} = ctx, C = PDF_C, extra = [], inserts = [];
  const status = {image: "foto", pdf: "PDF", badpdf: "separat fil", missing: "saknas", error: "ej läsbart"};
  pdfTable(ctx, [{h:"Nr", w:9}, {h:"Datum", w:21}, {h:"Beskrivning", w:52, wrap:1}, {h:"Kategori", w:27, wrap:1}, {h:"Betalt", w:16}, {h:"Moms", w:12, r:1}, {h:"Inkl. moms", w:24, r:1}, {h:"Kvitto", w:17}],
    recs.map((x, i) => ({cells: [String(i+1), x.e.date, x.e.desc, x.e.category, x.e.payment === "company" ? "Ftg-kort" : "Privat", `${x.e.vatRate} %`, fmtAmt(x.e.amount), status[x.kind]], warn: (x.kind === "missing" || x.kind === "error") ? 7 : -1})));
  pdfSignatures(ctx, "Attest");

  for (let i = 0; i < recs.length; i++) {
    const {e, kind, src, img, r} = recs[i];
    pdf.addPage(); let y = M;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.setTextColor(...C.INK); pdf.text(`Kvitto ${i+1} av ${recs.length}`, M, y + 4);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...C.MUTED); pdf.text(`${profile.name} · Kvittoredovisning ${from} – ${to}`, W - M, y + 4, {align:"right"});
    y += 10;
    // Uppgiftsruta
    const fields = [["Datum", e.date], ["Kategori", e.category], ["Betalt med", e.payment === "company" ? "Företagskort" : "Privat kort/kontant"],
      ["Belopp inkl. moms", fmtKr(e.amount)], ["Moms", `${e.vatRate} %  (${fmtKr(e.vat)})`], ["Belopp exkl. moms", fmtKr(r2(e.amount - e.vat))]];
    const descLines = pdf.splitTextToSize(e.desc || "–", W - 2*M - 8).slice(0, 3);
    const boxH = 12 + descLines.length * 4.5 + 22;
    pdf.setFillColor(238, 243, 245); pdf.rect(M, y, W - 2*M, boxH, "F");
    pdf.setFontSize(8); pdf.setTextColor(...C.MUTED); pdf.text("BESKRIVNING", M + 4, y + 6);
    pdf.setFontSize(11); pdf.setTextColor(...C.INK); pdf.setFont("helvetica", "bold"); pdf.text(descLines, M + 4, y + 11.5); pdf.setFont("helvetica", "normal");
    const fy = y + 12 + descLines.length * 4.5 + 3;
    fields.forEach(([k, v], j) => { const cx = M + 4 + (j % 3) * ((W - 2*M) / 3), cy = fy + Math.floor(j / 3) * 10;
      pdf.setFontSize(8); pdf.setTextColor(...C.MUTED); pdf.text(k.toUpperCase(), cx, cy);
      pdf.setFontSize(10.5); pdf.setTextColor(...C.INK); pdf.text(v, cx, cy + 4.5); });
    y += boxH + 6;
    const areaH = 297 - M - y;
    if (kind === "image") {
      const sc = Math.min((W - 2*M) / img.sz.w, areaH / img.sz.h), w = img.sz.w * sc, hgt = img.sz.h * sc;
      pdf.addImage(img.data, "JPEG", M + (W - 2*M - w) / 2, y, w, hgt, `kv${i}`, "FAST");
    } else if (kind === "pdf") {
      pdf.setFontSize(10); pdf.setTextColor(...C.MUTED);
      pdf.text(`Kvittot är en PDF-fil på ${src.getPageCount()} ${src.getPageCount() > 1 ? "sidor" : "sida"} och följer direkt efter den här sidan.`, M, y + 4);
      inserts.push({at: pdf.getNumberOfPages(), src});
    } else {
      pdf.setDrawColor(...C.WARN); pdf.setLineDashPattern([2, 2], 0); pdf.rect(M, y, W - 2*M, 40); pdf.setLineDashPattern([], 0);
      pdf.setFontSize(12); pdf.setTextColor(...C.WARN); pdf.setFont("helvetica", "bold");
      pdf.text({badpdf: "Kvittot bifogas som separat PDF-fil", error: "Kvittobilden kunde inte läsas – fotografera kvittot på nytt", missing: "Kvitto saknas"}[kind], W / 2, y + 22, {align:"center"}); pdf.setFont("helvetica", "normal");
      if (kind === "badpdf" && r) extra.push({name: `Kvitto_${pad(i+1)}_${e.date}_${slug(e.desc)}.pdf`, type:"application/pdf", blob: r.blob});
    }
  }
  let bytes = pdf.output("arraybuffer");
  if (inserts.length && window.PDFLib) {
    const doc = await PDFLib.PDFDocument.load(bytes);
    let offset = 0;
    for (const ins of inserts) {
      const pages = await doc.copyPages(ins.src, ins.src.getPageIndices());
      pages.forEach((pg, k) => doc.insertPage(ins.at + offset + k, pg));
      offset += pages.length;
    }
    bytes = await doc.save();
  }
  return {pdf: new Blob([bytes], {type:"application/pdf"}), extra};
}

/* ---------- säkerhetskopia ---------- */
async function saveBackup(){
  try {
    const [items, receipts, meta] = await Promise.all([DB.all("items"), DB.all("receipts"), DB.all("meta")]);
    const rec = [];
    for (const raw of receipts) { const r = await getReceipt(raw.id); if (r) rec.push({id:r.id, kind:r.kind, name:r.name, createdAt:r.createdAt, data: (await blobB64(r.blob)).replace(/\r\n/g, "")}); }
    const data = {app:"tidrapport", format:1, exportedAt: new Date().toISOString(),
      profile: S.profile, items, receipts: rec, months: meta.filter((m) => /^month:\d{4}-\d{2}$/.test(m.key)), kvittoSent: meta.find((m) => m.key === "kvittoSent")?.value || null};
    downloadBlob(new Blob([JSON.stringify(data)], {type:"application/json"}), `Tidrapport_sakerhetskopia_${todayStr()}.json`);
    toast("Säkerhetskopian är sparad");
  } catch (e) { toast("Kunde inte skapa säkerhetskopian."); }
}
function b64ToBlob(s, type){
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length > MAX_RECEIPT_BYTES * 1.4) return null;
  const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], {type});
}
async function restoreBackup(e){
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (f.size > MAX_BACKUP_BYTES) { toast("Filen är för stor för att vara en säkerhetskopia."); return; }
  let data;
  try { data = JSON.parse(await f.text()); } catch (x) { toast("Filen är ingen giltig säkerhetskopia."); return; }
  if (!data || data.app !== "tidrapport" || data.format !== 1 || !Array.isArray(data.items)) { toast("Filen är ingen säkerhetskopia från den här appen."); return; }
  let added = 0, updated = 0, skipped = 0;
  try {
    const recIds = new Set();
    for (const r of (Array.isArray(data.receipts) ? data.receipts : [])) {
      if (!r || !ID_RE.test(String(r.id)) || !["image","pdf"].includes(r.kind)) { skipped++; continue; }
      if (await DB.get("receipts", r.id)) { recIds.add(r.id); continue; }
      const type = r.kind === "pdf" ? "application/pdf" : "image/jpeg";
      const blob = b64ToBlob(r.data, type);
      if (!blob || blob.size > MAX_RECEIPT_BYTES || await sniff(blob) !== type) { skipped++; continue; }
      await putReceipt({id:r.id, kind:r.kind, type, name: clean(r.name, 80) || "kvitto", blob, createdAt: num(r.createdAt, 0, 1e14) ?? Date.now()});
      recIds.add(r.id);
    }
    for (const raw of data.items) {
      const it = sanitizeItem(raw); if (!it) { skipped++; continue; }
      if (it.receiptId && !recIds.has(it.receiptId) && !(await DB.get("receipts", it.receiptId))) it.receiptId = null;
      const cur = await DB.get("items", it.id);
      if (!cur) { await DB.put("items", it); added++; }
      else if (it.updatedAt > (cur.updatedAt || 0)) { await DB.put("items", it); updated++; }
    }
    for (const m of (Array.isArray(data.months) ? data.months : [])) {
      if (!m || !/^month:\d{4}-\d{2}$/.test(m.key) || typeof m.value !== "object" || !m.value) continue;
      const cur = (await DB.get("meta", m.key))?.value || {}, v = {};
      for (const k of ["sentChef","sentLon","changedAt"]) { const a = num(cur[k], 0, 1e14) || 0, b = num(m.value[k], 0, 1e14) || 0; if (a || b) v[k] = Math.max(a, b); }
      await DB.put("meta", {key:m.key, value:v});
    }
    if (data.kvittoSent && typeof data.kvittoSent === "object" && data.kvittoSent.ids && typeof data.kvittoSent.ids === "object") {
      const cur = await getKvittoSent();
      for (const [id, ts] of Object.entries(data.kvittoSent.ids)) { const n = num(ts, 0, 1e14); if (ID_RE.test(id) && n) cur.ids[id] = Math.max(cur.ids[id] || 0, n); }
      const l = data.kvittoSent.last, la = l && num(l.at, 0, 1e14);
      if (la && isValidDate(String(l.from)) && isValidDate(String(l.to)) && (!cur.last || la > cur.last.at)) cur.last = {from: l.from, to: l.to, at: la};
      await DB.put("meta", {key:"kvittoSent", value: cur});
    }
    if (!profileComplete() && data.profile) {
      const p = sanitizeProfile({...data.profile, ...Object.fromEntries(Object.entries(S.profile || {}).filter(([, v]) => v))});
      S.profile = p; await DB.put("meta", {key:"profile", value:p});
    }
  } catch (x) { toast("Inläsningen avbröts. Det som hann läsas in är sparat."); }
  toast(`Inläst: ${added} nya, ${updated} uppdaterade${skipped ? `, ${skipped} ogiltiga hoppades över` : ""}.`);
  S.months = {};
  if (profileComplete()) showMain(); else showSetup();
}
async function wipeAll(){
  const b = $("wipeBtn");
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Klicka igen för att radera allt"; setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "Radera all data"; } }, 5000); return; }
  try { await DB.wipe(); } catch (e) { toast("Kunde inte radera."); return; }
  S.profile = null; S.items = []; S.months = {};
  toast("All data är raderad från enheten"); showSetup();
}
})();
