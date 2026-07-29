/*
 * Odosielanie e-mailov cez Brevo.
 *
 * Ide sa cez HTTP API, nie cez SMTP: serverless funkcia žije pár sekúnd a
 * držať v nej otvorené SMTP spojenie je pomalé a časť hostingov ho aj blokuje.
 * Brevo prijme jednu požiadavku na /v3/smtp/email a to je celé.
 *
 * Pravidlo, ktoré tu platí bez výnimky: e-mail nesmie zhodiť rezerváciu.
 * Keď kľúč chýba, keď Brevo vypadne alebo keď odpovie chybou, žiadosť je aj
 * tak uložená a človek vidí svoj lístok. Nepodarený e-mail sa zapíše do logu.
 */

const API = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS || 6000);

function conf() {
  return {
    key: process.env.BREVO_API_KEY || '',
    from: process.env.MAIL_FROM || '',
    fromName: process.env.MAIL_FROM_NAME || 'Letné kino Veľké Zálužie',
    admin: process.env.MAIL_ADMIN || '',
    replyTo: process.env.MAIL_REPLY_TO || '',
  };
}

/** Posielame len vtedy, keď je čím a odkiaľ. */
export function mailReady() {
  const c = conf();
  return Boolean(c.key && c.from);
}

export function adminAddress() {
  return conf().admin;
}

/**
 * Stav nastavenia pre správcu. Kľúč sa nikdy nevracia, len či je vyplnený
 * a či vyzerá ako kľúč Brevo. Adresy vrátiť treba — správca si musí overiť,
 * že odosielateľ sedí s tým, čo má overené v Breve.
 */
export function mailStatus() {
  const c = conf();
  return {
    pripravene: mailReady(),
    klucNastaveny: Boolean(c.key),
    klucVyzeraAkoBrevo: /^xkeysib-/.test(c.key),
    odosielatel: c.from || null,
    menoOdosielatela: c.fromName,
    upozorneniaNa: c.admin || null,
    odpovedatNa: c.replyTo || null,
    chyba: [!c.key && 'BREVO_API_KEY', !c.from && 'MAIL_FROM', !c.admin && 'MAIL_ADMIN'].filter(Boolean),
  };
}

/** Poznámky do štartovacieho výpisu, nech je hneď vidieť, či e-maily pôjdu. */
export function mailStartupNotes() {
  const c = conf();
  const notes = [];
  if (!c.key) notes.push('BREVO_API_KEY nie je nastavený — e-maily sa neposielajú.');
  else if (!c.from) notes.push('MAIL_FROM nie je nastavený — e-maily sa neposielajú.');
  else if (!c.admin) notes.push('MAIL_ADMIN nie je nastavený — upozornenia o žiadostiach nikam nepôjdu.');
  return notes;
}

/**
 * Odošle jednu správu. Nikdy nevyhodí výnimku — vracia { ok, error }.
 */
/*
 * Aby sa log nezaplavil pri každej žiadosti, hlásenie o chýbajúcom nastavení
 * sa vypíše raz za život inštancie. Mlčať sa nedá — bez toho vyzerá chýbajúca
 * premenná úplne rovnako ako funkčné odosielanie a hľadá sa to naslepo.
 */
let warned = false;

export async function sendMail({ to, toName, subject, text, html }) {
  const c = conf();
  if (!mailReady()) {
    if (!warned) {
      warned = true;
      const chyba = [!c.key && 'BREVO_API_KEY', !c.from && 'MAIL_FROM'].filter(Boolean);
      console.error(`e-mail sa neposiela, chýba: ${chyba.join(', ')}`);
    }
    return { ok: false, error: 'e-mail nie je nastavený' };
  }
  if (!to) return { ok: false, error: 'chýba príjemca' };

  const body = {
    sender: { email: c.from, name: c.fromName },
    to: [{ email: to, ...(toName ? { name: toName } : {}) }],
    subject,
    textContent: text,
    ...(html ? { htmlContent: html } : {}),
    ...(c.replyTo ? { replyTo: { email: c.replyTo } } : {}),
  };

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'api-key': c.key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      /*
       * Brevo píše skutočný dôvod do tela odpovede a bez neho sa hádalo.
       * Rovnaký kód 401 znamená raz neplatný kľúč, inokedy neaktivovaný účet
       * alebo obmedzenie na povolené IP adresy — rozlíši ich až táto veta.
       */
      const raw = (await res.text()).slice(0, 400);
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = parsed.message || raw;
      } catch {
        /* nie je JSON, necháme surový text */
      }
      console.error(`e-mail neodoslaný (${res.status}) → ${to}: ${raw}`);
      return { ok: false, error: `Brevo ${res.status}`, detail, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error(`e-mail neodoslaný → ${to}: ${err.name === 'TimeoutError' ? 'vypršal čas' : err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * Pošle viac správ naraz a počká na všetky. Čaká sa zámerne: po odoslaní
 * odpovede môže serverless funkcia kedykoľvek skončiť a rozposielanie na
 * pozadí by sa nemuselo stihnúť.
 */
export async function sendAll(messages) {
  const out = await Promise.all(messages.filter(Boolean).map((m) => sendMail(m)));
  return out;
}
