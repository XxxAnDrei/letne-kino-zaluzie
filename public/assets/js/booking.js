/* ============================================================================
   Kalendár voľných termínov + žiadosť o zapožičanie.
   Beží nezávisle od animácií — keby GSAP zlyhal, rezervácia funguje ďalej.
   ========================================================================= */
(function () {
  "use strict";

  var MONTHS = [
    "január", "február", "marec", "apríl", "máj", "jún",
    "júl", "august", "september", "október", "november", "december",
  ];
  var MONTHS_GEN = [
    "januára", "februára", "marca", "apríla", "mája", "júna",
    "júla", "augusta", "septembra", "októbra", "novembra", "decembra",
  ];
  var DAYS = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"];

  var STATUS_LABEL = {
    free: "voľné",
    taken: "obsadené",
    blocked: "nedostupné",
    past: "už sa nedá",
    offseason: "mimo sezóny",
    far: "zatiaľ priďaleko",
    paused: "dočasne zatvorené",
  };

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    grid: $("calGrid"),
    month: $("calMonth"),
    prev: $("calPrev"),
    next: $("calNext"),
    hint: $("calHint"),
    form: $("form"),
    slotMain: $("slotMain"),
    slotTimes: $("slotTimes"),
    slotPickup: $("slotPickup"),
    slotReturn: $("slotReturn"),
    backupLine: $("backupLine"),
    backupToggle: $("backupToggle"),
    backupToggleText: $("backupToggleText"),
    formError: $("formError"),
    submit: $("submit"),
    submitText: $("submitText"),
    ticketSlot: $("ticketSlot"),
  };

  if (!el.grid || !el.form) return;

  var state = {
    days: {},          // "YYYY-MM-DD" -> { status, reason }
    settings: null,
    today: null,
    firstOpen: null,
    lastOpen: null,
    cursor: null,      // zobrazený mesiac, 1. deň
    selected: null,
    backup: null,
    arming: "main",    // "main" | "backup"
    loading: false,
  };

  /* ------------------------------------------------------------- dátumy */

  function parseIso(iso) {
    var p = iso.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  function toIso(d) {
    return (
      d.getUTCFullYear() +
      "-" + String(d.getUTCMonth() + 1).padStart(2, "0") +
      "-" + String(d.getUTCDate()).padStart(2, "0")
    );
  }

  function addDays(iso, n) {
    var d = parseIso(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toIso(d);
  }

  // pondelok = 0
  function weekIndex(d) {
    return (d.getUTCDay() + 6) % 7;
  }

  function longDate(iso) {
    var d = parseIso(iso);
    return DAYS[weekIndex(d)] + " " + d.getUTCDate() + ". " + MONTHS_GEN[d.getUTCMonth()];
  }

  function shortDate(iso) {
    var d = parseIso(iso);
    return d.getUTCDate() + ". " + MONTHS_GEN[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  /* ------------------------------------------------------------ načítanie */

  function load() {
    state.loading = true;
    return fetch("/api/availability", { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.days = {};
        data.days.forEach(function (d) { state.days[d.date] = d; });
        state.settings = data.settings;
        state.today = data.today;
        state.firstOpen = data.firstOpen;
        state.lastOpen = data.lastOpen;

        if (!state.cursor) {
          // Otvor rovno mesiac, v ktorom je najbližší voľný termín.
          var firstFree = data.days.find(function (d) { return d.status === "free"; });
          state.cursor = monthStart(firstFree ? firstFree.date : data.today);
        }
        render();
        state.loading = false;
      })
      .catch(function () {
        state.loading = false;
        el.grid.setAttribute("data-error", "1");
        if (el.hint) el.hint.textContent = "Kalendár sa nepodarilo načítať. Skús obnoviť stránku.";
      });
  }

  function monthStart(iso) {
    return iso.slice(0, 7) + "-01";
  }

  function shiftMonth(iso, delta) {
    var d = parseIso(iso);
    d.setUTCMonth(d.getUTCMonth() + delta, 1);
    return toIso(d);
  }

  /* ------------------------------------------------------------ vykreslenie */

  function render() {
    renderHeader();
    renderGrid();
    renderSlot();
  }

  function renderHeader() {
    var d = parseIso(state.cursor);
    el.month.textContent = MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();

    var prevIso = shiftMonth(state.cursor, -1);
    var nextIso = shiftMonth(state.cursor, 1);
    el.prev.disabled = prevIso < monthStart(state.today);
    el.next.disabled = nextIso > monthStart(state.lastOpen);

    if (el.hint && !el.grid.hasAttribute("data-error")) {
      var free = Object.keys(state.days).filter(function (k) {
        return state.days[k].status === "free";
      }).length;
      el.hint.textContent = free
        ? free + " voľných termínov do " + shortDate(state.lastOpen)
        : "Momentálne nie sú voľné termíny.";
    }
  }

  function renderGrid() {
    Array.prototype.slice
      .call(el.grid.querySelectorAll(".day"))
      .forEach(function (n) { n.remove(); });

    var first = parseIso(state.cursor);
    var pad = weekIndex(first);
    var daysInMonth = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
    ).getUTCDate();

    var frag = document.createDocumentFragment();

    for (var i = 0; i < pad; i += 1) {
      var blank = document.createElement("div");
      blank.className = "day day--empty";
      blank.setAttribute("aria-hidden", "true");
      frag.appendChild(blank);
    }

    for (var day = 1; day <= daysInMonth; day += 1) {
      var iso = state.cursor.slice(0, 8) + String(day).padStart(2, "0");
      var info = state.days[iso];
      var status = info ? info.status : iso < state.today ? "past" : "far";
      var isFree = status === "free";

      var cell = document.createElement(isFree ? "button" : "div");
      cell.className = "day day--" + status;
      cell.dataset.date = iso;
      cell.textContent = String(day);
      if (iso === state.today) cell.classList.add("day--today");
      if (iso === state.selected || iso === state.backup) cell.classList.add("is-selected");

      var label = longDate(iso) + " — " + (STATUS_LABEL[status] || status);
      if (isFree) {
        cell.type = "button";
        cell.setAttribute("aria-label", label + ". Kliknutím vyberieš tento termín.");
      } else {
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", label);
        cell.title = info && info.reason ? info.reason : label;
      }
      frag.appendChild(cell);
    }

    el.grid.appendChild(frag);
    document.dispatchEvent(new CustomEvent("kino:calendar"));
  }

  function renderSlot() {
    if (state.selected) {
      el.slotMain.textContent = longDate(state.selected);
      el.slotMain.dataset.empty = "false";
      el.slotTimes.hidden = false;
      el.slotPickup.textContent = "Prevzatie " + state.settings.pickupTime;
      el.slotReturn.textContent =
        "Vrátenie " + state.settings.returnTime + " · " + longDate(addDays(state.selected, 1));
    } else {
      el.slotMain.textContent = "Zatiaľ bez termínu";
      el.slotMain.dataset.empty = "true";
      el.slotTimes.hidden = true;
    }

    if (state.backup) {
      el.backupLine.innerHTML =
        "Náhradný termín pri daždi: <b>" + longDate(state.backup) + "</b>.";
      el.backupToggleText.textContent = "Zmeniť náhradný termín";
    } else if (state.arming === "backup") {
      el.backupLine.textContent = "Klikni v kalendári na deň, ktorý má poslúžiť ako náhradný.";
      el.backupToggleText.textContent = "Zrušiť výber náhradného";
    } else {
      el.backupLine.textContent = state.selected
        ? "Odporúčam pridať aj náhradný termín pre prípad dažďa."
        : "Kliknutím na deň v kalendári vyberieš hlavný termín.";
      el.backupToggleText.textContent = "Pridať náhradný termín";
    }
    el.backupToggle.disabled = !state.selected;
    el.backupToggle.setAttribute("aria-pressed", state.arming === "backup" ? "true" : "false");
  }

  /* ------------------------------------------------------------- interakcia */

  el.prev.addEventListener("click", function () {
    state.cursor = shiftMonth(state.cursor, -1);
    render();
  });
  el.next.addEventListener("click", function () {
    state.cursor = shiftMonth(state.cursor, 1);
    render();
  });

  el.grid.addEventListener("click", function (event) {
    var cell = event.target.closest(".day--free");
    if (!cell) return;
    var iso = cell.dataset.date;

    if (state.arming === "backup") {
      state.backup = iso === state.selected ? null : iso;
      state.arming = "main";
    } else {
      if (state.selected === iso) {
        state.selected = null;
      } else {
        state.selected = iso;
        if (state.backup === iso) state.backup = null;
      }
    }
    clearFieldError("date");
    render();
    document.dispatchEvent(new CustomEvent("kino:pick", { detail: { cell: cell } }));
  });

  el.backupToggle.addEventListener("click", function () {
    if (state.backup) {
      state.backup = null;
      state.arming = "backup";
    } else {
      state.arming = state.arming === "backup" ? "main" : "backup";
    }
    renderSlot();
  });

  /* -------------------------------------------------------------- odoslanie */

  function clearFieldError(name) {
    var err = $("err-" + name);
    if (err) {
      err.textContent = "";
      err.closest(".field")?.classList.remove("has-error");
    }
    var check = $("check-" + name);
    if (check) check.classList.remove("has-error");
  }

  function clearAllErrors() {
    ["name", "phone", "people", "address", "email", "note", "date", "backupDate"].forEach(clearFieldError);
    ["power", "garden", "wifi", "terms"].forEach(clearFieldError);
    el.formError.hidden = true;
    el.formError.textContent = "";
  }

  function showErrors(message, fields) {
    el.formError.hidden = false;
    el.formError.textContent = message;
    var firstNode = null;
    Object.keys(fields || {}).forEach(function (name) {
      var err = $("err-" + name);
      if (err) {
        err.textContent = fields[name];
        var field = err.closest(".field");
        if (field) field.classList.add("has-error");
        if (!firstNode) firstNode = field;
      }
      var check = $("check-" + name);
      if (check) {
        check.classList.add("has-error");
        if (!firstNode) firstNode = check;
      }
    });
    (firstNode || el.formError).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  el.form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearAllErrors();

    if (!state.selected) {
      showErrors("Najprv si vyber termín v kalendári.", {});
      document.getElementById("terminy").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    var payload = {
      date: state.selected,
      backupDate: state.backup,
      name: $("name").value,
      phone: $("phone").value,
      email: $("email").value,
      address: $("address").value,
      people: Number($("people").value),
      note: $("note").value,
      power: $("power").checked,
      garden: $("garden").checked,
      wifi: $("wifi").checked,
      terms: $("terms").checked,
      web: $("hp").value,
    };

    el.submit.disabled = true;
    el.submitText.textContent = "Posielam…";

    fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      })
      .then(function (res) {
        if (!res.ok) {
          showErrors(res.body.error || "Žiadosť sa nepodarilo odoslať.", res.body.fields);
          if (res.body.fields && res.body.fields.date) load();
          return;
        }
        showTicket(res.body);
        load();
      })
      .catch(function () {
        showErrors("Nepodarilo sa spojiť so serverom. Skús to prosím o chvíľu znova.", {});
      })
      .finally(function () {
        el.submit.disabled = false;
        el.submitText.textContent = "Poslať žiadosť";
      });
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showTicket(data) {
    var rows = [
      ["Termín", longDate(data.date)],
      ["Prevzatie", data.pickupTime + " · " + shortDate(data.date)],
      ["Vrátenie", data.returnTime + " · " + shortDate(data.returnDate)],
    ];
    if (data.backupDate) rows.push(["Ak zaprší", longDate(data.backupDate)]);

    el.form.hidden = true;
    el.ticketSlot.hidden = false;
    el.ticketSlot.innerHTML =
      '<div class="ticket" id="ticket">' +
      '<div class="ticket__body">' +
      '<span class="ticket__stamp">Čaká na potvrdenie</span>' +
      "<h3>Žiadosť je u mňa</h3>" +
      '<p class="dim">Termín som ti zatiaľ podržal a v kalendári už je označený ako obsadený. ' +
      "Overím adresu a ozvem sa ti telefonicky, zvyčajne do dvoch dní.</p>" +
      "<dl>" +
      rows
        .map(function (r) {
          return "<dt>" + escapeHtml(r[0]) + "</dt><dd>" + escapeHtml(r[1]) + "</dd>";
        })
        .join("") +
      "</dl>" +
      '<p class="form__note">Ak sa niečo zmení, zavolaj mi alebo napíš — číslo nájdeš v pätičke stránky.</p>' +
      "</div>" +
      '<div class="ticket__stub">' +
      '<span class="ticket__ref">' + escapeHtml(data.ref) + "</span>" +
      "</div>" +
      "</div>";

    document.dispatchEvent(new CustomEvent("kino:ticket"));
    el.ticketSlot.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  document.addEventListener("input", function (event) {
    if (event.target.closest("#form")) clearFieldError(event.target.name || event.target.id);
  });

  window.KinoBooking = {
    state: state,
    reload: load,
    longDate: longDate,
  };

  load();
})();
