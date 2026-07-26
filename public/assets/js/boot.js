/* Beží v <head> ešte pred vykreslením. Samostatný súbor je to preto, že CSP
   na stránke nepovoľuje inline skripty. */
(function () {
  "use strict";

  // Označ, že JS je k dispozícii — až potom sa smú skrývať prvky, ktoré má
  // odhaliť animácia. Bez JS zostane obsah viditeľný.
  document.documentElement.classList.add("js");

  // Video v hlavičke sa načítava až tu, aby sa podľa šírky okna vybrala
  // správna veľkosť. V HTML zdroj zámerne nie je, inak by prehliadač začal
  // sťahovať skôr, než sa dá rozhodnúť.
  document.addEventListener("DOMContentLoaded", function () {
    var video = document.getElementById("heroVideo");
    if (!video) return;

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return; // poster stačí, slučka na pozadí by rušila

    if (navigator.connection && navigator.connection.saveData) return;

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
  });
})();
