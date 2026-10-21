// Automatische Tests für BetterRoll (ohne echte Crunchyroll-Seite):
//   node tests/run.mjs        (braucht Node 18+ und Playwright mit Chromium)
// Nachgebauter Simulcast-Kalender (7 Tage, ~150 Karten, Original + Synchro, Fortschritt), dazu Popup, Auto-Skip und
// Hintergrund-Dienst mit nachgestellten Antworten. Kein Netzverkehr: AniList & Co. antworten im Test mit „nicht erreichbar“.
// Am Ende: Liste OK/FEHLER und Messwerte; Rückgabewert 1, wenn etwas fehlschlägt.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import vm from "vm";
import http from "http";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const results = [];
const ok = (name, cond, info = "") => { results.push({ name, ok: !!cond, info }); };

// ---- Chrome-Ersatz: Speicher mit Änderungs-Ereignissen (wie chrome.storage), Nachrichten an den Hintergrund ----
const STUB = `(() => {
  const listeners = [];
  const area = (name) => {
    const data = JSON.parse(sessionStorage.getItem("st_" + name) || "{}");
    const save = () => sessionStorage.setItem("st_" + name, JSON.stringify(data));
    const pick = (d) => { if (d == null) return { ...data }; if (typeof d === "string") return d in data ? { [d]: data[d] } : {};
      if (Array.isArray(d)) return Object.fromEntries(d.filter((k) => k in data).map((k) => [k, data[k]]));
      const r = { ...d }; for (const k in d) if (k in data) r[k] = data[k]; return r; };
    const fire = (changes) => setTimeout(() => listeners.forEach((f) => f(changes, name)), 0);
    return {
      get: (d, cb) => { const v = JSON.parse(JSON.stringify(pick(d))); if (cb) setTimeout(() => cb(v), 0); else return Promise.resolve(v); },
      set: (o, cb) => { const ch = {}; for (const k in o) { ch[k] = { oldValue: data[k], newValue: o[k] }; data[k] = o[k]; } save(); fire(ch); cb && setTimeout(cb, 0); return Promise.resolve(); },
      remove: (k, cb) => { const ch = {}; for (const x of [].concat(k)) { ch[x] = { oldValue: data[x] }; delete data[x]; } save(); fire(ch); cb && setTimeout(cb, 0); return Promise.resolve(); },
    };
  };
  window.__sent = [];
  window.chrome = {
    runtime: { id: "test", getURL: (p) => location.origin + "/src/" + p, getManifest: () => ({ version: "test" }), lastError: null,
      sendMessage: (m) => { window.__sent.push(m); return Promise.resolve({ ok: false, status: 0, error: "keine Verbindung" }); },
      sendNativeMessage: () => {}, onMessage: { addListener() {} } },
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener: (f) => listeners.push(f) } },
    tabs: { query: (q, cb) => { cb && setTimeout(() => cb([]), 0); return Promise.resolve([]); }, sendMessage: () => Promise.resolve(), create() {} },
    permissions: { contains: () => Promise.resolve(false) },
  };
})();`;

// ---- nachgebauter Kalender ----
const DAYS = 7, PER_DAY = 22;
function calendarHtml() {
  let body = "";
  for (let d = 0; d < DAYS; d++) {
    const date = new Date(Date.UTC(2026, 9, 19 + d)).toISOString().slice(0, 10);
    body += `<section class="day"><h1><time datetime="${date}">Tag ${d}</time></h1><ol class="releases">`;
    for (let i = 0; i < PER_DAY; i++) {
      const n = Math.floor(i / 2), dub = i % 2 === 1;
      const title = `Anime ${d}-${n}${dub ? " (German Dub)" : ""}`;
      body += `<li><article class="release js-release"><time class="available-time" datetime="${date}T1${n % 10}:00:00">1${n % 10}:00</time>`
        + `<div class="season-name"><a href="/de/series/G${d}X${n}/anime-${d}-${n}"><cite itemprop="name">${title}</cite></a></div>`
        + `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="90"><progress value="${(i % 4) / 3}" max="1"></progress></article></li>`;
    }
    body += "</ol></section>";
  }
  const cal = ["diag", "i18n", "theme", "languages", "match", "content", "comments", "rank", "dateformat", "series", "overlay", "speed", "skip"];
  return `<!doctype html><html><head><meta charset="utf-8"><script>${STUB}</script>`
    + `<link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/content.css"></head><body>${body}`
    + cal.map((f) => `<script src="/src/${f}.js"></script>`).join("") + `</body></html>`;
}

// kleiner Webserver für src/ und die Testseiten
const pages = { "/calendar.html": calendarHtml, "/video.html": () => `<!doctype html><html><head><meta charset="utf-8"><script>${STUB}</script><script>
  window.__ticks = 0; const si = window.setInterval; window.setInterval = (f, ms) => si(() => { window.__ticks++; f(); }, ms);
  window.__clicks = 0;</script></head><body><video id="v" src="/src/backgrounds/haus_2.webm" muted loop width="320" height="180"></video>
  <button id="sk" style="display:none;width:120px;height:30px" onclick="__clicks++;v.currentTime+=3">Intro überspringen</button>
  <script src="/src/skip.js"></script></body></html>` };
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".webm": "video/webm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (pages[url]) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(pages[url]()); }
  const file = path.join(ROOT, url);
  if (!file.startsWith(SRC) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined,
  args: ["--autoplay-policy=no-user-gesture-required"] }).catch(() => chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] }));

// ===== 1. Kalender =====
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("init")) return;
    sessionStorage.setItem("init", "1");
    sessionStorage.setItem("st_sync", JSON.stringify({ language: "de", merge: true, prefer: "lang", diag: true }));
    sessionStorage.setItem("st_local", JSON.stringify({ marks: { "anime 0-3": "fav", "anime 0-1": "dim" } }));
  });
  await page.goto(BASE + "/calendar.html");
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".crlf-item")];
    const visible = items.filter((c) => getComputedStyle(c).display !== "none");
    const titles = (list) => [...list.children].filter((c) => c.classList.contains("crlf-item") && getComputedStyle(c).display !== "none")
      .map((c) => c.querySelector("cite").textContent.trim());
    const day0 = titles(document.querySelector("ol.releases"));
    return { items: items.length, visible: visible.length, day0,
      dub: visible.filter((c) => /German Dub/.test(c.querySelector("[data-crlf-title]")?.dataset.crlfTitle || c.textContent)).length, // Originaltitel (Anzeige ist aufgeräumt)
      fav: document.querySelectorAll(".crlf-item.crlf-fav").length, dim: document.querySelectorAll(".crlf-item.crlf-dim").length,
      tools: !!document.getElementById("crlf-tools"), actions: document.querySelectorAll(".crlf-actions").length };
  });
  ok("Kalender: alle Karten erkannt", state.items === DAYS * PER_DAY, `${state.items}/${DAYS * PER_DAY}`);
  ok("Zusammenführen: eine Karte je Anime", state.visible === DAYS * PER_DAY / 2, `${state.visible} sichtbar`);
  ok("Fassung: deutsche Synchro bevorzugt", state.dub === DAYS * PER_DAY / 2, `${state.dub} Synchro-Karten sichtbar`);
  ok("★ markiert und oben", state.fav >= 1 && /^Anime 0-3\b/.test(state.day0[0]), state.day0.slice(0, 2).join(", "));
  ok("▼ ausgegraut und unten", state.dim >= 1 && /^Anime 0-1\b/.test(state.day0.at(-1)), state.day0.at(-1));
  ok("Knöpfe an den Karten und unten rechts", state.actions > 0 && state.tools);

  // Tastenkürzel: F im Eingabefeld nicht, sonst „nur Favoriten“
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "q"; document.body.prepend(i); });
  await page.focus("#q"); await page.keyboard.press("f"); await page.waitForTimeout(200);
  const typed = await page.evaluate(() => document.documentElement.classList.contains("crlf-onlyfav"));
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("f"); await page.waitForTimeout(300);
  const only = await page.evaluate(() => ({ on: document.documentElement.classList.contains("crlf-onlyfav"),
    shown: [...document.querySelectorAll(".crlf-item")].filter((c) => getComputedStyle(c).display !== "none").length }));
  ok("Taste F beim Tippen ignoriert", !typed);
  ok("Taste F: nur Favoriten", only.on && only.shown === 1, `${only.shown} sichtbar`);
  await page.keyboard.press("f"); await page.waitForTimeout(300);
  await page.keyboard.press("t"); await page.waitForTimeout(400);
  ok("Taste T öffnet Top 10", await page.evaluate(() => !!document.querySelector(".crlf-rpanel")));
  await page.keyboard.press("t"); await page.waitForTimeout(400);
  ok("Taste T schließt Top 10", await page.evaluate(() => !document.querySelector(".crlf-rpanel")));

  // Messung (diag): Zeiten der Durchläufe
  const stats = await page.evaluate(() => Object.fromEntries([...crlfDiagStats].map(([k, s]) => [k, { n: s.n, max: Math.round(s.max) }])));
  for (const [k, s] of Object.entries(stats)) results.push({ name: `Messung: ${k}`, ok: true, info: `${s.n}× , längster ${s.max} ms`, measure: true });
  ok("Kalender ohne Skriptfehler", !errors.length, errors.join(" | "));
  await page.close();
}

// ===== 2. Popup: Sichern und Laden =====
{
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("init")) return;
    sessionStorage.setItem("init", "1");
    sessionStorage.setItem("st_sync", JSON.stringify({ pageTheme: "light", favTop: false }));
    sessionStorage.setItem("st_local", JSON.stringify({ marks: { frieren: "fav", "one piece": "dim" }, playerSpeed: 1.25 }));
  });
  await page.addInitScript({ content: STUB });
  await page.goto(BASE + "/src/popup.html");
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById("more").open = true; });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#bkSave")]);
  const file = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "br-")), "backup.json");
  await dl.saveAs(file);
  const toast = await page.evaluate(() => !document.getElementById("toast").hidden);
  await page.evaluate(() => { sessionStorage.setItem("st_sync", "{}"); sessionStorage.setItem("st_local", "{}"); });
  await page.setInputFiles("#bkFile", file);
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => [JSON.parse(sessionStorage.getItem("st_sync")), JSON.parse(sessionStorage.getItem("st_local"))]);
  ok("Popup: Sichern mit Rückmeldung", toast);
  ok("Popup: Laden stellt Stand wieder her", back[0].favTop === false && back[0].pageTheme === "light" && back[1].marks.frieren === "fav" && back[1].playerSpeed === 1.25);
  await page.waitForTimeout(1500);
  ok("Popup ohne Skriptfehler", !errors.length, errors.join(" | "));
  await ctx.close();
}

// ===== 3. Auto-Skip: Prüfung nur bei laufendem Video =====
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/video.html");
  await page.waitForTimeout(1200);
  const idle = await page.evaluate("__ticks");
  await page.evaluate(() => document.getElementById("v").play());
  await page.evaluate(() => { document.getElementById("sk").style.display = "block"; });
  await page.waitForTimeout(1500);
  const clicks = await page.evaluate("__clicks");
  await page.evaluate(() => document.getElementById("v").pause());
  await page.waitForTimeout(300);
  const t = await page.evaluate("__ticks");
  await page.waitForTimeout(1200);
  const paused = (await page.evaluate("__ticks")) - t;
  ok("Auto-Skip schläft ohne Video", idle === 0, `${idle} Prüfungen`);
  ok("Auto-Skip klickt den Knopf", clicks === 1, `${clicks} Klicks`);
  ok("Auto-Skip schläft bei Pause", paused === 0, `${paused} Prüfungen`);
  ok("Auto-Skip ohne Skriptfehler", !errors.length, errors.join(" | "));
  await page.close();
}
await browser.close();
server.close();

// ===== 4. Hintergrund: gleiche Abfragen zusammenlegen, Fehlerliste =====
{
  const handlers = [], store = {};
  let fetches = 0;
  const noop = { addListener() {} };
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, AbortController, URL, SyntaxError,
    fetch: async () => { fetches++; await new Promise((r) => setTimeout(r, 200)); return { ok: false, status: 429, json: async () => null }; },
    chrome: { runtime: { onMessage: { addListener: (f) => handlers.push(f) }, onInstalled: noop, onStartup: noop, getURL: (p) => p },
      storage: { onChanged: noop, local: { get: async () => ({ ...store }), set: async (o) => Object.assign(store, o), remove: async () => {} },
        sync: { get: async () => ({}), set: async () => {} } }, permissions: { onAdded: noop, onRemoved: noop } } });
  vm.runInContext(fs.readFileSync(path.join(SRC, "background.js"), "utf8"), ctx);
  const ask = (m) => new Promise((r) => handlers.forEach((f) => f(m, {}, r)));
  const q = { type: "crlf-anilist", query: "query{x}" };
  await Promise.all([ask(q), ask(q), ask(q)]);
  ok("Hintergrund: gleiche Abfragen zusammengelegt", fetches === 2, `${fetches} Abrufe (1 + 1 Wiederholung bei 429)`);
  await new Promise((r) => setTimeout(r, 100));
  const e = (store.crErrors || [])[0];
  ok("Hintergrund: Fehler in der Fehlerliste", e && /429/.test(e.msg), e ? `${e.where}: ${e.msg}` : "leer");
}

// ===== Ausgabe =====
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.measure ? "  ·" : r.ok ? "OK " : "FEHLER"} ${r.name}${r.info ? ` – ${r.info}` : ""}`);
}
console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : `\nAlle ${results.filter((r) => !r.measure).length} Tests bestanden`);
process.exit(failed ? 1 : 0);
