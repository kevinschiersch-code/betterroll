// rank.js – Top 10 der aktuellen Season (Nutzerwunsch; abschaltbar im Popup, Einstellung featureRank). Quelle: die AniList-Community (öffentliche Schnittstelle,
// nur lesend); BetterRoll sendet dafür keine eigenen Daten. Geöffnet über den Knopf 🏆 unten rechts (content.js),
// angezeigt im selben Panel wie die 💬-Kommentare (crlfPanel in comments.js).
// Sortierung wählbar: beste Bewertung (Ø-Note, nur Anime mit genug Mitgliedern) oder beliebteste (Mitglieder).
// Eigene ★-Favoriten sind markiert; läuft ein Anime im Kalender, springt ein Klick zu seiner Karte.
// Gemerkt: Ergebnis 6 Stunden in "malCache" (Art "alrank"), gewählte Sortierung in storage.local "crRankSort".

// ===== 1. Daten =====

// aktuelle Season nach AniList-Einteilung (Winter = Jan–Mär, Frühling = Apr–Jun, Sommer = Jul–Sep, Herbst = Okt–Dez)
function crlfThisSeason() {
  const d = new Date();
  return { season: ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(d.getMonth() / 3)], year: d.getFullYear() };
}

// Top 10 einer Season laden: sort "score" (Ø-Note, ab 2000 Mitgliedern, damit wenige Stimmen nicht reichen) oder "popular"
async function crlfSeasonTop(season, year, sort) {
  return malCached("alrank", `${season}${year}|${sort}`, async () => {
    const d = await anilist(`query($s:MediaSeason,$y:Int,$sort:[MediaSort],$min:Int){Page(perPage:10){media(type:ANIME,season:$s,seasonYear:$y,isAdult:false,format_in:[TV,TV_SHORT,ONA],popularity_greater:$min,sort:$sort){id title{romaji english} synonyms status seasonYear format averageScore popularity coverImage{medium} siteUrl}}}`,
      { s: season, y: year, sort: sort === "popular" ? ["POPULARITY_DESC"] : ["SCORE_DESC", "POPULARITY_DESC"], min: sort === "popular" ? 0 : 2000 });
    return d.Page.media.map((m) => ({
      id: m.id, title: m.title.english || m.title.romaji, romaji: m.title.romaji, english: m.title.english, synonyms: m.synonyms,
      status: m.status, seasonYear: m.seasonYear, format: m.format, score: m.averageScore || 0, members: m.popularity || 0,
      cover: m.coverImage && m.coverImage.medium, url: m.siteUrl
    }));
  });
}

// Karte im Kalender zu einem AniList-Anime (Abgleich wie bei den Postern, match.js); null, wenn er hier nicht läuft
function crlfRankCard(m) {
  let best = null, top = CRLF_MATCH_MIN;
  for (const r of document.querySelectorAll(RELEASE_SELECTOR)) {
    if (!r.offsetParent || !releaseContainer(r).classList.contains("crlf-item")) continue; // nur sichtbare Kalenderkarten
    const t = releaseTitle(r);
    if (!t) continue;
    const { score } = crlfMatchScore(t, m);
    if (score >= top) { top = score; best = r; }
  }
  return best;
}
// gehört der Anime zu den eigenen ★? (Karte im Kalender oder gespeicherte Markierung mit passendem Titel)
function crlfRankIsFav(m, card) {
  if (card) return marks[crBaseTitle(releaseTitle(card) || "")] === "fav";
  return Object.entries(marks).some(([k, v]) => v === "fav" && crlfMatchScore(k, m).score >= CRLF_MATCH_MIN);
}

// ===== 2. Anzeige =====

// Zahl der Mitglieder kurz („123.400“ -> „123 Tsd.“ bzw. „123K“)
function crlfShortCount(n) {
  if (n >= 1e6) return T("{0} Mio.", (n / 1e6).toLocaleString(crlfLocale(), { maximumFractionDigits: 1 }));
  if (n >= 1e3) return T("{0} Tsd.", Math.round(n / 1e3).toLocaleString(crlfLocale()));
  return String(n);
}

// Karte im Kalender ins Bild holen und kurz aufleuchten lassen
function crlfRankJump(card) {
  closeComments();
  const box = releaseContainer(card);
  box.scrollIntoView({ block: "center", inline: "center" });
  box.classList.remove("crlf-flash"); void box.offsetWidth; box.classList.add("crlf-flash");
}

// Panel „Top 10 der Season“ öffnen
async function crlfOpenRanking() {
  const { season, year } = crlfThisSeason();
  const seasonName = `${T({ WINTER: "Winter", SPRING: "Frühling", SUMMER: "Sommer", FALL: "Herbst" }[season])} ${year}`;
  const { panel, body } = crlfPanel(T("Top 10 der Season"), `${seasonName} · ${T("AniList-Community")}`, T("Top 10 der Season"));
  panel.classList.add("crlf-rpanel");
  const { crRankSort = "score" } = await chrome.storage.local.get("crRankSort");

  // Umschalter Sortierung
  const tabs = el("div", "crlf-rtabs");
  tabs.setAttribute("role", "tablist");
  const list = el("ol", "crlf-rlist");
  const foot = el("p", "crlf-cfoot");
  foot.append(T("Quelle: "), link("https://anilist.co/search/anime/this-season", "AniList ↗"));
  for (const [key, label] of [["score", T("Beste Bewertung")], ["popular", T("Beliebteste")]]) {
    const b = el("button", "crlf-rtab", label);
    b.type = "button";
    b.dataset.sort = key;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => { chrome.storage.local.set({ crRankSort: key }); show(key); });
    tabs.appendChild(b);
  }
  body.replaceChildren(tabs, list, foot);

  async function show(sort) {
    for (const b of tabs.children) { const on = b.dataset.sort === sort; b.classList.toggle("crlf-on", on); b.setAttribute("aria-selected", on); }
    list.replaceChildren(el("li", "crlf-cmuted", T("Lädt …")));
    let top;
    try { top = await crlfSeasonTop(season, year, sort); } catch (e) {
      list.replaceChildren(el("li", "crlf-cerr", T("AniList nicht erreichbar ({0}).", e.message)));
      return;
    }
    if (panel !== commentPanel) return; // inzwischen geschlossen
    if (!top.length) { list.replaceChildren(el("li", "crlf-cmuted", T("Für diese Season gibt es noch keine Liste."))); return; }
    list.replaceChildren(...top.map((m, i) => rankRow(m, i + 1)));
  }

  // eine Zeile: Platz, Poster, Titel, Note/Mitglieder, ★ und „im Kalender“
  function rankRow(m, n) {
    const card = crlfRankCard(m), fav = crlfRankIsFav(m, card);
    const li = el("li", "crlf-rrow" + (fav ? " crlf-rfav" : ""));
    li.appendChild(el("b", "crlf-rnum", String(n)));
    const img = el("img", "crlf-rimg");
    img.alt = "";
    img.loading = "lazy";
    if (m.cover) img.src = m.cover;
    li.appendChild(img);
    const text = el("div", "crlf-rtext");
    const name = card ? el("button", "crlf-rname", m.title) : link(m.url, m.title, "crlf-rname");
    if (card) {
      name.type = "button";
      name.title = T("Im Kalender zeigen");
      name.addEventListener("click", () => crlfRankJump(card));
    }
    const meta = el("small", "crlf-rmeta");
    meta.append(m.score ? `★ ${m.score} %` : T("noch keine Note"), ` · ${T("{0} Mitglieder", crlfShortCount(m.members))}`);
    text.append(name, meta);
    const tags = el("span", "crlf-rtags");
    if (fav) tags.appendChild(el("i", "crlf-rtag crlf-rtag-fav", T("★ Favorit")));
    if (card) tags.appendChild(el("i", "crlf-rtag", T("im Kalender")));
    if (tags.childNodes.length) text.appendChild(tags);
    li.appendChild(text);
    return li;
  }

  show(crRankSort === "popular" ? "popular" : "score");
}
