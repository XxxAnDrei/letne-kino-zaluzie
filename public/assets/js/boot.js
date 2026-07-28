/* Beží v <head> ešte pred vykreslením. Samostatný súbor je to preto, že CSP
   na stránke nepovoľuje inline skripty. */
(function () {
  "use strict";

  // Označ, že JS je k dispozícii — až potom sa smú skrývať prvky, ktoré má
  // odhaliť animácia. Bez JS zostane obsah viditeľný.
  document.documentElement.classList.add("js");

  /*
   * Na telefóne sa filmový odpočet a otvorenie clony preskočia.
   * Text v úvode je pri nich schovaný, kým nedobehne animácia, takže na
   * pomalom pripojení sa človek díval takmer štyri sekundy na prázdnu
   * obrazovku. Na veľkej obrazovke predohra ostáva, tam je čas aj dôvod.
   * Rozhoduje sa tu, pred prvým vykreslením, aby nič neprebliklo.
   */
  if (window.matchMedia("(max-width: 860px)").matches) {
    document.documentElement.classList.add("no-intro");
  }

  // Video v hlavičke sa načítava až tu, aby sa podľa šírky okna vybrala
  // správna veľkosť. V HTML zdroj zámerne nie je, inak by prehliadač začal
  // sťahovať skôr, než sa dá rozhodnúť.
  function startVideo() {
    var video = document.getElementById("heroVideo");
    if (!video) return;

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return; // poster stačí, slučka na pozadí by rušila

    var net = navigator.connection;
    if (net) {
      // Na pomalom alebo meranom pripojení zostane poster. Slučka na pozadí
      // nie je hodná megabajtu z dátového balíčka.
      if (net.saveData) return;
      if (/(^|-)2g$/.test(net.effectiveType || "")) return;
    }

    var small = window.matchMedia("(max-width: 799px)").matches;
    var base = small ? video.dataset.mobile : video.dataset.desktop;

    // WebM je prvý: prehliadače bez H.264 (bežné na Linuxe) tak dostanú obraz
    // namiesto chyby. Ostatné si vyberú mp4 samy.
    [
      [base + ".webm", 'video/webm; codecs="vp9"'],
      [base + ".mp4", 'video/mp4; codecs="avc1.42E01E"'],
    ].forEach(function (pair) {
      var source = document.createElement("source");
      source.src = pair[0];
      source.type = pair[1];
      video.appendChild(source);
    });

    video.preload = "auto";
    video.load();

    // Autoplay môže byť odmietnutý (šetrenie batérie, nastavenia prehliadača).
    // V takom prípade jednoducho zostane poster.
    var attempt = video.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(function () {});
  }

  /*
   * Video sa púšťa až po načítaní zvyšku stránky a v prvej voľnej chvíli.
   * Má takmer megabajt a na telefóne je to najväčšia položka na stránke;
   * keby sa ťahalo hneď, súperilo by o linku s písmami a s posterom, ktorý
   * je aj tak to prvé, čo človek uvidí.
   */
  function later() {
    if (window.requestIdleCallback) requestIdleCallback(startVideo, { timeout: 2500 });
    else setTimeout(startVideo, 900);
  }

  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
})();
