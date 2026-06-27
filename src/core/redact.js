// Shared redaction for message content (URLs, emails, phone numbers).
//
// IMPORTANT: in the structured formats (JSON/CSV) this is applied to the message
// *content* fields only — never the whole serialized document — so that author
// ids, snowflakes, and ISO timestamps are not mangled by the phone-number
// pattern. The text formats (TXT/MD) apply redaction as a final pass over their
// output, which contains no id-like digit runs.

const URL_RE = /https?:\/\/[^\s]+/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

export function redactString(text, opts = {}) {
  let r = String(text);
  if (opts.redactUrls) r = r.replace(URL_RE, '[URL]');
  if (opts.redactEmails) {
    r = r.replace(EMAIL_RE, '[EMAIL]');
    r = r.replace(PHONE_RE, '[PHONE]');
  }
  return r;
}
