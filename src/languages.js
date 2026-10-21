// languages.js – gemeinsame Grundlagen für Kalender und Popup: Sprachliste, Standard-Einstellungen und
// Titel-Helfer (Sprachzusatz entfernen, Staffel erkennen).

// Bekannte Sprachzusätze im Titel, z. B. "Titel (Deutsch)" oder "Titel (German Dub)".
// key = interne ID, label = Anzeige im Popup (Zusätze in Klammern über T() übersetzbar, siehe i18n.js), aliases = Schreibweisen auf der Seite (kleingeschrieben).
const CR_LANGUAGES = [
  { key: "de", label: "Deutsch", aliases: ["deutsch", "german", "german dub"] },
  { key: "en", label: "English", aliases: ["english", "english dub", "englisch"] },
  { key: "es-419", label: "Español (América Latina)", aliases: ["español (américa latina)", "espanol (america latina)", "spanish (latin america)", "spanish dub", "latin american spanish", "spanisch (lateinamerika)"] },
  { key: "es-ES", label: "Español (España)", aliases: ["español (españa)", "espanol (espana)", "castilian", "castilian dub", "spanish (spain)", "spanisch (spanien)", "español (european)"] },
  { key: "pt-BR", label: "Português (Brasil)", aliases: ["português (brasil)", "portugues (brasil)", "portuguese (brazil)", "portuguese dub", "portugiesisch (brasilien)"] },
  { key: "pt-PT", label: "Português (Portugal)", aliases: ["português (portugal)", "portuguese (portugal)"] },
  { key: "fr", label: "Français", aliases: ["français", "francais", "french", "french dub", "französisch"] },
  { key: "it", label: "Italiano", aliases: ["italiano", "italian", "italian dub", "italienisch"] },
  { key: "ru", label: "Русский", aliases: ["русский", "russian", "russian dub", "russisch"] },
  { key: "ar", label: "العربية", aliases: ["العربية", "arabic", "arabic dub", "arabisch"] },
  { key: "hi", label: "हिंदी (Hindi)", aliases: ["हिंदी", "hindi", "hindi dub"] },
  { key: "ta", label: "தமிழ் (Tamil)", aliases: ["தமிழ்", "tamil", "tamil dub"] },
  { key: "te", label: "తెలుగు (Telugu)", aliases: ["తెలుగు", "telugu", "telugu dub"] },
  { key: "zh", label: "中文 (Chinesisch)", aliases: ["中文", "中文 (普通话)", "中文 (粵語)", "chinese", "mandarin", "cantonese", "chinese dub"] },
  { key: "ko", label: "한국어 (Koreanisch)", aliases: ["한국어", "korean", "korean dub"] },
  { key: "th", label: "ไทย (Thai)", aliases: ["ไทย", "thai", "thai dub"] },
  { key: "id", label: "Bahasa Indonesia", aliases: ["bahasa indonesia", "indonesian", "indonesian dub"] },
  { key: "ms", label: "Bahasa Melayu", aliases: ["bahasa melayu", "malay", "malay dub"] },
  { key: "vi", label: "Tiếng Việt", aliases: ["tiếng việt", "vietnamese", "vietnamese dub"] },
  { key: "pl", label: "Polski", aliases: ["polski", "polish", "polish dub"] },
  { key: "tr", label: "Türkçe", aliases: ["türkçe", "turkish", "turkish dub"] },
  { key: "ca", label: "Català", aliases: ["català", "catalan", "catalan dub"] },
  { key: "ja", label: "日本語 (Japanisch)", aliases: ["日本語", "japanese", "japanisch"] }
];

// Standardwerte aller Einstellungen (chrome.storage.sync); Bedeutung siehe popup.js / content.js
const CR_DEFAULT_SETTINGS = { active: true, enabled: true, language: "de", theme: "dark", pageTheme: "dark", featureFav: true, featureDim: true, featureComments: true, dateFormat: "de", hideTop: true, merge: true, prefer: "lang", cleanTitles: true, seasonTag: true, pageBg: "aurora", moreOpen: false, thumbs: "fav", posterSize: 100, uiLang: "de", autoClose: true, speedCtl: true, autoSkip: true, onlyFav: false, featureRank: true, favTop: true, diag: false, hotkeys: true, crApi: true };

// Titel ohne Sprachzusatz, kleingeschrieben: Schlüssel für Markierungen pro Anime
function crBaseTitle(title) {
  return crStripLanguage(title).toLowerCase();
}

// Titel ohne Sprachzusatz in Originalschreibweise, z. B. "Overgeared Staffel 1 (Deutsch)" -> "Overgeared Staffel 1"
function crStripLanguage(title) {
  let t = title.replace(/\s+/g, " ").trim();
  if (crDetectLanguage(t) !== null) {
    let depth = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] === ")") depth++;
      else if (t[i] === "(" && --depth === 0) { t = t.slice(0, i).trim(); break; }
    }
  }
  return t;
}

// Staffel am Titelende erkennen: "… Staffel 3", "… Season 2", "… 2nd Season" -> { title, season }
// optional mit Teil dahinter: "Season 1 Part 3", "Staffel 2 Teil 2", "Second Season", "2nd Season Cour 2"
const CR_ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const CR_PART = "(?:[\\s:,–-]+(?:Part|Teil|Cour|Parte)\\s+(\\d{1,2}))?";
const CR_SEASON_RES = [
  new RegExp("^(.*?)[\\s:,–-]*\\b(?:Staffel|Season|Saison|Temporada|Stagione|Сезон)\\s+(\\d{1,2})" + CR_PART + "[\\s-]*$", "i"),
  new RegExp("^(.*?)[\\s:,–-]*\\b(\\d{1,2})(?:st|nd|rd|th)\\s+Season" + CR_PART + "[\\s-]*$", "i"),
  new RegExp("^(.*?)[\\s:,–-]*\\b(" + Object.keys(CR_ORDINALS).join("|") + ")\\s+Season" + CR_PART + "[\\s-]*$", "i")
];
// Titel in { title, season, part } zerlegen (season/part null, wenn keine Staffel am Ende steht)
function crSplitSeason(title) {
  for (const re of CR_SEASON_RES) {
    const m = title.match(re);
    if (m && m[1].trim()) {
      const season = CR_ORDINALS[m[2].toLowerCase()] || +m[2];
      return { title: m[1].trim(), season, part: m[3] ? +m[3] : null };
    }
  }
  return { title, season: null, part: null };
}

// Liefert die Sprach-ID aus dem Titel, oder null wenn kein bekannter Zusatz am Ende steht.
function crDetectLanguage(title) {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t.endsWith(")")) return null;
  // letzte, korrekt geklammerte Gruppe am Ende finden (unterstützt "(Español (América Latina))")
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ")") depth++;
    else if (t[i] === "(" && --depth === 0) {
      const inner = t.slice(i + 1, -1).trim().toLowerCase();
      const lang = CR_LANGUAGES.find((l) => l.aliases.includes(inner));
      return lang ? lang.key : null;
    }
  }
  return null;
}
