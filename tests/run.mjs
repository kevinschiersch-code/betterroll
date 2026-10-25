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
        + `<div class="episode"><span>Folge ${n + 1}</span> <span>Verfügbar</span></div>`
        + `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="90"><progress value="${(i % 4) / 3}" max="1"></progress></article></li>`;
    }
    body += "</ol></section>";
  }
  // Skripte in der Reihenfolge des Manifests (Kalender, dann die übrigen Crunchyroll-Seiten)
  const cal = [...new Set(JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8")).content_scripts.flatMap((c) => c.js))].map((f) => f.replace(/\.js$/, ""));
  return `<!doctype html><html><head><meta charset="utf-8"><script>${STUB}</script>`
    + `<link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/content.css"></head><body>${body}`
    + cal.map((f) => `<script src="/src/${f}.js"></script>`).join("") + `</body></html>`;
}

// kleiner Webserver für src/ und die Testseiten
const pages = { "/calendar.html": calendarHtml, "/video.html": () => `<!doctype html><html><head><meta charset="utf-8"><script>${STUB}</script><script>
  window.__ticks = 0; const si = window.setInterval; window.setInterval = (f, ms) => si(() => { window.__ticks++; f(); }, ms);
  window.__clicks = 0;</script></head><body><video id="v" src="/src/backgrounds/haus_1.webm" muted loop width="320" height="180"></video>
  <button id="sk" style="display:none;width:120px;height:30px" onclick="__clicks++;v.currentTime+=3">Intro überspringen</button>
  <script src="/src/skip.js"></script></body></html>`,
  "/de/watch/AAA111/folge-1": () => `<!doctype html><html><head><meta charset="utf-8"><script>${STUB}</script></head><body>
  <video id="v" src="/src/backgrounds/haus_1.webm" muted width="320" height="180"></video>
  <section><h4>Nächste Folge</h4><a href="/de/watch/BBB222/folge-2">Folge 2</a></section>
  <section><h4>Vorherige Folge</h4><a href="/de/watch/ZZZ000/folge-0">Folge 0</a></section>
  <script src="/src/skip.js"></script></body></html>`,
  "/de/watch/BBB222/folge-2": () => "<!doctype html><title>Folge 2</title>",
  "/de/watch/CCC333/folge-3": () => `<!doctype html><html><head><meta charset="utf-8"><script>${STUB}</script></head><body>
  <video id="v" src="/src/backgrounds/haus_1.webm" muted loop width="320" height="180"></video>
  <button aria-label="Vorherige Folge" onclick="__prev++">⏮</button><button aria-label="Nächste Folge" onclick="__next++">⏭</button>
  <button id="ab" style="display:none;width:160px;height:30px" onclick="__ab++">Abspann überspringen</button>
  <script>window.__prev = 0; window.__next = 0; window.__ab = 0;</script><script src="/src/skip.js"></script></body></html>` };
// langsam ladende Bilder (Vorschau: Platz fürs Bild freihalten); PNG in passender Größe, ~0,7 s Verzögerung
import zlib from "zlib";
function png(w, h) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const SLOW = { "/slow/poster.png": png(200, 300), "/slow/thumb.png": png(320, 180) };
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".webm": "video/webm", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (SLOW[url]) return setTimeout(() => { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }); res.end(SLOW[url]); }, 700);
  if (url === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("User-agent: *\nDisallow: /x\n"); }
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

  // Seite zeichnet die Folgen-Zeile neu (wie beim Überfahren): 💬 und gekürzter Text müssen vor dem nächsten Bild zurück sein
  const redraw = await page.evaluate(async () => {
    const card = [...document.querySelectorAll(".crlf-item")].find((c) => getComputedStyle(c).display !== "none" && c.querySelector(".crlf-epline .crlf-btn-talk") && c.querySelector(".crlf-tag"));
    const line = card.querySelector(".crlf-epline");
    const before = line.textContent.includes("Verfügbar");
    const tag = card.querySelector(".crlf-tag"), talk0 = line.querySelector(".crlf-btn-talk");
    const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
    const oneRow = !!(tag && line.contains(tag) && !!(tag.compareDocumentPosition(talk0) & Node.DOCUMENT_POSITION_FOLLOWING) && Math.abs(mid(tag) - mid(talk0)) < 4);
    const fresh = document.createElement("div");
    fresh.className = "episode";
    fresh.innerHTML = "<span>Folge 9</span> <span>Verfügbar</span>";
    line.replaceWith(fresh);
    await Promise.resolve(); await Promise.resolve(); // nur Mikroaufgaben, kein neues Bild
    const now = card.querySelector(".crlf-epline");
    return { before, oneRow, tagBack: !!(now && now.querySelector(".crlf-tag")), talk: !!(now && now.querySelector(".crlf-btn-talk")), avail: now ? now.textContent.includes("Verfügbar") : true };
  });
  ok("„Verfügbar“ aus der Folgen-Zeile entfernt", !redraw.before);
  ok("Folge, Sprache und 💬 in einer Zeile", redraw.oneRow);
  ok("Neu gezeichnete Folgen-Zeile sofort repariert (kein Flackern)", redraw.talk && redraw.tagBack && !redraw.avail, JSON.stringify(redraw));

  // neue Teile der Seite (z. B. Vorschau beim Überfahren) lösen einen Einfärbe-Lauf aus: dabei dürfen auf den
  // Karten keine Übergänge starten (sonst blinken Schatten, 💬 und „Folge 3“ der Nachbarkarten kurz auf)
  const blink = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 300));
    const runs = [];
    const on = (e) => runs.push(e.propertyName + "@" + e.target.tagName.toLowerCase());
    document.addEventListener("transitionrun", on, true);
    const flips = [];
    const mo = new MutationObserver((ms) => ms.forEach((m) => flips.push(m.oldValue)));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    const pop = document.createElement("div");
    pop.textContent = "Vorschau";
    document.body.append(pop);
    for (let i = 0; i < 4; i++) await frame();
    await new Promise((r) => setTimeout(r, 300));
    document.removeEventListener("transitionrun", on, true); mo.disconnect(); pop.remove();
    return { flips: flips.length, runs: runs.length, first: runs.slice(0, 3) };
  });
  ok("Einfärben neuer Teile startet keine Übergänge auf den Karten (kein Aufblinken)", blink.flips > 0 && blink.runs === 0, JSON.stringify(blink));

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
  // Vorschau beim Überfahren: Poster und Folgenbild der Seite laden noch -> Platz in fester Größe frei, danach verschiebt sich nichts
  const card = page.locator(".crlf-item:visible").nth(2);
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const peek1 = await page.evaluate(() => {
    const card = document.elementsFromPoint(crlfMouse.x, crlfMouse.y).map((e) => e.closest("article.release")).find(Boolean);
    const pop = document.createElement("div");
    pop.style.cssText = "position:absolute;z-index:50;width:300px";
    pop.innerHTML = `<img src="/slow/poster.png?${Date.now()}"><h2 style="font-size:20px">${card.querySelector("cite").textContent}</h2>`
      + `<p>Eine Beschreibung, die lang genug ist, um als Beschreibung erkannt zu werden.</p><img src="/slow/thumb.png?${Date.now()}"><span>3</span><span>Der Folgentitel</span>`;
    pop.className = "test-pop";
    card.append(pop);
    crlfHoverCard = card;
    crlfPeek(pop);
    window.__peek = crlfPeekEl;
    // Lage innerhalb der Vorschau (die Einblend-Bewegung der ganzen Karte zählt nicht)
    const r = (s) => { const e = crlfPeekEl && crlfPeekEl.querySelector(s); if (!e) return null; const a = e.getBoundingClientRect(), p = crlfPeekEl.getBoundingClientRect(); return { left: a.left - p.left, top: a.top - p.top }; };
    window.__pos = () => ({ title: r(".crlf-pk-title"), desc: r(".crlf-pk-desc"), ep: r(".crlf-pk-ep"), h: crlfPeekEl ? crlfPeekEl.offsetHeight : 0 });
    return new Promise((res) => setTimeout(() => res({ ...window.__pos(), ph: crlfPeekEl ? crlfPeekEl.querySelectorAll(".crlf-pk-ph").length : 0 }), 300)); // nach dem Einblenden
  });
  await page.waitForTimeout(1500);
  const peek2 = await page.evaluate(() => ({ ...window.__pos(), same: window.__peek === crlfPeekEl,
    poster: !!crlfPeekEl?.querySelector("img.crlf-pk-poster"), thumb: !!crlfPeekEl?.querySelector(".crlf-pk-thumb img"), ph: crlfPeekEl?.querySelectorAll(".crlf-pk-ph").length,
    eptext: crlfPeekEl?.querySelector(".crlf-pk-eptext")?.textContent }));
  const samePos = (a, b) => a && b && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1;
  ok("Vorschau: Platz für ladende Bilder freigehalten", peek1.ph === 2, `${peek1.ph} Platzhalter`);
  ok("Vorschau: Bilder nachgeladen ohne Verschieben", peek2.same && peek2.poster && peek2.thumb && !peek2.ph && samePos(peek1.title, peek2.title)
    && samePos(peek1.desc, peek2.desc) && samePos(peek1.ep, peek2.ep) && peek1.h === peek2.h, JSON.stringify({ peek1, peek2 }));
  await page.evaluate(() => { crlfPeekClose(); document.querySelector(".test-pop").remove(); });

  // Vorschau öffnet sofort aus der Karte (ohne auf die Seite zu warten); kommt deren Vorschau, wird ergänzt statt neu gebaut
  const card2 = page.locator(".crlf-item:visible").nth(5);
  await card2.scrollIntoViewIfNeeded();
  const box2 = await card2.boundingBox();
  await page.mouse.move(box2.x + 5, box2.y + 5);
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 3 });
  await page.waitForTimeout(700);
  const early1 = await page.evaluate(() => ({ open: !!crlfPeekEl, early: !!crlfPeekEl?._crlfData?.early, ...(crlfPeekEl ? window.__pos() : {}) }));
  const early2 = await page.evaluate(async () => {
    const before = crlfPeekEl;
    const card = crlfHoverCard;
    const pop = document.createElement("div");
    pop.style.cssText = "position:absolute;z-index:50;width:300px";
    pop.className = "test-pop2";
    pop.innerHTML = `<img src="/slow/poster.png?e${Date.now()}"><h2 style="font-size:20px">${card.querySelector("cite").textContent}</h2>`
      + `<p>Die Beschreibung kommt erst mit der Einblendung der Seite, ihr Platz ist schon frei.</p><img src="/slow/thumb.png?e${Date.now()}"><span>${(card.textContent.match(/Folge (\d+)/) || [])[1]}</span><span>Erste Folge</span><button>Fortsetzen</button><button>Auf die Playlist</button>`;
    card.append(pop);
    crlfPeek(pop);
    await new Promise((r) => setTimeout(r, 1200));
    return { same: before === crlfPeekEl, btn: crlfPeekEl?.querySelector(".crlf-pk-btn")?.textContent, thumb: !!crlfPeekEl?.querySelector(".crlf-pk-thumb img"), ...window.__pos() };
  });
  const samePos2 = (a, b) => a && b && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1;
  ok("Vorschau öffnet sofort aus der Karte", early1.open && early1.early, JSON.stringify(early1));
  ok("Frühe Vorschau mit Daten der Seite ergänzt ohne Verschieben", early2.same && early2.btn === "Fortsetzen" && early2.thumb
    && samePos2(early1.title, early2.title) && samePos2(early1.ep, early2.ep) && samePos2(early1.desc, early2.desc) && early1.h === early2.h, JSON.stringify({ early1, early2 }));
  await page.evaluate(() => { crlfPeekClose(); document.querySelector(".test-pop2").remove(); });

  // zweites Überfahren, auch nach dem Neuladen: Beschreibung und Knöpfe sofort aus dem Zwischenspeicher
  const again = async () => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(100);
    const b = await page.locator(".crlf-item:visible").nth(5).boundingBox();
    await page.mouse.move(b.x + 5, b.y + 5);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    await page.waitForTimeout(400);
    return page.evaluate(() => ({ open: !!crlfPeekEl, btn: crlfPeekEl?.querySelector(".crlf-pk-btn")?.textContent,
      desc: crlfPeekEl?.querySelector(".crlf-pk-desc")?.textContent || "", ep: crlfPeekEl?.querySelector(".crlf-pk-eptext")?.textContent }));
  };
  const hit = await again();
  await page.evaluate(() => crlfPeekClose());
  await page.waitForTimeout(1800);
  await page.reload();
  await page.waitForTimeout(1500);
  await page.locator(".crlf-item:visible").nth(5).scrollIntoViewIfNeeded();
  const hit2 = await again();
  const cached = (h) => h.open && h.btn === "Fortsetzen" && /ihr Platz ist schon frei/.test(h.desc) && /Erste Folge/.test(h.ep || "");
  ok("Vorschau: zweites Mal sofort vollständig (Zwischenspeicher)", cached(hit), JSON.stringify(hit));
  ok("Vorschau: auch nach dem Neuladen vollständig", cached(hit2), JSON.stringify(hit2));
  await page.evaluate(() => crlfPeekClose());

  // Seite liefert keine Beschreibung (nur „Staffel 4“): Ersatz von AniList in den Platzhalter
  // gemerkte Vorschau-Daten früherer Schritte (gleiche Serie an mehreren Tagen) würden die Beschreibung schon liefern
  await page.evaluate(() => { crlfPeekMem.clear(); window.crlfAniListJob = () => Promise.resolve({ desc: "An English description from AniList that is long enough." }); });
  const card3 = page.locator(".crlf-item:visible").nth(8);
  await card3.scrollIntoViewIfNeeded();
  const b3 = await card3.boundingBox();
  await page.mouse.move(5, 5);
  await page.mouse.move(b3.x + 5, b3.y + 5);
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2, { steps: 3 });
  await page.waitForTimeout(400);
  const al = await page.evaluate(async () => {
    const card = crlfHoverCard;
    const pop = document.createElement("div");
    pop.style.cssText = "position:absolute;z-index:50;width:300px";
    pop.innerHTML = `<h2 style="font-size:20px">${card.querySelector("cite").textContent}</h2><p>Staffel 4</p><button>Fortsetzen</button>`;
    card.append(pop);
    const h = crlfPeekEl.offsetHeight;
    crlfPeek(pop);
    await new Promise((r) => setTimeout(r, 100));
    const p = crlfPeekEl.querySelector(".crlf-pk-desc");
    pop.remove();
    return { text: p.textContent, ph: p.classList.contains("crlf-pk-ph"), same: h === crlfPeekEl.offsetHeight };
  });
  ok("Vorschau: ohne Beschreibung der Seite Ersatz von AniList", /English description/.test(al.text) && /AniList/.test(al.text) && !al.ph && al.same, JSON.stringify(al));
  await page.evaluate(() => crlfPeekClose());
  // aufgeräumter Titel („Staffel 2“ steht als Abzeichen): die Vorschau aus der Karte nimmt den Originaltitel samt Staffel
  const fromCard = await page.evaluate(() => {
    const card = document.createElement("article");
    card.className = "release";
    card.innerHTML = `<cite data-crlf-title="Testanime Staffel 3 (German Dub)">Testanime</cite>`;
    const d = crlfPeekFromCard(card);
    return { name: d && d.name, season: d && d.season };
  });
  ok("Vorschau aus der Karte: Staffel aus dem Originaltitel", fromCard.season >= 2 && !/Staffel/.test(fromCard.name || "Staffel"), JSON.stringify(fromCard));

  // Crunchyroll-Katalog (private Fassung): anonymer Schlüssel ohne Cookies, Beschreibungen gebündelt, Vorschau nutzt sie
  const cat = await page.evaluate(async () => {
    const calls = [], real = window.fetch;
    window.fetch = async (url, o = {}) => {
      calls.push({ url: String(url), cred: o.credentials, method: o.method || "GET" });
      if (/^\/(?:de\/)?$/.test(url)) return new Response(`<script>window.__APP_CONFIG__={cxApiParams:{anonClientId:"anon-id",anonClientSecret:""}}</script>`);
      if (url === "/auth/v1/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }));
      if (String(url).startsWith("/content/v2/cms/objects/")) {
        const ids = String(url).split("/").pop().split("?")[0].split(",");
        return new Response(JSON.stringify({ data: ids.map((id) => ({ id, type: "series", description: `Deutsche Beschreibung für ${id} aus dem Katalog.` })) }));
      }
      return real(url, o);
    };
    await chrome.storage.local.remove("crCatPause");
    await chrome.storage.local.remove("crCatCfg");
    await crlfCatLoad();
    window.fetch = real;
    return { calls, desc: crlfCatDesc("G0X4") };
  });
  ok("Katalog: ohne Cookies, gebündelt, Beschreibung da", cat.calls.length >= 3 && cat.calls.every((c) => c.cred === "omit")
    && cat.calls.filter((c) => c.url.startsWith("/content/")).length === 2 && /G0X4/.test(cat.desc), `${cat.calls.length} Abrufe`);
  // Crunchyroll-Sterne über die Bewertungs-Schnittstelle: ohne Cookies, v3 abgelehnt -> v2, Weg gemerkt, Anzeige
  const rate = await page.evaluate(async () => {
    const calls = [], real = window.fetch;
    window.fetch = async (url, o = {}) => {
      calls.push({ url: String(url), cred: o.credentials });
      if (url === "/auth/v1/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }));
      if (String(url).startsWith("/content-reviews/v3/")) return new Response("", { status: 404 });
      if (String(url).startsWith("/content-reviews/v2/")) return new Response(JSON.stringify({ "5s": { displayed: "9.8", unit: "K" }, "4s": { displayed: "1.2", unit: "K" }, average: "4.8", total: 11000 }));
      return real(url, o);
    };
    await chrome.storage.local.remove(["crRatePause", "crRatePath"]);
    const a = await crlfCatRating("G0X5");
    const { crRatePath } = await chrome.storage.local.get("crRatePath");
    const box = crlfRatingBox("Anime 9-9", "/de/series/G9X9/anime-9-9");
    await new Promise((r) => setTimeout(r, 300));
    const shown = box.querySelector(".crlf-pop-rrow").textContent;
    // alles abgelehnt: kein Wert, 1 Tag Pause, danach keine weiteren Abrufe
    window.fetch = async (url, o = {}) => { calls.push({ url: String(url), cred: o.credentials });
      return url === "/auth/v1/token" ? new Response(JSON.stringify({ access_token: "tok", expires_in: 300 })) : new Response("", { status: 403 }); };
    await chrome.storage.local.remove(["crRatePause", "crRatePath"]);
    const b = await crlfCatRating("G0X7");
    const n = calls.length, c = await crlfCatRating("G0X8");
    const { crRatePause = 0 } = await chrome.storage.local.get("crRatePause");
    window.fetch = real;
    return { a, crRatePath, shown, b, c, paused: crRatePause > Date.now(), again: calls.length - n, omit: calls.every((x) => x.cred === "omit") };
  });
  ok("Bewertung: Sterne ohne Anmeldung aus dem Katalog", rate.omit && rate.a && rate.a.value === 4.8 && rate.a.count === 11000
    && rate.crRatePath === "/content-reviews/v2/rating/series/" && /4[,.]8/.test(rate.shown), JSON.stringify(rate));
  ok("Bewertung: abgelehnt -> Pause, alter Weg", rate.b === null && rate.c === null && rate.paused && rate.again === 0, JSON.stringify(rate));

  const card4 = page.locator(".crlf-item:visible").nth(4);
  await card4.scrollIntoViewIfNeeded();
  const b4 = await card4.boundingBox();
  await page.mouse.move(5, 5);
  await page.mouse.move(b4.x + 5, b4.y + 5);
  await page.mouse.move(b4.x + b4.width / 2, b4.y + b4.height / 2, { steps: 3 });
  await page.waitForTimeout(400);
  const catPeek = await page.evaluate(() => crlfPeekEl?.querySelector(".crlf-pk-desc")?.textContent || "");
  ok("Vorschau: Beschreibung sofort aus dem Katalog", /aus dem Katalog/.test(catPeek), catPeek);
  await page.evaluate(() => crlfPeekClose());

  ok("Kalender ohne Skriptfehler", !errors.length, errors.join(" | "));
  await page.close();
}

// ===== 1b. Eigener Kalender (calbuild.js): /simulcastcalendar wird per Regel auf /robots.txt?simulcastcalendar umgeleitet =====
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Content-Scripts der Kalender-Gruppen (document_start) in Manifest-Reihenfolge, davor Chrome-Ersatz und nachgestellter Katalog
  const mf = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  const files = [...new Set(mf.content_scripts.filter((c) => c.matches.some((m) => m.includes("simulcastcalendar"))).flatMap((c) => c.js))];
  const now = Date.now(), H = 36e5, D = 864e5;
  const SEED = `if (!sessionStorage.getItem("init")) { sessionStorage.setItem("init", "1"); sessionStorage.setItem("st_sync", JSON.stringify({ language: "de", merge: true })); }`;
  const MOCK = `(() => {
    window.__calls = [];
    const now = ${now}, H = ${H}, D = ${D}, iso = (t) => new Date(t).toISOString();
    const ep = (id, n, t, season) => ({ id, episode_number: n, slug_title: "folge-" + n, premium_available_date: iso(t), season_title: season, series_slug_title: "anime-a",
      images: { thumbnail: [[{ source: "/slow/thumb.png", width: 320, height: 180 }]] } });
    const J = (o) => new Response(JSON.stringify(o));
    window.fetch = async (url) => {
      url = String(url); window.__calls.push(url);
      if (url === "/" || url === "/de/") return new Response('<script>x={anonClientId:"anon-id",anonClientSecret:""}</script>');
      if (url === "/auth/v1/token") return J({ access_token: "tok", expires_in: 300 });
      if (url.startsWith("/content/v2/discover/browse")) return J({ data: url.includes("seasonal_tag=") && !window.__browsed++ ? [{ id: "GA", title: "Anime A", slug_title: "anime-a", last_public: iso(now - H) },
        { id: "GB", title: "Anime B", slug_title: "anime-b", last_public: iso(now - 4 * H) }] : [] });
      if (url.startsWith("/content/v2/cms/series/GA/seasons")) return J({ data: [{ id: "SJ", title: "Anime A", season_number: 1, season_sequence_number: 1,
        versions: [{ audio_locale: "ja-JP", guid: "SJ" }, { audio_locale: "de-DE", guid: "SD" }] }] });
      if (url.startsWith("/content/v2/cms/seasons/SJ/episodes")) return J({ data: [ep("EJ3", 3, now - 6.5 * D, "Anime A"), ep("EJ4", 4, now - 2 * H, "Anime A")] });
      if (url.startsWith("/content/v2/cms/seasons/SD/episodes")) return J({ data: [ep("ED3", 3, now - 3 * H, "Anime A")] });
      // Anime B: Staffel 2 nur angekündigt (Platzhalter-Datum), es läuft noch Staffel 1
      if (url.startsWith("/content/v2/cms/series/GB/seasons")) return J({ data: [
        { id: "SB2", title: "Anime B Staffel 2", season_number: 2, season_sequence_number: 2, versions: [{ audio_locale: "ja-JP", guid: "SB2" }] },
        { id: "SB1", title: "Anime B", season_number: 1, season_sequence_number: 1, versions: [{ audio_locale: "ja-JP", guid: "SB1" }] }] });
      if (url.startsWith("/content/v2/cms/seasons/SB2/episodes")) return J({ data: [ep("EB2X", 1, Date.parse("9998-11-30T00:00:00Z"), "Anime B Staffel 2")] });
      if (url.startsWith("/content/v2/cms/seasons/SB1/episodes")) return J({ data: [ep("EB7", 7, now - 4 * H, "Anime B")] });
      if (url.startsWith("/content/v2/cms/objects/")) return J({ data: [] });
      return new Response("", { status: 404 });
    };
    window.__browsed = 0;
  })();`;
  // Content-Scripts bei document_start sehen schon <html>; Init-Skripte von Playwright laufen davor: kurz darauf warten
  const code = JSON.stringify(files.map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n;\n"));
  await page.addInitScript({ content: SEED + "\n" + STUB + "\n" + MOCK + `\n(() => { const go = () => (0, eval)(${code});
    if (document.documentElement) go(); else new MutationObserver((m, o) => { if (document.documentElement) { o.disconnect(); go(); } }).observe(document, { childList: true }); })();` });
  await page.goto(BASE + "/robots.txt?simulcastcalendar&p=de/");
  await page.waitForSelector("article.release", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    path: location.pathname + location.search,
    days: document.querySelectorAll("section.day").length,
    pre: document.querySelectorAll("pre").length,
    cards: [...document.querySelectorAll("article.release")].map((a) => ({ t: (c => c.dataset.crlfTitle || c.textContent)(a.querySelector("cite")), ep: a.querySelector(".episode").textContent.trim(),
      soon: a.classList.contains("crlf-soon"), link: (a.querySelector("a[href*='/watch/']") || {}).getAttribute?.("href") || "", btns: !!a.querySelector(".crlf-actions") })),
    msg: (document.querySelector(".crlf-calmsg") || {}).textContent || "",
  }));
  const week0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();
  const inWeek = (t) => t >= week0 && t < week0 + 7 * D;
  const expect = [now - 6.5 * D, now - 2 * H, now - 3 * H, now - 4 * H].filter(inWeek).length;
  ok("Eigener Kalender: alte Adresse, 7 Tage, kein robots-Text", st.path === "/de/simulcastcalendar" && st.days === 7 && st.pre === 0, JSON.stringify({ path: st.path, days: st.days, pre: st.pre, msg: st.msg }));
  ok("Eigener Kalender: Folgen aus dem Katalog, Synchro mit Sprachzusatz", st.cards.filter((c) => !c.soon).length === expect
    && (!inWeek(now - 3 * H) || st.cards.some((c) => c.t === "Anime A (German Dub)")) && st.cards.filter((c) => !c.soon).every((c) => /\/de\/watch\/E/.test(c.link)), JSON.stringify(st.cards));
  ok("Eigener Kalender: laufende Staffel trotz angekündigter neuer Staffel", !inWeek(now - 4 * H) || st.cards.some((c) => /Anime B/.test(c.t) && c.ep.includes("7")), JSON.stringify(st.cards.map((c) => c.t + " " + c.ep)));
  ok("Eigener Kalender: BetterRoll-Knöpfe an allen Karten", st.cards.length > 0 && st.cards.every((c) => c.btns), `${st.cards.length} Karten`);
  await page.goto(BASE + "/robots.txt?simulcastcalendar&p=de/"); // wie die Umleitung beim erneuten Öffnen
  await page.waitForSelector("article.release", { timeout: 5000 }).catch(() => {});
  const again = await page.evaluate(() => ({ calls: (window.__calls || ["fehlt"]).filter((u) => u.startsWith("/content/v2/discover") || u.includes("/cms/series") || u.includes("/cms/seasons")).length,
    cards: document.querySelectorAll("article.release").length }));
  ok("Eigener Kalender: zweiter Aufruf aus dem Speicher (kein Abruf)", again.calls === 0 && again.cards === st.cards.length, JSON.stringify(again));
  ok("Eigener Kalender ohne Skriptfehler", !errors.length, errors.join(" | "));
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
    sessionStorage.setItem("st_local", JSON.stringify({ marks: { frieren: "fav", "one piece": "dim" }, playerSpeed: 1.25,
      alMap: { frieren: { id: 154587, title: "Frieren", url: "https://anilist.co/anime/154587" }, boese: { id: 1, url: "javascript:alert(1)" }, kaputt: { id: "x" } } }));
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
  ok("Popup: Laden übernimmt nur sichere Titel-Zuordnungen", back[1].alMap && Object.keys(back[1].alMap).join() === "frieren", JSON.stringify(back[1].alMap));
  ok("Popup: Laden stellt Stand wieder her", back[0].favTop === false && back[0].pageTheme === "light" && back[1].marks.frieren === "fav" && back[1].playerSpeed === 1.25);
  await page.waitForTimeout(1500);
  ok("Popup ohne Skriptfehler", !errors.length, errors.join(" | "));
  await ctx.close();
}

// ===== 2b. Links aus fremden Daten: nur https =====
{
  const code = fs.readFileSync(path.join(ROOT, "src/comments.js"), "utf8").match(/function safeUrl[\s\S]*?\n}/)[0];
  const safeUrl = new Function(code + "; return safeUrl;")();
  ok("Links: https bleibt, javascript:/http: fallen weg",
    safeUrl("https://anilist.co/anime/1") === "https://anilist.co/anime/1" && !safeUrl("javascript:alert(1)") && !safeUrl("http://x.de") && !safeUrl(undefined));
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
// ===== 3b. Auto-Skip nach eigenem Vorspulen: erstes Mal überspringen, zurückgespult nicht erneut =====
// Der Testserver kann nicht wirklich spulen (keine Range-Anfragen): Abspielzeit daher nachgestellt, Spulen löst seeked aus
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/video.html");
  await page.evaluate(() => { const v = document.getElementById("v"), b = document.getElementById("sk"); let pos = 0;
    Object.defineProperty(v, "currentTime", { get: () => pos, set: (x) => { pos = x; v.dispatchEvent(new Event("seeking")); setTimeout(() => v.dispatchEvent(new Event("seeked")), 20); } });
    b.onclick = () => { __clicks++; v.currentTime = 90; }; // Intro 60–90 s
    return v.play(); });
  await page.waitForTimeout(400);
  // selbst mitten ins Intro vorgespult, Knopf erscheint sofort
  await page.evaluate(() => { document.getElementById("v").currentTime = 62; document.getElementById("sk").style.display = "block"; });
  await page.waitForTimeout(1500);
  const first = await page.evaluate("__clicks");
  // Knopf weg, dann selbst zurück ins übersprungene Intro
  await page.evaluate(() => { document.getElementById("sk").style.display = "none"; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById("v").currentTime = 61; document.getElementById("sk").style.display = "block"; });
  await page.waitForTimeout(1500);
  const again = await page.evaluate("__clicks");
  ok("Auto-Skip überspringt auch nach eigenem Vorspulen", first === 1, `${first} Klicks`);
  ok("Auto-Skip: zurückgespult ins Intro wird nicht erneut übersprungen", again === 1, `${again} Klicks`);
  ok("Auto-Skip (Spulen) ohne Skriptfehler", !errors.length, errors.join(" | "));
  await page.close();
}
// ===== 3c. Player hängt in der letzten Sekunde (spielt, Zeit steht, kein „ended“): ans Ende springen, sonst „ended“ melden =====
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/video.html");
  await page.evaluate(() => { const v = document.getElementById("v"); let pos = 1419.6; window.__seeks = []; window.__ended = 0;
    Object.defineProperty(v, "duration", { get: () => 1420 });
    Object.defineProperty(v, "currentTime", { get: () => pos, set: (x) => { __seeks.push(x); pos = Math.min(x, 1419.9); } }); // Sprung landet knapp davor
    v.addEventListener("ended", () => __ended++);
    return v.play(); });
  await page.waitForTimeout(2200);
  const seeks = await page.evaluate("__seeks.slice()");
  await page.waitForTimeout(2000);
  const ended = await page.evaluate("__ended");
  ok("Folgenende: Hänger springt ans Ende", seeks.length === 1 && seeks[0] === 1420, JSON.stringify(seeks));
  ok("Folgenende: danach „ended“ gemeldet (nächste Folge)", ended === 1, `${ended}x`);
  ok("Folgenende ohne Skriptfehler", !errors.length, errors.join(" | "));
  await page.close();
}
// ===== 3d. Letzte Sekunde der Folge: Knopf „Nächste Folge“ drücken, ohne Knopf den Link darunter öffnen =====
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/de/watch/CCC333/folge-3");
  await page.evaluate(() => { const v = document.getElementById("v"); let pos = 1300;
    Object.defineProperty(v, "duration", { get: () => 1420 });
    Object.defineProperty(v, "currentTime", { get: () => pos, set: (x) => { pos = x; } });
    window.__jump = () => { pos = 1419.4; };
    return v.play(); });
  await page.waitForTimeout(800);
  const before = await page.evaluate("__next");
  await page.evaluate(() => __jump());
  await page.waitForTimeout(1500);
  const btn = await page.evaluate("[__next, __prev]");
  ok("Nächste Folge: vor der letzten Sekunde nichts", before === 0, `${before}x`);
  ok("Nächste Folge: Knopf in der letzten Sekunde gedrückt (einmal)", btn[0] === 1 && btn[1] === 0, JSON.stringify(btn));
  // Abspann-Knopf gegen Ende: überspringen, danach läuft der Rest (Teaser) bis zur letzten Sekunde.
  // mode: "run" Teaser läuft; "frozen" Player steht nach dem Sprung; "nudge" steht, bis BetterRoll ihn anstößt
  const outroPage = async (mode) => { await page.reload(); await page.evaluate((mode) => { const v = document.getElementById("v"), b = document.getElementById("ab"); let pos = 1330, run = mode === "run", seeks = 0;
    Object.defineProperty(v, "duration", { get: () => 1420 });
    Object.defineProperty(v, "currentTime", { get: () => pos, set: (x) => { pos = x; seeks++; if (mode === "nudge" && seeks > 1) run = true;
      v.dispatchEvent(new Event("seeking")); setTimeout(() => v.dispatchEvent(new Event("seeked")), 20); } });
    b.onclick = () => { __ab++; b.style.display = "none"; v.currentTime = 1380; }; // Abspann bis 23:00, danach 40 s Teaser
    setInterval(() => { if (run && pos >= 1380) pos += 0.25; }, 250);
    window.__set = (x) => { pos = x; };
    b.style.display = "block";
    return v.play(); }, mode); };
  await outroPage("run");
  await page.waitForTimeout(2500);
  const teaser = await page.evaluate("[__ab, __next]");
  await page.evaluate(() => __set(1419.2));
  await page.waitForTimeout(800);
  const atLast = await page.evaluate("__next");
  ok("Abspann übersprungen, Teaser danach läuft weiter", teaser[0] === 1 && teaser[1] === 0, JSON.stringify(teaser));
  ok("Nach dem Teaser in der letzten Sekunde zur nächsten Folge", atLast === 1, `${atLast}x`);
  // nach dem Abspann-Sprung steht der Player, Anstoßen löst ihn: Teaser läuft, keine nächste Folge
  await outroPage("nudge");
  await page.waitForTimeout(7000);
  const nudged = await page.evaluate("[__ab, __next, document.getElementById('v').currentTime]");
  ok("Hänger nach Abspann-Sprung: angestoßen, Teaser läuft weiter", nudged[0] === 1 && nudged[1] === 0 && nudged[2] > 1381, JSON.stringify(nudged));
  // steht auch nach dem Anstoßen: dann zur nächsten Folge
  await outroPage("frozen");
  await page.waitForTimeout(3000);
  const stillEarly = await page.evaluate("__next");
  await page.waitForTimeout(5000);
  const stalled = await page.evaluate("[__ab, __next]");
  ok("Hänger nach Abspann-Sprung: erst anstoßen, dann nächste Folge", stillEarly === 0 && stalled[0] === 1 && stalled[1] === 1, `${stillEarly} / ${JSON.stringify(stalled)}`);
  await page.goto(BASE + "/de/watch/AAA111/folge-1");
  await page.evaluate(() => { const v = document.getElementById("v"); Object.defineProperty(v, "duration", { get: () => 1420 });
    v.dispatchEvent(new Event("ended")); });
  await page.waitForTimeout(1500);
  ok("Nächste Folge: ohne Knopf den Link geöffnet", /\/watch\/BBB222\//.test(page.url()), page.url());
  ok("Nächste Folge ohne Skriptfehler", !errors.length, errors.join(" | "));
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
  // Pause nach Ablehnung: keine weitere Anfrage an AniList, andere Dienste unberührt
  fetches = 0;
  const p = await ask({ ...q, query: "query{y}" });
  ok("Hintergrund: Pause nach Ablehnung", fetches === 0 && p.error === "vorübergehend gesperrt", `${fetches} Abrufe, Antwort „${p.error}“`);
  ctx.fetch = async () => { fetches++; return { ok: false, status: 403, json: async () => null }; };
  await ask({ type: "crlf-jikan", path: "/x" });
  ok("Hintergrund: Jikan läuft trotz AniList-Pause, 403 sofort Pause", fetches === 1, `${fetches} Abruf`);
  fetches = 0;
  await ask({ type: "crlf-jikan", path: "/y" });
  ok("Hintergrund: Jikan danach ebenfalls pausiert", fetches === 0);
}

// ===== 5. Update-Hinweis am Symbol: heller Ring nur bei neuerer Version, Zeitplan nur einmal angelegt =====
{
  const handlers = [], icons = [], alarms = {}, store = {};
  let created = 0; const startups = []; let answer = { ok: true, newer: true, latest: "9.9.9" };
  const noop = { addListener() {} };
  const chrome = { runtime: { onMessage: { addListener: (f) => handlers.push(f) }, onInstalled: noop, onStartup: { addListener: (f) => startups.push(f) },
        getURL: (p) => p, lastError: null, sendNativeMessage: (_h, _m, cb) => setTimeout(() => cb(answer), 0) },
      action: { setIcon: (o, cb) => { icons.push(o.path); cb && cb(); }, setTitle() {} },
      alarms: { get: (n, cb) => cb(alarms[n]), create: (n, o) => { created++; alarms[n] = o; }, onAlarm: noop },
      storage: { onChanged: noop, local: { get: async () => ({ ...store }), set: async (o) => Object.assign(store, o), remove: async () => {} }, sync: { get: async () => ({}), set: async () => {} } },
      permissions: { onAdded: noop, onRemoved: noop } };
  const bg = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
  const start = () => vm.runInContext(bg, vm.createContext({ console, setTimeout, clearTimeout, AbortController, URL, SyntaxError, fetch: async () => ({ ok: false }), chrome }));
  start();
  start(); // Hintergrund startet neu
  ok("Update-Symbol: Zeitplan nur einmal angelegt", created === 1 && alarms["crlf-update-check"].periodInMinutes === 60, `${created}×`);
  startups.slice(-1)[0]();
  await new Promise((r) => setTimeout(r, 20));
  ok("Update-Symbol: Ring bei neuerer Version", icons.length === 1 && /upd/.test(icons[0][16]), JSON.stringify(icons.at(-1)));
  answer = { ok: true, newer: false, latest: "1.0.0" };
  await new Promise((r) => handlers.forEach((f) => f({ type: "crlf-update-check" }, {}, r)));
  ok("Update-Symbol: normal ohne Update", icons.length === 2 && !/upd/.test(icons[1][16]));
  answer = { ok: false, missing: true };
  startups.slice(-1)[0]();
  await new Promise((r) => setTimeout(r, 20));
  ok("Update-Symbol: ohne Helfer unverändert", icons.length === 2);
  // Kalender geöffnet: prüft, aber höchstens alle 15 Min.
  let asked = 0; const sn = chrome.runtime.sendNativeMessage;
  chrome.runtime.sendNativeMessage = (h, m, cb) => { asked++; sn(h, m, cb); };
  answer = { ok: true, newer: true, latest: "9.9.9" };
  const ping = () => handlers.slice(-1)[0]({ type: "crlf-update-ping" }, {}, () => {});
  ping(); await new Promise((r) => setTimeout(r, 20));
  ok("Update-Symbol: Kalender öffnen gedrosselt (kurz nach letzter Prüfung)", asked === 0, `${asked} Prüfungen`);
  store.updCheckedAt = Date.now() - 16 * 60 * 1000;
  ping(); await new Promise((r) => setTimeout(r, 20)); ping(); await new Promise((r) => setTimeout(r, 20));
  ok("Update-Symbol: Kalender öffnen prüft nach 15 Min.", asked === 1 && /upd/.test(icons.at(-1)[16]), `${asked} Prüfungen`);
  for (const f of Object.values(icons[0])) ok(`Update-Symbol: ${f} vorhanden`, fs.existsSync(path.join(SRC, f)));
}

// ===== 6. Design „Video“: jedes Motiv hat Video, Standbild und Eintrag in der Popup-Auswahl =====
{
  const names = JSON.parse(fs.readFileSync(path.join(SRC, "theme.js"), "utf8").match(/const CRLF_VIDEOS = (\[[^\]]*\])/)[1]);
  const popup = fs.readFileSync(path.join(SRC, "popup.js"), "utf8").match(/const VIDEOS = \{([^}]*)\}/)[1];
  const listed = [...popup.matchAll(/(\w+):/g)].map((m) => m[1]).filter((n) => n !== "auto");
  ok("Video: Popup-Auswahl = Motivliste", JSON.stringify(listed) === JSON.stringify(names), `${names.length} Motive`);
  for (const n of names) ok(`Video: ${n} (webm + Standbild)`,
    fs.statSync(path.join(SRC, "backgrounds", `${n}.webm`), { throwIfNoEntry: false })?.size > 1e5 &&
    fs.existsSync(path.join(SRC, "backgrounds", "blur", `${n}.jpg`)));
}

// ===== Ausgabe =====
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.measure ? "  ·" : r.ok ? "OK " : "FEHLER"} ${r.name}${r.info ? ` – ${r.info}` : ""}`);
}
console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : `\nAlle ${results.filter((r) => !r.measure).length} Tests bestanden`);
process.exit(failed ? 1 : 0);
