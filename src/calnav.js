// calnav.js – läuft auf allen Crunchyroll-Seiten. Crunchyroll hat den Release-Kalender im Oktober 2026 abgeschaltet;
// oben im Menü (Neu · Beliebt · Simulcast) steht deshalb wieder ein Reiter „Release-Kalender“, der zum Kalender von
// BetterRoll führt (calbuild.js, Umleitung über rules.json). Die Seite zeichnet die Kopfzeile neu: dann neu einsetzen.
// Seit 31.10.2026 hat Crunchyroll eine eigene Seite /releasecalendar (React, ohne BetterRoll-Design). rules.json leitet
// sie beim Laden um; Klicks auf Links dorthin und Seitenwechsel innerhalb der App (ohne Neuladen) fangen wir hier ab.
(() => {
  const CAL = /^\/(?:[a-z]{2}(?:-[a-z]{2,3})?\/)?(?:simulcast|release)calendar\/?$/i;
  const loc = (location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2,3})?)\//i) || [])[1];
  const href = `/${loc ? loc + "/" : ""}simulcastcalendar`;
  const label = !loc || /^de/i.test(loc) ? "Release-Kalender" : "Release Calendar";
  // Ganz neu laden, damit die Umleitung greift (die App würde sonst ihren eigenen Kalender einblenden).
  const go = (url) => { location.assign(url); };
  const isCal = (a) => { try { const u = new URL(a.href, location.href); return u.host === location.host && CAL.test(u.pathname); } catch { return false; } };
  addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || !isCal(a) || (a.target && a.target !== "_self")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    go(new URL(a.href, location.href).href);
  }, true);
  // Seitenwechsel innerhalb der App auf /releasecalendar: neu laden.
  let last = location.pathname;
  const watch = () => {
    if (location.pathname === last) return;
    last = location.pathname;
    if (/releasecalendar\/?$/i.test(last)) go(location.href);
  };
  const add = () => {
    watch();
    // Menü suchen: bisher .header-internal-links; falls Crunchyroll die Klassen ändert, über den Simulcast-Link oben.
    let box = document.querySelector(".header-internal-links");
    if (!box) {
      const sim = [...document.querySelectorAll("header a[href]")].find((a) => /\/simulcasts?\/?$|\/(?:simulcast|release)calendar\/?$/i.test(new URL(a.href, location.href).pathname));
      if (!sim) return;
      box = sim.parentElement && sim.parentElement.tagName === "LI" ? sim.parentElement.parentElement : sim.parentElement;
    }
    if (!box || box.querySelector(".crlf-navcal")) return;
    const linkOf = (el) => (el.matches("a[href]") ? el : el.querySelector("a[href]"));
    const tiles = [...box.children].filter((el) => linkOf(el));
    // Crunchyroll zeigt schon einen eigenen Kalender-Reiter: der führt (umgeleitet) zu BetterRoll, kein zweiter nötig.
    const own = tiles.find((el) => isCal(linkOf(el)));
    if (own) { linkOf(own).classList.add("crlf-navcal"); return; }
    const ref = tiles.find((el) => /\/simulcast/i.test(linkOf(el).getAttribute("href") || "")) || tiles[tiles.length - 1];
    if (!ref) return;
    const item = ref.cloneNode(true);
    const a = linkOf(item);
    a.classList.add("crlf-navcal");
    a.classList.remove("news-link");
    a.removeAttribute("data-t");
    a.setAttribute("href", href);
    a.removeAttribute("aria-current");
    const text = a.querySelector("span") || a;
    text.textContent = label;
    ref.after(item);
  };
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", watch);
  add();
})();
