// Per-page <head> for the public pages, so crawlers and link previews see the right title without running JS.
export const PUBLIC_PAGES = {
  "/features": {
    title: "Возможности — логгер LapTrace и AI-разбор | D3CF",
    description: "Как устроены LapTrace и D3CF: GPS 25 Гц и акселерометр, автоматическое деление на круги, дельта и сектора, AI-инженер с советами на карте трассы.",
  },
  "/shop": {
    title: "Магазин LapTrace — предзаказ | D3CF",
    description: "Оформите предзаказ GPS-логгера LapTrace для трека: 25 Гц, Bluetooth, до 20 часов работы. Мы подтвердим цену и доставку по email.",
  },
  "/contact": {
    title: "Контакты | D3CF Technology",
    description: "Вопросы по бете, устройству LapTrace, разбору логов и сотрудничеству — пишите на office@d3cf.com.",
  },
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderPublicPage(html, path, origin = "https://d3cf.com") {
  const page = PUBLIC_PAGES[path];
  if (!page) return null;
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const url = escapeHtml(`${origin}${path}`);
  const meta = (attribute, name, value) => [new RegExp(`(<meta ${attribute}="${name}" content=")[^"]*(")`), `$1${value}$2`];
  return [
    [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
    meta("name", "description", description),
    [/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`],
    meta("property", "og:url", url),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("name", "twitter:title", title),
    meta("name", "twitter:description", description),
  ].reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), html);
}
