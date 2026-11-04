// crauth.js – anonymer Zugang zur Crunchyroll-Schnittstelle (grant_type=client_id), wie ihn die Seite selbst für
// nicht eingeloggte Besucher nutzt, auch der neue Release-Kalender. Keine Cookies, kein Konto, nur öffentliche
// Katalogdaten. Der Schlüssel liegt nur im Arbeitsspeicher. Genutzt von calbuild.js (Kalender) und crcatalog.js.
let crlfCatTok = null;

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
  try {
    const res = await fetch(m ? `/${m[1]}/` : "/", { credentials: "omit" });
    if (!res.ok) throw new Error(`Startseite HTTP ${res.status}`);
    const html = await res.text();
    const pick = (k) => { const r = html.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']*)["']`)); return r ? r[1] : null; };
    const cfg = { id: pick("anonClientId") || pick("accountAuthClientId"), secret: pick("anonClientSecret") || "", t: Date.now() };
    if (!cfg.id) throw new Error("Kennung der Web-App nicht gefunden");
    await chrome.storage.local.set({ crCatCfg: cfg });
    return cfg;
  } catch (e) {
    // Startseite nicht lesbar: bekannte Kennung der Web-App (Stand 11/2026), beim nächsten Mal wieder versuchen
    return { id: "cr_web", secret: "", t: 0 };
  }
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
