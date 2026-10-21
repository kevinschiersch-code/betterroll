// match.js – ordnet einen Crunchyroll-Titel dem richtigen Anime bei AniList zu (für Poster und 💬-Panel).
// Statt blind den ersten Suchtreffer zu nehmen: Titel grob ins Englische übersetzen, mehrere Kandidaten holen und
// jeden bewerten (Wortähnlichkeit zu Romaji-, englischem Titel und Alternativtiteln, passende Staffel, läuft gerade,
// Serie statt Film). Unter der Mindestpunktzahl gilt ein Kandidat als unsicher: dann kein Poster statt eines falschen.
// Benutzt crStripLanguage/crSplitSeason aus languages.js.

// grobe Übersetzung häufiger Wörter deutscher Anime-Titel (Kleinschreibung, ohne Umlaute; "" = Füllwort weglassen)
const CRLF_DE_EN = {
  der: "", die: "", das: "", den: "", dem: "", des: "", ein: "", eine: "", einen: "", einem: "", einer: "", und: "and",
  von: "of", vom: "of", im: "in", in: "in", mit: "with", als: "as", zum: "to", zur: "to", ich: "i", mein: "my", meine: "my",
  wiedergeburt: "reincarnated", wiedergeboren: "reincarnated", schleim: "slime", welt: "world", anderen: "another", andere: "another",
  held: "hero", helden: "hero", daemonenkoenig: "demon lord", koenig: "king", koenigin: "queen", prinzessin: "princess",
  prinz: "prince", ritter: "knight", magier: "mage", hexe: "witch", drache: "dragon", drachen: "dragon", schwert: "sword",
  tagebuecher: "diaries", tagebuch: "diary", apothekerin: "apothecary", krieger: "warrior", dorf: "village", leben: "life",
  liebe: "love", freundin: "girlfriend", freund: "friend", schule: "school", akademie: "academy", abenteuer: "adventure",
  abenteurer: "adventurer", gilde: "guild", geschichte: "story", schatten: "shadow", mond: "moon", stern: "star",
  sterne: "stars", himmel: "sky", engel: "angel", teufel: "devil", gott: "god", goettin: "goddess", tod: "death",
  kampf: "battle", krieg: "war", reich: "kingdom", fluch: "curse", zauber: "magic", magie: "magic", boesewichtin: "villainess",
  tochter: "daughter", sohn: "son", bruder: "brother", schwester: "sister", maedchen: "girl", junge: "boy", katze: "cat",
  hund: "dog", essen: "food", koch: "cook", kochen: "cooking", neue: "new", neu: "new", letzte: "last", erste: "first",
  staffel: "season", teil: "part", insel: "island", meer: "sea", feuer: "fire", eis: "ice", blut: "blood", herz: "heart",
  seele: "soul", traum: "dream", reise: "journey", zeit: "time", ende: "end", jaeger: "hunter", detektiv: "detective",
  diener: "servant", meister: "master", schueler: "student", lehrer: "teacher", heilerin: "healer", heiler: "healer",
  heilige: "saint", verstossen: "exiled", verstossene: "exiled", staerkste: "strongest", schwaechste: "weakest",
  geheime: "secret", geheim: "secret", verflucht: "cursed", vergessene: "forgotten", nacht: "night", tag: "day",
  sommer: "summer", winter: "winter", fruehling: "spring", herbst: "autumn", schwarz: "black", weiss: "white", rot: "red",
  blau: "blue", gold: "gold", kleine: "little", kleiner: "little", grosse: "great", grosser: "great", ueber: "about"
};
const CRLF_STOP = new Set(["the", "a", "an", "of", "my", "as", "i", "is", "to", "in", "and", "no", "wa", "ga", "wo", "ni", "de", "season", "part", "cour", "tv", "anime"]);

// Text vereinfachen: klein, Umlaute ausgeschrieben, ohne Akzente und Satzzeichen
function crlfFold(s) {
  return (s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
// Titel grob übersetzen (nur Wörter aus der Liste, der Rest bleibt)
function crlfTranslateTitle(title) {
  return crlfFold(title).split(" ").map((w) => (w in CRLF_DE_EN ? CRLF_DE_EN[w] : w)).filter(Boolean).join(" ");
}
// bedeutungstragende Wörter eines Titels (ohne Füllwörter und Ordnungszahlen wie „2nd“)
function crlfTokens(s) {
  return crlfFold(s).split(" ").filter((w) => w && !CRLF_STOP.has(w) && !/^\d+(st|nd|rd|th)$/.test(w));
}
// Wortähnlichkeit: Dice-Wert plus Anteil der eigenen Wörter, die im Kandidaten vorkommen (Abdeckung).
// Zwei Wörter gelten als gleich, wenn sie gleich sind oder die ersten 5 Buchstaben übereinstimmen.
function crlfDice(a, b) {
  if (!a.length || !b.length) return { dice: 0, cover: 0 };
  const same = (x, y) => x === y || (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5));
  const used = new Set();
  let hit = 0;
  for (const x of a) {
    const j = b.findIndex((y, k) => !used.has(k) && same(x, y));
    if (j >= 0) { used.add(j); hit++; }
  }
  return { dice: (2 * hit) / (a.length + b.length), cover: hit / a.length };
}
// Staffelangaben aus einem AniList-Titel entfernen, damit „Kaiju No. 8 Season 2“ wie „Kaiju No. 8“ verglichen wird
function crlfStripSeasonName(name) {
  return ` ${name || ""} `.replace(/\s(season|part|cour)\s*\d+/gi, " ").replace(/\s\d+(st|nd|rd|th)\s+(season|part|cour)/gi, " ")
    .replace(/\s(ii|iii|iv|v)(?=[\s:])/g, " ").replace(/(\s(?!no\.?\s)\S+)\s\d\s*$/i, "$1").trim();
}
// Staffelnummer aus einem AniList-Titel („Season 2“, „2nd Season“, „II“, „Titel 3“ – aber nicht „No. 8“)
function crlfSeasonOf(name) {
  const t = ` ${(name || "").toLowerCase()} `;
  let m = t.match(/season\s*(\d+)/) || t.match(/(\d+)(?:st|nd|rd|th)\s+season/) || t.match(/\s(?!no\.?\s)\S+\s(\d)\s*(?::|$|\s-)/);
  if (m) return +m[1];
  m = t.match(/\s(ii|iii|iv|v)[\s:]/);
  return m ? { ii: 2, iii: 3, iv: 4, v: 5 }[m[1]] : null;
}
// Punktzahl eines AniList-Kandidaten { romaji, english, synonyms[], status, seasonYear, format } für einen Crunchyroll-Titel.
// Ein Name zählt nur, wenn er mind. 60 % der eigenen Wörter abdeckt oder mind. 2 Wörter und 40 % („Café Kitsune“ ≠ „Neko Cafe“).
// Untertitel nach „:“ oder „ -“ werden zusätzlich weggelassen verglichen („Solo Leveling Season 2 -Arise from the Shadow-“).
// alt: zusätzlicher (englischer) Titel, z. B. aus der Serien-Adresse der Karte (crlfSlugTitle).
function crlfMatchScore(crTitle, m, alt) {
  const { title: base, season } = crSplitSeason(crStripLanguage(crTitle));
  const own = [crlfTokens(base), crlfTokens(crlfTranslateTitle(base))];
  if (alt) own.push(crlfTokens(alt));
  const names = [m.romaji, m.english, ...(m.synonyms || [])].filter(Boolean);
  let best = 0, bestName = "";
  for (const n of names) {
    for (const v of new Set([n, n.split(/:| -|～|~/)[0]])) {
      const t = crlfTokens(crlfStripSeasonName(v));
      for (const o of own) {
        const { dice, cover } = crlfDice(o, t);
        const ok = cover >= 0.6 || (cover >= 0.4 && cover * o.length >= 2);
        if (ok && dice > best) { best = dice; bestName = n; }
      }
    }
  }
  if (!best) return { score: 0, name: "" };
  let score = best;
  const year = new Date().getFullYear();
  const airing = m.status === "RELEASING" || m.status === "NOT_YET_RELEASED";
  if (airing || (m.seasonYear && m.seasonYear >= year - 1)) score += 0.12; // Simulcast: läuft gerade
  if (/^(TV|TV_SHORT|ONA)$/.test(m.format || "")) score += 0.05;
  else if (/^(MOVIE|MUSIC|SPECIAL)$/.test(m.format || "")) score -= 0.2;
  const theirs = Math.max(0, ...names.map((n) => crlfSeasonOf(n) || 0));
  if (season && season > 1) score += theirs === season ? 0.15 : theirs ? -0.25 : -0.05;
  else if (season === 1 && theirs > 1) score -= 0.25;
  else if (theirs > 1 && !airing) score -= 0.15; // ohne Staffelangabe: Fortsetzung nur, wenn sie gerade läuft
  return { score, name: bestName };
}
const CRLF_MATCH_MIN = 0.55; // darunter: lieber kein Treffer als ein falscher
// besten Kandidaten wählen; null, wenn keiner sicher genug ist
function crlfBestMatch(crTitle, list, alt) {
  let best = null, top = -1;
  for (const m of list || []) {
    const { score } = crlfMatchScore(crTitle, m, alt);
    if (score > top) { top = score; best = m; }
  }
  return top >= CRLF_MATCH_MIN ? best : null;
}
// Englischer Titel aus der Serien-Adresse einer Kalenderkarte (/series/<ID>/that-time-i-got-reincarnated-as-a-slime).
// Crunchyroll bildet die Adresse aus dem englischen Titel, auch auf deutschen Seiten; deutsche Titel findet AniList oft nicht.
function crlfSlugTitle(release) {
  const a = release && release.querySelector('a[href*="/series/"]');
  const m = a && a.getAttribute("href").match(/\/series\/[^/?#]+\/([a-z0-9-]+)/i);
  return m && /[a-z]/i.test(m[1]) ? m[1].replace(/-+/g, " ").trim() : "";
}
