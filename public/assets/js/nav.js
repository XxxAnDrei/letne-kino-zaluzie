/*
 * Ponuka na telefóne.
 *
 * Tlačidlo je v HTML skryté a odkrýva ho až tento skript. Bez JS by inak
 * v hlavičke visel gombík, ktorý nič nerobí. Odkazy zo sekcie nav zostávajú
 * v DOM aj na mobile — čítačky obrazovky ich tak nájdu bez ohľadu na to,
 * či je ponuka otvorená.
 */
(function () {
  "use strict";

  var btn = document.getElementById("menuBtn");
  var panel = document.getElementById("menuPanel");
  if (!btn || !panel) return;

  btn.hidden = false;
  var open = false;
  var lastFocus = null;

  // Ponuka začína pod hlavičkou. Výška sa meria, nie háda — mení sa s veľkosťou
  // písma, ktorú si používateľ môže v prehliadači zväčšiť.
  var masthead = document.getElementById("masthead");
  function measure() {
    if (!masthead) return;
    document.documentElement.style.setProperty(
      "--masthead-h",
      Math.round(masthead.getBoundingClientRect().height) + "px"
    );
  }
  measure();
  window.addEventListener("resize", measure, { passive: true });

  function setOpen(next) {
    if (next === open) return;
    open = next;
    btn.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("menu-open", open);

    if (open) {
      lastFocus = document.activeElement;
      panel.hidden = false;
      // Prekreslenie medzi zobrazením a triedou, inak prechod nenabehne.
      requestAnimationFrame(function () {
        panel.classList.add("is-open");
      });
      var first = panel.querySelector("a");
      if (first) first.focus({ preventScroll: true });
    } else {
      panel.classList.remove("is-open");
      var done = function () {
        if (!open) panel.hidden = true;
        panel.removeEventListener("transitionend", done);
      };
      panel.addEventListener("transitionend", done);
      // Poistka, keby prechod nebežal (napr. pri obmedzenom pohybe).
      setTimeout(done, 400);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }
  }

  btn.addEventListener("click", function () {
    setOpen(!open);
  });

  // Kliknutie na odkaz ponuku zavrie, inak by prekryla cieľ skoku.
  panel.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) setOpen(false);
  });

  // Otočenie telefónu do šírky alebo zväčšenie okna: ponuka už netreba.
  var wide = window.matchMedia("(min-width: 861px)");
  var onWide = function (e) {
    if (e.matches) setOpen(false);
  };
  if (wide.addEventListener) wide.addEventListener("change", onWide);
  else if (wide.addListener) wide.addListener(onWide);

  /*
   * Držanie fokusu v otvorenej ponuke. Bez toho by sa dalo tabulátorom
   * prejsť do obsahu pod ňou, ktorý používateľ nevidí.
   */
  panel.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || !open) return;
    var items = panel.querySelectorAll("a");
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      btn.focus();
    }
  });
})();
