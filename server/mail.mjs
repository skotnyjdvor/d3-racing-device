// Transactional email via Resend (https://resend.com/docs/api-reference/emails/send-email).
const RESEND_URL = process.env.RESEND_API_URL || "https://api.resend.com/emails";
export const APP_URL = (process.env.APP_URL || "https://d3cf.com").replace(/\/$/, "");
const MAIL_FROM = process.env.MAIL_FROM || "D3CF Technology <no-reply@d3cf.com>";
const REPLY_TO = process.env.MAIL_REPLY_TO || "office@d3cf.com";

export const mailConfigured = () => Boolean((process.env.RESEND_API_KEY || "").trim());

const copy = {
  ru: {
    resetSubject: "Сброс пароля D3CF",
    resetTitle: "Сброс пароля",
    resetText: "Мы получили запрос на смену пароля для аккаунта D3CF. Ссылка действует 1 час.",
    resetButton: "Задать новый пароль",
    verifySubject: "Подтвердите email для D3CF",
    verifyTitle: "Подтвердите email",
    verifyText: "Подтвердите адрес, чтобы защитить аккаунт и получать письма о восстановлении доступа. Ссылка действует 24 часа.",
    verifyButton: "Подтвердить email",
    ignore: "Если вы не запрашивали это письмо, просто проигнорируйте его.",
  },
  en: {
    resetSubject: "Reset your D3CF password",
    resetTitle: "Password reset",
    resetText: "We received a request to change the password for your D3CF account. The link is valid for 1 hour.",
    resetButton: "Set a new password",
    verifySubject: "Confirm your email for D3CF",
    verifyTitle: "Confirm your email",
    verifyText: "Confirm your address to secure your account and receive access recovery emails. The link is valid for 24 hours.",
    verifyButton: "Confirm email",
    ignore: "If you did not request this email, you can safely ignore it.",
  },
  pl: {
    resetSubject: "Reset hasła D3CF",
    resetTitle: "Reset hasła",
    resetText: "Otrzymaliśmy prośbę o zmianę hasła do konta D3CF. Link jest ważny przez 1 godzinę.",
    resetButton: "Ustaw nowe hasło",
    verifySubject: "Potwierdź e-mail w D3CF",
    verifyTitle: "Potwierdź e-mail",
    verifyText: "Potwierdź adres, aby zabezpieczyć konto i otrzymywać wiadomości o odzyskaniu dostępu. Link jest ważny przez 24 godziny.",
    verifyButton: "Potwierdź e-mail",
    ignore: "Jeśli nie prosiłeś o tę wiadomość, po prostu ją zignoruj.",
  },
  it: {
    resetSubject: "Reimposta la password D3CF",
    resetTitle: "Nuova password",
    resetText: "Abbiamo ricevuto una richiesta di modifica della password per il tuo account D3CF. Il link è valido per 1 ora.",
    resetButton: "Imposta una nuova password",
    verifySubject: "Conferma la tua email per D3CF",
    verifyTitle: "Conferma la tua email",
    verifyText: "Conferma l'indirizzo per proteggere l'account e ricevere le email di recupero dell'accesso. Il link è valido per 24 ore.",
    verifyButton: "Conferma email",
    ignore: "Se non hai richiesto questa email, puoi semplicemente ignorarla.",
  },
};

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function layout({ title, text, button, link, ignore }) {
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#08080c;font-family:Arial,Helvetica,sans-serif;color:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #1f1f2a;background:#0f0f16">
<tr><td style="height:4px;background:#e10600;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font:700 13px/1 Arial,sans-serif;letter-spacing:3px;color:#a8a9ac">D3CF · TECHNOLOGY</p>
<h1 style="margin:0 0 16px;font:700 30px/1.1 Arial,sans-serif;text-transform:uppercase;color:#ffffff">${escape(title)}</h1>
<p style="margin:0 0 28px;font:15px/1.6 Arial,sans-serif;color:#c9cacd">${escape(text)}</p>
<a href="${escape(link)}" style="display:inline-block;padding:14px 26px;background:#e10600;color:#ffffff;font:700 13px/1 Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;text-decoration:none">${escape(button)}</a>
<p style="margin:28px 0 0;font:12px/1.6 Arial,sans-serif;color:#6a6b72;word-break:break-all">${escape(link)}</p>
<p style="margin:20px 0 0;font:12px/1.6 Arial,sans-serif;color:#6a6b72">${escape(ignore)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function send({ to, subject, html, text }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw Object.assign(new Error("Email is not configured"), { status: 503 });
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("Resend error", response.status, body.slice(0, 500));
    throw Object.assign(new Error("Email could not be sent. Try again later."), { status: 502 });
  }
}

export async function sendPasswordResetEmail(to, token, language = "ru") {
  const c = copy[language] || copy.ru;
  const link = `${APP_URL}/#reset=${token}`;
  await send({
    to, subject: c.resetSubject,
    html: layout({ title: c.resetTitle, text: c.resetText, button: c.resetButton, link, ignore: c.ignore }),
    text: `${c.resetText}\n\n${link}\n\n${c.ignore}`,
  });
}

export async function sendVerificationEmail(to, token, language = "ru") {
  const c = copy[language] || copy.ru;
  const link = `${APP_URL}/#verify=${token}`;
  await send({
    to, subject: c.verifySubject,
    html: layout({ title: c.verifyTitle, text: c.verifyText, button: c.verifyButton, link, ignore: c.ignore }),
    text: `${c.verifyText}\n\n${link}\n\n${c.ignore}`,
  });
}
