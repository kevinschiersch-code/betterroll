// popup.js – Einstellungen im Popup. Alles wird in chrome.storage.sync gespeichert; die Kalender-Skripte
// reagieren darauf sofort (storage.onChanged). Zusätzlich: Statuszeile, ↻ Neu laden und das eigene
// Hintergrundbild (Design „Bild“).
// Texte laufen über T() (i18n.js); Sprache der Oberfläche = Einstellung „uiLang“, folgt der Sprache unter „Fassung“.

const $ = (id) => document.getElementById(id);
const radio = (name, value) => document.querySelector(`input[name="${name}"][value="${value}"]`);
const langName = (key) => {
  const l = CR_LANGUAGES.find((x) => x.key === key);
  return l ? T(l.label).replace(/\s*\(.*\)$/, "") : T("Sprache");
};

for (const lang of CR_LANGUAGES) {
  const opt = document.createElement("option");
  opt.value = lang.key;
  opt.textContent = lang.label;
  $("language").appendChild(opt);
}

// feste Texte aus popup.html übersetzen: data-i18n (Text), data-i18n-title, data-i18n-aria.
// Der deutsche Ausgangstext wird beim ersten Mal im Attribut gemerkt.
function applyI18n() {
  document.documentElement.lang = crlfLang;
  for (const e of document.querySelectorAll("[data-i18n]")) {
    if (!e.dataset.i18n) e.dataset.i18n = e.textContent;
    e.textContent = T(e.dataset.i18n);
  }
  for (const e of document.querySelectorAll("[data-i18n-title]")) {
    if (!e.dataset.i18nTitle) e.dataset.i18nTitle = e.title;
    e.title = T(e.dataset.i18nTitle);
  }
  for (const e of document.querySelectorAll("[data-i18n-aria]")) {
    if (!e.dataset.i18nAria) e.dataset.i18nAria = e.getAttribute("aria-label");
    e.setAttribute("aria-label", T(e.dataset.i18nAria));
  }
  for (const opt of $("language").options) {
    const l = CR_LANGUAGES.find((x) => x.key === opt.value);
    if (l) opt.textContent = T(l.label);
  }
}

// alle Texte in der aktuellen Sprache neu setzen (beim Öffnen und nach dem Umschalten der Sprache)
function renderTexts() {
  applyI18n();
  syncMode();
  showStatus();
  bannerNote = "";
  syncBanner();
}

// Eine Auswahl "Fassung" statt mehrerer sich überschneidender Schalter.
// Sie setzt die Einstellungen, die content.js auswertet.
const MODES = {
  lang: { enabled: true, merge: true, prefer: "lang" },
  original: { enabled: true, merge: true, prefer: "original" },
  all: { enabled: false, merge: false }
};
// gewählte Fassung aus den Einstellungen: alle | OmU bevorzugt | Sprache bevorzugt
const modeOf = (s) => (!s.enabled ? "all" : s.prefer === "original" ? "original" : "lang");

// Fassungs-Leiste beschriften (gewählte Sprache) und Hinweiszeile darunter setzen
function syncMode() {
  const mode = document.querySelector('input[name="mode"]:checked')?.value || "lang";
  const lang = langName($("language").value);
  $("modeLang").textContent = lang;
  $("langWrap").classList.toggle("off", mode === "all");
  $("modeHint").textContent = {
    lang: T("Pro Anime eine Karte: {0}, sonst OmU.", lang),
    original: T("Pro Anime eine Karte: OmU, sonst {0}.", lang),
    all: T("Alle Fassungen und Sprachen wie auf der Seite.")
  }[mode];
}

// gespeicherte Einstellungen in die Bedienelemente übernehmen
chrome.storage.sync.get(CR_DEFAULT_SETTINGS, (s) => {
  crlfLang = s.uiLang === "en" ? "en" : "de";
  applyI18n();
  $("active").checked = s.active;
  $("language").value = s.language;
  radio("mode", modeOf(s)).checked = true;
  $("hideTop").checked = s.hideTop;
  $("featureFav").checked = s.featureFav;
  $("featureDim").checked = s.featureDim;
  $("favTop").checked = s.favTop;
  $("diag").checked = s.diag;
  $("hotkeys").checked = s.hotkeys;
  if ($("crApi")) $("crApi").checked = s.crApi;
  $("featureComments").checked = s.featureComments;
  $("tidy").checked = s.cleanTitles && s.seasonTag;
  $("autoClose").checked = s.autoClose;
  $("speedCtl").checked = s.speedCtl;
  $("autoSkip").checked = s.autoSkip;
  $("featureRank").checked = s.featureRank;
  radio("dateFormat", s.dateFormat).checked = true;
  radio("design", designOf(s)).checked = true;
  syncBanner();
  syncVideo();
  radio("thumbs", s.thumbs).checked = true;
  $("posterSize").value = s.posterSize;
  syncSize();
  if ($("more").open !== s.moreOpen) $("more").open = s.moreOpen; // löst „toggle“ aus, darum nur bei Unterschied
  applyTheme(s.theme);
  syncActive();
  syncMode();
  showCount();
});

// Popup selbst hell/dunkel (Einstellung "theme", unabhängig vom Kalender-Design)
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme").textContent = theme === "dark" ? "☀" : "☾";
}
$("theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.sync.set({ theme: next });
});

// Karteikarten Kalender / Player; die zuletzt gewählte merkt sich das Popup (nur auf diesem PC)
function showTab(tab) {
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  $("pageCal").hidden = tab !== "cal";
  $("pagePlayer").hidden = tab !== "player";
}
for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => { showTab(b.dataset.tab); chrome.storage.local.set({ popupTab: b.dataset.tab }); });
showTab("cal");
chrome.storage.local.get({ popupTab: "cal" }, (s) => showTab(s.popupTab === "player" ? "player" : "cal"));
// Design-Bereich auf-/zugeklappt merken (wie die Karteikarte nur auf diesem Gerät)
chrome.storage.local.get({ designOpen: true }, (s) => {
  $("designBox").open = s.designOpen !== false;
  $("designBox").addEventListener("toggle", () => chrome.storage.local.set({ designOpen: $("designBox").open }));
});

// Hauptschalter aus: übrige Einstellungen ausgrauen
function syncActive() { $("sections").classList.toggle("off", !$("active").checked); }

// speichern und danach den Zähler auffrischen
const save = (values) => chrome.storage.sync.set(values, () => setTimeout(showCount, 100));
const onSwitch = (id, key) => $(id).addEventListener("change", (e) => save({ [key]: e.target.checked }));

$("active").addEventListener("change", (e) => { syncActive(); save({ active: e.target.checked }); });
// Sprache unter „Fassung“: gilt auch für das Add-on selbst (Deutsch -> deutsche Oberfläche, jede andere -> englische);
// der offene Kalender lädt bei geänderter uiLang neu (content.js)
$("language").addEventListener("change", (e) => {
  const ui = e.target.value === "de" ? "de" : "en";
  save({ language: e.target.value, uiLang: ui });
  if (ui !== crlfLang) { crlfLang = ui; renderTexts(); } else syncMode();
});
for (const r of document.querySelectorAll('input[name="mode"]')) r.addEventListener("change", (e) => { syncMode(); save(MODES[e.target.value]); });
onSwitch("hideTop", "hideTop");
onSwitch("featureFav", "featureFav");
onSwitch("featureDim", "featureDim");
onSwitch("favTop", "favTop");
onSwitch("diag", "diag");
onSwitch("hotkeys", "hotkeys");
if ($("crApi")) onSwitch("crApi", "crApi");
onSwitch("featureComments", "featureComments");
onSwitch("autoClose", "autoClose");
onSwitch("speedCtl", "speedCtl");
onSwitch("autoSkip", "autoSkip");
onSwitch("featureRank", "featureRank");
$("tidy").addEventListener("change", (e) => save({ cleanTitles: e.target.checked, seasonTag: e.target.checked }));
// Ein Design = Hell/Dunkel plus Hintergrund. Der ☀/☾-Knopf auf der Seite schaltet nur Hell/Dunkel um
// und behält das zuletzt gewählte dunkle Design.
const DESIGNS = {
  light: { pageTheme: "light" },
  dark: { pageTheme: "dark", pageBg: "off" },
  aurora: { pageTheme: "dark", pageBg: "aurora" },
  glow: { pageTheme: "dark", pageBg: "glow" },
  grid: { pageTheme: "dark", pageBg: "grid" },
  banner: { pageTheme: "dark", pageBg: "banner" },
  video: { pageTheme: "dark", pageBg: "video" }
};
// Design-Feld zu den gespeicherten Werten (pageTheme + pageBg)
function designOf(s) {
  if (s.pageTheme === "light") return "light";
  return ["aurora", "glow", "grid", "banner", "video"].includes(s.pageBg) ? s.pageBg : "dark";
}
for (const r of document.querySelectorAll('input[name="design"]')) r.addEventListener("change", (e) => { chrome.storage.sync.set(DESIGNS[e.target.value]); syncBanner(); syncVideo(); });
chrome.storage.onChanged.addListener((c, area) => {
  if (c.pageTheme || c.pageBg) chrome.storage.sync.get(CR_DEFAULT_SETTINGS, (s) => { radio("design", designOf(s)).checked = true; syncBanner(); syncVideo(); });
  if (c.pageVideo) syncVideo();
  if (area === "local" && c.crBanner) showBanner(c.crBanner.newValue);
});

// ===== Motiv des Designs „Video“ =====
// Namen wie CRLF_VIDEOS in theme.js; Vorschau sind die Standbilder backgrounds/blur/<name>.jpg; „auto“ = wechselnd
const VIDEOS = { auto: "Wechselnd", haus_1: "Haus 1", haus_2: "Haus 2", baum_1: "Baum 1", baum_2: "Baum 2", altstadt_1: "Altstadt 1", altstadt_2: "Altstadt 2",
  leuchtturm_1: "Leuchtturm", regen_1: "Regenfenster", dach_1: "Dachterrasse", bahnsteig_1: "Bahnsteig", kirsch_1: "Kirschblüten", tempel_1: "Schneetempel" };
function syncVideo() {
  const row = $("videoRow");
  row.hidden = !radio("design", "video").checked;
  if (row.hidden) return;
  if (!row.firstChild) {
    for (const [name, label] of Object.entries(VIDEOS)) {
      const l = document.createElement("label"), r = document.createElement("input");
      r.type = "radio"; r.name = "video"; r.value = name;
      r.addEventListener("change", () => chrome.storage.sync.set({ pageVideo: name }));
      let pic;
      if (name === "auto") {
        l.className = "video-auto";
        pic = document.createElement("span");
        pic.textContent = `⇄ ${T(label)} · ${T("alle 45 s")}`;
        l.title = T("Motiv wechselt alle 45 Sekunden");
      } else {
        pic = document.createElement("img");
        pic.src = `backgrounds/blur/${name}.jpg`; pic.alt = "";
        const [, word, num = ""] = label.match(/^(.*?)( \d)?$/);
        l.title = T(word) + num;
      }
      l.append(r, pic);
      r.setAttribute("aria-label", l.title);
      row.append(l);
    }
  }
  chrome.storage.sync.get({ pageVideo: "auto" }, ({ pageVideo }) => { (radio("video", pageVideo) || radio("video", "auto")).checked = true; });
}

// ===== Eigenes Hintergrundbild (Design „Bild“) =====
// Ideale Größe = Bildschirm in echten Pixeln (Breite × Höhe × Pixeldichte), höchstens 3840 px breit. Größere Bilder
// verkleinert background.js darauf; kleinere wirken auf dem Bildschirm unscharf (Hinweis).
function bannerTarget() {
  const d = window.devicePixelRatio || 1;
  let w = Math.round(screen.width * d), h = Math.round(screen.height * d);
  if (w > 3840) { h = Math.round((h * 3840) / w); w = 3840; }
  return { w, h };
}
// Hinweiszeile nur bei Fehler, Warnung oder Laden (spart Höhe); die Größenangabe steht sonst im Eingabefeld und im Tooltip
var bannerNote = ""; // Meldung nach einer Aktion; leer = keine Zeile
// Hinweiszeile unter dem Hintergrundbild setzen (err = als Fehler einfärben)
function bannerHint(text, err) {
  bannerNote = text || "";
  const el = $("bannerHint");
  el.classList.toggle("err", !!err);
  el.textContent = bannerNote;
  el.hidden = !bannerNote || !radio("design", "banner").checked;
}
// gespeichertes Hintergrundbild im Feld „Bild“ und im Adressfeld zeigen
function showBanner(b) {
  const t = bannerTarget(), ideal = `${t.w} × ${t.h}`;
  const has = !!(b && b.src);
  $("bannerSw").style.backgroundImage = has ? `url("${b.src}")` : "";
  $("bannerClear").hidden = !has;
  $("bannerUrl").placeholder = T("Bild-URL einfügen · ideal {0} px", ideal);
  $("bannerRow").title = has ? T("Bild {0} px · ideal {1}", `${b.ow} × ${b.oh}`, ideal) : T("Ideal für deinen Bildschirm: {0} px (Querformat)", ideal);
  if (has) $("bannerUrl").value = /^https?:/.test(b.from || "") ? b.from : "";
  if (bannerNote && !/^…|…$/.test(bannerNote)) return; // Fehlermeldung stehen lassen
  const small = has && Math.max(t.w / b.ow, t.h / b.oh) > 1.25;
  bannerHint(small ? T("Bild {0} px ist kleiner als ideal ({1}), wirkt evtl. unscharf", `${b.ow} × ${b.oh}`, ideal) : "", small);
}
// Zeile für das Hintergrundbild nur beim Design „Bild“ zeigen
function syncBanner() {
  const on = radio("design", "banner").checked;
  $("bannerRow").hidden = !on;
  $("bannerHint").hidden = !on || !bannerNote;
  chrome.storage.local.get("crBanner", ({ crBanner }) => showBanner(crBanner));
}
// Antwort von background.js nach dem Laden eines Bildes anzeigen
async function bannerResult(r) {
  if (r && r.ok) { bannerHint(""); const { crBanner } = await chrome.storage.local.get("crBanner"); return showBanner(crBanner); }
  bannerHint(T("Bild nicht geladen: {0}", T((r && r.error) || "keine Verbindung")), true);
}
// Adresse: erst nur diese eine Seite freigeben lassen (Browser fragt), dann lädt background.js das Bild einmal
let bannerLast = "";
// eingegebene Bildadresse übernehmen
function setBannerUrl() {
  const raw = $("bannerUrl").value.trim();
  if (!raw || raw === bannerLast) return;
  let u;
  try { u = new URL(raw); } catch (e) { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) return bannerHint(T("Keine gültige Adresse"), true);
  bannerLast = raw;
  const msg = { type: "crlf-banner", url: u.href, ...bannerTarget() };
  chrome.storage.local.set({ crBannerPending: msg }); // falls das Popup bei der Freigabe-Abfrage schließt (Firefox)
  chrome.permissions.request({ origins: [`${u.origin}/*`] }).then((ok) => {
    if (!ok) { bannerLast = ""; return bannerHint(T("Zugriff auf {0} nicht erlaubt", u.host), true); }
    bannerHint(T("Bild wird geladen …"));
    chrome.runtime.sendMessage(msg).then(bannerResult, () => bannerResult(null));
  }, (e) => { bannerLast = ""; bannerHint(e.message, true); });
}
$("bannerUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") setBannerUrl(); });
$("bannerUrl").addEventListener("change", setBannerUrl);
// Datei vom PC: bleibt auf dem PC (wird nur verkleinert in storage.local abgelegt). Firefox schließt das Popup beim
// Dateidialog, darum dort dieselbe Seite in einem Tab öffnen.
const FIREFOX = /Firefox\//.test(navigator.userAgent);
$("bannerFile").addEventListener("click", () => {
  if (FIREFOX && location.hash !== "#banner") {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html#banner") });
    return window.close();
  }
  $("bannerPick").click();
});
$("bannerPick").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  bannerHint(T("Bild wird geladen …"));
  const reader = new FileReader();
  reader.onload = () => chrome.runtime.sendMessage({ type: "crlf-banner", dataUrl: reader.result, name: file.name, ...bannerTarget() }).then(bannerResult, () => bannerResult(null));
  reader.onerror = () => bannerResult({ error: "Kein Bild" });
  reader.readAsDataURL(file);
  e.target.value = "";
});
$("bannerClear").addEventListener("click", () => { bannerHint(""); bannerLast = ""; $("bannerUrl").value = ""; chrome.storage.local.remove("crBanner"); });
for (const r of document.querySelectorAll('input[name="thumbs"]')) r.addEventListener("change", (e) => { chrome.storage.sync.set({ thumbs: e.target.value }); syncSize(); });
// Regler „Größe“ der Vorschaubilder: beim Ziehen sofort im Kalender zeigen, beim Loslassen speichern
function syncSize() {
  $("posterSizeOut").textContent = `${$("posterSize").value} %`;
  $("sizeRow").classList.toggle("off", radio("thumbs", "none").checked);
}
$("posterSize").addEventListener("input", (e) => {
  syncSize();
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) chrome.tabs.sendMessage(tab.id, { type: "crlf-postersize", value: +e.target.value }, () => void chrome.runtime.lastError);
  });
});
$("posterSize").addEventListener("change", (e) => chrome.storage.sync.set({ posterSize: +e.target.value }));
for (const r of document.querySelectorAll('input[name="dateFormat"]')) r.addEventListener("change", (e) => chrome.storage.sync.set({ dateFormat: e.target.value }));
// "Erweitert" bleibt so offen oder zu, wie man es zuletzt gelassen hat
$("more").addEventListener("toggle", () => chrome.storage.sync.get({ moreOpen: false }, (s) => {
  if (s.moreOpen !== $("more").open) chrome.storage.sync.set({ moreOpen: $("more").open });
}));

let staleVersion = false;
// laufende Version neben dem Namen
$("ver").textContent = "v" + chrome.runtime.getManifest().version;
let remoteVersion = false, updating = false; // neue Version im Netz / wird gerade geladen
let statusMsg = null; // zuletzt gezeigte Statuszeile als [deutscher Text, Platzhalter …], für den Sprachwechsel
const setStatus = (...msg) => { statusMsg = msg; showStatus(); };
// Statuszeile unter dem Namen (neue Version bereit oder letzte Meldung)
function showStatus() {
  if (staleVersion) $("status").textContent = T("v{0} bereit: oben auf ↻ klicken", staleVersion);
  else if (remoteVersion && !updating) $("status").textContent = T("v{0} verfügbar: oben auf ↻ klicken", remoteVersion);
  else if (statusMsg) $("status").textContent = T(...statusMsg);
}

// Statuszeile unter dem Namen: wie viele Einträge der Filter ausblendet
function showCount() {
  if (!$("active").checked) {
    setStatus("Aus: Kalender wie im Original");
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !/crunchyroll\.com\/.*simulcastcalendar/.test(tab.url || "")) {
      setStatus("Öffne den Simulcast-Kalender");
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "crlf-count" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setStatus("Kalender neu laden, damit der Filter greift");
        return;
      }
      setStatus("{0} Einträge ausgeblendet", res.hidden);
    });
  });
}

// Hinweis, wenn im Ordner schon eine neuere Version liegt, Chrome aber noch die alte ausführt.
// (Das Popup wird bei jedem Öffnen frisch vom Ordner gelesen, die Kalender-Skripte erst nach ↻ in chrome://extensions.)
fetch("manifest.json", { cache: "no-store" })
  .then((r) => r.json())
  .then(({ version }) => {
    const running = chrome.runtime.getManifest().version;
    if (version && version !== running) {
      staleVersion = version;
      showStatus();
      $("reload").classList.add("ready");
      $("status").classList.add("warn");
    }
  })
  .catch(() => {});

// Neue Version im Netz? Fragt den lokalen Update-Helfer (über background.js; er liest nur latest.json).
// Dann zeigt ↻ „bereit“, und ein Klick lädt das Update und startet das Add-on neu.
chrome.runtime.sendMessage({ type: "crlf-update-check" }, (res) => {
  if (chrome.runtime.lastError || !res || !res.ok || !res.newer || staleVersion) return;
  remoteVersion = res.latest;
  showStatus();
  $("status").classList.add("warn");
  $("reload").classList.add("ready");
  $("reload").title = T("Update auf v{0} laden", res.latest);
});

// ↻: verfügbares Update holen, sonst Add-on neu laden (neue Version aus dem Ordner) und den offenen Kalender auffrischen
$("reload").addEventListener("click", () => {
  if (remoteVersion) {
    $("reload").disabled = updating = true;
    setStatus("v{0} wird geladen …", remoteVersion);
    chrome.runtime.sendMessage({ type: "crlf-update-run" }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.ok && res.updated) return setStatus("Aktualisiert auf v{0}, startet neu …", res.version || remoteVersion);
      $("reload").disabled = false;
      setStatus("Update fehlgeschlagen: {0}", (res && res.msg) || "?");
    });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const isCal = tab && /crunchyroll\.com\/.*simulcastcalendar/.test(tab.url || "");
    if (!isCal) return chrome.runtime.reload();
    chrome.tabs.sendMessage(tab.id, { type: "crlf-reload-soon" }, (ok) => {
      // ältere Versionen kennen die Nachricht nicht: dann den Tab direkt neu laden
      if (chrome.runtime.lastError || !ok) chrome.tabs.reload(tab.id);
      chrome.runtime.reload();
    });
  });
});

// Fehlerliste (Erweitert): letzte Fehler aus storage.local „crErrors“ (schreibt background.js), kopieren oder leeren
const errLine = (e) => `${new Date(e.t).toLocaleString(crlfLang === "en" ? "en-GB" : "de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${e.where}: ${e.msg}${e.n > 1 ? ` (${e.n}×)` : ""}`;
let errItems = [];
function showErrors(list) {
  errItems = list || [];
  const ol = $("errList");
  ol.replaceChildren(...errItems.map((e) => {
    const li = document.createElement("li"), line = errLine(e), i = line.indexOf(" · ");
    const b = document.createElement("b");
    b.textContent = line.slice(0, i);
    li.append(b, line.slice(i));
    return li;
  }));
  $("errNone").hidden = errItems.length > 0;
  $("errCopy").hidden = $("errClear").hidden = !errItems.length;
}
chrome.storage.local.get({ crErrors: [] }, ({ crErrors }) => showErrors(crErrors));
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.crErrors) showErrors(c.crErrors.newValue); });
$("errCopy").addEventListener("click", () => {
  const ver = chrome.runtime.getManifest().version;
  navigator.clipboard.writeText(`BetterRoll ${ver}\n` + errItems.map(errLine).join("\n")).then(() => {
    $("errCopy").textContent = T("Kopiert");
    setTimeout(() => { $("errCopy").textContent = T("Kopieren"); }, 1500);
  }).catch(() => {});
});
$("errClear").addEventListener("click", () => chrome.storage.local.remove("crErrors"));

// Sicherung (Erweitert): Einstellungen, ★/▼, eigene Zuordnungen (💬/Poster), Hintergrundbild und Tempo als Datei
// auf diesem PC. Laden prüft jeden Wert (nur bekannte Schlüssel, passender Typ) und ersetzt dann den Stand.
const BK_SYNC = { ...CR_DEFAULT_SETTINGS, pageVideo: "auto" };
const BK_LOCAL = ["marks", "alMap", "malMap", "crBanner", "playerSpeed", "crRankSort"];
const bkHint = (t) => { $("bkHint").textContent = t; };
// Rückmeldung: Banner oben (2,5 s) und Knopf kurz grün mit Haken
let toastTimer = 0;
function toast(text, bad) {
  const el = $("toast");
  el.textContent = text;
  el.classList.toggle("bad", !!bad);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("show"); setTimeout(() => { el.hidden = true; }, 250); }, 2500);
}
function flash(btn, text) {
  btn.classList.add("done");
  btn.textContent = "✓ " + text;
  setTimeout(() => { btn.classList.remove("done"); btn.textContent = T(btn.dataset.i18n); }, 2500);
}
// nach dem Laden lädt das Popup neu: die Meldung über sessionStorage mitnehmen
try {
  const t = sessionStorage.getItem("crlfToast");
  if (t) { sessionStorage.removeItem("crlfToast"); setTimeout(() => { toast(t); bkHint(t); flash($("bkLoad"), T("Geladen")); }, 150); } // nach dem Übersetzen der Texte
} catch (e) {}
$("bkSave").addEventListener("click", async () => {
  const sync = await chrome.storage.sync.get(Object.keys(BK_SYNC));
  const local = await chrome.storage.local.get(BK_LOCAL);
  const data = { app: "BetterRoll", version: chrome.runtime.getManifest().version, saved: new Date().toISOString(), sync, local };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `betterroll-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  const msg = T("Gesichert: {0} ★/▼", Object.keys(local.marks || {}).length);
  bkHint(msg); toast(msg); flash($("bkSave"), T("Gesichert"));
});
// Firefox schließt das Popup beim Dateidialog (die Auswahl ginge verloren): dort die Einstellungen in einem Tab öffnen
const bkFirefox = /Firefox\//.test(navigator.userAgent);
const bkInTab = location.hash === "#backup";
if (bkInTab) { $("more").open = true; setTimeout(() => $("bkLoad").scrollIntoView({ block: "center" }), 100); }
$("bkLoad").addEventListener("click", () => {
  if (bkFirefox && !bkInTab) { chrome.tabs.create({ url: chrome.runtime.getURL("popup.html#backup") }); window.close(); return; }
  $("bkFile").click();
});
$("bkFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (x) { data = null; }
  if (!data || data.app !== "BetterRoll" || typeof data.sync !== "object" || typeof data.local !== "object") { bkHint(T("Keine BetterRoll-Sicherung")); toast(T("Keine BetterRoll-Sicherung"), true); return; }
  const sync = {};
  for (const [k, v] of Object.entries(data.sync || {})) if (k in BK_SYNC && typeof v === typeof BK_SYNC[k]) sync[k] = v;
  const local = {}, src = data.local || {};
  const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (isMap(src.marks)) local.marks = Object.fromEntries(Object.entries(src.marks).filter(([k, v]) => typeof k === "string" && (v === "fav" || v === "dim")));
  for (const k of ["alMap", "malMap"]) if (isMap(src[k])) local[k] = src[k];
  if (isMap(src.crBanner) && typeof src.crBanner.src === "string" && src.crBanner.src.startsWith("data:image/")) local.crBanner = src.crBanner;
  if (typeof src.playerSpeed === "number") local.playerSpeed = src.playerSpeed;
  if (typeof src.crRankSort === "string") local.crRankSort = src.crRankSort;
  await chrome.storage.sync.set(sync);
  await chrome.storage.local.set(local);
  const msg = T("Geladen: {0} Einstellungen, {1} ★/▼", Object.keys(sync).length, Object.keys(local.marks || {}).length);
  bkHint(msg); toast(msg); flash($("bkLoad"), T("Geladen"));
  try { sessionStorage.setItem("crlfToast", msg); } catch (e) {}
  setTimeout(() => location.reload(), 1200); // alle Schalter mit dem geladenen Stand neu anzeigen
});
