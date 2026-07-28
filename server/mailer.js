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
export async function sendMail({ to, toName, subject, text, html }) {
  const c = conf();
  if (!mailReady()) return { ok: false, error: 'e-mail nie je nastavený' };
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
      // Brevo vracia dôvod v tele; bez neho by sa chyba ladila naslepo.
      const detail = (await res.text()).slice(0, 300);
      console.error(`e-mail neodoslaný (${res.status}) → ${to}: ${detail}`);
      return { ok: false, error: `Brevo ${res.status}` };
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
