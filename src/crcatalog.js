// Beschreibungen und Sterne aus dem öffentlichen Crunchyroll-Katalog (Einstellung „crApi“). Nur in der privaten Fassung:
// build.py lässt diese Datei in den Store-Paketen weg.
// Ohne Anmeldung: ein anonymer Schlüssel (grant_type=client_id), wie ihn die Seite für nicht eingeloggte Besucher
// nutzt. Keine Cookies, kein Konto, nur Katalogdaten. Alle Serien des Kalenders gebündelt (je Abruf bis 40),
// je Serie 30 Tage gemerkt (storage.local crDesc). Fehler/Ablehnung: 30 Min. Pause, dann gilt der alte Weg
// (Beschreibung aus der Einblendung der Seite, sonst AniList).
const CRLF_CAT_TTL = 30 * 864e5, CRLF_CAT_PAUSE = 30 * 60e3, CRLF_CAT_BATCH = 40;
const crlfCat = new Map(); // Serien-ID -> { d: Beschreibung, t: Zeitpunkt }
let crlfCatOn = false, crlfCatTok = null, crlfCatRun = null;

// Beschreibung einer Serie aus dem Katalog ("" = unbekannt); für theme.js (Vorschau)
function crlfCatDesc(sid) {
  const e = crlfCatOn && sid && crlfCat.get(String(sid).toUpperCase());
  return (e && e.d) || "";
}

// Sprache des Katalogs aus der Adresse (/de/…, /es-es/…, ohne Kürzel = Englisch)
function crlfCatLocale() {
  const m = location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,3})?)\//i), p = m ? m[1].toLowerCase() : "";
  const map = { de: "de-DE", fr: "fr-FR", es: "es-419", "es-es": "es-ES", "pt-br": "pt-BR", "pt-pt": "pt-PT", it: "it-IT", ru: "ru-RU", ar: "ar-SA", hi: "hi-IN" };
  return map[p] || "en-US";
}

// öffentliche Kennung der Web-App für anonyme Besucher (steht im HTML der Startseite); 7 Tage gemerkt
async function crlfCatClient() {
  const { crCatCfg: c } = await chrome.storage.local.get("crCatCfg");
  if (c && c.id && Date.now() - c.t < 7 * 864e5) return c;
  const m = location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,3})?)\//i);
  const res = await fetch(m ? `/${m[1]}/` : "/", { credentials: "omit" });
  if (!res.ok) throw new Error(`Startseite HTTP ${res.status}`);
  const html = await res.text();
  const pick = (k) => { const r = html.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']*)["']`)); return r ? r[1] : null; };
  const cfg = { id: pick("anonClientId") || pick("accountAuthClientId"), secret: pick("anonClientSecret") || "", t: Date.now() };
  if (!cfg.id) throw new Error("Kennung der Web-App nicht gefunden");
  await chrome.storage.local.set({ crCatCfg: cfg });
  return cfg;
}

// anonymer Zugangsschlüssel (nur im Arbeitsspeicher, läuft nach Minuten ab)
async function crlfCatToken() {
  if (crlfCatTok && Date.now() < crlfCatTok.until) return crlfCatTok.token;
  const cfg = await crlfCatClient();
  const device = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const res = await fetch("/auth/v1/token", {
    method: "POST", credentials: "omit",
    headers: { Authorization: "Basic " + btoa(`${cfg.id}:${cfg.secret}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_id&device_id=${encodeURIComponent(device)}&device_type=${encodeURIComponent("Chrome on Windows")}`
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) chrome.storage.local.remove("crCatCfg"); // Kennung veraltet: neu lesen
    throw new Error(`Schlüssel HTTP ${res.status}`);
  }
  const j = await res.json();
  if (!j.access_token) throw new Error("kein Schlüssel");
  crlfCatTok = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 300) - 30) * 1000 };
  return crlfCatTok.token;
}

// Beschreibungen für die Serien-IDs holen und merken
async function crlfCatFetch(ids) {
  const token = await crlfCatToken();
  for (let i = 0; i < ids.length; i += CRLF_CAT_BATCH) {
    const part = ids.slice(i, i + CRLF_CAT_BATCH);
    const res = await fetch(`/content/v2/cms/objects/${part.join(",")}?locale=${crlfCatLocale()}`, { credentials: "omit", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Katalog HTTP ${res.status}`);
    const j = await res.json();
    for (const o of (j && j.data) || []) {
      const d = String(o.description || (o.series_metadata && o.series_metadata.description) || "").replace(/\s+/g, " ").trim();
      if (o.id && d) crlfCat.set(String(o.id).toUpperCase(), { d, t: Date.now() });
    }
    // auch unbekannte IDs merken (leer), damit sie nicht bei jedem Aufruf erneut gefragt werden
    for (const id of part) if (!crlfCat.has(id)) crlfCat.set(id, { d: "", t: Date.now() });
  }
  const store = {};
  for (const [k, v] of crlfCat) if (Date.now() - v.t < CRLF_CAT_TTL) store[k] = v;
  await chrome.storage.local.set({ crDesc: store });
}

// Crunchyroll-Sterne einer Serie über die öffentliche Bewertungs-Schnittstelle, mit demselben anonymen Schlüssel
// (keine Cookies, kein Konto). Bündeln kennt sie nicht: ein Abruf je Serie, erst beim Überfahren; theme.js merkt das
// Ergebnis (crRating2). Lehnt CR alle bekannten Wege ab (z. B. nur mit Konto): 1 Tag Pause, Eintrag unter „Letzte
// Fehler“, dann gilt der alte Weg (Serienseite). Ergebnis { value, count, best, src: "api" } oder null.
const CRLF_RATE_PATHS = ["/content-reviews/v3/rating/series/", "/content-reviews/v2/rating/series/"], CRLF_RATE_PAUSE = 864e5;
async function crlfCatRating(sid) {
  sid = String(sid || "").toUpperCase();
  if (!crlfCatOn || !/^[A-Z0-9]+$/.test(sid)) return null;
  const { crRatePause = 0, crRatePath } = await chrome.storage.local.get(["crRatePause", "crRatePath"]);
  if (Date.now() < crRatePause) return null;
  const paths = crRatePath ? [crRatePath, ...CRLF_RATE_PATHS.filter((p) => p !== crRatePath)] : CRLF_RATE_PATHS;
  const fails = [];
  try {
    const token = await crlfCatToken();
    for (const p of paths) {
      const res = await fetch(p + sid, { credentials: "omit", headers: { Authorization: `Bearer ${token}` } });
      const r = res.ok ? crlfCatParseRating(await res.json().catch(() => null)) : null;
      if (r) {
        if (p !== crRatePath) chrome.storage.local.set({ crRatePath: p });
        return r.value ? r : null; // noch ohne Bewertungen: kein Fehler, nur kein Wert
      }
      if (res.status === 401) crlfCatTok = null; // Schlüssel abgelaufen: beim nächsten Mal neu holen
      fails.push(`${p.split("/")[2]}: ${res.ok ? "unbekannte Antwort" : "HTTP " + res.status}`);
    }
  } catch (e) { fails.push(e.message || String(e)); }
  chrome.storage.local.set({ crRatePause: Date.now() + CRLF_RATE_PAUSE });
  if (typeof crlfError === "function") crlfError("Crunchyroll-Bewertung", new Error(fails.join(", ")));
  return null;
}
// Antwort lesen: { average: "4.8", total: 12345 | "12.3K", "5s": { displayed: "10.4", unit: "K" }, … }.
// null = keine Bewertungsdaten erkannt; value 0 = Serie hat noch keine Bewertungen.
function crlfCatParseRating(j) {
  if (j && Array.isArray(j.data) && j.data[0]) j = j.data[0];
  if (!j || typeof j !== "object" || !("average" in j || "5s" in j)) return null;
  const num = (x) => {
    if (typeof x === "number") return x;
    const m = String(x == null ? "" : x).replace(",", ".").match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
    return m ? +m[1] * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1) : 0;
  };
  let sum = 0, n = 0;
  for (let i = 1; i <= 5; i++) { const s = j[`${i}s`]; if (s) { const c = num(`${s.displayed}${s.unit || ""}`); n += c; sum += c * i; } }
  const count = num(j.total) || n, value = num(j.average) || (n ? sum / n : 0);
  return { value: value > 0 && value <= 5 ? Math.round(value * 10) / 10 : 0, count: Math.round(count), best: 5, src: "api" };
}

// alle Serien im Kalender, deren Beschreibung fehlt oder abgelaufen ist, gebündelt nachladen
function crlfCatLoad() {
  if (!crlfCatOn || crlfCatRun) return crlfCatRun;
  crlfCatRun = (async () => {
    const { crCatPause = 0 } = await chrome.storage.local.get("crCatPause");
    if (Date.now() < crCatPause) return;
    const ids = new Set();
    for (const a of document.querySelectorAll('a[href*="/series/"]')) {
      const m = a.getAttribute("href").match(/\/series\/([A-Z0-9]+)/i);
      if (m) ids.add(m[1].toUpperCase());
    }
    const missing = [...ids].filter((id) => { const e = crlfCat.get(id); return !e || Date.now() - e.t > CRLF_CAT_TTL; });
    if (!missing.length) return;
    try { await crlfCatFetch(missing); }
    catch (e) {
      chrome.storage.local.set({ crCatPause: Date.now() + CRLF_CAT_PAUSE });
      if (typeof crlfError === "function") crlfError("Crunchyroll-Katalog", e);
    }
  })().finally(() => { crlfCatRun = null; });
  return crlfCatRun;
}

chrome.storage.local.get("crDesc").then(({ crDesc }) => {
  for (const [k, v] of Object.entries(crDesc || {})) if (!crlfCat.has(k)) crlfCat.set(k, v);
}).then(() => chrome.storage.sync.get({ crApi: true })).then(({ crApi }) => {
  crlfCatOn = !!crApi;
  if (!crlfCatOn) return;
  // Karten stehen erst nach dem Laden der Seite; später nachgezeichnete Karten beim zweiten Lauf
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", () => crlfCatLoad(), { once: true });
  else crlfCatLoad();
  setTimeout(crlfCatLoad, 4000);
}).catch(() => {});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "sync" && ch.crApi) { crlfCatOn = ch.crApi.newValue !== false; if (crlfCatOn) crlfCatLoad(); }
});
