// theme-rating.js – Bewertungen für die Vorschau (Crunchyroll-Sterne und AniList)
// Teil des Kalender-Designs; Reihenfolge der Dateien im Manifest: theme.js, theme-rating.js, theme-peek.js, theme-bg.js, theme-start.js.
// Alle teilen sich einen Bereich (gleiche Variablen und Funktionen wie früher in einer Datei).

// ===== 4. Bewertungen für die Vorschau =====
// Zwei Werte untereinander: die Sterne von Crunchyroll und das aktuelle AniList-Rating samt Platz in der
// laufenden Season. Gespeichert in storage.local "crRating2" als { "<quelle>|<schlüssel>": { t, v } }.
const crlfRatingMem = new Map(); // laufende/fertige Abfragen dieser Seite (Promise je Schlüssel)
const CRLF_RATING_TTL = 864e5; // AniList: 1 Tag
const CRLF_PURGE = 200 * 864e5; // ältere Einträge beim Speichern entfernen
// Crunchyroll-Sterne gelten die ganze Season: bis Season-Ende laut AniList plus drei Wochen,
// mindestens aber Folgenzahl × 1 Woche + 2 Wochen bzw. 90 Tage
function crlfCrValid(al) {
  return (hit) => {
    const age = Date.now() - hit.t;
    const byEpisodes = al && al.episodes ? (al.episodes * 7 + 14) * 864e5 : 0;
    if (age < Math.max(90 * 864e5, byEpisodes)) return true;
    return !!(al && al.end && Date.now() < al.end + 21 * 864e5);
  };
}
// neue Bewertung von einer Serienseite (series.js): nicht auf alte Fehlermeldungen im Speicher warten.
// Nur geänderte Crunchyroll-Einträge vergessen; laufende AniList-Abfragen bleiben.
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local" || !c.crRating2) return;
  const before = c.crRating2.oldValue || {}, after = c.crRating2.newValue || {};
  for (const id of Object.keys(after)) if (id.startsWith("cr|") && (!before[id] || before[id].t !== after[id].t)) crlfRatingMem.delete(id);
});
// Schreibzugriffe auf crRating2 nacheinander, damit parallele Abfragen sich nicht gegenseitig überschreiben
let crlfRatingWrite = Promise.resolve();
// (gespeichert wird der deutsche Name; übersetzt erst bei der Anzeige, siehe crlfRatingBox)
const CRLF_SEASONS = { WINTER: "Winter", SPRING: "Frühling", SUMMER: "Sommer", FALL: "Herbst" };

// Bewertung aus dem HTML einer Serienseite (strukturierte Daten bzw. eingebetteter Seitenzustand)
function crlfRatingFromHtml(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== "object") return null;
        if (o.aggregateRating && o.aggregateRating.ratingValue) return o.aggregateRating;
        for (const v of Object.values(o)) { const r = walk(v); if (r) return r; }
        return null;
      };
      const ar = walk(JSON.parse(m[1]));
      if (ar) return { value: +ar.ratingValue, count: +(ar.ratingCount || ar.reviewCount || 0), best: +(ar.bestRating || 5) };
    } catch (e) {}
  }
  // eingebetteter Seitenzustand (z. B. "rating":{"average":"4.9","total":12345})
  const m = html.match(/"average"\s*:\s*"?(\d(?:\.\d+)?)"?\s*,\s*"total"\s*:\s*"?(\d+)/);
  return m ? { value: +m[1], count: +m[2], best: 5 } : null;
}

// AniList: Durchschnittsnote, Mitglieder, Platz in der Season (bestbewertet vor beliebteste) und Start der nächsten
// Staffel. Anime per Abgleich (match.js) statt erstem Suchtreffer.
const CRLF_REL = "relations{edges{relationType node{id type format status season seasonYear startDate{year month day}}}}";
async function crlfAniListRating(name, en) {
  if (typeof alSearch !== "function" || typeof anilist !== "function") return null;
  const results = await alSearch(name);
  // englischer Titel aus der Serien-Adresse: deutsche Titel findet AniList oft nicht
  if (en && en.toLowerCase() !== name.toLowerCase()) for (const x of await alSearch(en).catch(() => [])) if (!results.some((y) => y.id === x.id)) results.push(x);
  const media = (typeof crlfBestMatch === "function" && crlfBestMatch(name, results, en)) || results[0];
  if (!media) return null;
  const d = await anilist(`query($id:Int){Media(id:$id){averageScore popularity siteUrl episodes description(asHtml:false) endDate{year month day} rankings{rank type allTime season year} ${CRLF_REL}}}`, { id: media.id });
  const m = d && d.Media;
  if (!m) return null;
  const inSeason = (m.rankings || []).filter((r) => !r.allTime && r.season);
  const rank = inSeason.find((r) => r.type === "RATED") || inSeason.find((r) => r.type === "POPULAR");
  const e = m.endDate || {};
  return { value: m.averageScore || 0, count: m.popularity || 0, url: m.siteUrl, episodes: m.episodes || 0, desc: crlfCleanDesc(m.description),
    end: e.year && e.month ? Date.UTC(e.year, e.month - 1, e.day || 28) : 0,
    rank: rank ? { n: rank.rank, rated: rank.type === "RATED", season: `${CRLF_SEASONS[rank.season] || ""} ${rank.year || ""}`.trim() } : null,
    next: await crlfNextSeason(m).catch(() => null) };
}
// AniList-Beschreibung lesbar machen: ohne HTML-Reste und Quellenangabe, höchstens ~500 Zeichen (am Satzende gekürzt)
function crlfCleanDesc(t) {
  if (!t) return "";
  t = t.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\((?:Source|Quelle)[^)]*\)/gi, "").replace(/\[Written by[^\]]*\]/gi, "")
    .replace(/\bNote:.*$/is, "").replace(/\s+/g, " ").trim();
  if (t.length <= 520) return t;
  const cut = t.slice(0, 520), end = cut.lastIndexOf(". ");
  return (end > 200 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, "") + " …");
}
// AniList-Daten einer Serie (Note, Mitglieder, nächste Staffel, Beschreibung) – einmal je Serie, für Bewertung und Beschreibung
function crlfAniListJob(name, url) {
  const en = url && ((url.match(/\/series\/[^/?#]+\/([a-z0-9-]+)/i) || [])[1] || "").replace(/-+/g, " ").trim();
  return name ? crlfCachedRating("al3", name.toLowerCase(), () => crlfAniListRating(name, en)) : Promise.resolve(null);
}

// Nächste Staffel: der Fortsetzungs-Kette (SEQUEL, Serie) folgen, bis eine noch nicht gestartete kommt (höchstens 4 Schritte).
// Ergebnis { y, m, d, season } – so genau, wie AniList es kennt; null, wenn kein Termin bekannt ist.
async function crlfNextSeason(m) {
  for (let hop = 0; m && hop < 4; hop++) {
    const edge = ((m.relations && m.relations.edges) || []).find((x) => x.relationType === "SEQUEL" && x.node && x.node.type === "ANIME" && /^(TV|TV_SHORT|ONA)$/.test(x.node.format || ""));
    if (!edge) return null;
    const n = edge.node, sd = n.startDate || {};
    const future = n.status === "NOT_YET_RELEASED" || (sd.year && Date.UTC(sd.year, (sd.month || 12) - 1, sd.day || 28) > Date.now());
    if (future) return sd.year || n.seasonYear ? { y: sd.year || n.seasonYear, m: sd.month || 0, d: sd.day || 0, season: n.season || "" } : null;
    const r = await anilist(`query($id:Int){Media(id:$id){${CRLF_REL}}}`, { id: n.id });
    m = r && r.Media;
  }
  return null;
}
// Termin als Text: „12.01.2027“, „Januar 2027“, „Winter 2027“ oder „2027“
function crlfNextText(n) {
  if (!n || !n.y) return "";
  if (n.m && n.d) return new Date(Date.UTC(n.y, n.m - 1, n.d)).toLocaleDateString(crlfLocale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  if (n.m) return new Date(Date.UTC(n.y, n.m - 1, 1)).toLocaleDateString(crlfLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  return n.season ? `${T(CRLF_SEASONS[n.season] || "")} ${n.y}`.trim() : String(n.y);
}

// Ein Wert pro Quelle und Serie, unabhängig voneinander geladen: was zuerst da ist, wird gleich angezeigt
function crlfCachedRating(kind, key, load, valid) {
  const id = `${kind}|${key}`;
  if (crlfRatingMem.has(id)) return crlfRatingMem.get(id);
  const job = (async () => {
    const { crRating2: store = {} } = await chrome.storage.local.get("crRating2");
    const hit = store[id];
    if (hit && (valid ? valid(hit) : Date.now() - hit.t < CRLF_RATING_TTL)) return hit.v;
    const v = await load().catch(() => null);
    // nur Treffer speichern (sonst beim nächsten Mal erneut versuchen)
    if (v && !v.error) {
      crlfRatingWrite = crlfRatingWrite.then(async () => {
        const { crRating2: cur = {} } = await chrome.storage.local.get("crRating2");
        for (const [k, e] of Object.entries(cur)) if (Date.now() - e.t > CRLF_PURGE) delete cur[k];
        cur[id] = { t: Date.now(), v };
        await chrome.storage.local.set({ crRating2: cur });
      }).catch((e) => crlfError("Bewertung speichern", e));
    }
    if (!v || v.error) setTimeout(() => { if (crlfRatingMem.get(id) === job) crlfRatingMem.delete(id); }, 60000); // später erneut versuchen
    return v;
  })();
  crlfRatingMem.set(id, job);
  return job;
}

// Crunchyroll-Sterne einer Serie: aus dem HTML der öffentlichen Serienseite (wie ein normaler Seitenaufruf).
// Klappt das nicht, hilft series.js: es merkt sich die Bewertung, sobald man die Serienseite einmal öffnet.
// Private Fassung: zuerst die Bewertungs-Schnittstelle (crcatalog.js, ohne Anmeldung).
async function crlfCrunchyrollRating(url) {
  if (typeof crlfCatRating === "function") {
    const r = await crlfCatRating(crlfSid(url)).catch(() => null);
    if (r && r.value) return r;
  }
  try {
    const html = await crlfSeriesPage(url);
    if (html) {
      const r = crlfRatingFromHtml(html);
      if (r && r.value) return r;
    }
  } catch (e) {}
  return { error: "noch nicht bekannt. Serienseite einmal öffnen, dann steht sie hier", open: url };
}

// Bewertungszeilen „Crunchyroll“ und „Aktuell“; stehen sofort mit Platzhaltern da und füllen sich, sobald Daten da sind
function crlfRatingBox(name, url) {
  const box = document.createElement("div");
  box.className = "crlf-pop-rating";
  box.dataset.key = url || name;
  const r = { cr: undefined, al: undefined };
  const fmt = (n, d) => n.toLocaleString(crlfLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });
  const NB = "\u00a0";
  const row = (label, value, meta) => {
    const line = document.createElement("div");
    line.className = "crlf-pop-rrow";
    const l = document.createElement("i"); l.textContent = label;
    const b = document.createElement("b"); b.textContent = value;
    const s = document.createElement("small"); s.textContent = meta || NB;
    line.append(l, b, s);
    return line;
  };
  // Beide Zeilen stehen von Anfang an (Platzhalter), damit sich die Größe der Vorschau beim Laden nicht ändert
  const render = () => {
    box.replaceChildren();
    const crOk = r.cr && !r.cr.error;
    const line = row("Crunchyroll", "", "");
    const stars = line.querySelector("b");
    stars.className = "crlf-stars";
    stars.textContent = "★★★★★";
    const num = document.createElement("b");
    stars.after(num);
    if (crOk) {
      const pct = Math.max(0, Math.min(100, (r.cr.value / (r.cr.best || 5)) * 100));
      stars.style.setProperty("--crlf-fill", `${pct}%`);
      const cnt = r.cr.count >= 1e6 ? T("{0} Mio.", fmt(r.cr.count / 1e6, 1)) : r.cr.count >= 1e3 ? T("{0} Tsd.", fmt(r.cr.count / 1e3, 1)) : r.cr.count ? fmt(r.cr.count, 0) : "";
      num.textContent = fmt(r.cr.value, 1);
      line.querySelector("small").textContent = cnt ? T("{0} Bewertungen", cnt) : NB;
    } else {
      stars.style.setProperty("--crlf-fill", "0%");
      num.textContent = "–";
      line.classList.add("crlf-pop-rwait");
      line.querySelector("small").textContent = r.cr === undefined ? T("wird geladen …") : T("noch keine Bewertung");
    }
    box.append(line);
    if (r.al && r.al.value) {
      const season = (r.al.rank && r.al.rank.season || "").replace(/^\S+/, (w) => T(w)); // „Sommer 2026“ -> „Summer 2026“
      const rank = r.al.rank ? `#${r.al.rank.n} ${r.al.rank.rated ? T("bestbewertet") : T("beliebteste")} ${season}`.trim() : "";
      box.append(row(T("Aktuell"), `${r.al.value} %`, [rank, "AniList"].filter(Boolean).join(" · ")));
    } else {
      const w = row(T("Aktuell"), "– %", r.al === undefined ? T("wird geladen …") : T("keine Daten"));
      w.classList.add("crlf-pop-rwait");
      box.append(w);
    }
    // nächste Staffel: Zeile ist immer da (gleiche Höhe der Vorschau), ohne bekannten Termin bleibt sie leer
    const nx = r.al && r.al.next ? crlfNextText(r.al.next) : "";
    const nl = row(T("Nächste Staffel"), nx || NB, nx ? (r.al.next.m && r.al.next.d ? T("Start") : T("ungefährer Start")) + " · AniList" : NB);
    nl.classList.add("crlf-pop-rnext");
    if (!nx) nl.style.visibility = "hidden";
    box.append(nl);
  };
  render();
  const sid = url && (url.match(/\/series\/([A-Z0-9]+)/i) || [])[1];
  const alJob = crlfAniListJob(name, url);
  alJob.then((v) => { r.al = v; render(); });
  // Gültigkeit der Crunchyroll-Sterne hängt an der Season (Folgenzahl/Ende von AniList)
  // Mit Bewertungs-Schnittstelle (private Fassung) nicht auf AniList warten; ihre Werte gelten 3 Tage
  const crJob = typeof crlfCatRating === "function"
    ? Promise.resolve(crlfCrValid(null))
    : alJob.catch(() => null).then((al) => crlfCrValid(al));
  crJob.then((valid) => sid ? crlfCachedRating("cr", sid, () => crlfCrunchyrollRating(url),
    (hit) => hit.v && hit.v.src === "api" ? Date.now() - hit.t < 3 * 864e5 : valid(hit)) : null)
    .then((v) => { r.cr = v; render(); });
  return box;
}
