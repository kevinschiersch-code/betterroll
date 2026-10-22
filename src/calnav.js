// calnav.js – läuft auf allen Crunchyroll-Seiten. Crunchyroll hat den Release-Kalender im Oktober 2026 abgeschaltet;
// oben im Menü (Neu · Beliebt · Simulcast) steht deshalb wieder ein Reiter „Release-Kalender“, der zum Kalender von
// BetterRoll führt (calbuild.js, Umleitung über rules.json). Die Seite zeichnet die Kopfzeile neu: dann neu einsetzen.
(() => {
  const loc = (location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,3})?)\//i) || [])[1];
  const href = `/${loc ? loc + "/" : ""}simulcastcalendar`;
  const label = !loc || /^de/i.test(loc) ? "Release-Kalender" : "Release Calendar";
  const add = () => {
    const box = document.querySelector(".header-internal-links");
    if (!box || box.querySelector(".crlf-navcal")) return;
    const tiles = [...box.querySelectorAll(":scope > a")];
    const ref = tiles.find((a) => /\/simulcast/i.test(a.getAttribute("href") || "")) || tiles[tiles.length - 1];
    if (!ref) return;
    const a = ref.cloneNode(true);
    a.classList.add("crlf-navcal");
    a.classList.remove("news-link");
    a.removeAttribute("data-t");
    a.setAttribute("href", href);
    const text = a.querySelector("span") || a;
    text.textContent = label;
    ref.after(a);
  };
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
  add();
})();
