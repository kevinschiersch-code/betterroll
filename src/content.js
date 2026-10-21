// content.js – Hauptlogik im Simulcast-Kalender: Sprachfilter, Zusammenführen von Synchro/OmU, ★/▼-Markierungen
// mit Sortierung, aufgeräumte Titel mit Abzeichen, Poster von AniList, Folgen-Zeile mit 💬, Fortschrittsbalken
// (aus dem Balken der Seite), Ausgrauen gesehener Folgen und die Knöpfe „Nur Favoriten“ / „Heute“.
//
// Abschnitte:
//   1. Einträge und Titel finden
//   2. Markierungen und Knöpfe (★ / ▼ / 💬)
//   3. Fortschritt (aus der Seite)
//   4. Vorschaubilder und Poster
//   5. Kopfbereich, Abzeichen, Tagesspalten
//   5b. Knöpfe 🏆 Top 10 der Season (rank.js), „Nur Favoriten“ und „Heute“
//   6. Filter anwenden (applyFilter) und Start
//   7. Nachrichten vom Popup
//
// Eigene Texte laufen über T() (i18n.js, Sprache = Einstellung „uiLang“); Muster für Texte der Seite bleiben zweisprachig.

let settings = { ...CR_DEFAULT_SETTINGS };
let marks = {}; // Basistitel -> "fav" (hervorgehoben) | "dim" (ausgegraut); in storage.local
let hiddenCount = 0; // fürs Popup: „N Einträge ausgeblendet“
let nextIndex = 0; // ursprüngliche Reihenfolge der Einträge (data-crlf-index)

// ===== 1. Einträge und Titel finden =====

// Jeder Kalendereintrag ist ein <article class="release">; Titel steht in .season-name / cite.
// Fallback-Selektoren, falls Crunchyroll das Markup ändert.
const RELEASE_SELECTOR = "article.release, .js-release, [itemtype*='TVEpisode']";

// Werte nur schreiben, wenn sie sich ändern: jedes Schreiben (auch derselbe Wert) ist eine Änderung der Seite, die
// alle Beobachter (Design, Vorschau, Einblendungen …) erneut aufweckt
const addCls = (el, ...cls) => { for (const c of cls) if (!el.classList.contains(c)) el.classList.add(c); };
const setData = (el, k, v) => { v = String(v); if (el.dataset[k] !== v) el.dataset[k] = v; };
const setHidden = (el, h) => { h = !!h; if (el.hidden !== h) el.hidden = h; };
const setAttr = (el, k, v) => { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const TITLE_SELECTOR = ".season-name cite, .season-name, cite[itemprop='name'], [itemprop='name'], h1, h2, h3";
const RANK = { fav: 0, none: 1, dim: 2 }; // Sortierung: ★ oben, ▼ unten

// Eintrags-Container: höchster Vorfahr, der nur diesen einen Eintrag enthält. Die Tiefe wird an Tagen
// mit mehreren Einträgen bestimmt (kleinste Tiefe) und für alle Einträge verwendet, damit an Tagen mit nur
// einem Eintrag nicht die ganze Tagesspalte erwischt wird.
let itemDepth = null;
function measureDepth(releases) {
  // Anzahl Einträge je Vorfahr (nur äußerste Treffer zählen, verschachtelte Schema-Elemente nicht)
  const counts = new Map();
  for (const r of releases) for (let p = r.parentElement; p; p = p.parentElement) counts.set(p, (counts.get(p) || 0) + 1);
  let min = Infinity;
  for (const r of releases) {
    let c = r, d = 0;
    while (c.parentElement && c.parentElement !== document.body && counts.get(c.parentElement) === 1) {
      c = c.parentElement;
      d++;
    }
    if (c.parentElement && counts.get(c.parentElement) > 1) min = Math.min(min, d);
  }
  if (min !== Infinity) itemDepth = min;
}

// Titel nach Vorrang der Selektoren (querySelector mit Liste nähme den ersten Treffer im Dokument)
function releaseTitleEl(release) {
  for (const sel of TITLE_SELECTOR.split(",")) {
    const el = release.querySelector(sel.trim());
    if (el && el.textContent.trim()) return el;
  }
  return null;
}

// Liefert immer den Originaltitel, auch wenn wir den Sprachzusatz in der Anzeige entfernt haben
function releaseTitle(release) {
  const el = releaseTitleEl(release);
  if (!el) return null;
  const shown = el.textContent.replace(/\s+/g, " ").trim();
  if (el.dataset.crlfTitle && el.dataset.crlfShown === shown) return el.dataset.crlfTitle;
  delete el.dataset.crlfTitle;
  delete el.dataset.crlfShown;
  return shown;
}

// Sprachzusatz aus dem angezeigten Titel nehmen (die Sprache steht dann als Hinweis oben in der Karte)
function updateShownTitle(entry, cleanLang, cleanSeason) {
  const el = releaseTitleEl(entry.release);
  if (!el || el.children.length) return;
  const original = releaseTitle(entry.release);
  let shown = cleanLang ? crStripLanguage(original) : original;
  if (cleanSeason) shown = crSplitSeason(shown).title;
  if (el.textContent.replace(/\s+/g, " ").trim() === shown) return;
  el.textContent = shown;
  if (shown !== original) {
    el.dataset.crlfTitle = original;
    el.dataset.crlfShown = shown;
  } else {
    delete el.dataset.crlfTitle;
    delete el.dataset.crlfShown;
  }
}

// Eintrags-Container eines Eintrags (siehe measureDepth)
function releaseContainer(release) {
  let c = release;
  for (let i = 0; i < (itemDepth || 0) && c.parentElement; i++) c = c.parentElement;
  return c;
}

// ===== 2. Markierungen und Knöpfe =====

// Sprachfilter: Eintrag in einer anderen als der gewählten Sprache? (OmU ohne Sprachzusatz bleibt)
function shouldHide(title) {
  if (!settings.active || !settings.enabled) return false;
  const lang = crDetectLanguage(title);
  return lang !== null && lang !== settings.language;
}

// wirksame Markierung eines Anime ("fav" | "dim" | "none"), abhängig davon, ob die Knöpfe eingeschaltet sind
function activeMark(key) {
  if (!settings.active) return "none";
  const m = marks[key];
  if (m === "fav" && settings.featureFav) return "fav";
  if (m === "dim" && settings.featureDim) return "dim";
  return "none";
}

// Klick auf ★/▼: Markierung setzen bzw. wieder entfernen (gespeichert in storage.local "marks")
function toggleMark(key, mark) {
  if (marks[key] === mark) delete marks[key];
  else marks[key] = mark;
  chrome.storage.local.set({ marks });
}

// Knopfleiste in die Zeile der Uhrzeit setzen: schwebt rechts daneben, die Uhrzeit bleibt frei.
// (Nur Karten mit Uhrzeit bekommen Knöpfe, siehe applyFilter.)
function placeBar(release, bar) {
  const time = release.querySelector("time, .available-time");
  if (time && time.parentElement) {
    // eigene Zeile: Uhrzeit links, Staffel + ★/▼ rechts, nie umbrechend
    const row = document.createElement("div");
    row.className = "crlf-timerow";
    time.before(row);
    row.append(time, bar);
    bar.classList.add("crlf-inline");
    bar.dataset.placed = "1";
    // Lesezeichen-Symbol der Seite im Titel nicht schweben lassen, sonst bleibt ein Wort allein in der ersten Zeile
    const title = releaseTitleEl(release);
    const block = title && (title.closest("h1, h2, h3, h4, .season-name") || title);
    if (block) for (const el of block.querySelectorAll("*")) {
      if (!el.textContent.trim() && getComputedStyle(el).float !== "none") {
        el.classList.add("crlf-inline-icon");
        block.classList.add("crlf-has-icon");
      }
    }
  }
}

// Knopfleiste ★/▼ (und 💬) einer Karte anlegen bzw. auf den aktuellen Stand bringen
function ensureButtons(release, key) {
  let bar = release.querySelector(".crlf-actions");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "crlf-actions";
    for (const [mark, symbol, label] of [["fav", "★", T("Hervorheben")], ["dim", "▼", T("Ausblenden (ausgrauen, nach unten)")]]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `crlf-btn crlf-btn-${mark}`;
      btn.textContent = symbol;
      btn.title = label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMark(bar.dataset.key, mark);
      });
      bar.appendChild(btn);
    }
    placeBar(release, bar);
  } else if (!bar.dataset.placed) placeBar(release, bar);
  setData(bar, "key", key);
  placeTalk(release, bar);
  setHidden(bar.querySelector(".crlf-btn-fav"), !settings.featureFav);
  setHidden(bar.querySelector(".crlf-btn-dim"), !settings.featureDim);
  const talkBtn = release.querySelector(".crlf-btn-talk");
  if (talkBtn) setHidden(talkBtn, !settings.featureComments);
  bar.querySelector(".crlf-btn-fav").classList.toggle("crlf-on", marks[key] === "fav");
  bar.querySelector(".crlf-btn-dim").classList.toggle("crlf-on", marks[key] === "dim");
}

// Folgen-Zeile („Folge 134 Verfügbar“) finden: kleinster Block, der nur diese Zeile enthält
function episodeLine(release) {
  for (const e of release.querySelectorAll("*")) {
    if (e.children.length || e.closest(".crlf-actions, .crlf-timerow, .crlf-btn")) continue;
    if (!/(Folgen?|Episoden?|Episodes?)\s*\d/i.test(e.textContent)) continue;
    let line = e;
    while (line.parentElement && line.parentElement !== release && line.parentElement.textContent.trim().length < 60 &&
      !line.parentElement.querySelector("img, time, cite, h1, h2, h3, h4, .crlf-actions")) line = line.parentElement;
    return line;
  }
  return null;
}

// 💬 rechts ans Ende der Folgen-Zeile; die Seite kann die Zeile neu zeichnen, daher bei jedem Durchlauf prüfen.
// Ohne Folgen-Zeile bleibt er unten rechts auf der Karte.
function placeTalk(release, bar) {
  let talk = release.querySelector(".crlf-btn-talk");
  if (!talk) {
    // 💬: Diskussion zur Folge, siehe comments.js (wird neu angelegt, falls die Seite die Zeile neu gezeichnet hat)
    talk = document.createElement("button");
    talk.type = "button";
    talk.className = "crlf-btn crlf-btn-talk";
    talk.textContent = "💬";
    talk.title = T("Kommentare zur Folge");
    talk.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      crlfOpenComments(release, bar.dataset.key);
    });
  }
  const line = release.querySelector(".crlf-epline") || episodeLine(release);
  if (line) {
    addCls(line, "crlf-epline");
    if (settings.active) trimAvailable(line);
    if (talk.classList.contains("crlf-talk-float")) talk.classList.remove("crlf-talk-float");
    if (talk.parentElement !== line) line.appendChild(talk);
    if (release.crlfMeta) placeMeta(release, release.crlfMeta);
  } else if (!talk.classList.contains("crlf-talk-float") || !talk.parentElement) {
    talk.classList.add("crlf-talk-float");
    release.appendChild(talk);
  }
}

// „Verfügbar“ aus der Folgen-Zeile nehmen, damit „Folge 16“ in eine Zeile passt (Original wird gemerkt
// und beim Ausschalten per Hauptschalter zurückgesetzt)
const AVAIL_RE = /\s*\b(verfügbar|available|disponible|disponibile|disponível)\b\s*/gi;
const availOrig = new Map();
function trimAvailable(line) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement && n.parentElement.closest(".crlf-btn, .crlf-meta")) continue;
    AVAIL_RE.lastIndex = 0;
    if (!AVAIL_RE.test(n.nodeValue)) continue;
    if (!availOrig.has(n)) {
      if (availOrig.size > 500) for (const k of availOrig.keys()) if (!k.isConnected) availOrig.delete(k); // alte Karten vergessen
      availOrig.set(n, n.nodeValue);
    }
    AVAIL_RE.lastIndex = 0;
    const t = n.nodeValue.replace(AVAIL_RE, " ").replace(/\s+/g, " ");
    n.nodeValue = t.trim() ? t : "";
  }
}
// Hauptschalter aus: „Verfügbar“ wieder einsetzen
function restoreAvailable() {
  for (const [n, v] of availOrig) if (n.isConnected) n.nodeValue = v;
  availOrig.clear();
}

// ===== 3. Fortschritt (aus der Seite) =====
// Crunchyroll zeigt angemeldeten Besuchern in jeder Karte einen Fortschrittsbalken (<progress>). Dessen Wert nutzt das
// Add-on: gesehene Folge (ab 90 %) -> Karte ausgegraut (.crlf-watched); Balken orange bzw. eigener Balken unter dem
// Poster, wenn der Balken der Seite unsichtbar ist. Keine eigene Anmeldung, keine Abfragen.
// Erst alle Karten vermessen, dann alles ändern: so rechnet der Browser das Layout einmal statt einmal je Karte.
function updateProgress(releases) {
  const plans = releases.map((release) => {
    const bars = settings.active ? siteBars(release) : [];
    const v = bars.length ? siteBarValue(bars[0]) : undefined;
    return { release, v, plan: progressPlan(release, v, bars) };
  });
  for (const { release, v, plan } of plans) {
    releaseContainer(release).classList.toggle("crlf-watched", v !== undefined && v >= 0.9);
    progressBar(release, v, plan);
  }
}

// größtes sichtbares Bild der Karte (Folgenbild oder Poster)
function cardImage(release) {
  let best = null, area = 0;
  for (const img of release.querySelectorAll("img")) {
    const r = img.getBoundingClientRect();
    if (r.width >= 60 && r.height >= 40 && r.width * r.height > area && !isHidden(img, release)) { best = img; area = r.width * r.height; }
  }
  return best;
}
// Hülle einer Karte: ihr Listeneintrag, wenn er nur diese Karte enthält, sonst der Eintrags-Container
function cardBox(release) {
  const li = release.closest("li");
  if (li && li.querySelectorAll("article.release, .js-release").length <= 1) return li;
  return releaseContainer(release);
}
// Fortschrittsbalken der Seite in dieser Karte: ein natives <progress> (darin nur Ersatz-Divs „Fortschritt: 100 %“).
// Ist er sichtbar, wird er per CSS orange gefärbt und ist der einzige Balken – wir zeichnen dann keinen eigenen.
// Auf Karten mit Poster (★) steckt er unsichtbar im ausgeblendeten Folgenbild-Teil: dann zählt nur sein Wert.
function siteBars(release) {
  return [...release.querySelectorAll("progress, [role=progressbar]")].filter((e) => !e.closest(".crlf-pbar, .crlf-peek"));
}
// ist der Balken der Seite zu sehen?
const siteBarVisible = (e, release) => e.getBoundingClientRect().width > 0 && !isHidden(e, release);
// Wert des Balkens 0..1 (progress bzw. aria-valuenow), undefined ohne Wert
function siteBarValue(e) {
  const v = parseFloat(e.tagName === "PROGRESS" ? e.getAttribute("value") : e.getAttribute("aria-valuenow"));
  const max = parseFloat(e.tagName === "PROGRESS" ? e.getAttribute("max") || 1 : e.getAttribute("aria-valuemax") || 100);
  return v >= 0 && max > 0 ? Math.min(1, v / max) : undefined;
}
// Eigener orangefarbener Balken unter dem Kartenbild – Lesephase: wohin und wie breit (null = kein eigener Balken).
// p: 0..1, undefined = kein Wert; bars = Balken der Seite
function progressPlan(release, p, bars) {
  if (bars.some((e) => siteBarVisible(e, release))) return null; // Balken der Seite sichtbar: er ist der einzige (per CSS orange)
  const img = p === undefined || !settings.active ? null : cardImage(release);
  if (!img) return null;
  // hinter die Bildhülle setzen (Hülle = Vorfahren, die kaum größer als das Bild sind; sonst würde der Balken abgeschnitten)
  const ir = img.getBoundingClientRect();
  let anchor = img;
  while (anchor.parentElement && anchor.parentElement !== release) {
    const r = anchor.parentElement.getBoundingClientRect();
    if (r.height > ir.height + 8 || r.width > ir.width + 24) break;
    anchor = anchor.parentElement;
  }
  return { anchor, width: Math.round(ir.width) };
}
// Schreibphase: Balken anlegen, setzen oder entfernen
function progressBar(release, p, plan) {
  let bar = release.querySelector(".crlf-pbar");
  if (!plan) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "crlf-pbar";
    bar.append(document.createElement("i"));
  }
  const { anchor, width } = plan;
  if (bar.previousElementSibling !== anchor) anchor.after(bar);
  if (bar.style.width !== `${width}px`) bar.style.width = `${width}px`;
  const pct = Math.round(p * 100);
  bar.firstChild.style.width = `${pct}%`;
  setAttr(bar, "title", T("Fortschritt {0} %", pct));
}

// ===== 4. Vorschaubilder und Poster =====

// Element unsichtbar (ausgeblendet, durchsichtig oder auf Höhe 0 begrenzt)?
function hiddenStyle(el) {
  const cs = getComputedStyle(el);
  return cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1 || parseFloat(cs.maxHeight) === 0;
}

// Bild oder eine seiner Hüllen innerhalb der Karte unsichtbar?
function isHidden(img, release) {
  for (let el = img; el && el !== release; el = el.parentElement) if (hiddenStyle(el)) return true;
  return false;
}

// 1 = Querformat (Folgenbild), -1 = Hochformat (Poster), 0 = unbekannt
function landscapeScore(img) {
  const w = img.naturalWidth || +img.getAttribute("width") || 0;
  const h = img.naturalHeight || +img.getAttribute("height") || 0;
  if (w && h) return w > h ? 1 : -1;
  const url = (img.dataset.src || img.getAttribute("src") || "").toLowerCase();
  const dim = url.match(/\/(\d{2,4})x(\d{2,4})\//);
  if (dim) return +dim[1] > +dim[2] ? 1 : -1;
  if (/portrait|poster|keyart|tall/.test(url)) return -1;
  if (/thumbnail|landscape|wide|episode/.test(url)) return 1;
  return 0;
}

// Vorschaubild sichtbar machen: versteckte Hüllen bis zum Eintrag einblenden, Lazy-Load-Quelle setzen.
// Nur EIN Bild zeigen: ist schon ein Bild sichtbar, nichts tun; sonst Poster vor Folgenbild (das Folgenbild
// bekommt danach ohnehin das Poster, siehe showPoster).
function showThumbnail(release) {
  const imgs = [...release.querySelectorAll("img")];
  if (imgs.some((img) => !img.closest(".crlf-show") && !isHidden(img, release) && img.getAttribute("src"))) return;
  if (release.querySelector(".crlf-show")) return; // bereits eins eingeblendet
  // bestes Bild: Hochformat (Poster) vor Querformat, bei Gleichstand das spätere
  let best = null, bestScore = -Infinity;
  imgs.forEach((img, i) => {
    const score = -landscapeScore(img) * 100 + i;
    if (score > bestScore) { best = img; bestScore = score; }
  });
  for (const img of best ? [best] : []) {
    const lazy = img.dataset.src || img.dataset.original || img.dataset.lazySrc;
    const src = img.getAttribute("src") || "";
    if (lazy && (!src || src.startsWith("data:"))) {
      img.dataset.crlfOrigSrc = src; // zum Zurücksetzen merken
      img.src = lazy;
    }
    for (let el = img; el && el !== release; el = el.parentElement) if (hiddenStyle(el)) el.classList.add("crlf-show");
  }
}

// Titelbild statt Folgenbild (Nutzerwunsch): Das sichtbare Kartenbild bekommt das Poster des Anime von AniList
// (öffentliche Schnittstelle). Zuordnung: vom Nutzer im 💬-Panel gewählter Anime (alMap), sonst Abgleich (match.js):
// je Titel bis zu 6 Kandidaten für den Originaltitel und den grob übersetzten Titel, bewertet nach Titel, Staffel und
// Laufzeit. Ist keiner sicher genug, bleibt das Folgenbild (lieber kein Poster als ein falsches).
// Gemerkt in storage.local „crPosters4“ je Titel; „kein Treffer“ als "-<Zeit>", nach 3 Tagen neuer Versuch.
const posterUrls = new Map(); // Titel-Schlüssel -> Adresse | null (keins) | "…" (wird geladen)
const POSTER_RETRY = 3 * 864e5;
const POSTER_EN_SINCE = Date.UTC(2026, 9, 19, 19); // ältere Fehlversuche (vor der Suche mit englischem Titel) neu versuchen
let posterStore = null, posterWanted = new Map(), posterTimer = 0;
let posterBackoff = 30000; // AniList nicht erreichbar: Wartezeit bis zum nächsten Versuch (verdoppelt sich, max. 10 Min.)
// Ergebnis eines Titels merken (Adresse oder „kein Treffer“)
function posterDone(key, src) {
  posterUrls.set(key, src || null);
  posterStore[key] = src || `-${Date.now()}`;
}
// gesammelte Titel laden, je Abfrage höchstens 4 Titel (bis 12 benannte Teilabfragen)
async function loadPosters() {
  posterTimer = 0;
  const wanted = [...posterWanted];
  posterWanted = new Map();
  if (!wanted.length) return;
  const { alMap = {} } = await chrome.storage.local.get("alMap");
  const big = 150 * (devicePixelRatio || 1) * ((+settings.posterSize || 100) / 100) > 230; // große Bilder nur bei Bedarf
  const cover = `coverImage{${big ? "extraLarge" : "large"}}`;
  const fields = `id title{romaji english} synonyms status seasonYear format ${cover}`;
  for (let i = 0; i < wanted.length; i += 4) {
    const part = wanted.slice(i, i + 4), vars = {}, defs = [], body = [];
    part.forEach(([key, [title, en]], j) => {
      const id = alMap[key] && +alMap[key].id;
      if (id) { body.push(`a${j}:Media(id:${id},type:ANIME){id ${cover}}`); return; }
      const { title: base, season } = crSplitSeason(crStripLanguage(title));
      const sfx = season && season > 1 ? ` Season ${season}` : "";
      const de = crlfTranslateTitle(base) + sfx;
      const qs = []; // Originaltitel, Übersetzung (nur wenn sie etwas ändert), englischer Titel aus der Serien-Adresse
      for (const q of [base + sfx, de, en && en + sfx]) if (q && !qs.some((x) => crlfFold(x) === crlfFold(q))) qs.push(q);
      qs.forEach((q, k) => {
        const n = `q${j}_${k}`;
        vars[n] = q; defs.push(`$${n}:String`);
        body.push(`${"abc"[k]}${j}:Page(perPage:6){media(search:$${n},type:ANIME,sort:SEARCH_MATCH){${fields}}}`);
      });
    });
    let data = null;
    try {
      const r = await chrome.runtime.sendMessage({ type: "crlf-anilist", query: `query${defs.length ? `(${defs.join(",")})` : ""}{${body.join(" ")}}`, variables: vars });
      if (r && r.ok && r.json && r.json.data) data = r.json.data;
    } catch (e) {}
    if (!data) { // Fehler (offline, zu viele Anfragen): diese Titel erst nach einer Pause erneut versuchen
      const wait = posterBackoff;
      posterBackoff = Math.min(posterBackoff * 2, 600000);
      for (const [key] of part) posterUrls.set(key, null);
      setTimeout(() => { for (const [key] of part) if (posterUrls.get(key) === null) posterUrls.delete(key); scheduleFilter(); }, wait);
      continue;
    }
    posterBackoff = 30000;
    part.forEach(([key, [title, en]], j) => {
      const a = data[`a${j}`];
      let m = a && !a.media ? a : null; // vom Nutzer gewählter Anime
      if (!m) {
        const seen = new Map();
        for (const d of [a, data[`b${j}`], data[`c${j}`]]) for (const x of (d && d.media) || []) seen.set(x.id, x);
        m = crlfBestMatch(title, [...seen.values()].map((x) => ({ ...x, romaji: x.title && x.title.romaji, english: x.title && x.title.english })), en);
      }
      const c = m && m.coverImage;
      posterDone(key, c && (c.extraLarge || c.large));
    });
  }
  chrome.storage.local.set({ crPosters4: posterStore });
  scheduleFilter();
}
// Poster-Adresse einer Karte (null = keins/noch nicht da); unbekannte Titel werden zum Laden vorgemerkt
function posterFor(release) {
  const title = releaseTitle(release);
  if (!title || !posterStore) return null;
  const key = crBaseTitle(title);
  if (!posterUrls.has(key)) {
    const s = posterStore[key];
    if (s && s[0] !== "-") posterUrls.set(key, s);
    else if (s && Date.now() - +s.slice(1) < POSTER_RETRY && +s.slice(1) > POSTER_EN_SINCE) posterUrls.set(key, null);
    else {
      posterUrls.set(key, "…");
      posterWanted.set(key, [title, crlfSlugTitle(release)]);
      if (!posterTimer) posterTimer = setTimeout(loadPosters, 50);
    }
  }
  const v = posterUrls.get(key);
  return v && v !== "…" ? v : null;
}
// Anime im 💬-Panel neu zugeordnet: Poster dieses Titels neu laden
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local" || !c.alMap || !posterStore) return;
  const before = c.alMap.oldValue || {}, after = c.alMap.newValue || {};
  for (const key of Object.keys(after)) {
    if (before[key] && before[key].id === after[key].id) continue;
    delete posterStore[key];
    posterUrls.delete(key);
    document.querySelectorAll("img.crlf-poster").forEach((img) => { const r = img.closest(RELEASE_SELECTOR); if (r && crBaseTitle(releaseTitle(r) || "") === key) restorePoster(r); });
  }
  scheduleFilter();
});
// Einheitliche Bildbreite für alle Karten: Anteil (Regler „Größe“, posterSize in %) der schmalsten Kartenbreite
// (Spalten sind nicht ganz gleich breit, so bleiben alle Poster gleich groß)
let posterW = 0;
function posterWidth(releases) {
  let w = Infinity;
  for (const r of releases) {
    if (!r.offsetWidth) continue;
    const cs = getComputedStyle(r);
    w = Math.min(w, r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  }
  if (!isFinite(w) || w < 60) return;
  w = Math.floor(w * Math.min(100, Math.max(20, +settings.posterSize || 100)) / 100);
  if (w === posterW) return;
  posterW = w;
  document.documentElement.style.setProperty("--crlf-pw", `${posterW}px`);
}
addEventListener("resize", () => scheduleFilter(), { passive: true });

// gleich beim Laden alle Serien der Seite anfragen (nicht erst, wenn ein Bild sichtbar wird)
function prefetchPosters(releases) { if (settings.thumbs !== "none") for (const r of releases) posterFor(r); }
chrome.storage.local.get({ crPosters4: {} }, (r) => {
  posterStore = r.crPosters4 || {};
  chrome.storage.local.remove(["crPosters", "crPosters2", "crPosters3"]); // alte Speicher (Crunchyroll-Bilder) verwerfen
  scheduleFilter();
});

// sichtbares Kartenbild, das ein Poster bekommen soll (Lesephase; eben erst eingeblendete Bilder haben evtl. noch keine Größe)
function posterImage(release) {
  if (release.querySelector("img.crlf-poster")) return null; // schon erledigt: nichts messen
  return cardImage(release) || [...release.querySelectorAll("img")].find((i) => i.getAttribute("src") && !isHidden(i, release)) || null;
}
// Kartenbild durch das Poster ersetzen (Poster der Seite nur auf gleiche Größe bringen); img aus posterImage
function showPoster(release, img) {
  if (!img || img.classList.contains("crlf-poster")) return;
  if (landscapeScore(img) === -1) { addCls(img, "crlf-poster-fit"); return; } // Poster der Seite: gleiche Größe
  const src = posterFor(release);
  if (!src) return;
  img.dataset.crlfPosterOrig = img.getAttribute("src") || "";
  addCls(img, "crlf-poster");
  if (img.parentElement && img.parentElement !== release) addCls(img.parentElement, "crlf-poster-box");
  img.src = src;
}
// Poster wieder durch das Bild der Seite ersetzen
function restorePoster(release) {
  release.querySelectorAll(".crlf-poster-fit").forEach((e) => e.classList.remove("crlf-poster-fit"));
  release.querySelectorAll(".crlf-poster-box").forEach((e) => e.classList.remove("crlf-poster-box"));
  for (const img of release.querySelectorAll("img.crlf-poster")) {
    img.classList.remove("crlf-poster");
    const orig = img.dataset.crlfPosterOrig;
    if (orig) img.setAttribute("src", orig); else img.removeAttribute("src");
    delete img.dataset.crlfPosterOrig;
  }
}

// Markierung aufgehoben: Vorschaubild wieder so wie auf der Seite (versteckt bzw. nicht geladen)
function restoreThumbnail(release) {
  release.querySelectorAll(".crlf-show").forEach((el) => el.classList.remove("crlf-show"));
  restorePoster(release);
  for (const img of release.querySelectorAll("img[data-crlf-orig-src]")) {
    const orig = img.dataset.crlfOrigSrc;
    if (orig) img.setAttribute("src", orig);
    else img.removeAttribute("src");
    delete img.dataset.crlfOrigSrc;
  }
}

// ===== 5. Kopfbereich, Abzeichen, Tagesspalten =====

// Kopfbereich (Reiter "Veröffentlichungskalender / Lineup" und Schalter "Premium / Kostenlos") per Text finden.
// Versteckt wird der kleinste gemeinsame Vorfahr, der keine Kalendereinträge enthält.
const TOP_PATTERNS = [
  [/veröffentlichungskalender|release calendar|simulcast-?kalender|simulcast calendar/i, /line-?up/i],
  [/premium/i, /kostenlos|free/i]
];

// Elemente mit kurzem passendem Text außerhalb der Kalenderkarten (höchstens 20)
function textElements(re) {
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && found.length < 20; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest(RELEASE_SELECTOR + ", .crlf-actions, script, style")) continue;
    if (re.test(n.textContent) && n.textContent.trim().length < 60) found.push(el);
  }
  return found;
}

// Tiefe eines Elements im Dokument (Anzahl Vorfahren)
const depth = (el) => { let d = 0; for (let p = el; p; p = p.parentElement) d++; return d; };

// engstes Paar: gemeinsamer Vorfahr mit größter Tiefe (z. B. nicht der "Premium"-Link in der Seitennavigation)
function tightestBlock(reA, reB) {
  let best = null;
  for (const ea of textElements(reA)) for (const eb of textElements(reB)) {
    if (ea === eb) continue;
    const c = commonAncestor(ea, eb);
    if (usable(c) && (!best || depth(c) > depth(best))) best = c;
  }
  return best;
}

// nächster gemeinsamer Vorfahr zweier Elemente
function commonAncestor(a, b) {
  for (let p = a; p; p = p.parentElement) if (p.contains(b)) return p;
  return null;
}

// als Kopfbereich brauchbar: nicht body/html und ohne Kalendereinträge
const usable = (el) => el && el !== document.body && el !== document.documentElement && !el.querySelector(RELEASE_SELECTOR);

let topBlocks = [];
// zu versteckende Blöcke (gemerkt, solange sie noch im Dokument sind)
function findTopBlocks() {
  if (topBlocks.length && topBlocks.every((b) => b.isConnected)) return topBlocks;
  const groups = TOP_PATTERNS.map(([a, b]) => tightestBlock(a, b)).filter(Boolean);
  // beide Gruppen in einem gemeinsamen Block ohne Kalender? Dann den ganzen Block (auch die Lücke dazwischen)
  if (groups.length === 2) {
    const both = commonAncestor(groups[0], groups[1]);
    // nur wenn dazwischen keine weiteren Bedienelemente liegen (z. B. Pfeile zum Wochenwechsel)
    const extra = both && [...both.querySelectorAll("a, button, input, select")].some((c) => !groups.some((g) => g.contains(c)));
    if (usable(both) && !extra) return (topBlocks = [both]);
  }
  return (topBlocks = groups);
}

// Einstellung „Kopfbereich ausblenden“ anwenden
function applyTopArea() {
  const hide = settings.active && settings.hideTop;
  document.querySelectorAll(".crlf-top-hidden").forEach((el) => { if (!hide) el.classList.remove("crlf-top-hidden"); });
  if (hide) findTopBlocks().forEach((el) => el.classList.add("crlf-top-hidden"));
}

// Kurzname einer Fassung für den Hinweis-Link
function versionLabel(lang) {
  if (lang === null) return T("OmU");
  const l = CR_LANGUAGES.find((x) => x.key === lang);
  return l ? T(l.label).replace(/\s*\(.*\)$/, "") : lang;
}

// Hinweis-Zeile direkt unter dem Titel (Staffel, Sprache, andere Fassung), damit die Kopfzeile frei bleibt
// Die Zeile sitzt vorn in der Folgen-Zeile („English  Folge 7  💬“), sonst unter dem Titel. Sie wird an der Karte gemerkt,
// damit sie nach einem Neuzeichnen der Folgen-Zeile durch die Seite sofort wieder eingesetzt werden kann.
function metaRow(release) {
  let row = release.querySelector(".crlf-meta") || release.crlfMeta;
  if (!row) {
    row = document.createElement("div");
    row.className = "crlf-meta";
  }
  return placeMeta(release, row) ? (release.crlfMeta = row) : null;
}
function placeMeta(release, row) {
  const line = release.querySelector(".crlf-epline");
  if (line) {
    if (row.parentElement !== line) line.prepend(row);
    return true;
  }
  if (release.contains(row)) return true;
  const titleEl = releaseTitleEl(release);
  const block = titleEl && (titleEl.closest("h1, h2, h3, h4, .season-name") || titleEl);
  if (!block || !release.contains(block)) return false;
  block.after(row);
  return true;
}

// Abzeichen einer Karte: Sprache bzw. „+ andere Fassung“ unter dem Titel, Staffel „ST 1 | T 2“ neben ★/▼
function updateAltBadges(entry, clean, season) {
  const bar = metaRow(entry.release);
  if (!bar) return;
  // Karte mit Sprachfassung: Sprache als Hinweis statt Link zur anderen Fassung
  const tag = clean && entry.lang !== null;
  const want = (season ? "s" + season.n + "." + season.part + ";" : "") + (tag ? "tag:" + entry.lang : entry.alts.map((a) => a.lang ?? "orig").join("|"));
  if ((bar.dataset.alts || "") === want) return; // nichts ändern, sonst endlose DOM-Änderungen
  bar.dataset.alts = want;
  bar.querySelectorAll(".crlf-alt").forEach((el) => el.remove());
  if (tag) {
    const t = document.createElement("span");
    t.className = "crlf-alt crlf-tag";
    t.textContent = versionLabel(entry.lang);
    t.title = T("Sprachfassung");
    bar.append(t);
  } else for (const alt of entry.alts) {
    const link = alt.release.querySelector("a[href]");
    const badge = document.createElement(link ? "a" : "span");
    badge.className = "crlf-alt";
    badge.textContent = "+ " + versionLabel(alt.lang);
    badge.title = T("Auch verfügbar: {0}", releaseTitle(alt.release) || "");
    if (link) badge.href = link.href;
    badge.addEventListener("click", (e) => e.stopPropagation());
    bar.append(badge);
  }
  // Staffel sitzt oben zwischen Uhrzeit und ★/▼
  const actions = entry.release.querySelector(".crlf-actions");
  if (actions) {
    actions.querySelectorAll(".crlf-season").forEach((el) => el.remove());
    if (season) {
      const s = document.createElement("span");
      s.className = "crlf-alt crlf-season";
      crlfSeasonBadge(s, season.n, season.part);
      s.title = T("Staffel {0}", season.n) + (season.part ? T(", Teil {0}", season.part) : "");
      actions.prepend(s);
    }
  }
}

// Tagesspalte je Liste finden (höchster Vorfahr, der nur diese eine Liste enthält) und markieren
function markDays(lists) {
  const counts = new Map();
  for (const l of lists) for (let p = l.parentElement; p; p = p.parentElement) counts.set(p, (counts.get(p) || 0) + 1);
  for (const l of lists) {
    const path = [l];
    let c = l;
    while (c.parentElement && c.parentElement !== document.body && counts.get(c.parentElement) === 1) path.push(c = c.parentElement);
    if (c !== l) path.pop(); // oberstes Element ist die Tagesspalte, nicht Teil des Pfads
    path.forEach((e) => addCls(e, "crlf-daypath"));
    if (c !== l) {
      if (c.classList.contains("crlf-daypath")) c.classList.remove("crlf-daypath");
      addCls(c, "crlf-day");
      // Tageskopf (Datum, Wochentag) = alles in der Spalte außerhalb des Pfads zur Liste
      for (let p = l; p !== c; p = p.parentElement)
        for (const sib of p.parentElement.children) if (sib !== p && !sib.classList.contains("crlf-daypath") && !sib.classList.contains("crlf-nofav")) addCls(sib, "crlf-dayhead");
    }
  }
  // Hüllen zwischen Seite und Kalender: werden bei gewähltem Hintergrund durchsichtig
  const first = lists.values().next().value;
  for (let p = first && first.parentElement; p && p !== document.body; p = p.parentElement) addCls(p, "crlf-bgpath");
}

// Hervorgehobene nach oben (abschaltbar: Einstellung „favTop“), ausgegraute nach unten; sonst ursprüngliche Reihenfolge
function sortList(list) {
  const children = [...list.children];
  for (const c of children) if (c.dataset.crlfIndex === undefined) c.dataset.crlfIndex = nextIndex++;
  const rank = (c) => { const m = c.dataset.crlfMark || "none"; return m === "fav" && !settings.favTop ? RANK.none : RANK[m]; };
  const sorted = [...children].sort((a, b) => rank(a) - rank(b) || a.dataset.crlfIndex - b.dataset.crlfIndex);
  if (sorted.some((c, i) => c !== children[i])) for (const c of sorted) list.appendChild(c);
}

// ===== 5b. Knöpfe 🏆 Top 10, „Nur Favoriten“ und „Heute“ (über dem ☀/☾-Knopf unten rechts) =====

// Datum (lokal, JJJJ-MM-TT) einer Karte aus <time datetime="…"> der Seite; null, wenn die Seite keines liefert
// Datum als JJJJ-MM-TT in Ortszeit
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => dayStr(new Date());
function releaseDay(release) {
  const t = release.querySelector("time[datetime]");
  const d = t && new Date(t.getAttribute("datetime"));
  return d && !isNaN(d) ? dayStr(d) : null;
}

// Knopfleiste anlegen bzw. auf den Stand bringen; markiert außerdem die Spalte von heute (.crlf-today)
function updateTools(releases) {
  let box = document.getElementById("crlf-tools");
  if (!settings.active) {
    if (box) box.hidden = true;
    document.documentElement.classList.remove("crlf-onlyfav");
    for (const el of document.querySelectorAll(".crlf-today")) el.classList.remove("crlf-today");
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.id = "crlf-tools";
    const fav = document.createElement("button");
    fav.type = "button"; fav.className = "crlf-tool crlf-tool-fav"; fav.textContent = "★";
    fav.addEventListener("click", () => chrome.storage.sync.set({ onlyFav: !settings.onlyFav }));
    const today = document.createElement("button");
    today.type = "button"; today.className = "crlf-tool crlf-tool-today"; today.textContent = T("Heute");
    today.addEventListener("click", goToday);
    const rank = document.createElement("button");
    rank.type = "button"; rank.className = "crlf-tool crlf-tool-rank";
    // Pokal als graue Umriss-Linie (wie die Symbole im Popup), kein buntes Emoji
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4");
    svg.append(path); rank.append(svg);
    rank.setAttribute("aria-label", T("Top 10 der Season"));
    rank.title = T("Top 10 der Season");
    rank.addEventListener("click", () => (commentPanel && commentPanel.classList.contains("crlf-rpanel") ? closeComments() : crlfOpenRanking()));
    box.append(rank, fav, today);
    document.body.appendChild(box);
  }
  setHidden(box, false);
  const key = (k) => (settings.hotkeys ? ` (${k})` : ""); // Kürzel im Tooltip, wenn eingeschaltet
  setAttr(box.querySelector(".crlf-tool-today"), "title", T("Zu heute springen") + key("H"));
  const rb = box.querySelector(".crlf-tool-rank");
  setAttr(rb, "title", T("Top 10 der Season") + key("T"));
  setHidden(rb, !settings.featureRank);
  if (!settings.featureRank && commentPanel && commentPanel.classList.contains("crlf-rpanel")) closeComments();
  const favOk = !!settings.featureFav;
  const nFav = favOk ? releases.filter((r) => releaseContainer(r).classList.contains("crlf-fav")).length : 0;
  const only = !!settings.onlyFav && favOk;
  document.documentElement.classList.toggle("crlf-onlyfav", only);
  const fb = box.querySelector(".crlf-tool-fav");
  setHidden(fb, !favOk);
  fb.classList.toggle("crlf-on", only);
  setAttr(fb, "aria-pressed", only);
  setAttr(fb, "title", (only ? T("Wieder alle Anime zeigen") : nFav ? T("Nur Favoriten (★) zeigen") : T("Nur Favoriten (★) zeigen – noch keine markiert")) + key("F"));
  const day = todayStr();
  const hit = releases.find((r) => releaseDay(r) === day);
  const col = hit && releaseContainer(hit).closest(".crlf-day");
  for (const el of document.querySelectorAll(".crlf-today")) if (el !== col) el.classList.remove("crlf-today");
  if (col) addCls(col, "crlf-today");
}

// Tastenkürzel (Einstellung „hotkeys“): H = Heute, F = nur Favoriten, T = Top 10 – lösen die Knöpfe unten rechts aus.
// Nicht beim Tippen (Eingabefelder, 💬-Panel) und nicht mit Strg/Alt/Cmd (Browser-Kürzel wie Strg+F bleiben frei).
addEventListener("keydown", (e) => {
  if (!settings.active || !settings.hotkeys || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
  const t = e.target;
  if (t instanceof Element && (t.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") || t.isContentEditable)) return;
  const cls = { h: "crlf-tool-today", f: "crlf-tool-fav", t: "crlf-tool-rank" }[e.key.toLowerCase()];
  const btn = cls && document.querySelector(`#crlf-tools .${cls}`);
  if (!btn || btn.hidden) return;
  e.preventDefault();
  btn.click();
}, true);

// „Heute“: Spalte von heute ins Bild holen; zeigt die Seite eine andere Woche, die Woche von heute laden
function goToday() {
  const col = document.querySelector(".crlf-day.crlf-today");
  if (col) {
    col.scrollIntoView({ block: "start", inline: "center" }); // ohne „smooth“: sanftes Scrollen blieb im Test manchmal stehen
    col.classList.remove("crlf-flash"); void col.offsetWidth; col.classList.add("crlf-flash");
    return;
  }
  const u = new URL(location.href);
  u.searchParams.set("date", todayStr());
  location.href = u.toString();
}

// ===== 6. Filter anwenden und Start =====

// Kompletter Durchlauf über alle Einträge; läuft bei jeder Änderung der Seite oder der Einstellungen
function applyFilter() { crlfTime("Filter und Sortierung", applyFilterNow); }
function applyFilterNow() {
  // Hauptschalter aus: Knöpfe verstecken, alles in Originalreihenfolge und unverändert anzeigen
  document.documentElement.classList.toggle("crlf-off", !settings.active);
  if (!settings.active) restoreAvailable();
  const releases = [...document.querySelectorAll(RELEASE_SELECTOR)].filter(
    // nur äußerste Treffer, und nur Kalenderkarten mit Uhrzeit (keine Vorschau-Einblendungen der Seite)
    (r) => !(r.parentElement && r.parentElement.closest(RELEASE_SELECTOR)) && r.querySelector("time, .available-time")
  );
  measureDepth(releases);
  const lists = new Set();
  // Indizes in Dokumentreihenfolge vergeben, bevor irgendetwas verschoben wird
  for (const r of releases) {
    const c = releaseContainer(r);
    if (c.dataset.crlfIndex === undefined) c.dataset.crlfIndex = nextIndex++;
  }
  const titled = [];
  for (const release of releases) {
    const title = releaseTitle(release);
    if (title === null) continue;
    titled.push(release);
    const key = crBaseTitle(title);
    const mark = activeMark(key);
    const container = releaseContainer(release);
    ensureButtons(release, key);
    setData(container, "crlfMark", mark);
    addCls(container, "crlf-item");
    container.classList.toggle("crlf-fav", mark === "fav");
    // Vorschaubilder: bei allen, nur bei Favoriten (Standard) oder bei keinem (auch die der Seite verstecken)
    const thumbs = settings.thumbs;
    if (thumbs === "all" || (thumbs === "fav" && mark === "fav")) showThumbnail(release);
    else if (release.querySelector(".crlf-show, img[data-crlf-orig-src]")) restoreThumbnail(release);
    container.classList.toggle("crlf-noimg", settings.active && thumbs === "none");
    container.classList.toggle("crlf-dim", mark === "dim");
    if (container.parentElement) lists.add(container.parentElement);
  }
  // Poster: erst die Bilder aller Karten bestimmen (misst Größen), dann ersetzen – eine Layout-Berechnung statt einer je Karte
  const posters = settings.active && settings.thumbs !== "none";
  const imgs = titled.map((r) => (posters ? posterImage(r) : null));
  titled.forEach((r, i) => (posters ? showPoster(r, imgs[i]) : restorePoster(r)));
  if (settings.active) prefetchPosters(releases);
  posterWidth(releases);
  updateProgress(releases);
  lists.forEach(sortList);
  markDays(lists);
  applyTopArea();
  updateTools(releases);

  // Sprachfilter und Doppelte, in der (neuen) Reihenfolge
  // (gleiche Titel fasst das Zusammenführen unten ohnehin zu einer Karte zusammen)
  const entries = [];
  const outer = new Set(releases);
  for (const release of document.querySelectorAll(RELEASE_SELECTOR)) {
    if (!outer.has(release)) continue;
    const title = releaseTitle(release);
    if (title === null) continue;
    entries.push({ release, hide: shouldHide(title), base: crBaseTitle(title), lang: crDetectLanguage(title) });
  }

  // Sicherheitsnetz: jeder Anime bleibt mindestens einmal sichtbar, auch wenn die Filter ihn ganz wegnehmen
  // würden (z. B. nur in einer anderen Sprache vorhanden). Bevorzugt: gewählte Sprache, dann Original, dann erster.
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.base)) groups.set(e.base, []);
    groups.get(e.base).push(e);
  }
  for (const group of groups.values()) {
    if (group.some((e) => !e.hide)) continue;
    const pick = group.find((e) => e.lang === settings.language) || group.find((e) => e.lang === null) || group[0];
    pick.hide = false;
  }

  // Synchro und Original desselben Anime zu einer Karte zusammenfassen; die andere Fassung als Hinweis-Link
  for (const e of entries) e.alts = [];
  if (settings.active && settings.merge) {
    const visible = new Map();
    for (const e of entries) {
      if (e.hide) continue;
      if (!visible.has(e.base)) visible.set(e.base, []);
      visible.get(e.base).push(e);
    }
    for (const group of visible.values()) {
      if (group.length < 2) continue;
      const byLang = (l) => group.find((e) => e.lang === l);
      const winner = settings.prefer === "original"
        ? byLang(null) || byLang(settings.language) || group[0]
        : byLang(settings.language) || byLang(null) || group[0];
      for (const e of group) {
        if (e === winner) continue;
        e.hide = true;
        if (e.lang !== winner.lang && !winner.alts.some((a) => a.lang === e.lang)) winner.alts.push(e);
      }
    }
  }

  // Titel aufräumen (Sprachzusatz/Staffel als Abzeichen statt im Titel)
  let count = 0;
  const clean = settings.active && settings.cleanTitles;
  const seasonOn = settings.active && settings.seasonTag;
  for (const e of entries) {
    const split = seasonOn ? crSplitSeason(crStripLanguage(releaseTitle(e.release) || "")) : { season: null };
    const season = split.season === null ? null : { n: split.season, part: split.part };
    updateShownTitle(e, clean && e.lang !== null, seasonOn && season !== null);
    updateAltBadges(e, clean, season);
  }
  for (const { release, hide } of entries) {
    const container = releaseContainer(release);
    if (container.classList.contains("crlf-hidden") !== hide) container.classList.toggle("crlf-hidden", hide);
    if (hide) count++;
  }
  hiddenCount = count;
  updateEmptyDays(lists);
}

// „Nur Favoriten“: Tage ohne sichtbare Karte bekommen einen Hinweis in normaler Spaltenbreite
// (sonst fällt die leere Spalte zusammen und die Woche verrutscht, z. B. Montag halb im Bild)
let dayW = 0;
chrome.storage.local.get({ crlfDayW: 0 }, (r) => { if (!dayW && r.crlfDayW) setDayW(r.crlfDayW); });
function setDayW(w) {
  dayW = w;
  document.documentElement.style.setProperty("--crlf-dayw", `${w}px`);
}
function updateEmptyDays(lists) {
  const only = settings.active && document.documentElement.classList.contains("crlf-onlyfav");
  let w = 0;
  for (const l of lists) {
    const next = l.nextElementSibling;
    const ph = next && next.classList.contains("crlf-nofav") ? next : null;
    const shown = [...l.children].some((c) => c.offsetHeight > 0);
    if (!only && shown) w = Math.max(w, l.offsetWidth); // Breite merken, solange Karten zu sehen sind
    if (only && !shown) {
      if (!ph) {
        const el = document.createElement("div");
        el.className = "crlf-nofav";
        el.textContent = T("Keine Favoriten an diesem Tag");
        l.after(el);
      }
    } else if (ph) ph.remove();
  }
  if (w >= 80 && Math.abs(w - dayW) > 2) {
    setDayW(w);
    chrome.storage.local.set({ crlfDayW: w });
  }
}

// applyFilter höchstens einmal pro Bild ausführen
let scheduled = false;
let settingsReady = false; // erst filtern, wenn Einstellungen und Markierungen geladen sind (sonst kurz falscher Zustand)
function scheduleFilter() {
  if (scheduled || !settingsReady) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyFilter();
  });
}

// Sprache von außen vorgeben (z. B. Link aus der Anleitung): „#crlf-lang=en“ bzw. „#crlf-lang=de“ in der Adresse
// speichert Oberflächensprache und bevorzugte Fassung; der Zusatz wird danach aus der Adresse entfernt.
(() => {
  const m = location.hash.match(/(?:^#|&)crlf-lang=(en|de)(?=&|$)/);
  if (!m) return;
  crlfLang = m[1]; // gilt sofort, ohne Neuladen
  settings.uiLang = settings.language = m[1];
  chrome.storage.sync.set({ uiLang: m[1], language: m[1] });
  const rest = location.hash.slice(1).split("&").filter((p) => !/^crlf-lang=/.test(p)).join("&");
  history.replaceState(history.state, "", location.pathname + location.search + (rest ? "#" + rest : ""));
  if (typeof crlfApplyTheme === "function") crlfApplyTheme(crlfTheme); // Titel des ☀/☾-Knopfs in der neuen Sprache
})();

// Crunchyroll zeichnet Teile einer Karte neu (z. B. die Folgen-Zeile beim Überfahren mit der Maus): 💬, ★/▼ und das
// gekürzte „Folge 3“ sofort wiederherstellen, noch bevor der Browser das Bild zeichnet – der volle Durchlauf (applyFilter)
// kommt erst ein Bild später, bis dahin war kurz die Originalzeile zu sehen (Flackern).
function fixCardsNow(mutations) {
  if (!settings.active) return;
  const cards = new Set();
  for (const m of mutations) {
    const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    const card = el && el.closest(RELEASE_SELECTOR);
    if (!card || !card.isConnected) continue;
    let outer = card; // äußerste Karte (verschachtelte Schema-Elemente)
    for (let p = card.parentElement && card.parentElement.closest(RELEASE_SELECTOR); p; p = p.parentElement && p.parentElement.closest(RELEASE_SELECTOR)) outer = p;
    if (releaseContainer(outer).classList.contains("crlf-item")) cards.add(outer);
  }
  for (const release of cards) {
    const title = releaseTitle(release);
    if (title !== null) ensureButtons(release, crBaseTitle(title));
  }
}

// Start: Einstellungen und Markierungen laden, filtern, danach Änderungen der Seite beobachten
chrome.storage.sync.get(CR_DEFAULT_SETTINGS, (stored) => {
  settings = { ...CR_DEFAULT_SETTINGS, ...stored };
  crlfLang = settings.uiLang === "en" ? "en" : "de";
  chrome.storage.local.get({ marks: {} }, (local) => {
    marks = local.marks;
    settingsReady = true;
    applyFilter();
    // nachgeladene Einträge (Wochenwechsel, Filter, Infinite Scroll) ebenfalls filtern
    new MutationObserver((mutations) => crlfTime("Beobachter Filter", () => {
      const relevant = mutations.some((m) =>
        m.type === "characterData" ||
        [...m.addedNodes].some((n) => !(n.nodeType === 1 && (n.classList.contains("crlf-actions") || n.classList.contains("crlf-alt") || n.classList.contains("crlf-meta") || n.classList.contains("crlf-nofav"))))
      );
      if (relevant) { fixCardsNow(mutations); scheduleFilter(); }
    })).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
});

// Einstellungen oder Markierungen geändert (Popup, ★/▼): sofort neu anwenden
chrome.storage.onChanged.addListener((changes, area) => {
  // andere Sprache der Oberfläche (Popup): Seite neu laden, damit alle Texte neu entstehen
  if (area === "sync" && changes.uiLang && (changes.uiLang.newValue === "en" ? "en" : "de") !== crlfLang) { location.reload(); return; }
  if (area === "local" && changes.marks) marks = changes.marks.newValue || {};
  else if (area === "sync") {
    const keys = Object.keys(changes).filter((k) => k in CR_DEFAULT_SETTINGS); // mk0… (Favoriten-Abgleich) ignorieren
    if (!keys.length) return;
    for (const key of keys) settings[key] = changes[key].newValue;
  } else return;
  if (settingsReady) applyFilter();
});

// ===== 7. Nachrichten vom Popup =====

// Nachrichten vom Popup: Zähler, Postergröße (live), Neuladen
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "crlf-count") sendResponse({ hidden: hiddenCount });
  if (msg.type === "crlf-postersize") { settings.posterSize = msg.value; scheduleFilter(); } // Vorschau beim Ziehen des Reglers
  // Add-on wird gleich neu geladen: Seite kurz danach auffrischen, damit die neuen Skripte greifen
  if (msg.type === "crlf-reload-soon") { setTimeout(() => location.reload(), 700); sendResponse(true); }
});
