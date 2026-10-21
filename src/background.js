// background.js – Hintergrund-Dienst (MV3 Service Worker).
//
// Abschnitte:
//   1. Abrufe für die Kalender-Skripte: AniList (Poster, Bewertungen, 💬), Anime News Network (News),
//      MyAnimeList über Jikan (Ersatz für 💬). Sie laufen hier statt im Tab: so gelten die Regeln der
//      Crunchyroll-Seite (CSP/CORS) nicht, und Fehler kommen mit echtem Status zurück. Nur lesend.
//   2. Eigenes Hintergrundbild (Design „Bild“) verkleinern und speichern
//   3. Erstinstallation: Sprache aus lang.json, Willkommensseite
//   4. ★/▼ über die Synchronisierung des Browsers auf alle Geräte bringen
//   5. Updates per ↻ über den lokalen Helfer der entpackten Installation (fehlt in den Store-Paketen)

// ===== 1. Abrufe =====
const JIKAN_BASE = "https://api.jikan.moe/v4";
let queue = Promise.resolve();

// Fehlerliste fürs Popup (Erweitert): die letzten 20 Fehler mit Uhrzeit in storage.local „crErrors“, nur auf diesem
// Gerät, nichts wird gesendet. Gleicher Fehler noch einmal: nur Zähler und Zeit erhöhen. Die Tabs melden per Nachricht
// „crlf-error“, geschrieben wird nur hier und nacheinander.
let errWrite = Promise.resolve();
function logError(where, msg) {
  msg = String((msg && msg.message) || msg || "?").slice(0, 300);
  where = String(where).slice(0, 80);
  errWrite = errWrite.then(async () => {
    const { crErrors: list = [] } = await chrome.storage.local.get("crErrors");
    const same = list.find((e) => e.where === where && e.msg === msg);
    if (same) { same.n = (same.n || 1) + 1; same.t = Date.now(); }
    else list.push({ t: Date.now(), where, msg, n: 1 });
    list.sort((a, b) => b.t - a.t);
    await chrome.storage.local.set({ crErrors: list.slice(0, 20) });
  }).catch(() => {});
}
const host = (url) => { try { return new URL(url).hostname; } catch (e) { return url; } };

// Pause je Dienst nach Ablehnung oder Ausfall (403, 429, 5xx, keine Verbindung): 5 Min., bei Wiederholung 10/20/30 Min.
// In der Pause geht keine Anfrage raus, die Antwort ist sofort „vorübergehend gesperrt“. Erfolg hebt die Pause auf.
// (Nur im Speicher: startet der Hintergrund neu, wird wieder normal gefragt.)
const PAUSE_MIN = [5, 10, 20, 30];
const paused = new Map(); // Host -> { until, step }
function pauseHost(h, why) {
  const p = paused.get(h);
  const step = p ? Math.min(p.step + 1, PAUSE_MIN.length - 1) : 0;
  paused.set(h, { until: Date.now() + PAUSE_MIN[step] * 60000, step });
  logError(h, `${why} – Pause ${PAUSE_MIN[step]} Min.`);
}

// Fehlschlag eintragen: Ablehnung/Ausfall -> Pause, sonst nur in die Fehlerliste („nicht gefunden“ ist normal)
function noteFailure(h, r) {
  if (r.ok || r.paused || r.status === 404) return;
  if (r.status === 0 && r.error !== "ungültige Antwort") pauseHost(h, r.error);
  else if (r.status === 403 || r.status === 429 || r.status >= 500) pauseHost(h, `Antwort ${r.status}${r.status === 429 ? " (zu viele Anfragen)" : ""}`);
  else logError(h, r.error || `Antwort ${r.status}`);
}

// Ein Abruf mit 15 s Zeitlimit; Antwort als JSON (bzw. Text bei asText). Fehler kommen als { ok: false, status, error }.
// final = false: Fehlschlag noch nicht eintragen (fetchRetry versucht es gleich noch einmal)
async function fetchOnce(url, init = {}, asText = false, final = true) {
  const h = host(url), p = paused.get(h);
  if (p && Date.now() < p.until) return { ok: false, status: 0, error: "vorübergehend gesperrt", paused: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (res.ok) paused.delete(h);
    else if (final) noteFailure(h, { ok: false, status: res.status });
    if (asText) return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
    const json = res.ok ? await res.json() : null;
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    const error = e.name === "AbortError" ? "Zeitüberschreitung" : e instanceof SyntaxError ? "ungültige Antwort" : "keine Verbindung";
    if (final) noteFailure(h, { ok: false, status: 0, error });
    return { ok: false, status: 0, error };
  } finally {
    clearTimeout(timer);
  }
}

// bei Netzfehler, 429 (zu viele Anfragen) oder 5xx nach 1,5 s einmal wiederholen
async function fetchRetry(url, init) {
  const r = await fetchOnce(url, init, false, false);
  if (r.ok || r.paused) return r;
  if (!(r.status === 0 || r.status === 429 || r.status >= 500)) { noteFailure(host(url), r); return r; }
  await new Promise((ok) => setTimeout(ok, 1500));
  return fetchOnce(url, init);
}

// Jikan erlaubt ca. 3 Anfragen/Sekunde: nacheinander mit Abstand
function jikanFetch(path) {
  const run = queue.then(async () => {
    const r = await fetchRetry(JIKAN_BASE + path);
    await new Promise((ok) => setTimeout(ok, 400));
    return r;
  });
  queue = run.catch(() => {});
  return run;
}

// AniList: öffentliche GraphQL-API ohne Schlüssel (ca. 30 Anfragen/Minute), nur Leseabfragen
function anilistFetch(query, variables) {
  return fetchRetry("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }) });
}

// Anime News Network (Lexikon-API, liefert XML mit den News eines Anime): höchstens 1 Anfrage/Sekunde,
// darum nacheinander. Der Text wird im Kalender-Tab gelesen (hier gibt es keinen XML-Parser).
let annQueue = Promise.resolve();
function annFetch(name) {
  const url = `https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=~${encodeURIComponent(name)}`;
  const run = annQueue.then(async () => {
    const r = await fetchOnce(url, { credentials: "omit" }, true);
    await new Promise((ok) => setTimeout(ok, 1100));
    return r;
  });
  annQueue = run.catch(() => {});
  return run;
}

// Gleiche Anfrage läuft schon (Doppelklick, Vorschau und 💬 zugleich, zwei Tabs): auf deren Antwort warten statt
// erneut abzurufen. Gilt nur, solange sie läuft; danach entscheidet wieder der Zwischenspeicher der Tabs.
const running = new Map();
function shared(key, load) {
  if (running.has(key)) return running.get(key);
  const job = load().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

// Anfragen der Kalender-Skripte und des Popups (Antwort jeweils asynchron)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "crlf-ann" && typeof msg.name === "string" && msg.name.length <= 200) {
    shared("ann|" + msg.name, () => annFetch(msg.name)).then(sendResponse);
    return true;
  }
  if (msg.type === "crlf-jikan" && typeof msg.path === "string" && msg.path.startsWith("/")) {
    shared("jikan|" + msg.path, () => jikanFetch(msg.path)).then(sendResponse);
    return true; // Antwort kommt asynchron
  }
  if (msg.type === "crlf-anilist" && typeof msg.query === "string" && !/\bmutation\b/i.test(msg.query)) {
    const vars = msg.variables || {};
    shared("anilist|" + msg.query + "|" + JSON.stringify(vars), () => anilistFetch(msg.query, vars)).then(sendResponse);
    return true;
  }
  if (msg.type === "crlf-error") { logError(msg.where, msg.msg); return; }
  if (msg.type === "crlf-banner") {
    makeBanner(msg).then(sendResponse);
    return true;
  }
});

// ===== 2. Eigenes Hintergrundbild (Design „Bild“) =====
// Das Popup schickt eine Bildadresse (nach Freigabe genau dieser Seite) oder eine Datei vom PC (als data:-Adresse).
// Das Bild wird hier einmal geladen, auf die Bildschirmgröße verkleinert (w × h, deckend wie „cover“) und als JPEG in
// storage.local „crBanner“ abgelegt; der Kalender zeichnet es von dort, ohne das Bild erneut abzurufen.
// Popup und permissions.onAdded können dieselbe Adresse gleichzeitig anstoßen: dann nur einmal laden
const bannerJobs = new Map();
function makeBanner(msg) {
  const id = msg.url || msg.dataUrl || "";
  if (!bannerJobs.has(id)) bannerJobs.set(id, loadBanner(msg).finally(() => bannerJobs.delete(id)));
  return bannerJobs.get(id);
}
async function loadBanner({ url, dataUrl, name, w, h }) {
  if (url) chrome.storage.local.remove("crBannerPending"); // erledigt, egal wie es ausgeht
  try {
    let blob;
    if (dataUrl) blob = await (await fetch(dataUrl)).blob();
    else {
      if (!/^https?:\/\//i.test(url || "")) return { error: "Keine gültige Adresse" };
      const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      blob = await res.blob();
    }
    if (!/^image\//.test(blob.type) && blob.type) return { error: "Kein Bild" };
    const bmp = await createImageBitmap(blob);
    const ow = bmp.width, oh = bmp.height;
    const tw = Math.min(Math.max(+w || 1920, 640), 3840), th = Math.min(Math.max(+h || 1080, 360), 2160);
    const scale = Math.min(1, Math.max(tw / ow, th / oh)); // nur verkleinern
    const cw = Math.max(1, Math.round(ow * scale)), ch = Math.max(1, Math.round(oh * scale));
    const canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext("2d").drawImage(bmp, 0, 0, cw, ch);
    bmp.close();
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
    const bytes = new Uint8Array(await out.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const banner = { src: `data:image/jpeg;base64,${btoa(bin)}`, w: cw, h: ch, ow, oh, from: dataUrl ? name || "" : url, t: Date.now() };
    await chrome.storage.local.set({ crBanner: banner });
    return { ok: true, w: cw, h: ch, ow, oh };
  } catch (e) {
    return { error: /decode|source image/i.test(e.message || "") ? "Kein Bild" : "keine Verbindung" };
  }
}
// Firefox schließt das Popup, sobald die Freigabe-Abfrage erscheint: Dann holt der Hintergrund die vorgemerkte Adresse
chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  await new Promise((ok) => setTimeout(ok, 1500)); // ist das Popup noch offen, erledigt es das selbst
  const { crBannerPending: p } = await chrome.storage.local.get("crBannerPending");
  if (p && p.url && origins.some((o) => o.replace(/\/\*$/, "") === new URL(p.url).origin)) makeBanner(p);
});

// ===== 3. Erstinstallation =====
// Sprache aus einer optionalen Datei lang.json im Add-on-Ordner übernehmen ({ "lang": "de" | "en" }),
// z. B. von einem Installationspaket vorgegeben. Setzt Oberflächensprache und bevorzugte Fassung; fehlt die Datei, bleibt alles ab Werk.
// (Fehlertexte oben wie „Zeitüberschreitung“ bleiben deutsch; comments.js übersetzt sie bei der Anzeige.)
// Danach öffnet sich einmal die Willkommensseite (welcome.html) mit einer kurzen Übersicht der Funktionen.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // „Fehler melden“ gibt es seit 1.82 nicht mehr: dafür gesammelte Daten löschen
  chrome.storage.local.remove(["crReportDraft", "crReportTimes", "crReportHashes", "crInstallId", "crClosedOverlays", "crOverlaySeen", "crSkipLog", "crPlayerDiag"]).catch(() => {});
  if (reason !== "install") return;
  try {
    const res = await fetch(chrome.runtime.getURL("lang.json"), { cache: "no-store" });
    if (res.ok) {
      const { lang } = await res.json();
      if (lang === "de" || lang === "en") await chrome.storage.sync.set({ uiLang: lang, language: lang });
    }
  } catch (e) {} // keine Datei oder ungültig: nichts tun
  chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

// ===== 4. Favoriten über alle Geräte (storage.sync) =====
// ★/▼ liegen in storage.local "marks" (schnell, ohne Grenzen). Dieser Abschnitt spiegelt sie ins Browser-Konto
// (Chrome-/Firefox-Synchronisierung), damit jeder PC desselben Kontos dieselben Markierungen hat.
// Format in sync: "mk0".."mkN" = { Titel: "f" | "d" } (je Teil < 8 KB), "mkMeta" = { n, ts }. Es wird nur die
// Titelliste übertragen, nichts sonst. Neuere Änderung gewinnt (ts); beim ersten Abgleich wird zusammengeführt.
const MK_CHUNK = 7000; // Bytes je Teil (Grenze von storage.sync: 8192 je Eintrag)
let mkPushed = ""; // zuletzt übertragener/übernommener Stand (JSON), verhindert Ping-Pong
let mkTimer = 0;
// Markierungen als vergleichbarer Text (Reihenfolge egal)
const mkJson = (m) => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));

// Markierungen in Teile < MK_CHUNK aufteilen (kurz: "f"/"d")
function mkPack(marks) {
  const parts = [{}];
  let size = 2;
  for (const [k, v] of Object.entries(marks)) {
    if (v !== "fav" && v !== "dim") continue;
    const add = new TextEncoder().encode(JSON.stringify(k)).length + 5;
    if (size + add > MK_CHUNK) { parts.push({}); size = 2; }
    parts[parts.length - 1][k] = v === "fav" ? "f" : "d";
    size += add;
  }
  return parts;
}

// Stand im Konto lesen: { marks, ts } oder null, wenn dort noch nichts liegt
async function mkReadSync() {
  const { mkMeta } = await chrome.storage.sync.get("mkMeta");
  if (!mkMeta || !mkMeta.n) return null;
  const keys = Array.from({ length: mkMeta.n }, (_, i) => "mk" + i);
  const got = await chrome.storage.sync.get(keys);
  const marks = {};
  for (const k of keys) for (const [t, v] of Object.entries(got[k] || {})) marks[t] = v === "f" ? "fav" : "dim";
  return { marks, ts: mkMeta.ts || 0 };
}

// Stand ins Konto schreiben (alle Teile in einem Aufruf, überzählige alte Teile löschen)
async function mkPush(marks, ts) {
  const parts = mkPack(marks);
  const data = { mkMeta: { n: parts.length, ts } };
  parts.forEach((p, i) => { data["mk" + i] = p; });
  const { mkMeta: old } = await chrome.storage.sync.get("mkMeta");
  mkPushed = mkJson(marks);
  try {
    await chrome.storage.sync.set(data);
    const extra = [];
    for (let i = parts.length; old && i < old.n; i++) extra.push("mk" + i);
    if (extra.length) await chrome.storage.sync.remove(extra);
  } catch (e) { logError("★/▼ ins Konto übertragen", e); } // Kontingent erschöpft o. Ä.: lokal bleibt alles erhalten, nächster Versuch bei der nächsten Änderung
}

// beim Start: Stand des Kontos und dieses Geräts abgleichen
async function mkStartup() {
  clearTimeout(mkTimer);
  const { marks = {}, marksTs } = await chrome.storage.local.get(["marks", "marksTs"]);
  const remote = await mkReadSync();
  if (!remote) { if (Object.keys(marks).length) mkPush(marks, marksTs || Date.now()); return; }
  if (!marksTs) { // erster Abgleich auf diesem Gerät: zusammenführen (Konto gewinnt bei Widerspruch)
    const merged = { ...marks, ...remote.marks }, ts = Date.now();
    mkPushed = mkJson(merged);
    await chrome.storage.local.set({ marks: merged, marksTs: ts });
    if (mkJson(merged) !== mkJson(remote.marks)) mkPush(merged, ts);
  } else if (remote.ts > marksTs) {
    mkPushed = mkJson(remote.marks);
    await chrome.storage.local.set({ marks: remote.marks, marksTs: remote.ts });
  } else if (marksTs > remote.ts) mkPush(marks, marksTs);
}

// lokale Änderung -> (entprellt) ins Konto; Änderung aus dem Konto (anderes Gerät) -> lokal übernehmen, wenn neuer
chrome.storage.onChanged.addListener(async (c, area) => {
  if (area === "local" && c.marks) {
    const marks = c.marks.newValue || {};
    if (mkJson(marks) === mkPushed) return; // kam gerade aus dem Konto
    const ts = Date.now();
    chrome.storage.local.set({ marksTs: ts }); // sofort: eine ältere Änderung aus dem Konto darf diese nicht überschreiben
    clearTimeout(mkTimer); // mehrere Klicks kurz hintereinander: einmal übertragen (Schreibgrenzen von sync)
    mkTimer = setTimeout(() => mkPush(marks, ts), 1500);
  } else if (area === "sync" && c.mkMeta && c.mkMeta.newValue) {
    const remote = await mkReadSync();
    if (!remote || mkJson(remote.marks) === mkPushed) return;
    const { marksTs = 0 } = await chrome.storage.local.get("marksTs");
    if (remote.ts < marksTs) return;
    mkPushed = mkJson(remote.marks);
    chrome.storage.local.set({ marks: remote.marks, marksTs: remote.ts });
  }
});
chrome.runtime.onStartup.addListener(mkStartup);
chrome.runtime.onInstalled.addListener(mkStartup);

// @updater-begin (build.py entfernt diesen Abschnitt in den Store-Paketen; dort aktualisiert der Store)
// ===== 5. Updates per Knopf (entpackt installiert) =====
// Ein Add-on darf keine Dateien schreiben. Das übernimmt ein kleiner Helfer auf dem PC (Native Messaging,
// „com.betterroll.updater“), den der Installer bzw. „Updates einrichten“ anmeldet: Er startet updater.ps1, der nur
// die öffentliche latest.json liest, das Paket lädt, dessen SHA-256 prüft und die Dateien austauscht. Es wird nichts
// gesendet. Das Popup fragt beim Öffnen nach („check“) und zeigt ↻ als bereit; ein Klick holt das Update („update“),
// danach lädt sich das Add-on neu. Kein Zeitplan mehr im Browser; der Updater prüft nur noch bei der Windows-Anmeldung.
const HOST = "com.betterroll.updater";
// Helfer fragen; fehlt er (noch nicht eingerichtet), kommt { ok: false, missing: true }
function native(cmd) {
  return new Promise((ok) => {
    if (!chrome.runtime.sendNativeMessage) return ok({ ok: false, missing: true });
    chrome.runtime.sendNativeMessage(HOST, { cmd }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) return ok({ ok: false, missing: /not found|forbidden|not allowed|exited/i.test(err.message || ""), msg: err.message });
      ok(res && typeof res === "object" ? res : { ok: false });
    });
  });
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || (msg.type !== "crlf-update-check" && msg.type !== "crlf-update-run")) return;
  if (msg.type === "crlf-update-check") { native("check").then(sendResponse); return true; }
  native("update").then(async (res) => {
    sendResponse(res);
    if (!res.ok || !res.updated) return;
    // offene Kalender-Tabs vorwarnen, dann neu laden (die Tabs laden sich danach selbst neu)
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => new Promise((done) => chrome.tabs.sendMessage(t.id, { type: "crlf-reload-soon" }, () => { void chrome.runtime.lastError; done(); }))));
    setTimeout(() => chrome.runtime.reload(), 300);
  });
  return true;
});
// @updater-end
