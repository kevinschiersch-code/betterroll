// series.js – läuft auf allen Crunchyroll-Seiten. Auf Serienseiten die angezeigte Bewertung („4.5 (57.8K)“ unter den Genres) ablesen und merken,
// damit die Vorschau im Kalender sie zeigen kann. Nur lesen, nichts an der Seite ändern.
(() => {
  const RE = /(?:^|[^\d.,])(\d[.,]\d)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(K|M|Tsd\.?|Mio\.?)?\s*\)/i;
  let lastId = null, done = false, tries = 0;

  // Serien-ID aus der Adresse (/series/<ID>/…)
  const seriesId = () => (location.pathname.match(/\/series\/([A-Z0-9]+)/i) || [])[1] || null;

  // Bewertung im sichtbaren Text der Seite suchen: { value, best, count } oder null
  function readRating() {
    const text = (document.body && (document.body.innerText || document.body.textContent)) || "";
    for (const line of text.split("\n")) {
      const m = line.match(RE);
      if (!m) continue;
      const value = parseFloat(m[1].replace(",", "."));
      if (!(value > 0 && value <= 5)) continue;
      const mult = /^m/i.test(m[3] || "") ? 1e6 : m[3] ? 1e3 : 1;
      return { value, best: 5, count: Math.round(parseFloat(m[2].replace(",", ".")) * mult) };
    }
    return null;
  }

  // Bewertung für die Vorschau merken (gleicher Speicher wie theme.js, Art "cr")
  async function save(id, v) {
    const { crRating2: store = {} } = await chrome.storage.local.get("crRating2");
    store[`cr|${id}`] = { t: Date.now(), v };
    await chrome.storage.local.set({ crRating2: store });
  }

  // die Seite wechselt Serien ohne Neuladen: Adresse regelmäßig prüfen, je Serie einmal speichern
  // (höchstens 30 Versuche je Serie; ohne Bewertung auf der Seite wird danach nicht mehr gesucht)
  setInterval(() => {
    const id = seriesId();
    if (id !== lastId) { lastId = id; done = false; tries = 0; }
    if (!id || done || ++tries > 30) return;
    const r = readRating();
    if (r) { done = true; save(id, r).catch((e) => chrome.runtime.sendMessage({ type: "crlf-error", where: "Bewertung speichern", msg: String(e && e.message || e) }).catch(() => {})); }
  }, 1000);
})();
