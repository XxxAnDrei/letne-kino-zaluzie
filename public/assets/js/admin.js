/* ============================================================================
   Správcovský panel. Všetky zmenové volania nesú hlavičku X-Requested-With,
   ktorú bežný cross-site formulár nevie nastaviť — spolu so SameSite=Lax
   cookie to stačí ako ochrana proti CSRF.
   ========================================================================= */
(function () {
  "use strict";

  var MONTHS_GEN = [
    "januára", "februára", "marca", "apríla", "mája", "júna",
    "júla", "augusta", "septembra", "októbra", "novembra", "decembra",
  ];
  var DAYS = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"];

  var STATUS = {
    pending: "Čaká",
    approved: "Potvrdené",
    rejected: "Zamietnuté",
    cancelled: "Zrušené",
    done: "Vybavené",
    moved: "Presunuté",
  };
  var FILTERS = [
    ["", "Všetky"],
    ["pending", "Čakajú"],
    ["approved", "Potvrdené"],
    ["done", "Vybavené"],
    ["rejected", "Zamietnuté"],
    ["cancelled", "Zrušené"],
    ["moved", "Presunuté"],
  ];

  /* Odovzdávací zoznam — predvyplní sa pri prevzatí aj vrátení. */
  var KIT = [
    "plátno", "ventilátor", "projektor", "reproduktor", "diaľkové ovládače",
    "káble", "predlžovací kábel", "upevňovacie laná", "kolíky", "návod",
  ];

  var $ = function (id) { return document.getElementById(id); };
  var state = { filter: "", q: "", today: null, rows: [], counts: {} };

  /* ------------------------------------------------------------- pomocné */

  function api(path, options) {
    var opts = options || {};
    opts.headers = Object.assign(
      { Accept: "application/json" },
      opts.headers,
      opts.method && opts.method !== "GET"
        ? { "Content-Type": "application/json", "X-Requested-With": "kino-admin" }
        : {}
    );
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) {
        showLogin();
        throw new Error("odhlásené");
      }
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || "Chyba " + r.status);
        return body;
      });
    });
  }

  function parseIso(iso) {
    var p = String(iso).split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  function longDate(iso) {
    var d = parseIso(iso);
    return DAYS[(d.getUTCDay() + 6) % 7] + " " + d.getUTCDate() + ". " + MONTHS_GEN[d.getUTCMonth()];
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var toastTimer;
  function toast(message, bad) {
    var node = $("toast");
    node.hidden = false;
    node.textContent = message;
    node.classList.toggle("is-bad", !!bad);
    if (window.gsap) {
      gsap.killTweensOf(node);
      gsap.fromTo(
        node,
        { y: 120, xPercent: -50 },
        { y: 0, xPercent: -50, duration: 0.45, ease: "power3.out" }
      );
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (window.gsap) {
        gsap.to(node, { y: 120, duration: 0.35, ease: "power3.in", onComplete: function () { node.hidden = true; } });
      } else {
        node.hidden = true;
      }
    }, 2600);
  }

  /* --------------------------------------------------------- prihlásenie */

  function showLogin() {
    $("login").hidden = false;
    $("panel").hidden = true;
    $("password").focus();
  }

  function showPanel() {
    $("login").hidden = true;
    $("panel").hidden = false;
    loadAll();
  }

  $("loginForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var err = $("loginError");
    err.hidden = true;
    $("loginBtn").disabled = true;

    fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    })
      .then(function (r) {
        return r.json().then(function (b) { return { ok: r.ok, body: b }; });
      })
      .then(function (res) {
        if (!res.ok) {
          err.hidden = false;
          err.textContent = res.body.error || "Prihlásenie zlyhalo.";
          return;
        }
        $("password").value = "";
        showPanel();
      })
      .catch(function () {
        err.hidden = false;
        err.textContent = "Server neodpovedá.";
      })
      .finally(function () { $("loginBtn").disabled = false; });
  });

  $("logout").addEventListener("click", function () {
    fetch("/api/admin/logout", { method: "POST" }).finally(showLogin);
  });

  /* ------------------------------------------------------------ zoznam */

  /*
   * Pri štarte sa ťahá len zoznam žiadostí. Zvyšok žije v okne nastavení
   * a načíta sa až pri jeho otvorení — panel sa tak otvorí na jeden dopyt
   * namiesto piatich.
   */
  function loadAll() {
    loadReservations();
  }

  /* ------------------------------------------------------------- e-maily */

  /*
   * Bez tohto sa nefunkčné odosielanie hľadá naslepo: stránka vyzerá rovnako,
   * či e-mail odišiel alebo nie. Tu je vidieť, čo je nastavené, a skúšobná
   * správa vráti presnú odpoveď od Brevo.
   */
  function loadMailState() {
    var box = $("mailState");
    if (!box) return;
    api("/api/admin/mail")
      .then(function (s) {
        if (!s.pripravene) {
          box.innerHTML =
            "<b>E-maily sa neposielajú.</b> Chýba: " +
            esc(s.chyba.join(", ")) +
            ". Doplň to v nastaveniach hostingu a nasaď znova.";
          return;
        }
        var pozn = s.klucVyzeraAkoBrevo
          ? ""
          : " Pozor: kľúč nezačína na xkeysib, nemusí to byť API kľúč.";
        box.innerHTML =
          "Odosielateľ <b>" + esc(s.odosielatel) + "</b>, upozornenia chodia na <b>" +
          esc(s.upozorneniaNa || "—") + "</b>." + esc(pozn);
      })
      .catch(function (e) { if (e.message !== "odhlásené") box.textContent = e.message; });
  }

  $("mailTest").addEventListener("click", function () {
    var btn = $("mailTest");
    btn.disabled = true;
    api("/api/admin/mail/test", { method: "POST" })
      .then(function (r) { toast("Skúšobný e-mail odoslaný na " + r.odoslaneNa + "."); })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); })
      .then(function () { btn.disabled = false; });
  });

  /*
   * Pripomienky púšťa raz denne Vercel Cron. Tlačidlo robí to isté ručne —
   * inak sa dá na funkčnosť čakať do najbližšieho rána. Opakované stlačenie
   * nič nepošle druhýkrát, o to sa stará značka reminded_at na serveri.
   */
  $("cronRun").addEventListener("click", function () {
    var btn = $("cronRun");
    btn.disabled = true;
    api("/api/cron/reminders", { method: "POST" })
      .then(function (r) {
        var sprava = r.poslane
          ? "Odoslaných pripomienok: " + r.poslane + "."
          : "Na dnes ani zajtra nie je čo pripomínať.";
        if (r.preskocene) sprava += " Nepodarilo sa: " + r.preskocene + ".";
        if (r.nepotvrdene && r.nepotvrdene.length) {
          sprava +=
            " Pozor, nepotvrdené na dnes/zajtra: " +
            r.nepotvrdene.map(function (x) { return x.ref; }).join(", ") + ".";
        }
        toast(sprava, Boolean(r.preskocene));
      })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); })
      .then(function () { btn.disabled = false; });
  });

  /* ------------------------------------------------- určenie termínov */

  var SCOPE_LABEL = { zaluzie: "iba Veľké Zálužie", all: "aj okolité obce", approval: "po dohode" };

  function loadSlotRules() {
    api("/api/admin/slot-rules")
      .then(function (data) {
        $("srList").innerHTML = data.rules.length
          ? data.rules
              .map(function (r) {
                return (
                  "<li><time>" + esc(r.date) + "</time><span>" +
                  esc(SCOPE_LABEL[r.scope] || r.scope) +
                  '</span><button type="button" data-sr="' + esc(r.date) +
                  '" aria-label="Zrušiť pravidlo">×</button></li>'
                );
              })
              .join("")
          : "<li><span>Všetky termíny podľa predvoleného nastavenia.</span></li>";
      })
      .catch(function () {});
  }

  $("srAdd").addEventListener("click", function () {
    var date = $("srDate").value;
    if (!date) return toast("Vyber dátum.", true);
    api("/api/admin/slot-rules", {
      method: "POST",
      body: JSON.stringify({ date: date, scope: $("srScope").value }),
    })
      .then(function () {
        $("srDate").value = "";
        toast("Určenie termínu uložené.");
        loadSlotRules();
      })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  $("srList").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-sr]");
    if (!btn) return;
    api("/api/admin/slot-rules/" + btn.dataset.sr, { method: "DELETE" })
      .then(function () { toast("Pravidlo zrušené."); loadSlotRules(); })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  /* --------------------------------------------------- blokované kontakty */

  function loadBlocklist() {
    api("/api/admin/blocklist")
      .then(function (data) {
        $("blList").innerHTML = data.entries.length
          ? data.entries
              .map(function (b) {
                return (
                  "<li><time>" + esc(b.value) + "</time><span>" + esc(b.reason || "") +
                  '</span><button type="button" data-bl="' + b.id +
                  '" aria-label="Odblokovať">×</button></li>'
                );
              })
              .join("")
          : "<li><span>Žiadne blokované kontakty.</span></li>";
      })
      .catch(function () {});
  }

  $("blAdd").addEventListener("click", function () {
    var value = $("blValue").value.trim();
    if (!value) return toast("Zadaj telefón alebo e-mail.", true);
    api("/api/admin/blocklist", {
      method: "POST",
      body: JSON.stringify({ value: value, reason: $("blReason").value }),
    })
      .then(function () {
        $("blValue").value = "";
        $("blReason").value = "";
        toast("Kontakt zablokovaný.");
        loadBlocklist();
      })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  $("blList").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-bl]");
    if (!btn) return;
    api("/api/admin/blocklist/" + btn.dataset.bl, { method: "DELETE" })
      .then(function () { toast("Odblokované."); loadBlocklist(); })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  function loadReservations() {
    var params = new URLSearchParams();
    if (state.filter) params.set("status", state.filter);
    if (state.q) params.set("q", state.q);

    api("/api/admin/reservations?" + params.toString())
      .then(function (data) {
        state.rows = data.reservations;
        state.counts = data.counts;
        state.today = data.today;
        renderFilters();
        renderList();
      })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  }

  function renderFilters() {
    var total = Object.keys(state.counts).reduce(function (sum, k) {
      return sum + state.counts[k];
    }, 0);
    $("filters").innerHTML = FILTERS.map(function (f) {
      var n = f[0] === "" ? total : state.counts[f[0]] || 0;
      return (
        '<button type="button" data-filter="' + f[0] + '" aria-pressed="' +
        (state.filter === f[0]) + '">' + f[1] + "<b>" + n + "</b></button>"
      );
    }).join("");
  }

  function renderList() {
    var list = $("list");
    if (!state.rows.length) {
      list.innerHTML = '<div class="empty">Zatiaľ tu nič nie je.</div>';
      return;
    }

    list.innerHTML = state.rows.map(renderRow).join("");

    if (window.gsap) {
      gsap.from(list.querySelectorAll(".res"), {
        autoAlpha: 0,
        y: 14,
        duration: 0.45,
        stagger: 0.035,
        ease: "power2.out",
      });
    }
  }

  function renderRow(r) {
    var isPast = r.date < state.today;
    var flags = [
      ["plnoletosť", r.confirm_adult],
      ["návod", r.confirm_manual],
      ["obsah", r.confirm_content],
      ["podmienky", r.confirm_terms],
      ["gdpr", r.confirm_privacy],
    ]
      .map(function (f) {
        return '<span class="flag ' + (f[1] ? "on" : "off") + '">' + f[0] + "</span>";
      })
      .join("");
    if (r.handout_at) flags += '<span class="flag on">prevzaté</span>';
    if (r.return_at) flags += '<span class="flag on">vrátené</span>';

    var notes = "";
    if (r.note) notes += "<b>Poznámka žiadateľa:</b> " + esc(r.note) + "<br />";
    if (r.backup_date) notes += "<b>Náhradný termín:</b> " + esc(longDate(r.backup_date)) + "<br />";
    if (r.moved_from) notes += "<b>Presunuté z:</b> " + esc(longDate(r.moved_from)) + "<br />";
    if (r.condition_note) notes += "<b>Stav vybavenia:</b> " + esc(r.condition_note);

    return (
      '<article class="res" data-id="' + r.id + '">' +
      '<div class="res__top">' +
        '<div class="res__when">' +
          '<span class="res__day">' + parseIso(r.date).getUTCDate() + ". " +
            MONTHS_GEN[parseIso(r.date).getUTCMonth()].slice(0, 3) + "</span>" +
          '<span class="meta">' + esc(r.date) + "</span>" +
          '<span class="meta">' + esc(r.ref) + "</span>" +
        "</div>" +
        '<div class="res__who">' +
          '<span class="res__name">' + esc(r.name) + "</span>" +
          '<div class="res__facts">' +
            '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + "</a>" +
            '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>" +
            "<span>" + esc(r.municipality) + "</span>" +
            "<span>" + esc(r.address) + "</span>" +
          "</div>" +
          '<div class="res__flags">' + flags + "</div>" +
        "</div>" +
        '<span class="chip chip--' + esc(r.status) + '">' +
          (STATUS[r.status] || esc(r.status)) + (isPast ? " · po termíne" : "") +
        "</span>" +
      "</div>" +
      (notes ? '<p class="res__note">' + notes + "</p>" : "") +
      '<div class="res__actions">' +
        '<button class="act act--ok" data-do="approved"' + (r.status === "approved" ? " disabled" : "") + ">Potvrdiť</button>" +
        '<button class="act act--no" data-do="rejected"' + (r.status === "rejected" ? " disabled" : "") + ">Zamietnuť</button>" +
        '<button class="act" data-do="cancelled"' + (r.status === "cancelled" ? " disabled" : "") + ">Zrušiť</button>" +
        '<button class="act" data-do="done"' + (r.status === "done" ? " disabled" : "") + ">Vybavené</button>" +
        '<button class="act" data-move title="Preložiť na náhradný termín pri zlom počasí">Presunúť</button>' +
        '<button class="act" data-hand="handout"' + (r.handout_at ? " disabled" : "") + ">Prevzatie</button>" +
        '<button class="act" data-hand="return"' + (r.return_at ? " disabled" : "") + ">Vrátenie</button>" +
        '<input class="act act--note" data-note placeholder="Interná poznámka…" value="' + esc(r.admin_note || "") + '" />' +
        '<button class="act act--no" data-del title="Nenávratne zmazať">Zmazať</button>' +
      "</div>" +
      "</article>"
    );
  }

  $("filters").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    loadReservations();
  });

  var searchTimer;
  $("search").addEventListener("input", function (event) {
    clearTimeout(searchTimer);
    var value = event.target.value;
    searchTimer = setTimeout(function () {
      state.q = value;
      loadReservations();
    }, 250);
  });

  $("list").addEventListener("click", function (event) {
    var card = event.target.closest(".res");
    if (!card) return;
    var id = card.dataset.id;

    var action = event.target.closest("button[data-do]");
    if (action) {
      api("/api/admin/reservations/" + id, {
        method: "PATCH",
        body: JSON.stringify({ status: action.dataset.do }),
      })
        .then(function () {
          toast("Stav zmenený na „" + STATUS[action.dataset.do] + "”.");
          loadReservations();
        })
        .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
      return;
    }

    if (event.target.closest("button[data-move]")) {
      var when = window.prompt(
        "Presunúť na dátum (RRRR-MM-DD). Prázdne = náhradný termín zo žiadosti."
      );
      if (when === null) return;
      api("/api/admin/reservations/" + id + "/move", {
        method: "POST",
        body: JSON.stringify(when.trim() ? { date: when.trim() } : {}),
      })
        .then(function (res) {
          toast("Presunuté na " + res.reservation.date + ".");
          loadReservations();
        })
        .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
      return;
    }

    var hand = event.target.closest("button[data-hand]");
    if (hand) {
      var phase = hand.dataset.hand;
      var picked = window.prompt(
        (phase === "handout" ? "Odovzdávané" : "Vrátené") +
          " položky, oddelené čiarkou:",
        KIT.join(", ")
      );
      if (picked === null) return;
      var cond = window.prompt("Stav vybavenia alebo poznámka:", "") || "";
      api("/api/admin/reservations/" + id + "/handover", {
        method: "POST",
        body: JSON.stringify({
          phase: phase,
          items: picked.split(",").map(function (v) { return v.trim(); }).filter(Boolean),
          conditionNote: cond,
        }),
      })
        .then(function () {
          toast(phase === "handout" ? "Prevzatie zapísané." : "Vrátenie zapísané.");
          loadReservations();
        })
        .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
      return;
    }

    if (event.target.closest("button[data-del]")) {
      if (!window.confirm("Naozaj natrvalo zmazať túto rezerváciu?")) return;
      api("/api/admin/reservations/" + id, { method: "DELETE" })
        .then(function () {
          toast("Rezervácia zmazaná.");
          loadReservations();
        })
        .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
    }
  });

  $("list").addEventListener("change", function (event) {
    var input = event.target.closest("input[data-note]");
    if (!input) return;
    var id = input.closest(".res").dataset.id;
    api("/api/admin/reservations/" + id, {
      method: "PATCH",
      body: JSON.stringify({ adminNote: input.value }),
    })
      .then(function () { toast("Poznámka uložená."); })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  /* --------------------------------------------------------- blokácie */

  function loadBlackouts() {
    api("/api/admin/blackouts")
      .then(function (data) {
        $("boList").innerHTML = data.blackouts.length
          ? data.blackouts
              .map(function (b) {
                return (
                  "<li><time>" + esc(b.date) + "</time><span>" + esc(b.reason || "") +
                  '</span><button type="button" data-bo="' + b.id + '" aria-label="Odblokovať">×</button></li>'
                );
              })
              .join("")
          : '<li><span>Žiadne zablokované dni.</span></li>';
      })
      .catch(function () {});
  }

  $("boAdd").addEventListener("click", function () {
    var date = $("boDate").value;
    var dateTo = $("boDateTo").value;
    if (!date) return toast("Vyber dátum od.", true);
    if (dateTo && dateTo < date) return toast("Dátum do je skôr než dátum od.", true);
    api("/api/admin/blackouts", {
      method: "POST",
      body: JSON.stringify({ date: date, dateTo: dateTo || date, reason: $("boReason").value }),
    })
      .then(function (r) {
        $("boDate").value = "";
        $("boDateTo").value = "";
        $("boReason").value = "";
        toast(r.pocet > 1 ? "Zablokovaných " + r.pocet + " dní." : "Termín zablokovaný.");
        loadBlackouts();
      })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  /* ------------------------------------------------------------- nastavenia */

  var dlg = $("settingsDlg");
  $("settingsOpen").addEventListener("click", function () {
    // Údaje sa načítajú až pri otvorení, nech štart panela nezdržujú.
    loadBlackouts();
    loadSlotRules();
    loadBlocklist();
    loadSettings();
    loadMailState();
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
  });
  $("settingsClose").addEventListener("click", function () { dlg.close(); });
  // Kliknutie mimo obsahu zavrie okno; dialog sám vracia kliky na podklad.
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg) dlg.close();
  });

  $("boList").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-bo]");
    if (!btn) return;
    api("/api/admin/blackouts/" + btn.dataset.bo, { method: "DELETE" })
      .then(function () {
        toast("Blokácia zrušená.");
        loadBlackouts();
      })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  /* -------------------------------------------------------- nastavenia */

  function loadSettings() {
    api("/api/admin/settings")
      .then(function (data) {
        var s = data.settings;
        $("setSeasonStart").value = s.seasonStart;
        $("setSeasonEnd").value = s.seasonEnd;
        $("setPickup").value = s.pickupTime;
        $("setReturn").value = s.returnTime;
        $("setLead").value = s.leadDays;
        $("setHorizon").value = s.horizonDays;
        $("setScope").value = s.defaultScope;
        $("setHome").value = s.homeMunicipality;
        $("setPaused").checked = s.paused;
        $("ozName").value = s.oz.name;
        $("ozIban").value = s.oz.iban;
        $("ozNote").value = s.oz.note;
        $("ozIco").value = s.oz.ico;
        $("ozBank").value = s.oz.bank;
        $("ozAddress").value = s.oz.address;
        $("ozRegistration").value = s.oz.registration;
      })
      .catch(function () {});
  }

  $("ozSave").addEventListener("click", function () {
    api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        oz_name: $("ozName").value,
        oz_iban: $("ozIban").value.replace(/\s+/g, ""),
        pay_note: $("ozNote").value,
        oz_ico: $("ozIco").value,
        oz_bank: $("ozBank").value,
        oz_address: $("ozAddress").value,
        oz_registration: $("ozRegistration").value,
      }),
    })
      .then(function () { toast("Údaje združenia uložené."); })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  $("setSave").addEventListener("click", function () {
    api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        season_start: $("setSeasonStart").value,
        season_end: $("setSeasonEnd").value,
        pickup_time: $("setPickup").value,
        return_time: $("setReturn").value,
        lead_days: $("setLead").value,
        horizon_days: $("setHorizon").value,
        default_scope: $("setScope").value,
        home_municipality: $("setHome").value,
        paused: $("setPaused").checked ? "1" : "0",
      }),
    })
      .then(function () { toast("Nastavenia uložené."); })
      .catch(function (e) { if (e.message !== "odhlásené") toast(e.message, true); });
  });

  /* ------------------------------------------------------------- štart */

  fetch("/api/admin/session", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.json(); })
    .then(function (data) { (data.authed ? showPanel : showLogin)(); })
    .catch(showLogin);
})();
