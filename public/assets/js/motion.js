/* ============================================================================
   Motion vrstva. Každá animácia odpovedá na otázku „čo sa práve stalo"
   alebo „kam sa mám pozrieť". Nič tu nie je len ozdoba.
   Pri prefers-reduced-motion sa všetko vypne a obsah zostane statický.
   ========================================================================= */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined";
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  document.getElementById("year").textContent = String(new Date().getFullYear());

  /* ------------------------------------------------- statický režim */

  function revealAll() {
    $$(".reveal").forEach(function (n) { n.style.opacity = "1"; });
    $$(".step").forEach(function (n) { n.classList.add("is-on"); });
    var spine = $("setupSpine");
    if (spine) spine.style.transform = "scaleY(1)";

    // Bez animácie sa momenty večera nestriedajú — ukážu sa všetky naraz
    // a scéna prestane byť pripnutá, takže sa dá normálne preskrolovať.
    var dusk = document.querySelector(".dusk");
    if (dusk) dusk.classList.add("is-static");
    $$(".beat").forEach(function (n) { n.classList.add("is-on"); });
    var fill = $("duskFill");
    if (fill) fill.style.setProperty("--p", "1");

    // Výkres záhrady zostane v tom stave, ktorý sekcia opisuje: postavené,
    // rozsvietené, s ľuďmi na dekách. Zrolovaný kufor sa skryje.
    var bundle = $("gBundle");
    if (bundle) bundle.style.opacity = "0";
    var night = $("duskNight");
    if (night) night.style.opacity = "1";
    var stars = $("duskStars");
    if (stars) stars.style.opacity = "1";
    var surface = $("duskSurface");
    if (surface) surface.style.fill = "color-mix(in oklab, var(--ivory) 82%, transparent)";
  }

  function dropLeader() {
    var leader = $("leader");
    var iris = $("iris");
    if (leader) leader.remove();
    if (iris) iris.remove();
    document.body.classList.remove("is-locked");
  }

  if (reduced || !hasGsap) {
    // Pri redukovanom pohybe video vôbec nenačítava boot.js — zostane poster.
    dropLeader();
    revealAll();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /*
   * Pripínanie beží aj na telefóne — časová os aj vodorovná cievka sú kvôli
   * nemu. Skákanie stránky spôsoboval prepočet, nie pripínanie samo:
   *
   *   1. na mobile sa innerHeight mení pri každom skrolovaní, ako sa schováva
   *      adresný riadok, a každá taká zmena vyvolá resize;
   *   2. po prepočte sa prepočítala aj výška rozpery pod pripnutou sekciou;
   *   3. výška dokumentu skočila a s ňou pozícia — kto bol dole, ocitol sa
   *      na konci stránky.
   *
   * Rieši sa to na všetkých troch miestach: ignoreMobileResize povie GSAP-u,
   * aby zmenu od adresného riadku nepovažoval za skutočný resize; vlastný
   * prepočet nižšie sa spúšťa len pri zmene šírky; a dĺžky pripnutých sekcií
   * sa počítajú z výšky zapamätanej pri načítaní, nie z aktuálnej.
   */
  ScrollTrigger.config({ ignoreMobileResize: true });

  // Zapamätaná výška okna. Adresný riadok ju počas skrolovania mení, takže
  // čítať ju pri každom prepočte by rozhýbalo celú stránku pod prstom.
  var stabilnaVyska = window.innerHeight;
  var canSplit = typeof window.SplitText !== "undefined";
  if (canSplit) gsap.registerPlugin(SplitText);
  var canDraw = typeof window.DrawSVGPlugin !== "undefined";
  if (canDraw) gsap.registerPlugin(DrawSVGPlugin);

  /* ================================================== 1. PREDOHRA */

  var seenLeader = false;
  try { seenLeader = sessionStorage.getItem("vz-kino-leader") === "1"; } catch (e) {}

  function heroIntro() {
    var tl = gsap.timeline({ defaults: { ease: "power4.out" } });

    tl.from(".hero__title .ln > span", {
      yPercent: 118,
      duration: 1.15,
      stagger: 0.09,
    })
      .to('[data-hero="meta"]', { autoAlpha: 1, y: 0, duration: 0.8 }, 0.15)
      .to('[data-hero="specs"]', { autoAlpha: 1, y: 0, duration: 0.8 }, "-=0.55")
      .to('[data-hero="cta"]', { autoAlpha: 1, y: 0, duration: 0.8 }, "-=0.6")
      .to('[data-hero="hint"]', { autoAlpha: 1, duration: 0.6 }, "-=0.5")
      .to("#beam", { opacity: 1, duration: 2.2, ease: "power1.inOut" }, "-=1.2");

    return tl;
  }

  // Počiatočné stavy, nech nič neprebliskne pred spustením timeline.
  /*
   * Bez predohry (telefón) sa úvodný text neschováva. Keby sa schoval, čakal
   * by na stiahnutie GSAP a najväčší prvok na obrazovke by naskočil o sekundy
   * neskôr. Na veľkej obrazovke ostáva nábeh zachovaný.
   */
  var noIntro = document.documentElement.classList.contains("no-intro");
  if (!noIntro) {
    gsap.set('[data-hero="meta"], [data-hero="specs"], [data-hero="cta"], [data-hero="hint"]', {
      autoAlpha: 0,
      y: 26,
    });
  }

  function playLeader() {
    document.body.classList.add("is-locked");
    var num = $("leaderNum");
    var sweep = document.querySelector(".leader__ring .sweep");
    var tl = gsap.timeline({
      onComplete: function () {
        dropLeader();
        try { sessionStorage.setItem("vz-kino-leader", "1"); } catch (e) {}
      },
    });

    [3, 2, 1].forEach(function (n, i) {
      tl.call(function () { num.textContent = String(n); }, null, i * 0.5)
        .fromTo(
          num,
          { scale: 1.35, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.24, ease: "power3.out" },
          i * 0.5
        )
        // Kruh má pathLength="1", takže dasharray ide priamo od 0 do 1.
        .fromTo(
          sweep,
          { strokeDasharray: "0 1" },
          { strokeDasharray: "1 1", duration: 0.5, ease: "none" },
          i * 0.5
        )
        .to(num, { autoAlpha: 0, duration: 0.14 }, i * 0.5 + 0.4);
    });

    tl.to("#leader", { autoAlpha: 0, duration: 0.35 }, 1.55)
      .to(
        "#iris span:first-child",
        { yPercent: -100, duration: 0.95, ease: "power4.inOut" },
        1.6
      )
      .to(
        "#iris span:last-child",
        { yPercent: 100, duration: 0.95, ease: "power4.inOut" },
        1.6
      )
      .add(heroIntro(), 1.95);

    return tl;
  }

  if (noIntro) {
    dropLeader(); // text je viditeľný z CSS, netreba ho nič odhaľovať
  } else if (seenLeader) {
    dropLeader();
    heroIntro();
  } else {
    playLeader();
  }

  /* ================================================== 2. HLAVIČKA */

  ScrollTrigger.create({
    start: "top -80",
    end: 99999,
    onToggle: function (self) {
      $("masthead").classList.toggle("is-stuck", self.isActive);
    },
  });

  /* ================================================== 3. HERO */

  // Video sa hýbe pomalšie než stránka — hĺbka bez toho, aby si to všimol.
  gsap.to("#heroMedia", {
    yPercent: 14,
    ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
  });

  gsap.to(".hero__inner", {
    yPercent: -18,
    autoAlpha: 0.15,
    ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
  });

  // Prach v lúči projektora. Málo častíc, dlhé dráhy — inak to vyzerá ako sneh.
  (function motes() {
    var beam = $("beam");
    if (!beam) return;
    for (var i = 0; i < 14; i += 1) {
      var m = document.createElement("span");
      m.className = "mote";
      beam.appendChild(m);
      gsap.set(m, { x: gsap.utils.random(0, beam.offsetWidth), y: gsap.utils.random(0, beam.offsetHeight) });
      gsap.to(m, {
        x: "+=" + gsap.utils.random(-140, -40),
        y: "+=" + gsap.utils.random(-60, 60),
        opacity: gsap.utils.random(0.15, 0.7),
        duration: gsap.utils.random(9, 18),
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: gsap.utils.random(0, 6),
      });
    }
  })();

  gsap.to("#scrollBar", {
    scaleY: 0.15,
    transformOrigin: "bottom",
    duration: 1.4,
    repeat: -1,
    yoyo: true,
    ease: "power2.inOut",
  });

  /* ================================================== 4. ODHAĽOVANIE */

  function revealBatch() {
    /*
     * Bez predohry sa úvod z odhaľovania vynecháva. Je to prvé, čo je na
     * obrazovke vidieť, a čakať s ním na stiahnutie GSAP znamená mať niekoľko
     * sekúnd prázdny úvod. Zvyšok stránky nabieha ako predtým.
     */
    var targetsAll = gsap.utils.toArray(".reveal").filter(function (n) {
      return !noIntro || !n.closest(".hero");
    });
    if (!targetsAll.length) return;

    // Posun sa nastaví skôr, než batch vznikne — inak by prvky viditeľné pri
    // načítaní odštartovali z nuly a trhlo by nimi.
    gsap.set(targetsAll, { y: 34 });
    ScrollTrigger.batch(targetsAll, {
      start: "top 88%",
      once: true,
      onEnter: function (targets) {
        gsap.to(targets, {
          autoAlpha: 1,
          y: 0,
          duration: 0.95,
          stagger: 0.08,
          ease: "power3.out",
          overwrite: true,
        });
      },
    });
  }

  gsap.utils.toArray(".eyebrow").forEach(function (row) {
    gsap.fromTo(
      row,
      { "--eyebrow-scale": 0 },
      {
        "--eyebrow-scale": 1,
        duration: 1.1,
        ease: "power2.inOut",
        scrollTrigger: { trigger: row, start: "top 85%", once: true },
      }
    );
  });

  /* ================================================== 5. SÚMRAK → NOC */

  (function duskScene() {
    var section = document.querySelector(".dusk");
    var scene = $("duskScene");
    if (!section || !scene) return;

    var beats = $$(".beat", section);
    var fill = $("duskFill");

    // Hranice momentov. Prvý beží od začiatku, takže scéna nie je nikdy bez textu.
    var marks = [0, 0.42, 0.72];

    // Východiskový stav: prázdna záhrada, plátno ešte leží zrolované.
    gsap.set("#gScreen", { scaleY: 0.02, svgOrigin: "670 600" });
    gsap.set(["#gGuy", "#gPeople", "#gLantern", "#gScreenGlow"], { autoAlpha: 0 });
    gsap.set("#gKit", { autoAlpha: 0 });
    gsap.set("#duskSurface", { fill: "color-mix(in oklab, var(--ivory) 8%, transparent)" });

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: "top top",
        // Pevná dĺžka v pixeloch namiesto „+=300%". Percentá sa počítajú
        // z výšky okna a tá sa na mobile mení pri každom skrolovaní.
        end: "+=" + stabilnaVyska * 3,
        pin: true,
        scrub: 0.7,
        anticipatePin: 1,
        onUpdate: function (self) {
          var p = self.progress;
          if (fill) fill.style.setProperty("--p", String(p));
          var active = 0;
          for (var i = marks.length - 1; i >= 0; i -= 1) {
            if (p >= marks[i]) { active = i; break; }
          }
          beats.forEach(function (beat, i) {
            beat.classList.toggle("is-on", i === active);
          });
        },
      },
    });

    /* 17:00 — technika dorazí a postaví sa. */
    if (canDraw) {
      tl.from("#gGround path", { drawSVG: 0, duration: 0.07, ease: "none" }, 0)
        .from("#gHedge path, #gTree path, #gTree circle", { drawSVG: 0, duration: 0.08, stagger: 0.01, ease: "none" }, 0.03)
        .from("#gHouse path, #gHouse rect", { drawSVG: 0, duration: 0.08, stagger: 0.012, ease: "none" }, 0.05);
    } else {
      tl.from("#gGround, #gHedge, #gTree, #gHouse", { autoAlpha: 0, duration: 0.08, stagger: 0.02 }, 0);
    }

    // Kufor a zrolované plátno sú na zemi hneď od začiatku — technika dorazila.
    tl.to("#gBundle", { autoAlpha: 0, duration: 0.05 }, 0.2)
      .to("#gScreen", { scaleY: 1, duration: 0.12, ease: "power2.out" }, 0.19)
      .to("#gGuy", { autoAlpha: 1, duration: 0.06 }, 0.3)
      .to("#gKit", { autoAlpha: 1, duration: 0.07 }, 0.34);

    /* 21:30 — zotmie sa a projektor sa rozsvieti. */
    tl.to("#duskNight", { opacity: 1, duration: 0.13, ease: "none" }, 0.42)
      .to("#duskStars", { opacity: 1, duration: 0.12, ease: "none" }, 0.45)
      .to("#gScreenGlow", { autoAlpha: 1, duration: 0.1 }, 0.46)
      .to("#duskSurface", { fill: "color-mix(in oklab, var(--ivory) 82%, transparent)", duration: 0.09 }, 0.47)
      .to("#gPeople", { autoAlpha: 1, duration: 0.08 }, 0.51)
      .to("#gLantern", { autoAlpha: 1, duration: 0.08 }, 0.53);

    /* 10:00 — ráno sa všetko zloží späť do kufra. */
    tl.to("#gScreenGlow", { autoAlpha: 0, duration: 0.07 }, 0.74)
      .to("#duskSurface", { fill: "color-mix(in oklab, var(--ivory) 8%, transparent)", duration: 0.07 }, 0.74)
      .to("#gPeople", { autoAlpha: 0, duration: 0.06 }, 0.75)
      .to("#gLantern", { autoAlpha: 0, duration: 0.06 }, 0.76)
      .to("#duskStars", { opacity: 0, duration: 0.08, ease: "none" }, 0.79)
      .to("#duskNight", { opacity: 0.35, duration: 0.09, ease: "none" }, 0.79)
      .to("#gGuy", { autoAlpha: 0, duration: 0.05 }, 0.83)
      .to("#gScreen", { scaleY: 0.02, duration: 0.1, ease: "power2.in" }, 0.85)
      .to("#gBundle", { autoAlpha: 1, duration: 0.06 }, 0.9);
  })();

  /* Mierkový výkres v príbehu sa nakreslí, keď naň prídeš. */
  (function scaleDrawing() {
    var svg = document.querySelector(".draw--scale");
    if (!svg) return;

    var tl = gsap.timeline({
      scrollTrigger: { trigger: svg, start: "top 78%", once: true },
      defaults: { ease: "none" },
    });

    if (canDraw) {
      tl.from(svg.querySelectorAll(".draw__ground .d-line"), { drawSVG: 0, duration: 0.7 })
        .from(svg.querySelectorAll(".draw__ground .d-hatch"), { drawSVG: 0, duration: 0.5 }, "-=0.4")
        .from(svg.querySelectorAll(".draw__object .d-frame"), { drawSVG: 0, duration: 0.8, ease: "power1.inOut" }, "-=0.3")
        .from(svg.querySelectorAll(".draw__dims .d-dim, .draw__dims .d-tick, .draw__dims .d-ext, .draw__plot .d-plot, .draw__plot .d-tick"),
              { drawSVG: 0, duration: 0.6, stagger: 0.04 }, "-=0.25");
    } else {
      tl.from(svg.querySelectorAll("g"), { autoAlpha: 0, duration: 0.5, stagger: 0.08 });
    }

    tl.from(svg.querySelector(".d-surface"), { autoAlpha: 0, duration: 0.5 }, "-=0.6")
      .from(svg.querySelectorAll(".draw__figure circle, .draw__figure path"),
            { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.04, ease: "power2.out" }, "-=0.4")
      .from(svg.querySelector(".d-diag"), { autoAlpha: 0, duration: 0.4 }, "-=0.3")
      .from(svg.querySelectorAll(".d-num"), { autoAlpha: 0, duration: 0.45, stagger: 0.07, ease: "power2.out" }, "-=0.3");
  })();

  /* ================================================== 6. CIEVKA OBSAHU */

  (function reel() {
    var section = document.querySelector(".reel");
    var track = $("reelTrack");
    if (!section || !track) return;

    var getShift = function () {
      return Math.max(0, track.scrollWidth - window.innerWidth);
    };

    gsap.to(track, {
      x: function () { return -getShift(); },
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        // Aj tu vstupuje zapamätaná výška, nie aktuálna.
        end: function () { return "+=" + (getShift() + stabilnaVyska * 0.5); },
        pin: true,
        scrub: 0.8,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });
  })();

  /* ================================================== 7. ZAPOJENIE */

  (function setup() {
    var list = $("setupSteps");
    var spine = $("setupSpine");
    if (!list || !spine) return;

    gsap.to(spine, {
      scaleY: 1,
      ease: "none",
      scrollTrigger: {
        trigger: list,
        start: "top 72%",
        end: "bottom 78%",
        scrub: 0.5,
      },
    });

    $$(".step", list).forEach(function (step) {
      ScrollTrigger.create({
        trigger: step,
        start: "top 76%",
        onEnter: function () { step.classList.add("is-on"); },
        onLeaveBack: function () { step.classList.remove("is-on"); },
      });
      gsap.from(step, {
        autoAlpha: 0,
        y: 28,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: { trigger: step, start: "top 82%", once: true },
      });
    });

    // Odpočet 10 minút sa naozaj odpočíta.
    var clock = $("setupClock");
    if (clock) {
      var out = { n: 0 };
      var small = clock.querySelector("small");
      gsap.to(out, {
        n: 10,
        duration: 1.4,
        ease: "power2.out",
        scrollTrigger: { trigger: clock, start: "top 80%", once: true },
        onUpdate: function () {
          clock.firstChild.nodeValue = String(Math.round(out.n));
        },
      });
      if (small) gsap.from(small, {
        autoAlpha: 0,
        duration: 0.6,
        scrollTrigger: { trigger: clock, start: "top 80%", once: true },
      });
    }
  })();

  /* ================================================== 8. KALENDÁR A LÍSTOK */

  document.addEventListener("kino:calendar", function () {
    var cells = $$("#calGrid .day:not(.day--empty)");
    gsap.fromTo(
      cells,
      { autoAlpha: 0, scale: 0.86 },
      {
        autoAlpha: 1,
        scale: 1,
        duration: 0.5,
        ease: "power3.out",
        stagger: { each: 0.008, from: "start" },
        overwrite: true,
      }
    );
  });

  document.addEventListener("kino:pick", function (event) {
    var cell = event.detail && event.detail.cell;
    if (!cell) return;
    gsap.fromTo(cell, { scale: 0.82 }, { scale: 1, duration: 0.55, ease: "elastic.out(1, 0.55)" });
  });

  document.addEventListener("kino:ticket", function () {
    var ticket = $("ticket");
    if (!ticket) return;
    gsap
      .timeline()
      .from(ticket, { autoAlpha: 0, y: 40, duration: 0.7, ease: "power3.out" })
      .from(ticket.querySelectorAll("dt, dd"), {
        autoAlpha: 0,
        x: -14,
        duration: 0.45,
        stagger: 0.05,
        ease: "power2.out",
      }, "-=0.3")
      .from(".ticket__stamp", {
        scale: 1.6,
        autoAlpha: 0,
        rotate: -8,
        duration: 0.55,
        ease: "back.out(2)",
      }, "-=0.45");
    ScrollTrigger.refresh();
  });

  /* ================================================== 9. KURZOR */

  (function cursor() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var dot = $("cursor");
    if (!dot) return;

    var setX = gsap.quickTo(dot, "x", { duration: 0.35, ease: "power3" });
    var setY = gsap.quickTo(dot, "y", { duration: 0.35, ease: "power3" });

    window.addEventListener("pointermove", function (e) {
      gsap.to(dot, { autoAlpha: 1, duration: 0.3, overwrite: "auto" });
      setX(e.clientX);
      setY(e.clientY);
    }, { passive: true });

    document.addEventListener("pointerover", function (e) {
      var interactive = e.target.closest("a, button, input, select, textarea, .day--free");
      gsap.to(dot, { scale: interactive ? 2.1 : 1, duration: 0.3, ease: "power3.out" });
    });

    window.addEventListener("blur", function () {
      gsap.to(dot, { autoAlpha: 0, duration: 0.2 });
    });
  })();

  /* ================================================== 10. TYPOGRAFIA */

  function splitHeadings() {
    if (!canSplit) return;
    // Nadpis vo vodorovnej cievke sa hýbe spolu s pripnutým trackom, takže
    // ScrollTrigger naviazaný priamo naň by počítal nezmysly — ten vynechávame.
    $$(".h-section:not(.reel .h-section)").forEach(function (heading) {
      var split = new SplitText(heading, { type: "lines", mask: "lines", linesClass: "sp-line" });
      gsap.from(split.lines, {
        yPercent: 110,
        duration: 1,
        stagger: 0.08,
        ease: "power4.out",
        scrollTrigger: { trigger: heading, start: "top 86%", once: true },
      });
      heading.classList.remove("reveal");
      heading.style.opacity = "1";
    });
  }

  /* ------------------------------------------- štart po načítaní fontov */

  var start = function () {
    splitHeadings();
    revealBatch();
    ScrollTrigger.refresh();
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start);
  } else {
    window.addEventListener("load", start);
  }

  /*
   * Prepočítava sa len pri zmene šírky, teda pri otočení telefónu alebo pri
   * ťahaní okna na počítači. Pôvodne sa reagovalo na každý resize, lenže ten
   * na mobile vyvoláva už samotné skrolovanie, keď sa schováva adresný riadok.
   * Prepočet potom menil výšku dokumentu a stránka pod prstom poskakovala.
   */
  var lastWidth = window.innerWidth;
  var resizeTimer;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { ScrollTrigger.refresh(); }, 200);
  });
})();
