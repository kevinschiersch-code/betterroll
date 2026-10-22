// Eigener Simulcast-Kalender: Crunchyroll hat /simulcastcalendar abgeschaltet (Umleitung auf die Season-Übersicht).
// Eine Regel (rules.json) leitet /…/simulcastcalendar?… vorher auf die kleine Datei /robots.txt?simulcastcalendar&p=…
// um. Dieses Skript läuft dort als erstes, stellt die alte Adresse in der Leiste wieder her und baut die Wochenansicht
// im Aufbau der alten Seite nach (section.day > ol.releases > li > article.release), damit alle übrigen Teile von
// BetterRoll unverändert darauf arbeiten. Daten aus dem öffentlichen Katalog mit dem anonymen Schlüssel aus
// crcatalog.js (keine Cookies, kein Konto). Künftige Folgen der Woche werden aus der letzten Folge + 7 Tage geschätzt.
(() => {
  if (location.pathname !== "/robots.txt" || !/(?:^\?|&)simulcastcalendar(?=&|$)/.test(location.search)) return;
  try { window.stop(); } catch (e) {}

  // alte Adresse wiederherstellen (Sprache aus p=, sonst aus dem Browser)
  const q = new URLSearchParams(location.search);
  let loc = (q.get("p") || "").replace(/\/$/, "");
  if (!/^[a-z]{2}(?:-[a-z]{2,3})?$/i.test(loc)) loc = /^de\b/i.test(navigator.language) ? "de" : "";
  q.delete("simulcastcalendar"); q.delete("p");
  const rest = q.toString();
  history.replaceState(null, "", `/${loc ? loc + "/" : ""}simulcastcalendar${rest ? "?" + rest : ""}`);

  const CAL_SERIES_TTL = 12 * 36e5, CAL_EPS_TTL = 36e5, CAL_PAR = 8;
  const DUB = { "de-DE": "German", "en-US": "English", "es-419": "Spanish", "es-ES": "Castilian", "pt-BR": "Portuguese", "pt-PT": "Portuguese (Portugal)",
    "fr-FR": "French", "it-IT": "Italian", "ru-RU": "Russian", "ar-SA": "Arabic", "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu",
    "zh-CN": "Chinese", "zh-HK": "Chinese", "zh-TW": "Chinese", "ko-KR": "Korean", "th-TH": "Thai", "id-ID": "Indonesian", "ms-MY": "Malay",
    "vi-VN": "Vietnamese", "pl-PL": "Polish", "tr-TR": "Turkish", "ca-ES": "Catalan" };
  const de = !loc || /^de/i.test(loc);
  const L = de
    ? { title: "Simulcast-Kalender", prev: "‹ Vorherige Woche", next: "Nächste Woche ›", load: "Kalender wird geladen …", err: "Kalender konnte nicht geladen werden", retry: "Erneut versuchen", ep: "Folge", avail: "Verfügbar", soon: "voraussichtlich" }
    : { title: "Simulcast Calendar", prev: "‹ Previous week", next: "Next week ›", load: "Loading calendar …", err: "Could not load the calendar", retry: "Try again", ep: "Episode", avail: "Available", soon: "expected" };
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
    .crlf-calbar { display: flex; align-items: center; gap: 16px; padding: 14px 24px; flex-wrap: wrap; }
    .crlf-calbar a { color: #f47521; text-decoration: none; }
    .crlf-calbar h1 { margin: 0 auto 0 0; font-size: 20px; color: #fff; }
    .crlf-calmsg { padding: 40px 24px; text-align: center; color: #aaa; }
    .crlf-calmsg button { margin-top: 12px; padding: 6px 14px; cursor: pointer; }
    .crlf-calweek { display: flex; align-items: flex-start; gap: 8px; padding: 0 24px 40px; }
    .crlf-calweek section.day { flex: 1 1 0; min-width: 0; }
    .crlf-calweek section.day > h1 { font-size: 14px; margin: 0 0 8px; color: #fff; }
    .crlf-calweek ol.releases { list-style: none; margin: 0; padding: 0; }
    .crlf-calweek article.release { position: relative; margin: 0 0 10px; background: #141519; padding: 6px; }
    .crlf-calweek article.release img { display: block; width: 100%; height: auto; }
    .crlf-calweek .season-name a { color: #fff; text-decoration: none; }
    .crlf-calweek .crlf-soon { opacity: .75; }`);
  document.head.append(css);
  const bar = el("header", { class: "crlf-calbar" },
    el("h1", {}, el("a", { href: path("") }, "Crunchyroll"), " · ", L.title),
    el("a", { href: shift(-7) }, L.prev), el("a", { href: shift(7) }, L.next));
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
  const pool = async (items, fn) => {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(CAL_PAR, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } }
    }));
    return out;
  };
  const seasonTag = (d) => `${["winter", "spring", "summer", "fall"][Math.floor(d.getMonth() / 3)]}-${d.getFullYear()}`;
  const imgOf = (images, key, w) => {
    const sets = images && images[key];
    const list = Array.isArray(sets) ? (Array.isArray(sets[0]) ? sets[0] : sets) : [];
    const sorted = list.filter((x) => x && x.source).sort((a, b) => Math.abs(a.width - w) - Math.abs(b.width - w));
    return sorted.length ? sorted[0].source : "";
  };
  const relDate = (e) => e.premium_available_date || e.availability_starts || e.episode_air_date || "";

  async function loadWeek() {
    const locale = crlfCatLocale();
    const { calCache2: calCache = {} } = await chrome.storage.local.get("calCache2");
    const cache = { series: calCache.series || {}, eps: calCache.eps || {} };
    const now = Date.now();

    // Serien der Season (Woche) und der vorigen Season (laufende Zweiteiler)
    const prevSeason = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    const tags = [...new Set([seasonTag(start), seasonTag(new Date(end - 1)), seasonTag(prevSeason)])];
    const series = new Map();
    let lastErr = null;
    for (const tag of tags) {
      const found = [];
      try {
        for (let off = 0; off < 400; off += 100) {
          const j = await api(`/content/v2/discover/browse?seasonal_tag=${tag}&n=100&start=${off}&locale=${locale}`);
          const data = (j && j.data) || [];
          found.push(...data);
          if (data.length < 100 || (j.total && off + 100 >= j.total)) break;
        }
      } catch (e) { lastErr = e; }
      for (const s of found) {
        if (!s.id || series.has(s.id)) continue;
        const last = Date.parse(s.last_public || (s.series_metadata && s.series_metadata.last_public) || "");
        if (!isNaN(last) && last < start - 21 * 864e5) continue; // seit Wochen nichts Neues: beendet
        series.set(s.id, s);
      }
    }

    if (!series.size && lastErr) throw lastErr;

    // je Serie die neueste Staffel jeder Sprachfassung
    const sids = [...series.keys()];
    await pool(sids, async (sid) => {
      const c = cache.series[sid];
      if (c && now - c.t < CAL_SERIES_TTL) return;
      const j = await api(`/content/v2/cms/series/${sid}/seasons?locale=${locale}`);
      const best = new Map();
      for (const s of (j && j.data) || []) {
        const n = s.season_sequence_number || s.season_number || 0;
        // Synchronfassungen stecken als eigene Staffel-IDs in versions[]
        const vers = Array.isArray(s.versions) && s.versions.length ? s.versions : [{ audio_locale: s.audio_locale, guid: s.id }];
        for (const v of vers) {
          const audio = v.audio_locale || "ja-JP", id = v.guid || v.season_guid || s.id;
          const o = best.get(audio);
          if (!o || n > o.n) best.set(audio, { id, title: s.title || "", audio, n, num: s.season_number || n, count: s.number_of_episodes || 0 });
        }
      }
      cache.series[sid] = { t: now, seasons: [...best.values()] };
    });

    // Folgen dieser Staffeln (nur die letzten 60 Tage werden gemerkt)
    const seasons = sids.flatMap((sid) => ((cache.series[sid] && cache.series[sid].seasons) || []).map((s) => ({ ...s, sid })));
    await pool(seasons, async (s) => {
      const c = cache.eps[s.id];
      if (c && now - c.t < CAL_EPS_TTL && !(start < now - 60 * 864e5)) return;
      const j = await api(`/content/v2/cms/seasons/${s.id}/episodes?locale=${locale}`);
      const list = [];
      for (const e of (j && j.data) || []) {
        const d = Date.parse(relDate(e));
        if (isNaN(d) || d > now + 30 * 864e5) continue; // Platzhalter wie 9998-11-30 = noch nicht angekündigt
        list.push({ id: e.id, n: e.episode_number != null ? e.episode_number : e.episode, slug: e.slug_title || "", d, img: imgOf(e.images, "thumbnail", 320),
          sslug: e.series_slug_title || "", title: e.season_title || "" });
      }
      cache.eps[s.id] = { t: now, list: start < now - 60 * 864e5 ? list : list.filter((x) => x.d > now - 60 * 864e5) };
    });

    // aufräumen: nur Einträge der aktuellen Serien/Staffeln behalten
    const keepS = new Set(seasons.map((s) => s.id)), keepSer = new Set(sids);
    for (const k of Object.keys(cache.eps)) if (!keepS.has(k)) delete cache.eps[k];
    for (const k of Object.keys(cache.series)) if (!keepSer.has(k)) delete cache.series[k];
    chrome.storage.local.set({ calCache2: cache }).catch(() => {});

    // Einträge der Woche: erschienene Folgen und geschätzte nächste Folgen (letzte + 7 Tage)
    const items = [];
    for (const s of seasons) {
      const ser = series.get(s.sid) || {};
      const eps = ((cache.eps[s.id] && cache.eps[s.id].list) || []).slice().sort((a, b) => a.d - b.d);
      // „Staffel 1“ allein sagt nichts: dann Serientitel (+ Staffel ab 2)
      const own = s.title && !/^\s*(Staffel|Season|Saison|Temporada|Stagione)\s*\d+\s*$/i.test(s.title) ? s.title : "";
      let title = own || `${ser.title || (eps[0] && eps[0].title) || ""}${s.num > 1 ? ` ${de ? "Staffel" : "Season"} ${s.num}` : ""}`;
      const tagged = typeof crDetectLanguage === "function" ? crDetectLanguage(title) !== null : /\)\s*$/.test(title);
      if (s.audio !== "ja-JP" && DUB[s.audio] && !tagged) title += ` (${DUB[s.audio]} Dub)`;
      const slug = (eps[0] && eps[0].sslug) || ser.slug_title || "";
      const poster = imgOf(ser.images, "poster_wide", 320);
      for (const e of eps) if (e.d >= start && e.d < end) items.push({ ...e, sid: s.sid, slug2: slug, title, img: e.img || poster });
      const out = eps.filter((e) => e.d <= now), last = out[out.length - 1];
      const known = new Set(eps.map((e) => +e.n));
      if (!last || last.d < now - 21 * 864e5 || !isFinite(+last.n)) continue;
      for (let k = 1; k <= 3; k++) {
        const d = last.d + k * 7 * 864e5, n = +last.n + k;
        if (known.has(n)) continue;
        if (d <= now || d < start) continue;
        if (d >= end) break;
        items.push({ id: "", n, d, sid: s.sid, slug2: slug, title, img: last.img || poster, soon: true });
      }
    }
    return items;
  }

  function render(items) {
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
        const thumb = it.img ? el("img", { src: it.img, width: "160", height: "90", alt: "", loading: "lazy" }) : null;
        ol.append(el("li", {}, el("article", { class: `release js-release${it.soon ? " crlf-soon" : ""}` },
          el("time", { class: "available-time", datetime: when.toISOString() }, fmtTime.format(when)),
          el("div", { class: "season-name" }, el("a", { href: path(`series/${it.sid}${it.slug2 ? "/" + it.slug2 : ""}`) }, el("cite", { itemprop: "name" }, it.title))),
          el("div", { class: "episode" }, el("span", {}, epText), " ", el("span", {}, it.soon ? L.soon : (it.d <= Date.now() ? L.avail : ""))),
          thumb && (it.id ? el("a", { href: path(`watch/${it.id}${it.slug ? "/" + it.slug : ""}`), class: "available-episode-link" }, thumb) : thumb))));
      }
      week.append(el("section", { class: "day" }, el("h1", {}, el("time", { datetime: ymd(day) }, fmtDay.format(day))), ol));
    }
    msg.remove();
    document.body.append(week);
    if (typeof crlfCatLoad === "function") crlfCatLoad(); // Beschreibungen für die neuen Serien-Links
  }

  async function run() {
    msg.replaceChildren(L.load);
    try {
      if (typeof crlfCatToken !== "function") throw new Error("crcatalog.js fehlt");
      render(await loadWeek());
    } catch (e) {
      const retry = el("button", { type: "button" }, L.retry);
      retry.addEventListener("click", run);
      msg.replaceChildren(el("div", {}, `${L.err}: ${e.message || e}`), retry);
      if (typeof crlfError === "function") crlfError("Kalender", e);
    }
  }
  // crcatalog.js wird nach diesem Skript geladen: erst danach starten
  setTimeout(run, 0);
  // Reste von robots.txt, falls der Browser nach window.stop() noch Text angehängt hat
  const dropPre = () => { for (const p of document.querySelectorAll("body > pre, html > pre")) p.remove(); };
  addEventListener("DOMContentLoaded", dropPre, { once: true });
  setTimeout(dropPre, 500);
})();
