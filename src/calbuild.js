// Eigener Release-Kalender: Crunchyroll hat /simulcastcalendar abgeschaltet und seit 31.10.2026 eine neue Seite
// /releasecalendar (React, ohne BetterRoll-Funktionen, nur schon erschienene Folgen). Eine Regel (rules.json) leitet beide
// Adressen vorher auf die kleine Datei /robots.txt?simulcastcalendar&p=… um. Dieses Skript läuft dort als erstes, stellt
// die alte Adresse in der Leiste wieder her und baut die Wochenansicht im Aufbau der alten Seite nach
// (section.day > ol.releases > li > article.release), damit alle übrigen Teile von BetterRoll unverändert darauf arbeiten.
// Daten seit 1.87.20 wie die neue Seite von Crunchyroll: eine Abfrage je Woche (alle erschienenen Folgen), mit dem
// anonymen Schlüssel aus crcatalog.js (keine Cookies, kein Konto). Kommende Folgen werden aus der letzten Folge + 7 Tage
// geschätzt (dafür die drei Wochen davor, ebenfalls je eine Abfrage, gemerkt).
(() => {
  if (location.pathname !== "/robots.txt" || !/(?:^\?|&)simulcastcalendar(?=&|$)/.test(location.search)) return;

  // alte Adresse wiederherstellen (Sprache aus p=, sonst aus dem Browser)
  const q = new URLSearchParams(location.search);
  let loc = (q.get("p") || "").replace(/\/$/, "");
  if (!/^[a-z]{2}(?:-[a-z]{2,3})?$/i.test(loc)) loc = /^de\b/i.test(navigator.language) ? "de" : "";
  q.delete("simulcastcalendar"); q.delete("p");
  const rest = q.toString();
  history.replaceState(null, "", `/${loc ? loc + "/" : ""}simulcastcalendar${rest ? "?" + rest : ""}`);

  const CAL_WEEK_TTL = 7 * 864e5, CAL_LIVE_TTL = 30 * 60e3, CAL_WEEKS_KEPT = 10;
  const DUB = { "de-DE": "German", "en-US": "English", "es-419": "Spanish", "es-ES": "Castilian", "pt-BR": "Portuguese", "pt-PT": "Portuguese (Portugal)",
    "fr-FR": "French", "it-IT": "Italian", "ru-RU": "Russian", "ar-SA": "Arabic", "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu",
    "zh-CN": "Chinese", "zh-HK": "Chinese", "zh-TW": "Chinese", "ko-KR": "Korean", "th-TH": "Thai", "id-ID": "Indonesian", "ms-MY": "Malay",
    "vi-VN": "Vietnamese", "pl-PL": "Polish", "tr-TR": "Turkish", "ca-ES": "Catalan" };
  const de = !loc || /^de/i.test(loc);
  const L = de
    ? { title: "Release-Kalender", prev: "‹ Vorherige Woche", next: "Nächste Woche ›", load: "Kalender wird geladen …", err: "Kalender konnte nicht geladen werden", retry: "Erneut versuchen", ep: "Folge", avail: "Verfügbar", soon: "voraussichtlich", reload: "↻ Neu laden", stamp: "Stand" }
    : { title: "Release Calendar", prev: "‹ Previous week", next: "Next week ›", load: "Loading calendar …", err: "Could not load the calendar", retry: "Try again", ep: "Episode", avail: "Available", soon: "expected", reload: "↻ Reload", stamp: "As of" };
  const path = (p) => `/${loc ? loc + "/" : ""}${p}`;

  // Woche: Montag bis Sonntag um das Datum aus ?date= (sonst heute), Ortszeit
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dm = (q.get("date") || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const base = dm ? new Date(+dm[1], dm[2] - 1, +dm[3]) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const shift = (days) => { const d = new Date(start); d.setDate(d.getDate() + days); const u = new URLSearchParams(rest); u.set("date", ymd(d)); return `${path("simulcastcalendar")}?${u}`; };

  // Grundgerüst der Seite (ersetzt den Inhalt von robots.txt)
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    e.append(...kids.filter((k) => k != null));
    return e;
  };
  document.documentElement.replaceChildren(
    el("head", {}, el("meta", { charset: "utf-8" }), el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), el("title", {}, `Crunchyroll – ${L.title}`)),
    el("body", { class: "crlf-calbuild" })
  );
  document.documentElement.lang = de ? "de" : "en";
  const css = el("style", {}, `
    body.crlf-calbuild { margin: 0; background: #000; color: #dadada; font: 14px/1.4 "Lato", "Helvetica Neue", Arial, sans-serif; }
    .crlf-calbar { display: flex; align-items: center; gap: 16px; padding: 14px 24px; flex-wrap: wrap; max-width: 1378px; margin: 0 auto; }
    .crlf-calbar a { color: #f47521; text-decoration: none; }
    .crlf-calbar h1 { margin: 0 auto 0 0; font-size: 20px; color: #fff; }
    .crlf-calmsg { padding: 40px 24px; text-align: center; color: #aaa; }
    .crlf-calmsg button { margin-top: 12px; padding: 6px 14px; cursor: pointer; }
    /* feste Breite wie der alte Kalender: Browser-Zoom vergrößert die ganze Seite, nicht nur den Inhalt der Kacheln */
    .crlf-calweek { display: flex; align-items: flex-start; gap: 8px; padding: 0 24px 40px; width: max-content; margin: 0 auto; }
    .crlf-calweek section.day { flex: 0 0 190px; width: 190px; min-width: 0; position: relative; }
    /* heute: etwas breiter, leicht hinterlegt, Akzentrahmen */
    html body .crlf-calweek section.day[data-crlf-today] { flex-basis: 240px !important; width: 240px !important; border-radius: 14px;
      background: rgba(var(--crlf-acc-rgb, 244, 117, 33), 0.07) !important; box-shadow: inset 0 0 0 1px rgba(var(--crlf-acc-rgb, 244, 117, 33), 0.35); padding: 0 6px 6px !important; }
    html body .crlf-calweek section.day[data-crlf-today] > h1 { color: var(--crlf-accent, #f47521) !important; }
    /* Jetzt-Linie: alles darunter ist noch nicht erschienen; sie rutscht beim Erscheinen sanft nach unten */
    .crlf-nowline { position: absolute; left: 2px; right: 2px; height: 0; border-top: 2px solid var(--crlf-accent, #f47521); z-index: 3;
      pointer-events: none; transition: top .6s ease; box-shadow: 0 0 8px rgba(var(--crlf-acc-rgb, 244, 117, 33), 0.8); }
    .crlf-nowline::before { content: ""; position: absolute; left: -4px; top: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--crlf-accent, #f47521); }
    .crlf-calweek section.day > h1 { font-size: 14px; margin: 0 0 8px; color: #fff; }
    .crlf-calweek ol.releases { list-style: none; margin: 0; padding: 0; }
    .crlf-calweek article.release { position: relative; margin: 0 0 10px; background: #141519; padding: 6px; }
    .crlf-calweek article.release img { display: block; width: 100%; height: auto; }
    .crlf-calweek .season-name a { color: #fff; text-decoration: none; }
    /* Wertquelle für content.js: unsichtbar, dann zeichnet content.js den orangen Balken direkt unter dem Bild */
    .crlf-calweek progress.crlf-progsrc { display: none !important; }
    /* Balken im unteren Rand des Titelbilds (wie bei Crunchyroll), nicht darunter */
    .crlf-calweek .crlf-pbar { position: relative; z-index: 2; height: 5px; margin: -12px auto 7px !important;
      transform: scaleX(0.92); background: rgba(0, 0, 0, 0.55) !important; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25); }
    .crlf-calweek a.crlf-eplink { color: inherit !important; text-decoration: none !important; }
    .crlf-calweek a.crlf-eplink:hover { text-decoration: underline !important; }
    /* geschätzte Folgen: nur Schrift gedämpft, das Titelbild bleibt voll sichtbar */
    .crlf-calweek .crlf-soon time, .crlf-calweek .crlf-soon .season-name, .crlf-calweek .crlf-soon .episode { opacity: .7; }
    .crlf-calstamp { color: #888; font-size: 12px; }`);
  document.head.append(css);
  const bar = el("header", { class: "crlf-calbar" },
    el("h1", {}, el("a", { href: path("") }, "Crunchyroll"), " · ", L.title),
    el("span", { class: "crlf-calstamp" }), el("a", { href: "#", class: "crlf-calreload" }, L.reload),
    el("a", { href: shift(-7) }, L.prev), el("a", { href: shift(7) }, L.next));
  bar.querySelector(".crlf-calreload").addEventListener("click", (ev) => { ev.preventDefault(); run(true); });
  const msg = el("div", { class: "crlf-calmsg" }, L.load);
  document.body.append(bar, msg);

  // ---- Abrufe ----
  const api = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await crlfCatToken();
      const res = await fetch(url, { credentials: "omit", headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 && !attempt) { crlfCatTok = null; continue; }
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        throw new Error(`HTTP ${res.status} ${url.split("?")[0]} ${body}`);
      }
      return res.json();
    }
  };
  const imgOf = (images, key, w) => {
    const sets = images && images[key];
    const list = Array.isArray(sets) ? (Array.isArray(sets[0]) ? sets[0] : sets) : [];
    const sorted = list.filter((x) => x && x.source).sort((a, b) => Math.abs(a.width - w) - Math.abs(b.width - w));
    return sorted.length ? sorted[0].source : "";
  };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  // Eintrag der Schnittstelle (eine Sprachfassung einer Folge) -> Karte. Titel im alten Format („X Staffel N“ nur, wenn
  // die Staffel keinen eigenen Namen hat; Synchro mit Zusatz „(German Dub)“), weil ★/▼ daran hängen.
  function toItem(e) {
    const m = e && e.episode_metadata;
    if (!m || !e.id || !m.series_id) return null;
    const d = Date.parse(m.premium_available_date || m.availability_starts || "");
    if (isNaN(d)) return null;
    const audio = m.audio_locale || "ja-JP";
    const num = +m.season_display_number || m.season_number || m.season_sequence_number || 1;
    const st = m.season_title || "";
    const own = st && !/^\s*(Staffel|Season|Saison|Temporada|Stagione)\s*\d+\s*$/i.test(st) ? st : "";
    let title = own || `${m.series_title || ""} ${de ? "Staffel" : "Season"} ${num}`;
    const tagged = typeof crDetectLanguage === "function" ? crDetectLanguage(title) !== null : /\)\s*$/.test(title);
    if (audio !== "ja-JP" && DUB[audio] && !tagged) title += ` (${DUB[audio]} Dub)`;
    return { id: e.id, n: m.episode_number != null ? m.episode_number : m.episode, slug: e.slug_title || "", d, img: imgOf(e.images, "thumbnail", 320),
      sid: m.series_id, slug2: m.series_slug_title || "", title, sea: m.season_id || `${m.series_id}|${audio}|${num}` };
  }

  // Eine Woche (Mo 00:00 bis Mo 00:00, Ortszeit) mit derselben Abfrage wie der Release-Kalender von Crunchyroll:
  // alle in dieser Zeit erschienenen Folgen, je Sprachfassung ein Eintrag. Künftige Folgen liefert sie nicht.
  async function fetchWeek(mon) {
    const loc = crlfCatLocale(), from = mon.getTime(), to = addDays(mon, 7).getTime();
    const seen = new Set(), items = [];
    for (let off = 0, page = 0; page < 10; page++) {
      const j = await api(`/content/v2/discover/browse?type=episode&sort_by=newly_added&ratings=true&n=100&start=${off}`
        + `&from_date=${from}&to_date=${to}&preferred_audio_language=${loc}&locale=${loc}`);
      const data = (j && j.data) || [];
      for (const e of data) { const it = toItem(e); if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); } }
      off += data.length;
      if (!data.length || off >= ((j && j.total) || 0)) break;
    }
    return items;
  }

  // Wochen im Speicher (calWeeks3["de-DE|2026-11-02"] = { t, items }). Eine Woche, die beim Abruf noch lief, wird nach
  // 30 Min. neu abgerufen (mit „↻ Neu laden“ sofort), eine schon vorbei abgerufene nach 7 Tagen. Künftige Wochen: leer.
  async function getWeeks(mons, force) {
    const { calWeeks3: store = {} } = await chrome.storage.local.get("calWeeks3");
    const loc = crlfCatLocale();
    let changed = false;
    const one = async (mon) => {
      const now = Date.now();
      if (mon.getTime() > now) return { t: now, items: [] };
      const key = `${loc}|${ymd(mon)}`, w = store[key];
      const live = !w || w.t < addDays(mon, 7).getTime() + 864e5; // beim Abruf noch nicht ganz vorbei (1 Tag für Nachzügler)
      if (w && !(force && live) && now - w.t < (live ? CAL_LIVE_TTL : CAL_WEEK_TTL)) return w;
      try {
        store[key] = { t: Date.now(), items: await fetchWeek(mon) };
        changed = true;
        return store[key];
      } catch (e) { if (w) return w; throw e; } // lieber der alte Stand als gar nichts
    };
    // erst die gezeigte Woche (holt den Schlüssel), dann die Vorwochen für die Schätzung gleichzeitig; die dürfen fehlen
    const main = await one(mons[0]);
    const rest = await Promise.all(mons.slice(1).map((m) => one(m).catch(() => ({ t: 0, items: [] }))));
    if (changed) {
      const keep = Object.keys(store).sort((a, b) => (a.split("|")[1] < b.split("|")[1] ? 1 : -1)).slice(0, CAL_WEEKS_KEPT);
      for (const k of Object.keys(store)) if (!keep.includes(k)) delete store[k];
      await chrome.storage.local.set({ calWeeks3: store }).catch(() => {});
    }
    return [main, ...rest];
  }

  // Kalender der Woche: erschienene Folgen und geschätzte nächste Folgen (letzte Folge einer Sprachfassung + 7 Tage,
  // höchstens 3 Wochen weit, nur wenn die letzte Folge höchstens 3 Wochen her ist)
  async function loadWeek(force) {
    const [main, ...base] = await getWeeks([start, addDays(start, -7), addDays(start, -14), addDays(start, -21)], force);
    const now = Date.now(), items = main.items.slice();
    const bySea = new Map();
    for (const it of [...base.flatMap((w) => w.items), ...main.items]) {
      if (it.d > now) continue;
      let g = bySea.get(it.sea);
      if (!g) bySea.set(it.sea, (g = { last: null, known: new Set() }));
      g.known.add(+it.n);
      if (!g.last || it.d > g.last.d || (it.d === g.last.d && +it.n > +g.last.n)) g.last = it;
    }
    for (const { last, known } of bySea.values()) {
      if (!last || last.d < now - 21 * 864e5 || !isFinite(+last.n)) continue;
      for (let k = 1; k <= 3; k++) {
        const d = last.d + k * 7 * 864e5, n = +last.n + k;
        if (known.has(n)) continue;
        if (d <= now || d < start) continue;
        if (d >= end) break;
        items.push({ id: "", n, d, sid: last.sid, slug2: last.slug2, title: last.title, img: last.img, soon: true, last });
      }
    }
    return { items, t: Math.max(main.t, ...base.map((w) => w.t)) };
  }

  function render(items, t) {
    for (const old of document.querySelectorAll(".crlf-calweek")) old.remove();
    const fmtStamp = new Intl.DateTimeFormat(de ? "de-DE" : "en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    bar.querySelector(".crlf-calstamp").textContent = `${L.stamp} ${fmtStamp.format(new Date(t))}`;
    const week = el("div", { class: "crlf-calweek" });
    const fmtDay = new Intl.DateTimeFormat(de ? "de-DE" : "en-US", { weekday: "long", day: "2-digit", month: "2-digit" });
    const fmtTime = new Intl.DateTimeFormat(de ? "de-DE" : "en-US", { hour: "2-digit", minute: "2-digit" });
    for (let i = 0; i < 7; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      const ol = el("ol", { class: "releases" });
      for (const it of items.filter((x) => x.d >= day && x.d < next).sort((a, b) => a.d - b.d || a.title.localeCompare(b.title))) {
        const when = new Date(it.d);
        const epText = `${L.ep} ${it.n}`;
        // Bild und „Folge N“ führen zur Folge; geschätzte Folgen (noch ohne Folgenseite) zur Serie
        const seriesUrl = path(`series/${it.sid}${it.slug2 ? "/" + it.slug2 : ""}`);
        const target = it.id ? path(`watch/${it.id}${it.slug ? "/" + it.slug : ""}`) : seriesUrl;
        const thumb = it.img ? el("img", { src: it.img, width: "160", height: "90", alt: "", loading: "lazy" }) : null;
        ol.append(el("li", {}, el("article", { class: `release js-release${it.soon && it.d > Date.now() ? " crlf-soon" : ""}`, "data-crlf-thumb": it.soon ? null : it.img || null,
          "data-crlf-ep": it.id ? it.id.toUpperCase() : null,
          // geschätzte Folge: die Vorschau zeigt stattdessen die zuletzt erschienene (Bild, Fortschritt, Abspielen)
          "data-crlf-last-ep": it.last && it.last.id ? it.last.id.toUpperCase() : null, "data-crlf-last-n": it.last ? String(it.last.n) : null,
          "data-crlf-last-thumb": (it.last && it.last.img) || null,
          "data-crlf-last-href": it.last && it.last.id ? path(`watch/${it.last.id}${it.last.slug ? "/" + it.last.slug : ""}`) : null },
          el("time", { class: "available-time", datetime: when.toISOString() }, fmtTime.format(when)),
          el("div", { class: "season-name" }, el("a", { href: path(`series/${it.sid}${it.slug2 ? "/" + it.slug2 : ""}`) }, el("cite", { itemprop: "name" }, it.title))),
          el("div", { class: "episode" }, el("a", { href: target, class: "crlf-eplink" }, epText), " ", el("span", {}, it.d > Date.now() ? "" : L.avail)),
          thumb && el("a", { href: target, class: "available-episode-link" }, thumb))));
      }
      week.append(el("section", { class: "day", "data-crlf-today": ymd(day) === ymd(new Date()) ? "" : null },
        el("h1", {}, el("time", { datetime: ymd(day) }, fmtDay.format(day))), ol));
    }
    msg.remove();
    document.body.append(week);
    if (typeof crlfCatLoad === "function") crlfCatLoad(); // Beschreibungen für die neuen Serien-Links
    placeNow();
    chrome.storage.local.get("epProg").then(({ epProg }) => showProgress(epProg || {})).catch(() => {});
  }

  // eigener Fortschritt (watchlog.js) als <progress> in der Karte, wie früher der Balken der Seite: content.js zeichnet
  // daraus den orangen Balken und graut gesehene Folgen (ab 90 %) aus, die Vorschau zeigt ihn ebenfalls.
  // Ohne gemessenen Wert bleibt der Balken weg (hidden), damit nicht jede Karte „0 %“ zeigt.
  function showProgress(epProg) {
    for (const card of document.querySelectorAll(".crlf-calweek article.release[data-crlf-ep]")) {
      // angefangene Folgen mindestens 10 % (Nutzerwunsch), sonst ist nach ein paar Sekunden noch nichts zu sehen
      const e = epProg[card.dataset.crlfEp], v = e && e.p > 0 ? String(Math.max(0.1, e.p)) : null;
      let pr = card.querySelector(":scope > progress");
      if (v === null) { if (pr) pr.remove(); continue; }
      if (!pr) { pr = el("progress", { max: "1", class: "crlf-progsrc" }); card.append(pr); }
      if (pr.getAttribute("value") !== v) pr.setAttribute("value", v);
    }
    // geschätzte Folgen: Fortschritt der zuletzt erschienenen nur für die Vorschau merken (Karte selbst bleibt ungegraut)
    for (const card of document.querySelectorAll(".crlf-calweek article.release[data-crlf-last-ep]")) {
      const e = epProg[card.dataset.crlfLastEp];
      if (e && e.p > 0) card.dataset.crlfLastP = String(Math.max(0.1, e.p)); else delete card.dataset.crlfLastP;
    }
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.epProg) showProgress(ch.epProg.newValue || {}); });

  // „Jetzt“-Linie in der Spalte von heute: über der ersten Folge, deren Zeit noch nicht erreicht ist (Reihenfolge wie
  // angezeigt, also nach ★-Sortierung). Läuft jede halbe Minute und nach jeder Änderung der Liste (Filter, ★/▼).
  // Die Linie liegt über der Spalte (absolut), nicht in der Liste, damit Sortierung und Filter sie nicht anfassen.
  let nowT = 0;
  function placeNow() {
    const col = document.querySelector(".crlf-calweek section.day[data-crlf-today]");
    if (!col) return;
    let line = col.querySelector(":scope > .crlf-nowline");
    if (!line) { line = el("div", { class: "crlf-nowline", "aria-hidden": "true" }); col.append(line); }
    const now = Date.now();
    const cards = [...col.querySelectorAll("article.release")].filter((a) => a.offsetParent && !a.closest(".crlf-hidden"));
    if (!cards.length) { line.hidden = true; return; }
    const outer = (a) => (a.closest("li") || a);
    const idx = cards.findIndex((a) => { const t = a.querySelector("time[datetime]"); return t && Date.parse(t.getAttribute("datetime")) > now; });
    const base = col.getBoundingClientRect().top;
    let y;
    if (idx === -1) y = outer(cards[cards.length - 1]).getBoundingClientRect().bottom + 3;
    else if (idx === 0) y = outer(cards[0]).getBoundingClientRect().top - 3;
    else y = (outer(cards[idx - 1]).getBoundingClientRect().bottom + outer(cards[idx]).getBoundingClientRect().top) / 2;
    line.hidden = false;
    line.style.top = `${Math.round(y - base)}px`;
  }
  const schedNow = () => { clearTimeout(nowT); nowT = setTimeout(placeNow, 120); };
  setInterval(placeNow, 30e3);
  addEventListener("resize", schedNow);
  addEventListener("load", schedNow, true); // nachgeladene Bilder verschieben die Karten
  new MutationObserver((muts) => { if (muts.some((m) => !(m.target.closest && m.target.closest(".crlf-nowline")))) schedNow(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });

  async function run(force) {
    msg.replaceChildren(L.load);
    if (!msg.isConnected) document.body.append(msg);
    try {
      if (typeof crlfCatToken !== "function") throw new Error("crcatalog.js fehlt");
      const w = await loadWeek(force === true);
      render(w.items, w.t);
    } catch (e) {
      const retry = el("button", { type: "button" }, L.retry);
      retry.addEventListener("click", run);
      msg.replaceChildren(el("div", {}, `${L.err}: ${e.message || e}`), retry);
      if (typeof crlfError === "function") crlfError("Kalender", e);
    }
  }
  // crcatalog.js wird nach diesem Skript geladen: erst danach starten
  setTimeout(run, 0);
  // Inhalt von robots.txt: der Browser legt dafür eigene head/body/pre hinter unseren an; die wieder entfernen.
  // (Kein window.stop(): danach zeichnete Chrome die Seite nie, requestAnimationFrame lief nicht.)
  const ownHead = document.head, ownBody = document.body;
  const dropPre = () => {
    for (const c of [...document.documentElement.children]) if (c !== ownHead && c !== ownBody) c.remove();
    for (const p of ownBody.querySelectorAll(":scope > pre")) p.remove();
  };
  addEventListener("DOMContentLoaded", dropPre, { once: true });
  setTimeout(dropPre, 500);
})();
