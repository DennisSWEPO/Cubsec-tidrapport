/* Tidrapport & utlägg – fristående webbapp.
   All data sparas lokalt i webbläsarens IndexedDB på användarens enhet.
   Appen gör inga nätverksanrop utöver att läsa sina egna filer (config.json, mallen). */
"use strict";
(() => {
const APP_VERSION = "1.0.0";
const MONTHS = ["Januari","Februari","Mars","April","Maj","Juni","Juli","Augusti","September","Oktober","November","December"];
const TYPES = ["work","travel","expense","absence"];
const TYPE_LABEL = {work:"Arbete", travel:"Resa", expense:"Utlägg", absence:"Frånvaro"};
const VEHICLES = ["own","benefit","benefit_el","none"];
const VEH_LABEL = {own:"Egen bil", benefit:"Förmånsbil", benefit_el:"Förmånsbil el", none:"Ingen bil"};
const CATS = ["Måltid","Representation","Hotell/logi","Tåg/flyg/taxi","Parkering","Drivmedel","Kontorsmaterial","Programvara","Övrigt"];
const KINDS = ["Semester","Sjukdom","VAB","Föräldraledighet","Tjänstledighet","Kompledighet","Övrigt"];
const VAT_RATES = [25,12,6,0];
const PAYMENTS = ["private","company"];
const DEFAULT_CFG = {foretag:"", lonekontorTidrapport:"", lonekontorLonefragor:"", rateOwn:25, rateBenefit:12, rateBenefitEl:9.5};
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const $ = (id) => document.getElementById(id);
const S = {cfg:{...DEFAULT_CFG}, cfgLon:false, profile:null, ym:null, items:[], months:{}, type:"work",
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
  const t = {work:0, travel:0, absence:0, expPrivate:0, expCompany:0, vat:0, km:0, mileAmt:0, absByKind:{}};
  for (const it of items) {
    if (it.type === "work") t.work += it.hours;
    else if (it.type === "travel") { t.travel += it.travelHours; t.km += it.km; t.mileAmt += it.km / 10 * rateFor(it.vehicle); }
    else if (it.type === "absence") { t.absence += it.hours; t.absByKind[it.kind] = (t.absByKind[it.kind] || 0) + it.hours; }
    else if (it.type === "expense") { if (it.payment === "company") t.expCompany += it.amount; else t.expPrivate += it.amount; t.vat += it.vat; }
  }
  for (const k of ["work","travel","absence","expPrivate","expCompany","vat","km","mileAmt"]) t[k] = r2(t[k]);
  return t;
}
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
  return {name: clean(raw.name, 80), empNo: clean(raw.empNo, 30), chefMail: mail(raw.chefMail), lonTid: mail(raw.lonTid), lonFragor: mail(raw.lonFragor)};
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
  S.profile = (await DB.get("meta", "profile"))?.value || null;
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
  S.cfg = {foretag: clean(raw.foretag, 80), lonekontorTidrapport: mail(raw.lonekontorTidrapport), lonekontorLonefragor: mail(raw.lonekontorLonefragor),
    rateOwn: rate(ms.egenBil, 25), rateBenefit: rate(ms.formansbil, 12), rateBenefitEl: rate(ms.formansbilEl, 9.5)};
  S.cfgLon = !!(S.cfg.lonekontorTidrapport || S.cfg.lonekontorLonefragor);
}
const lonTid = () => S.cfg.lonekontorTidrapport || S.profile?.lonTid || "";
const lonFragor = () => S.cfg.lonekontorLonefragor || S.profile?.lonFragor || "";
const profileComplete = () => !!(S.profile && S.profile.name && isEmail(S.profile.chefMail) && (lonTid() || lonFragor()));

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
  $("su-lon").hidden = S.cfgLon;
  $("su-lontid").value = p.lonTid || ""; $("su-lonfr").value = p.lonFragor || "";
  $("who").textContent = S.cfg.foretag;
  showView("setup");
}
function showMain(){ renderWho(); renderMonthLabel(); resetForm(); showView("main"); loadMonth(); }
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
    lonTid: S.cfgLon ? (S.profile?.lonTid || "") : g("lontid").value, lonFragor: S.cfgLon ? (S.profile?.lonFragor || "") : g("lonfr").value};
  const err = [];
  if (!clean(raw.name, 80)) err.push("Fyll i ditt namn.");
  if (!isEmail(clean(raw.chefMail, 254).toLowerCase())) err.push("Fyll i chefens e-postadress, t.ex. namn@foretag.se.");
  if (!S.cfgLon) {
    for (const [v, label] of [[raw.lonTid, "tidrapporter"], [raw.lonFragor, "lönefrågor"]])
      if (clean(v, 254) && !isEmail(clean(v, 254).toLowerCase())) err.push(`E-postadressen för ${label} ser inte rätt ut.`);
    if (!clean(raw.lonTid, 254) && !clean(raw.lonFragor, 254)) err.push("Fyll i minst en e-postadress till lönekontoret.");
  }
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
  $("p-lontid").value = lonTid(); $("p-lonfr").value = lonFragor();
  $("p-lontid").readOnly = $("p-lonfr").readOnly = S.cfgLon; $("lonHint").hidden = !S.cfgLon;
  $("profileErr").hidden = true; delete $("wipeBtn").dataset.armed; $("wipeBtn").textContent = "Radera all data";
  showView("settings");
}

/* ---------- månad ---------- */
function changeMonth(d){ S.ym = shiftYm(S.ym, d); renderMonthLabel(); resetForm(); loadMonth(); }
function renderMonthLabel(){ $("monthLabel").textContent = ymLabel(S.ym); }
async function loadMonth(){
  const ym = S.ym;
  const [items, meta] = await Promise.all([DB.byMonth(ym), DB.get("meta", "month:" + ym)]);
  if (ym !== S.ym) return;
  S.items = items.map(sanitizeItem).filter(Boolean);
  S.months[ym] = meta?.value || {};
  render();
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
  const r = await DB.get("receipts", rid);
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
        await DB.put("receipts", {id: rid, kind: S.receipt.kind, type: S.receipt.type, name: S.receipt.name, blob: S.receipt.blob, createdAt: now});
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
    if (it.receiptId) DB.get("receipts", it.receiptId).then((r) => { if (r && S.editId === it.id && S.receipt === undefined) showReceiptPreview(r); });
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
async function openSend(target){
  if (!profileComplete()) { toast("Fyll i dina uppgifter först."); openSettings(); return; }
  if (!S.items.length) { toast(`Det finns inget registrerat för ${ymLabel(S.ym).toLowerCase()}.`); return; }
  const ym = S.ym, items = S.items.slice(), t = totals(items), p = S.profile;
  const to = target === "chef" ? [p.chefMail] : [...new Set([lonTid(), lonFragor()].filter(Boolean))];
  const subject = `Tidrapport ${ymLabel(ym)} – ${p.name}${target === "chef" ? " (för attest)" : ""}`;
  const dlg = $("sendDialog");
  $("sdTitle").textContent = target === "chef" ? "Skicka tidrapport till chef" : "Skicka tidrapport till lönekontoret";
  $("sdTo").replaceChildren(h("span", {class:"addr"}, to.join(", "), h("button", {class:"btn small", type:"button", onclick: () => copyText(to.join(", "))}, "Kopiera")));
  $("sdSubject").textContent = subject;
  $("sdFiles").textContent = "Skapar bilagor…"; $("sdOpts").replaceChildren(); $("sdHelp").textContent = ""; $("sdHelp").classList.remove("manual"); $("sdWarn").hidden = true;
  if (!dlg.open) dlg.showModal();

  let files;
  try { files = await buildAttachments(items, ym); }
  catch (e) { $("sdFiles").textContent = "Kunde inte skapa bilagorna. Ladda om appen och försök igen."; return; }
  if (!dlg.open) return;
  const total = files.reduce((s, f) => s + f.blob.size, 0);
  $("sdFiles").textContent = files.map((f) => f.name).join(", ") + ` (${fmtN(total/1048576, 1)} MB)`;
  if (total > 20 * 1048576) { $("sdWarn").textContent = "Bilagorna är större än 20 MB och kan stoppas av mejlservern. Skicka i så fall kvittona i ett separat mejl."; $("sdWarn").hidden = false; }

  const body = mailBody(target, ym, t, files);
  const markSent = async () => {
    const m = {...(S.months[ym] || {})}; m[target === "chef" ? "sentChef" : "sentLon"] = Date.now();
    S.months[ym] = m; await DB.put("meta", {key:"month:" + ym, value:m}).catch(() => {});
    if (ym === S.ym) renderSendStatus();
  };
  const fileObjs = files.map((f) => new File([f.blob], f.name, {type: f.type}));
  let shareFiles = null;
  if (navigator.canShare) {
    if (navigator.canShare({files: fileObjs})) shareFiles = fileObjs;
    else { const pdfs = fileObjs.filter((f) => f.type === "application/pdf"); if (pdfs.length && navigator.canShare({files: pdfs})) shareFiles = pdfs; }
  }
  const touch = window.matchMedia("(pointer: coarse)").matches;

  const optShare = shareFiles && h("button", {class:"btn " + (touch ? "primary" : ""), type:"button", onclick: async () => {
    try { await navigator.share({files: shareFiles, title: subject, text: body}); await markSent(); toast("Markerad som skickad"); }
    catch (e) { if (e && e.name !== "AbortError") toast("Delningen misslyckades. Prova ett annat alternativ."); }
  }}, "Dela med bilagor (välj e-postappen)");
  const optEml = h("button", {class:"btn " + (!touch || !shareFiles ? "primary" : ""), type:"button", onclick: async () => {
    downloadBlob(await buildEml({to, subject, body, files}), `Tidrapport_${ym}_${slug(p.name)}.eml`); await markSent();
    toast("Utkastet är sparat – öppna filen så öppnas mejlet med bilagor");
  }}, "Skapa mejlutkast med bilagor (Outlook)");
  const optManual = h("button", {class:"btn", type:"button", onclick: () => {
    $("sdHelp").replaceChildren(
      h("span", null, "1. Spara bilagorna:"),
      h("span", {class:"actions"}, files.map((f) => h("button", {class:"btn small", type:"button", onclick: () => downloadBlob(f.blob, f.name)}, f.name))),
      h("span", null, "2. Öppna e-posten och bifoga filerna från Hämtade filer:"),
      h("button", {class:"btn small primary", type:"button", onclick: async () => { location.href = mailtoUrl(to, subject, body); await markSent(); }}, "Öppna e-post"));
    $("sdHelp").classList.add("manual");
  }}, "Öppna e-post och bifoga själv");
  $("sdOpts").replaceChildren(...(touch && optShare ? [optShare, optEml, optManual] : [optEml, optShare, optManual]).filter(Boolean));
  $("sdHelp").textContent = (shareFiles ? "Dela: välj Mail, Outlook eller Gmail och klistra in mottagaren om fältet är tomt. " : "")
    + "Mejlutkast: öppna den sparade .eml-filen, så öppnas ett färdigt mejl i Outlook. Kontrollera och tryck Skicka. "
    + "Fungerar inget av det: välj det sista alternativet och bifoga filerna själv.";
}
function mailBody(target, ym, t, files){
  const p = S.profile, abs = Object.entries(t.absByKind).map(([k, v]) => `${k} ${fmtH(v)}`).join(", ");
  const lines = ["Hej,", "",
    `Här kommer min tidrapport för ${ymLabel(ym).toLowerCase()}${target === "chef" ? " för attest" : ""}.`, "",
    `Närvaro: ${fmtH(t.work)}`, `Restid: ${fmtH(t.travel)}`, `Frånvaro: ${fmtH(t.absence)}${abs ? ` (${abs})` : ""}`,
    `Utlägg att ersätta: ${fmtKr(t.expPrivate)}`, `Milersättning: ${fmtKr(t.mileAmt)} (${fmtN(t.km/10, 1)} mil)`,
    `Totalt att utbetala: ${fmtKr(r2(t.expPrivate + t.mileAmt))}`];
  if (t.expCompany) lines.push(`Kvittoredovisning företagskort: ${fmtKr(t.expCompany)}`);
  if (target === "lon") {
    const sc = S.months[ym]?.sentChef;
    lines.push("", sc ? `Tidrapporten skickades till ${p.chefMail} för attest ${fmtDate(sc)}.` : `Attesterande chef: ${p.chefMail}.`);
  }
  lines.push("", "Bilagor: " + files.map((f) => f.name).join(", "), "", "Med vänliga hälsningar", p.name + (p.empNo ? ` (anst.nr ${p.empNo})` : ""));
  return lines.join("\n");
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
async function buildAttachments(items, ym){
  const p = S.profile, base = `Tidrapport_${ym}_${slug(p.name)}`;
  const xlsx = await buildXlsx(p, ym, items);
  const {pdf, extra} = await buildPdf(p, ym, items);
  return [{name: base + ".xlsx", type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", blob: xlsx},
          {name: base + ".pdf", type:"application/pdf", blob: pdf}, ...extra];
}
function dayRows(items){
  const days = []; for (let d = 1; d <= 31; d++) days.push({d, desc:[], work:0, travel:0, exp:0, abs:0, km:0});
  for (const it of sortItems(items)) {
    const x = days[+it.date.slice(8) - 1];
    if (it.type === "work") { x.work += it.hours; if (it.desc) x.desc.push(it.desc); }
    if (it.type === "travel") { x.travel += it.travelHours; x.km += it.km; x.desc.push(`Resa: ${it.desc}${it.km ? ` (${fmtN(it.km, 1)} km)` : ""}`); }
    if (it.type === "expense") { if (it.payment !== "company") x.exp += it.amount; x.desc.push(`${it.payment === "company" ? "Kvitto (ftg-kort)" : "Utlägg"}: ${it.desc || it.category}`); }
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
  if (t.expCompany) { setStr("D" + row, "Kvittoredovisning företagskort (ej ersättning)"); setNum("G" + row, t.expCompany, 8); row++; }
  if (t.vat) { setStr("D" + row, "Varav ingående moms, alla kvitton"); setNum("G" + row, t.vat, 8); row++; }
  for (const [k, hrs] of Object.entries(t.absByKind)) { setStr("D" + row, `Frånvaro – ${k}`); setNum("H" + row, r2(hrs)); row++; }
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
async function buildPdf(profile, ym, items){
  const {jsPDF} = window.jspdf; const pdf = new jsPDF({unit:"mm", format:"a4"});
  const W = 210, M = 16; let y = M;
  const INK = [30,58,74], ACC = [48,87,110], MUTED = [100,115,122], LINE = [210,220,224], WARN = [154,85,18];
  const t = totals(items), sorted = sortItems(items), extra = [];
  const pageBreak = (need) => { if (y + need > 297 - M) { pdf.addPage(); y = M; return true; } return false; };
  const logo = await getLogo();
  if (logo && logo.s) pdf.addImage(logo.d, "PNG", W - M - 38, M - 4, 38, 38 * logo.s.h / logo.s.w);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.setTextColor(...INK); pdf.text("Tidrapport", M, y + 4);
  pdf.setFontSize(11); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...MUTED);
  pdf.text([ymLabel(ym), S.cfg.foretag].filter(Boolean).join("  ·  "), M, y + 11);
  y += 20; pdf.setTextColor(...INK); pdf.setFontSize(10);
  pdf.text(`Anställd: ${profile.name}${profile.empNo ? `   Anst.nr: ${profile.empNo}` : ""}`, M, y); y += 5;
  pdf.setTextColor(...MUTED); pdf.text(`Attesterande chef: ${profile.chefMail}`, M, y); y += 7;
  const sum = [["Närvaro", fmtH(t.work)], ["Restid", fmtH(t.travel)], ["Frånvaro", fmtH(t.absence)], ["Utlägg att ersätta", fmtKr(t.expPrivate)],
    ["Milersättning", `${fmtKr(t.mileAmt)} (${fmtN(t.km/10, 1)} mil)`], ["Totalt att utbetala", fmtKr(r2(t.expPrivate + t.mileAmt))]];
  pdf.setFillColor(238, 243, 245); pdf.rect(M, y, W - 2*M, 26, "F");
  sum.forEach(([k, v], i) => { const cx = M + 4 + (i % 3) * ((W - 2*M) / 3), cy = y + 7 + Math.floor(i / 3) * 11;
    pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text(k.toUpperCase(), cx, cy);
    pdf.setFontSize(11); pdf.setTextColor(...INK); pdf.setFont("helvetica", "bold"); pdf.text(v, cx, cy + 5); pdf.setFont("helvetica", "normal"); });
  y += 34;
  const cols = [{h:"Datum", w:18}, {h:"Beskrivning", w:76}, {h:"Närvaro", w:17, r:1}, {h:"Restid", w:15, r:1}, {h:"Utlägg", w:24, r:1}, {h:"Frånvaro", w:17, r:1}, {h:"Mil", w:11, r:1}];
  const head = () => { pdf.setFillColor(...ACC); pdf.rect(M, y, W - 2*M, 7, "F"); pdf.setTextColor(255, 255, 255); pdf.setFontSize(8.5); pdf.setFont("helvetica", "bold");
    let x = M; cols.forEach((c) => { pdf.text(c.h, c.r ? x + c.w - 2 : x + 2, y + 4.8, {align: c.r ? "right" : "left"}); x += c.w; }); pdf.setFont("helvetica", "normal"); y += 7; };
  head(); pdf.setFontSize(8.5);
  for (const x of dayRows(items).filter((d) => d.desc.length || d.work || d.travel || d.exp || d.abs || d.mil)) {
    const ds = `${ym}-${pad(x.d)}`;
    const lines = pdf.splitTextToSize(x.desc.join("; ") || "–", cols[1].w - 4); const rh = Math.max(6, lines.length * 3.8 + 2.4);
    if (pageBreak(rh)) { head(); pdf.setFontSize(8.5); }
    pdf.setTextColor(...INK); let cx = M;
    const vals = [`${x.d} ${weekday(ds)}`, lines, x.work ? fmtN(x.work) : "", x.travel ? fmtN(x.travel) : "", x.exp ? fmtKr(x.exp) : "", x.abs ? fmtN(x.abs) : "", x.mil ? fmtN(x.mil, 1) : ""];
    cols.forEach((c, i) => { pdf.text(vals[i], c.r ? cx + c.w - 2 : cx + 2, y + 4.2, {align: c.r ? "right" : "left"}); cx += c.w; });
    y += rh; pdf.setDrawColor(...LINE); pdf.line(M, y, W - M, y);
  }
  const exps = sorted.filter((i) => i.type === "expense");
  const receipts = {};
  for (const e of exps) if (e.receiptId) receipts[e.id] = await DB.get("receipts", e.receiptId);
  const sect = (title) => { y += 8; pageBreak(20); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(...INK); pdf.text(title, M, y); pdf.setFont("helvetica", "normal"); y += 6; pdf.setFontSize(8.5); };
  if (exps.length) {
    sect("Utlägg och kvitton");
    exps.forEach((e, i) => { pageBreak(6); pdf.setTextColor(...INK);
      pdf.text(`${i+1}. ${e.date}`, M, y); pdf.text(pdf.splitTextToSize(`${e.desc} (${e.category})`, 70)[0], M + 26, y);
      pdf.text(e.payment === "company" ? "Ftg-kort" : "Privat", M + 100, y);
      pdf.text(`moms ${fmtKr(e.vat)}`, M + 155, y, {align:"right"}); pdf.text(fmtKr(e.amount), W - M, y, {align:"right"});
      const r = receipts[e.id];
      if (!r) { pdf.setTextColor(...WARN); pdf.text("kvitto saknas", M + 115, y); }
      else { pdf.setTextColor(...MUTED); pdf.text(r.kind === "pdf" ? "separat fil" : `bilaga ${i+1}`, M + 115, y); }
      y += 5; });
  }
  const trs = sorted.filter((i) => i.type === "travel" && i.km);
  if (trs.length) {
    sect("Körjournal");
    trs.forEach((tr) => { pageBreak(6); pdf.setTextColor(...INK); const rate = rateFor(tr.vehicle);
      pdf.text(tr.date, M, y); pdf.text(pdf.splitTextToSize(tr.desc, 80)[0], M + 22, y);
      pdf.text(`${fmtN(tr.km, 1)} km · ${VEH_LABEL[tr.vehicle]}`, M + 106, y); pdf.text(rate ? fmtKr(r2(tr.km/10*rate)) : "–", W - M, y, {align:"right"}); y += 5; });
  }
  y += 14; pageBreak(24); pdf.setDrawColor(...MUTED);
  pdf.line(M, y, M + 70, y); pdf.line(W - M - 70, y, W - M, y); pdf.setFontSize(8); pdf.setTextColor(...MUTED);
  pdf.text("Anställd, underskrift och datum", M, y + 4); pdf.text("Attest chef", W - M - 70, y + 4);
  for (let i = 0; i < exps.length; i++) {
    const e = exps[i], r = receipts[e.id]; if (!r) continue;
    if (r.kind === "pdf") { extra.push({name: `Kvitto_${ym}_${pad(i+1)}_${slug(e.desc)}.pdf`, type:"application/pdf", blob: r.blob}); continue; }
    if (await sniff(r.blob) !== "image/jpeg") continue;
    const src = await blobToDataUrl(r.blob), sz = await imgSize(src); if (!sz) continue;
    pdf.addPage(); y = M;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(...INK); pdf.text(`Bilaga ${i+1} – kvitto`, M, y + 2);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...MUTED);
    pdf.text(pdf.splitTextToSize(`${e.date} · ${e.desc} · ${fmtKr(e.amount)} · ${profile.name}`, W - 2*M)[0], M, y + 8);
    const sc = Math.min((W - 2*M) / sz.w, (297 - 2*M - 16) / sz.h);
    pdf.addImage(src, "JPEG", M, y + 14, sz.w * sc, sz.h * sc);
  }
  return {pdf: pdf.output("blob"), extra};
}

/* ---------- säkerhetskopia ---------- */
async function saveBackup(){
  try {
    const [items, receipts, meta] = await Promise.all([DB.all("items"), DB.all("receipts"), DB.all("meta")]);
    const rec = [];
    for (const r of receipts) rec.push({id:r.id, kind:r.kind, name:r.name, createdAt:r.createdAt, data: (await blobB64(r.blob)).replace(/\r\n/g, "")});
    const data = {app:"tidrapport", format:1, exportedAt: new Date().toISOString(),
      profile: S.profile, items, receipts: rec, months: meta.filter((m) => /^month:\d{4}-\d{2}$/.test(m.key))};
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
      await DB.put("receipts", {id:r.id, kind:r.kind, type, name: clean(r.name, 80) || "kvitto", blob, createdAt: num(r.createdAt, 0, 1e14) ?? Date.now()});
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
