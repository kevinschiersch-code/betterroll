// crnext.js – nur private Fassung (build.py lässt die Datei im Store-Paket weg). Kennt die nächste Folge aus dem
// öffentlichen Crunchyroll-Katalog, ohne Anmeldung: anonymer Schlüssel wie in crauth.js (grant_type=client_id, keine
// Cookies, kein Konto, nur Katalogdaten; Kennung der Web-App gemeinsam in storage.local crCatCfg). skip.js fragt 90 s
// vor Schluss einmal nach und nutzt die Adresse nur, wenn am Folgenende weder Knopf noch Link „Nächste Folge“ helfen.
// Gleiche Sprachfassung: Die Staffel-ID einer Folge gehört zu genau einer Fassung (wie in calbuild.js). Noch nicht
// erschienene Folgen zählen nicht; nach der letzten Folge der Staffel gibt es keine Adresse. Schalter: Einstellung crApi.
(() => {
  const memo = new Map(); // Folgen-ID -> Promise mit Adresse ("" = keine nächste Folge)
  let tok = null;
  const pre = () => (location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,3})?)\//i) || [])[1] || "";
  const LOCALES = { de: "de-DE", fr: "fr-FR", es: "es-419", "es-es": "es-ES", "pt-br": "pt-BR", "pt-pt": "pt-PT", it: "it-IT", ru: "ru-RU", ar: "ar-SA", hi: "hi-IN" };
  const locale = () => LOCALES[pre().toLowerCase()] || "en-US";

  // öffentliche Kennung der Web-App für anonyme Besucher (steht im HTML der Startseite); 7 Tage gemerkt. Steht sie dort
  // nicht mehr (neue Seite seit 31.10.2026): bekannte Kennung der Web-App wie in crauth.js, beim nächsten Mal neu suchen
  async function client() {
    const { crCatCfg: c } = await chrome.storage.local.get("crCatCfg");
    if (c && c.id && Date.now() - c.t < 7 * 864e5) return c;
    try {
      const res = await fetch(pre() ? `/${pre()}/` : "/", { credentials: "omit" });
      if (!res.ok) throw new Error(`Startseite HTTP ${res.status}`);
      const html = await res.text();
      const pick = (k) => { const r = html.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']*)["']`)); return r ? r[1] : null; };
      const cfg = { id: pick("anonClientId") || pick("accountAuthClientId"), secret: pick("anonClientSecret") || "", t: Date.now() };
      if (!cfg.id) throw new Error("Kennung der Web-App nicht gefunden");
      await chrome.storage.local.set({ crCatCfg: cfg });
      return cfg;
    } catch (e) {
      return { id: "cr_web", secret: "", t: 0 };
    }
  }
  // anonymer Zugangsschlüssel (nur im Arbeitsspeicher, läuft nach Minuten ab)
  async function token() {
    if (tok && Date.now() < tok.until) return tok.token;
    const cfg = await client();
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
    tok = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 300) - 30) * 1000 };
    return tok.token;
  }
  async function api(url) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { credentials: "omit", headers: { Authorization: `Bearer ${await token()}` } });
      if (res.status === 401 && !attempt) { tok = null; continue; } // Schlüssel abgelaufen: einmal neu
      if (!res.ok) throw new Error(`Katalog HTTP ${res.status} ${url.split("?")[0]}`);
      return res.json();
    }
  }
  async function find(id) {
    const { crApi } = await chrome.storage.sync.get({ crApi: true });
    if (!crApi) return "";
    const lc = locale();
    const o = await api(`/content/v2/cms/objects/${id}?locale=${lc}`);
    const ep = o && Array.isArray(o.data) && o.data[0];
    const season = ep && ((ep.episode_metadata && ep.episode_metadata.season_id) || ep.season_id);
    if (!season) throw new Error("Staffel der Folge unbekannt");
    const j = await api(`/content/v2/cms/seasons/${season}/episodes?locale=${lc}`);
    const seq = (e) => +(e.sequence_number ?? e.episode_number ?? 0);
    const list = ((j && j.data) || []).filter((e) => e && e.id).sort((a, b) => seq(a) - seq(b));
    const i = list.findIndex((e) => String(e.id).toUpperCase() === id);
    if (i < 0) throw new Error("Folge nicht in ihrer Staffel gefunden");
    const now = Date.now();
    const out = (e) => !(Date.parse(e.premium_available_date || e.availability_starts || e.episode_air_date || "") > now);
    const next = list.slice(i + 1).find(out);
    if (!next) return "";
    return `${location.origin}/${pre() ? pre() + "/" : ""}watch/${next.id}${next.slug_title ? "/" + next.slug_title : ""}`;
  }
  // für skip.js: Adresse der Folge nach id ("" = keine); je Folge einmal gefragt, Fehler werden beim nächsten Mal neu versucht
  globalThis.crlfNextUrl = (id) => {
    id = String(id || "").toUpperCase();
    if (!/^[A-Z0-9]+$/.test(id)) return Promise.resolve("");
    if (!memo.has(id)) memo.set(id, find(id).catch((e) => { memo.delete(id); throw e; }));
    return memo.get(id);
  };
})();
