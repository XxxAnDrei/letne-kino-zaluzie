/* ============================================================================
   Dobrovoľný príspevok. Úmyselne nemá nič spoločné s rezerváciou — beží
   samostatne, aby sa príspevok nikdy nestal podmienkou odoslania žiadosti.
   ========================================================================= */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var panel = document.querySelector(".give__panel");
  if (!panel) return;

  var qrBox = $("giveQr");
  var input = $("giveAmount");
  var payLink = $("givePay");
  var copyBtn = $("copyIban");
  var ibanEl = $("giveIban");
  var buttons = Array.prototype.slice.call(panel.querySelectorAll(".amount[data-amount]"));

  var oz = null;
  var timer = null;
  var lastRequested = null;

  function currentAmount() {
    var raw = Number(input.value);
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : null;
  }

  function markButtons() {
    var amount = currentAmount();
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.amount) === amount));
    });
  }

  /** Odkaz na payme.sk je záložná cesta pre toho, kto QR nepoužije. */
  function updatePayLink() {
    if (!oz || !payLink) return;
    var amount = currentAmount();
    var params = new URLSearchParams({
      V: "1",
      IBAN: oz.iban.replace(/\s+/g, ""),
      CC: "EUR",
      CN: oz.name,
      MSG: oz.note,
    });
    if (amount) params.set("AM", amount.toFixed(2));
    payLink.href = "https://payme.sk/?" + params.toString();
  }

  function loadQr() {
    var amount = currentAmount();
    var key = String(amount);
    if (key === lastRequested) return;
    lastRequested = key;

    fetch("/api/donation" + (amount ? "?amount=" + encodeURIComponent(amount) : ""), {
      headers: { Accept: "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        oz = data.oz;
        if (data.qr && qrBox) {
          qrBox.innerHTML = data.qr;
          qrBox.setAttribute(
            "aria-label",
            amount
              ? "QR kód na platbu " + amount + " € podľa štandardu PAY by square"
              : "QR kód na platbu podľa štandardu PAY by square, sumu si zadáš v banke"
          );
        }
        // Údaje združenia sú v HTML aj staticky, toto ich len zosúladí
        // s tým, čo má správca uložené v nastaveniach.
        document.querySelectorAll("[data-oz]").forEach(function (node) {
          var value = oz[node.dataset.oz];
          if (!value) return;
          // IBAN sa číta po štvoriciach; kopíruje sa potom bez medzier.
          node.textContent =
            node.dataset.oz === "iban" ? value.replace(/(.{4})/g, "$1 ").trim() : value;
        });
        updatePayLink();
      })
      .catch(function () {
        if (qrBox && !qrBox.firstChild) {
          qrBox.textContent = "QR sa nepodarilo načítať, použi IBAN nižšie.";
        }
      });
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var value = Number(b.dataset.amount);
      // Druhý klik na tú istú sumu ju zruší — späť na QR bez predpísanej sumy.
      input.value = currentAmount() === value ? "" : String(value);
      markButtons();
      updatePayLink();
      loadQr();
    });
  });

  input.addEventListener("input", function () {
    markButtons();
    updatePayLink();
    clearTimeout(timer);
    timer = setTimeout(loadQr, 400);
  });

  if (copyBtn && ibanEl) {
    copyBtn.addEventListener("click", function () {
      var iban = ibanEl.textContent.replace(/\s+/g, "");
      var done = function () {
        var original = copyBtn.textContent;
        copyBtn.textContent = "Skopírované";
        setTimeout(function () { copyBtn.textContent = original; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(iban).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        // Bez Clipboard API (staršie prehliadače, HTTP) aspoň text označíme.
        var range = document.createRange();
        range.selectNodeContents(ibanEl);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copyBtn.textContent = "Označené, skopíruj";
        setTimeout(function () { copyBtn.textContent = "Skopírovať"; }, 2400);
      }
    });
  }

  loadQr();
})();
