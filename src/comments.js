// comments.js – 💬 Kommentare pro Folge, nur lesend. Hauptquelle AniList (GraphQL): Folgen-Thread mit Kommentaren, sonst
// Staffel-Überblick (Durchschnittsnote, Rezensionen). Ersatz: MyAnimeList-Diskussionen über die Jikan-API.
// Zusätzlich News von Anime News Network (aufklappbar, nur wenn vorhanden).
// Abgerufen wird nur beim Klick auf 💬 (die Suche nutzt auch die Vorschau in theme.js); Ergebnisse werden
// zwischengespeichert (storage.local "malCache", für alle Quellen). Die Zuordnung Crunchyroll-Titel -> Anime ist vom
// Nutzer korrigierbar: "alMap" (AniList, gilt auch für das Poster) bzw. "malMap" (MyAnimeList).
// Texte des Panels laufen über T() (i18n.js); Muster für Folgen-Texte der Seite und der Threads bleiben zweisprachig.
const MAL_TTL = { search: 7 * 864e5, forum: 3600e3, topic: 600e3, alsearch2: 7 * 864e5, althreads: 1800e3, alcomments: 600e3, alinfo: 6 * 3600e3, annnews: 6 * 3600e3, alrank: 6 * 3600e3 };

// ===== 1. Abrufe und Zwischenspeicher =====

// Abruf über das Hintergrundskript (background.js): dort gelten die Regeln der Crunchyroll-Seite nicht
async function jikan(path) {
  const r = await chrome.runtime.sendMessage({ type: "crlf-jikan", path });
  if (r && r.ok) return r.json;
  if (!r) throw new Error(T("MyAnimeList-Abruf fehlgeschlagen. Bitte das Add-on mit ↻ neu laden."));
  if (r.status === 429) throw new Error(T("MyAnimeList meldet zu viele Anfragen. Bitte kurz warten und erneut öffnen."));
  if (r.status >= 500) throw new Error(T("MyAnimeList (Jikan) ist gerade überlastet oder nicht erreichbar (Fehler {0}).", r.status));
  if (r.status) throw new Error(T("MyAnimeList-Abruf fehlgeschlagen (Fehler {0}).", r.status));
  // r.error kommt deutsch aus background.js („Zeitüberschreitung“ / „keine Verbindung“)
  throw new Error(T("MyAnimeList nicht erreichbar ({0}).", T(r.error || "keine Verbindung")));
}

// Ergebnis aus dem Zwischenspeicher (gültig je Art laut MAL_TTL) oder neu laden und speichern.
// Schreiben nacheinander und mit frisch gelesenem Stand, damit parallele Abfragen sich nichts überschreiben.
let malWrite = Promise.resolve();
async function malCached(kind, key, load) {
  const id = `${kind}:${key}`;
  const { malCache = {} } = await chrome.storage.local.get("malCache");
  const hit = malCache[id];
  if (hit && Date.now() - hit.t < MAL_TTL[kind]) return hit.v;
  const v = await load();
  malWrite = malWrite.then(async () => {
    const { malCache: cur = {} } = await chrome.storage.local.get("malCache");
    // klein halten: abgelaufene Einträge und solche unbekannter (alter) Arten beim Schreiben entfernen
    for (const [k, e] of Object.entries(cur)) { const ttl = MAL_TTL[k.split(":")[0]]; if (!ttl || Date.now() - e.t > ttl) delete cur[k]; }
    cur[id] = { t: Date.now(), v };
    await chrome.storage.local.set({ malCache: cur });
  }).catch((e) => crlfError("Zwischenspeicher speichern", e));
  return v;
}

// Suchtext für MyAnimeList: Titel ohne Sprachzusatz, ab Staffel 2 mit „Season N“
function malSearchQuery(title) {
  const { title: base, season } = crSplitSeason(crStripLanguage(title));
  return season && season > 1 ? `${base} Season ${season}` : base;
}

// Anime-Suche bei MyAnimeList (Jikan)
async function malSearch(query) {
  return malCached("search", query.toLowerCase(), async () => {
    const { data = [] } = await jikan(`/anime?q=${encodeURIComponent(query)}&limit=6&order_by=popularity&sort=asc`);
    return data.map((a) => ({ id: a.mal_id, title: a.title, en: a.title_english, year: a.year, type: a.type, url: a.url }));
  });
}

// Folgen-Diskussionen eines Anime bei MyAnimeList
async function malForum(id) {
  return malCached("forum", id, async () => {
    const { data = [] } = await jikan(`/anime/${id}/forum?filter=episode`);
    return data.map((t) => ({
      id: t.mal_id, title: t.title, url: t.url, comments: t.comments, date: t.date,
      last: t.last_comment ? { user: t.last_comment.author_username, date: t.last_comment.date } : null
    }));
  });
}

// Beiträge eines Threads; nicht jede Jikan-Version bietet das an, dann bleibt es beim Link
async function malTopic(id) {
  return malCached("topic", id, async () => {
    const json = await jikan(`/forum/topic/${id}`);
    const posts = json.data?.posts || json.data?.messages || json.data || [];
    return (Array.isArray(posts) ? posts : []).slice(0, 30).map((p) => ({
      user: p.author_username || p.username || p.user?.username || "",
      date: p.date || p.created_at || "",
      text: p.body || p.text || p.message || ""
    })).filter((p) => p.text).map((p) => ({ ...p, text: cleanHtml(p.text) }));
  });
}

// ===== 2. Panel: Aufbau, Öffnen, Schließen =====

// HTML eines MAL-Beitrags in lesbaren Text
function cleanHtml(t) {
  return t.replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Folge der Karte: zuerst die Folgen-Zeile („Folge 3 Verfügbar“), sonst der ganze Kartentext.
// Bei „Folgen 1-13“ zählt die letzte; die Spanne wird für den Kopf gemerkt.
function episodeInfo(release) {
  const line = release.querySelector(".crlf-epline");
  const re = /(?:Folgen?|Episoden?|Episodes?|Ep\.?)\s*(\d+)(?:\s*[-–]\s*(\d+))?/i;
  const m = (line && line.textContent.match(re)) || release.textContent.replace(/\s+/g, " ").match(re);
  if (!m) return { ep: null, label: "" };
  return { ep: +(m[2] || m[1]), label: m[2] ? T("Folgen {0}–{1}", m[1], m[2]) : T("Folge {0}", m[1]) };
}

// Folgennummer aus einem Thread-Titel („Episode 5 Discussion“)
const threadEpisode = (t) => { const m = t.title.match(/\b(?:Episode|Ep\.?|Folge)\s*(\d+)/i); return m ? +m[1] : null; };
// Datum kurz (17.10.26) in der Sprache der Oberfläche
const fmtDate = (d) => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleDateString(crlfLocale(), { day: "2-digit", month: "2-digit", year: "2-digit" }); };

// kleine Helfer zum Bauen des Panels
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// nur https-Adressen als Link zulassen (Adressen kommen aus AniList, Jikan, ANN oder einer geladenen Sicherung)
function safeUrl(href) {
  try { const u = new URL(String(href || "")); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; }
}
// Link, der in einem neuen Tab öffnet; unsichere Adresse: Text ohne Link
function link(href, text, cls) {
  const a = el("a", cls, text);
  const url = safeUrl(href);
  if (url) a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

let commentPanel = null;
// Panel schließen (Esc, ✕, Scrollen im Wochenplan)
function closeComments() {
  if (commentPanel) commentPanel.remove();
  commentPanel = null;
  commentWheel = 0;
}
addEventListener("keydown", (e) => { if (e.key === "Escape") closeComments(); });
// Scrollen im Wochenplan (nicht im Panel) schließt das Panel; kleine Schwelle gegen versehentliches Zucken am Mausrad
let commentWheel = 0, commentWheelAt = 0, commentScrollFrom = null, commentInsideAt = -1e9;
addEventListener("wheel", (e) => {
  if (!commentPanel) return;
  if (commentPanel.contains(e.target)) { commentInsideAt = performance.now(); return; }
  if (e.timeStamp - commentWheelAt > 500) commentWheel = 0;
  commentWheelAt = e.timeStamp;
  commentWheel += Math.abs(e.deltaY) + Math.abs(e.deltaX);
  if (commentWheel > 60) closeComments();
}, { capture: true, passive: true });
addEventListener("scroll", (e) => { // Bildlaufleiste, Tastatur: Seite um mehr als 60 px bewegt
  if (!commentPanel || (e.target instanceof Node && commentPanel.contains(e.target))) return;
  // am Listenende läuft das Mausrad im Panel in die Seite weiter: das schließt nicht
  if (performance.now() - commentInsideAt < 600) { commentScrollFrom = { x: scrollX, y: scrollY }; return; }
  if (!commentScrollFrom) commentScrollFrom = { x: scrollX, y: scrollY };
  if (Math.abs(scrollY - commentScrollFrom.y) + Math.abs(scrollX - commentScrollFrom.x) > 60) closeComments();
}, { capture: true, passive: true });

// Leeres Panel am rechten Rand (Handy: Blatt von unten) mit Titel, Unterzeile und ✕ öffnen; ersetzt ein offenes.
// Wird auch für die Top 10 der Season genutzt (rank.js). Ergebnis { panel, body }.
function crlfPanel(title, sub, aria) {
  closeComments();
  const panel = el("aside", "crlf-cpanel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", aria);
  const head = el("header", "crlf-chead");
  const h = el("div", "crlf-ctitle");
  h.append(el("strong", null, title), el("small", null, sub));
  const x = el("button", "crlf-cclose", "✕");
  x.type = "button";
  x.title = T("Schließen (Esc)");
  x.addEventListener("click", closeComments);
  head.append(h, x);
  const body = el("div", "crlf-cbody");
  panel.append(head, body);
  document.body.appendChild(panel);
  commentPanel = panel;
  if (typeof crlfFitSheet === "function") crlfFitSheet(panel, 0.85, true); // Handy: Blatt von unten
  commentScrollFrom = { x: scrollX, y: scrollY };
  // Scrollen im Panel bleibt im Panel (sonst liefe es am Listenende in die Seite weiter und würde das Panel schließen)
  panel.addEventListener("wheel", (e) => {
    const b = body, atTop = b.scrollTop <= 0, atEnd = b.scrollTop + b.clientHeight >= b.scrollHeight - 1;
    if (!b.contains(e.target) || (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atEnd)) e.preventDefault();
  }, { passive: false });
  return { panel, body };
}

// Panel öffnen: erst AniList, bei Fehler MyAnimeList, sonst Fehlermeldungen und Such-Links
async function crlfOpenComments(release, key) {
  const title = releaseTitle(release) || key;
  const { ep, label: epLabel } = episodeInfo(release);
  const sp = crSplitSeason(crStripLanguage(title));
  const sub = [sp.season ? T("Staffel {0}", sp.season) : "", epLabel, T("Diskussion")].filter(Boolean).join(" · ");
  const { panel, body } = crlfPanel(sp.title, sub, T("Kommentare zur Folge"));

  const status = (t) => { body.replaceChildren(el("p", "crlf-cmuted", t)); };
  const query = malSearchQuery(title);
  const seasonSfx = (query.match(/ Season \d+$/) || [""])[0];
  const en = typeof crlfSlugTitle === "function" ? crlfSlugTitle(release) : "";
  const errors = [];
  status(T("Suche bei AniList …"));
  try {
    // Originaltitel und grob übersetzter Titel (match.js); bester Kandidat zuerst, sonst erster Suchtreffer
    // dazu der englische Titel aus der Serien-Adresse der Karte (zuerst, er trifft am zuverlässigsten)
    const de = crlfTranslateTitle(crSplitSeason(crStripLanguage(title)).title) + seasonSfx;
    const qs = [...new Set([en && en + seasonSfx, query, de].filter(Boolean).map((q) => q.toLowerCase()))];
    const results = [];
    let fails = 0, firstErr = null;
    for (const q of qs) {
      const list = await alSearch(q).catch((e) => { fails++; firstErr = firstErr || e; return []; });
      for (const r of list) if (!results.some((x) => x.id === r.id)) results.push(r);
    }
    if (fails === qs.length) throw firstErr; // AniList gar nicht erreichbar
    if (commentPanel !== panel) return;
    const { alMap = {} } = await chrome.storage.local.get("alMap");
    const media = alMap[key] || crlfBestMatch(title, results, en) || results[0];
    if (media) return await renderAniList(panel, body, media, results, key, ep, query);
    errors.push(T("AniList: nichts gefunden"));
  } catch (err) {
    errors.push(`AniList: ${err.message}`);
  }
  if (commentPanel !== panel) return;
  status(T("AniList klappt nicht, versuche MyAnimeList …"));
  try {
    const { malMap = {} } = await chrome.storage.local.get("malMap");
    let results = en ? await malSearch(en + seasonSfx).catch(() => []) : [];
    if (!results.length) results = await malSearch(query);
    if (commentPanel !== panel) return;
    const anime = malMap[key] || results[0];
    if (anime) return await renderAnime(panel, body, anime, results, key, ep);
    errors.push(T("MyAnimeList: nichts gefunden"));
  } catch (err) {
    errors.push(`MyAnimeList: ${err.message}`);
  }
  if (commentPanel !== panel) return;
  const box = el("div", "crlf-ccontent");
  box.appendChild(el("p", "crlf-cmuted", T("Keine Kommentar-Quelle erreichbar.")));
  for (const e of errors) box.appendChild(el("p", "crlf-cerr", e));
  body.replaceChildren(box, sourceLinks(en ? en + seasonSfx : query, ep));
}

// ===== 3. AniList (Hauptquelle) =====
// GraphQL-Abfrage über das Hintergrundskript (nur Leseabfragen)
async function anilist(query, variables) {
  const r = await chrome.runtime.sendMessage({ type: "crlf-anilist", query, variables });
  if (!r) throw new Error(T("Abruf fehlgeschlagen, bitte das Add-on mit ↻ neu laden"));
  if (r.ok && r.json && !r.json.errors) return r.json.data;
  if (r.json && r.json.errors) throw new Error(r.json.errors[0]?.message || T("Fehler in der Antwort"));
  if (r.status === 429) throw new Error(T("zu viele Anfragen, bitte kurz warten"));
  if (r.status) throw new Error(T("Fehler {0}", r.status));
  throw new Error(T(r.error || "keine Verbindung"));
}

// Anime-Suche (wird auch für die Bewertung in der Vorschau genutzt, siehe theme.js)
async function alSearch(q) {
  return malCached("alsearch2", q.toLowerCase(), async () => {
    const d = await anilist(`query($q:String){Page(perPage:6){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} synonyms status seasonYear format siteUrl}}}`, { q });
    return d.Page.media.map((m) => ({
      id: m.id, title: m.title.english || m.title.romaji, romaji: m.title.romaji, english: m.title.english, synonyms: m.synonyms,
      status: m.status, seasonYear: m.seasonYear, format: m.format, year: m.seasonYear, type: m.format, url: m.siteUrl
    }));
  });
}

// Diskussions-Threads eines Anime (neueste zuerst)
async function alThreads(id) {
  return malCached("althreads", id, async () => {
    const d = await anilist(`query($id:Int){Page(perPage:50){threads(mediaCategoryId:$id,sort:CREATED_AT_DESC){id title replyCount siteUrl createdAt}}}`, { id });
    return d.Page.threads.map((t) => ({ id: t.id, title: t.title, url: t.siteUrl, comments: t.replyCount, date: t.createdAt * 1000 }));
  });
}

// gezielte Suche nach dem Thread einer Folge, falls er nicht unter den 50 neuesten ist (beliebte Anime haben viele Threads)
async function alEpisodeThread(id, ep) {
  return malCached("althreads", `${id}:${ep}`, async () => {
    const d = await anilist(`query($id:Int,$s:String){Page(perPage:10){threads(mediaCategoryId:$id,search:$s,sort:CREATED_AT_DESC){id title replyCount siteUrl createdAt}}}`, { id, s: `Episode ${ep}` });
    return d.Page.threads.map((t) => ({ id: t.id, title: t.title, url: t.siteUrl, comments: t.replyCount, date: t.createdAt * 1000 }));
  });
}

// Kommentare eines Threads
async function alComments(threadId) {
  return malCached("alcomments", threadId, async () => {
    const d = await anilist(`query($id:Int){Page(perPage:25){threadComments(threadId:$id,sort:ID){comment likeCount createdAt user{name}}}}`, { id: threadId });
    return d.Page.threadComments.map((c) => ({ user: c.user?.name || "", date: c.createdAt * 1000, likes: c.likeCount, text: cleanMarkup(c.comment || "") })).filter((c) => c.text);
  });
}

// Staffel-Überblick: Durchschnittsnote, Mitglieder, beste Rezensionen
async function alInfo(id) {
  return malCached("alinfo", id, async () => {
    const d = await anilist(`query($id:Int){Media(id:$id){averageScore popularity siteUrl reviews(sort:RATING_DESC,perPage:4){nodes{summary score user{name} siteUrl}}}}`, { id });
    const m = d.Media;
    return { score: m.averageScore, popularity: m.popularity, url: m.siteUrl,
      reviews: (m.reviews?.nodes || []).map((r) => ({ summary: r.summary, score: r.score, user: r.user?.name || "", url: r.siteUrl })) };
  });
}

// ===== 4. Anime News Network =====
// News zu einem Anime aus dem ANN-Lexikon (öffentliche API; Bedingung: ANN als Quelle nennen und auf den Eintrag
// verlinken). Gesucht wird mit dem englischen und dem Romaji-Titel von AniList, der passende Eintrag per Abgleich
// (match.js). Ergebnis { url, news: [{ title, url, date }] } – neueste zuerst, höchstens 6; ohne News null.
async function annNews(media) {
  return malCached("annnews", media.id, async () => {
    const names = [...new Set([media.english, media.romaji, media.title].filter(Boolean))].slice(0, 2);
    const cands = new Map();
    for (const name of names) {
      const r = await chrome.runtime.sendMessage({ type: "crlf-ann", name }).catch(() => null);
      if (!r || !r.ok || !r.text) continue;
      const xml = new DOMParser().parseFromString(r.text, "text/xml");
      for (const a of xml.querySelectorAll("ann > anime")) {
        const infos = [...a.querySelectorAll(":scope > info")];
        const alt = infos.filter((i) => i.getAttribute("type") === "Alternative title").map((i) => i.textContent);
        const type = (a.getAttribute("type") || "").toUpperCase();
        cands.set(a.getAttribute("id"), {
          id: a.getAttribute("id"), romaji: (a.getAttribute("name") || "").replace(/\s*\((TV|ONA|OAV|OVA|movie)[^)]*\)\s*$/i, ""), synonyms: alt,
          format: type === "TV" ? "TV" : type === "ONA" ? "ONA" : type === "MOVIE" ? "MOVIE" : type === "OAV" ? "SPECIAL" : "",
          news: [...a.querySelectorAll(":scope > news")].map((n) => ({ title: n.textContent.trim(), url: n.getAttribute("href") || "", date: Date.parse(n.getAttribute("datetime") || "") || 0 }))
        });
      }
      if (cands.size) break;
    }
    const want = media.english || media.romaji || media.title;
    const hit = crlfBestMatch(want, [...cands.values()]) || (media.romaji && crlfBestMatch(media.romaji, [...cands.values()]));
    if (!hit) return null;
    const news = hit.news.filter((n) => n.title && /^https:\/\/www\.animenewsnetwork\.com\//.test(n.url)).sort((a, b) => b.date - a.date).slice(0, 6);
    return news.length ? { url: `https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${encodeURIComponent(hit.id)}`, news } : null;
  });
}
// Aufklappbarer Bereich „News“ im 💬-Panel; erscheint nur, wenn es News gibt
function newsSection(panel, media, before) {
  annNews(media).then((res) => {
    if (!res || commentPanel !== panel || !before.isConnected) return;
    const box = el("details", "crlf-cnews");
    const sum = el("summary", null, T("📰 News ({0})", res.news.length));
    box.appendChild(sum);
    for (const n of res.news) {
      const card = link(n.url, null, "crlf-cthread");
      card.append(el("b", null, n.title), el("small", null, n.date ? new Date(n.date).toLocaleDateString(crlfLocale(), { day: "2-digit", month: "2-digit", year: "numeric" }) : ""));
      box.appendChild(card);
    }
    const src = el("small", "crlf-cmuted");
    src.append(T("Quelle: "), link(res.url, "Anime News Network ↗"));
    box.appendChild(src);
    before.before(box);
  }).catch((e) => crlfError("News laden", e));
}

// ===== 5. Inhalte des Panels =====

// AniList-Markdown/HTML in lesbaren Text: Spoiler-Marken, Bilder, Links, Tags entfernen
function cleanMarkup(t) {
  return t.replace(/~!([\s\S]*?)!~/g, (m, x) => T("[Spoiler: {0}]", x)).replace(/~!|!~/g, "").replace(/img\d*%?\((.*?)\)/gi, () => T("[Bild]")).replace(/youtube\((.*?)\)|webm\((.*?)\)/gi, "[Video]")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/[_*~#>]{1,3}/g, "").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Auswahlfeld „welcher Anime ist gemeint?“ (Treffer der Suche; die Wahl wird je Anime gemerkt)
function matchPicker(label, current, results, onPick) {
  const match = el("div", "crlf-cmatch");
  const sel = el("select");
  sel.setAttribute("aria-label", T("Anime bei {0}", label));
  const opts = results.some((r) => r.id === current.id) ? results : [current, ...results];
  for (const r of opts) {
    const o = el("option", null, `${r.title}${r.year ? ` (${r.year})` : ""}${r.type ? ` · ${r.type}` : ""}`);
    o.value = r.id;
    o.selected = r.id === current.id;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => onPick(opts.find((r) => String(r.id) === sel.value)));
  match.append(el("span", null, `${label}:`), sel);
  return match;
}

// Fußzeile: Hauptknopf (mitdiskutieren) und Such-Links zu AniList, MyAnimeList und r/anime
function sourceLinks(query, ep, main) {
  const foot = el("footer", "crlf-cfoot");
  if (main) foot.appendChild(main);
  const more = el("div", "crlf-cmore");
  more.append(
    link(`https://anilist.co/search/anime?search=${encodeURIComponent(query)}`, "AniList ↗", "crlf-clink"),
    link(`https://myanimelist.net/anime.php?q=${encodeURIComponent(query)}&cat=anime`, "MyAnimeList ↗", "crlf-clink"),
    link(`https://www.reddit.com/r/anime/search/?q=${encodeURIComponent(`${query} Episode ${ep ?? ""} discussion`)}&restrict_sr=1`, "r/anime ↗", "crlf-clink")
  );
  foot.appendChild(more);
  return foot;
}

// kleines Abzeichen „Folge 26“: auf welche Folge sich ein Kommentar oder Thread bezieht
function epTag(n) { return el("i", "crlf-cep", T("Folge {0}", n)); }

// Liste von Kommentaren mit Name, Folge, Likes und Datum
function commentList(list, epNo) {
  const posts = el("div", "crlf-cposts");
  for (const p of list) {
    const post = el("article", "crlf-cpost");
    const meta = el("div", "crlf-cmeta");
    const who = el("span", "crlf-cwho");
    who.append(el("b", null, p.user));
    if (epNo) who.appendChild(epTag(epNo));
    meta.append(who, el("span", null, [p.likes ? `♥ ${p.likes}` : "", fmtDate(p.date)].filter(Boolean).join(" · ")));
    post.append(meta, el("p", null, p.text));
    posts.appendChild(post);
  }
  return posts;
}

// AniList-Ansicht: Thread zur Folge mit Kommentaren, sonst Staffel-Überblick und neueste Threads
async function renderAniList(panel, body, media, results, key, ep, query) {
  body.replaceChildren(el("p", "crlf-cmuted", T("Lade Diskussionen …")));
  const picker = matchPicker("AniList", media, results, async (pick) => {
    const { alMap = {} } = await chrome.storage.local.get("alMap");
    alMap[key] = pick;
    await chrome.storage.local.set({ alMap });
    renderAniList(panel, body, pick, results, key, ep, query).catch((e) => body.replaceChildren(el("p", "crlf-cmuted", e.message)));
  });
  const threads = await alThreads(media.id);
  if (commentPanel !== panel) return;
  const content = el("div", "crlf-ccontent");
  let exact = ep ? threads.find((t) => threadEpisode(t) === ep) : null;
  if (ep && !exact) exact = (await alEpisodeThread(media.id, ep).catch(() => [])).find((t) => threadEpisode(t) === ep) || null;
  if (commentPanel !== panel) return;
  let main;
  if (exact) {
    content.appendChild(threadCard(exact, true));
    const list = await alComments(exact.id).catch(() => []);
    if (commentPanel !== panel) return;
    content.appendChild(list.length ? commentList(list, ep) : el("p", "crlf-cmuted", T("Noch keine Kommentare.")));
    main = link(exact.url, T("Auf AniList mitdiskutieren ↗"), "crlf-cbtn");
  } else {
    // keine Diskussion zu dieser Folge: Überblick über die ganze Staffel
    const info = await alInfo(media.id);
    if (commentPanel !== panel) return;
    content.appendChild(missingNote(ep, threads));
    content.appendChild(el("p", "crlf-cmuted", T("Überblick über die Staffel:")));
    const sum = el("div", "crlf-csum");
    const score = el("div", "crlf-cscore", info.score ? `${info.score}%` : "–");
    const txt = el("div");
    txt.append(el("b", null, T("Durchschnittsbewertung")), el("small", null, T("{0} Mitglieder auf AniList", (info.popularity || 0).toLocaleString(crlfLocale()))));
    sum.append(score, txt);
    content.appendChild(sum);
    for (const r of info.reviews) {
      const card = link(r.url, null, "crlf-cthread");
      card.append(el("b", null, r.summary), el("small", null, T("{0}/100 · Rezension von {1}", r.score, r.user)));
      content.appendChild(card);
    }
    if (threads.length) {
      content.appendChild(el("p", "crlf-cmuted", T("Neueste Diskussionen:")));
      for (const t of threads.slice(0, 4)) content.appendChild(threadCard(t, false));
    }
    main = link(info.url || media.url, T("Auf AniList ansehen ↗"), "crlf-cbtn");
  }
  const links = sourceLinks(media.english || media.romaji || query, ep, main);
  body.replaceChildren(picker, content, links);
  newsSection(panel, media, links);
}

// Hinweis, wenn es zur Folge der Karte keine Diskussion gibt, mit der neuesten vorhandenen Folge
function missingNote(ep, threads) {
  const nums = threads.map(threadEpisode).filter((n) => n != null);
  const newest = nums.length ? Math.max(...nums) : null;
  const text = ep
    ? T("Keine Diskussion zu Folge {0}", ep) + (newest != null ? T(", neueste: Folge {0}", newest) : "") + "."
    : T("Folge der Karte unbekannt") + (newest != null ? T(", neueste Diskussion: Folge {0}", newest) : "") + ".";
  return el("p", "crlf-cnote", text);
}

// ===== 6. MyAnimeList (Ersatz) =====
// MAL-Ansicht: Thread zur Folge (Beiträge, wenn Jikan sie liefert), sonst die neuesten Folgen-Threads
async function renderAnime(panel, body, anime, results, key, ep) {
  body.replaceChildren(el("p", "crlf-cmuted", T("Lade Diskussionen …")));
  const picker = matchPicker("MAL", anime, results, async (pick) => {
    const { malMap = {} } = await chrome.storage.local.get("malMap");
    malMap[key] = pick;
    await chrome.storage.local.set({ malMap });
    renderAnime(panel, body, pick, results, key, ep).catch((e) => body.replaceChildren(el("p", "crlf-cmuted", e.message)));
  });
  const threads = await malForum(anime.id);
  if (commentPanel !== panel) return;
  const content = el("div", "crlf-ccontent");
  const exact = ep ? threads.find((t) => threadEpisode(t) === ep) : null;
  if (exact) {
    content.appendChild(threadCard(exact, true));
    const posts = el("div", "crlf-cposts");
    content.appendChild(posts);
    // Beiträge nachladen; ohne Beitrags-Abruf bleibt der Link zum Thread
    malTopic(exact.id).then((list) => { if (list.length) posts.replaceWith(commentList(list, ep)); }).catch((e) => crlfError("Kommentare laden", e));
  } else {
    content.appendChild(threads.length ? missingNote(ep, threads) : el("p", "crlf-cmuted", T("Zu diesem Anime gibt es noch keine Folgen-Threads.")));
    if (threads.length) content.appendChild(el("p", "crlf-cmuted", T("Neueste Folgen-Threads (Nummerierung kann abweichen):")));
    for (const t of threads.slice(0, 6)) content.appendChild(threadCard(t, false));
  }
  const foot = sourceLinks(anime.title, ep, link(exact ? exact.url : `${anime.url}/forum?topic=episode`, T("Auf MyAnimeList mitschreiben ↗"), "crlf-cbtn"));
  body.replaceChildren(picker, content, foot);
}

// Karte für einen Thread (mit „Folge N“-Abzeichen und Anzahl Kommentare)
function threadCard(t, main) {
  const card = link(t.url, null, "crlf-cthread" + (main ? " crlf-cmain" : ""));
  const n = threadEpisode(t);
  const head = el("b", null, t.title);
  if (n != null) head.prepend(epTag(n));
  card.append(head);
  const info = el("small", null, T("{0} Kommentare", t.comments ?? 0) + (t.last ? T(" · zuletzt {0}, {1}", t.last.user, fmtDate(t.last.date)) : ""));
  card.appendChild(info);
  return card;
}
