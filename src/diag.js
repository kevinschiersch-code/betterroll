// diag.js – Diagnose (Schalter „Leistung messen“ unter Erweitert, ab Werk aus). Misst im Kalender, wie oft die
// Durchläufe von BetterRoll laufen und wie lange sie dauern, dazu lange Blockaden des Browsers (über 50 ms).
// Alle 10 s steht eine Übersicht in der Browser-Konsole (F12). Nur lokal: nichts wird gespeichert oder gesendet.
let crlfDiagOn = false, crlfDiagTimer = 0;
let crlfDiagStats = new Map(), crlfDiagLong = { n: 0, sum: 0, max: 0 };

// Fehler in die Fehlerliste des Popups (Erweitert) eintragen; der Hintergrund schreibt sie, nur lokal
function crlfError(where, e) {
  try { chrome.runtime.sendMessage({ type: "crlf-error", where, msg: String((e && e.message) || e) }).catch(() => {}); } catch (x) {}
}
// unbehandelte Fehler der eigenen Skripte (Adresse des Add-ons) ebenfalls eintragen
addEventListener("error", (e) => { if (e.filename && e.filename.startsWith(chrome.runtime.getURL(""))) crlfError(e.filename.split("/").pop() + ":" + e.lineno, e.message); });
addEventListener("unhandledrejection", (e) => { const r = e.reason; if (r && r.stack && r.stack.includes(chrome.runtime.getURL(""))) crlfError("Kalender", r); });

// fn ausführen; bei eingeschaltetem Schalter Dauer unter name mitzählen
function crlfTime(name, fn) {
  if (!crlfDiagOn) return fn();
  const t0 = performance.now();
  try { return fn(); } finally {
    const d = performance.now() - t0;
    let s = crlfDiagStats.get(name);
    if (!s) crlfDiagStats.set(name, (s = { n: 0, sum: 0, max: 0 }));
    s.n++; s.sum += d; s.max = Math.max(s.max, d);
  }
}

const crlfMs = (v) => Math.round(v * 10) / 10;
function crlfDiagReport() {
  if (!crlfDiagStats.size && !crlfDiagLong.n) return;
  const rows = {};
  for (const [name, s] of [...crlfDiagStats].sort((a, b) => b[1].sum - a[1].sum)) {
    rows[name] = { Anzahl: s.n, "gesamt ms": crlfMs(s.sum), "Ø ms": crlfMs(s.sum / s.n), "max ms": crlfMs(s.max) };
  }
  const cards = document.querySelectorAll("article.release, .js-release").length;
  console.log(`BetterRoll-Diagnose (letzte 10 s, ${cards} Karten): ${crlfDiagLong.n} lange Blockaden, zusammen ${Math.round(crlfDiagLong.sum)} ms, längste ${Math.round(crlfDiagLong.max)} ms`);
  if (Object.keys(rows).length) console.table(rows);
  crlfDiagStats = new Map();
  crlfDiagLong = { n: 0, sum: 0, max: 0 };
}

// lange Blockaden des Browsers (gibt es nur in Chrome/Edge; Firefox zeigt nur die Tabelle)
try {
  new PerformanceObserver((list) => {
    if (!crlfDiagOn) return;
    for (const e of list.getEntries()) { crlfDiagLong.n++; crlfDiagLong.sum += e.duration; crlfDiagLong.max = Math.max(crlfDiagLong.max, e.duration); }
  }).observe({ type: "longtask", buffered: true });
} catch (e) {}

function crlfDiagSet(on) {
  crlfDiagOn = !!on;
  clearInterval(crlfDiagTimer);
  if (crlfDiagOn) {
    console.log("BetterRoll-Diagnose an: alle 10 s eine Übersicht (abschalten im Popup unter Erweitert).");
    crlfDiagTimer = setInterval(crlfDiagReport, 10000);
  }
}
chrome.storage.sync.get({ diag: false }, ({ diag }) => crlfDiagSet(diag));
chrome.storage.onChanged.addListener((c, area) => { if (area === "sync" && c.diag) crlfDiagSet(c.diag.newValue); });
