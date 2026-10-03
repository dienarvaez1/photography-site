// POST /translate: the Admin's page editor (src/lib/page-editor.ts) has the text it is about to save translated into the
// site's other language before saving both. Cloudflare Workers AI does the translating (the `AI` binding in
// wrangler.jsonc); nothing is stored here.
//
//   JSON { from: "en" | "es", to: "es" | "en", texts: { <key>: "<text>", … } }  ->  { texts: { <key>: "<translation>", … } }
//
// A text may hold {placeholders} the site fills in (e.g. {email}); a translation must keep exactly the same ones, or it is
// refused rather than saved broken. Text is plain: anything that looks like HTML is refused both ways, because some of the
// site's text is rendered as HTML.

export const TRANSLATION_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const LANGUAGES = { en: 'English', es: 'Spanish' };
export const MAX_TEXTS = 12;
export const MAX_TEXT_LENGTH = 4000;

export class TranslationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const placeholders = (text) => [...String(text).matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0]).sort();
const looksLikeHtml = (text) => /[<>]/.test(text);

/** Checks a request body; returns { from, to, texts } or throws a 400. */
export function readTranslationRequest(body) {
  const { from, to, texts } = body ?? {};
  if (!LANGUAGES[from] || !LANGUAGES[to] || from === to) throw new TranslationError(400, 'bad-request', 'Give "from" and "to" as "en" and "es".');
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) throw new TranslationError(400, 'bad-request', 'Send the texts as { key: text }.');
  const entries = Object.entries(texts);
  if (!entries.length || entries.length > MAX_TEXTS) throw new TranslationError(400, 'bad-request', `Send 1 to ${MAX_TEXTS} texts.`);
  for (const [key, text] of entries) {
    if (!/^[A-Za-z0-9.-]{1,80}$/.test(key)) throw new TranslationError(400, 'bad-request', 'Bad text key.');
    if (typeof text !== 'string' || !text.trim()) throw new TranslationError(400, 'bad-request', `"${key}" is empty.`);
    if (text.length > MAX_TEXT_LENGTH) throw new TranslationError(400, 'bad-request', `"${key}" is longer than ${MAX_TEXT_LENGTH} characters.`);
    if (looksLikeHtml(text)) throw new TranslationError(400, 'bad-request', `"${key}" must be plain text (no < or >).`);
  }
  return { from, to, texts: Object.fromEntries(entries.map(([key, text]) => [key, text.trim()])) };
}

const instructions = (from, to) =>
  `You translate the website of a professional photographer from ${LANGUAGES[from]} to ${LANGUAGES[to]}. ` +
  `Write natural, warm, polished ${LANGUAGES[to]}${to === 'es' ? ' (neutral Latin American Spanish, addressing the reader informally with "tú", as the rest of the site does)' : ''} with the same meaning and tone. ` +
  'Keep every placeholder in curly braces, such as {email}, exactly as written. Keep blank lines between paragraphs. ' +
  'Reply with the translation only: no quotes, notes, labels or explanations.';

/** The model's answer, tidied: some models wrap it in quotes or prefix a label. */
function tidy(answer) {
  let text = String(answer ?? '').trim();
  text = text.replace(/^(?:translation|traducción)\s*:\s*/i, '');
  if (/^["“«].*["”»]$/s.test(text)) text = text.slice(1, -1).trim();
  return text;
}

/** Translates each text with the AI binding; checks every answer keeps its placeholders and stays plain text. */
export async function translateTexts(ai, { from, to, texts }) {
  if (!ai) throw new TranslationError(500, 'misconfigured', 'The translation service (AI binding) is not set up on this Worker.');
  const results = await Promise.all(
    Object.entries(texts).map(async ([key, text]) => {
      let answer;
      try {
        answer = await ai.run(TRANSLATION_MODEL, { messages: [{ role: 'system', content: instructions(from, to) }, { role: 'user', content: text }], max_tokens: 2048, temperature: 0.2 });
      } catch {
        throw new TranslationError(502, 'translation-failed', 'The translation service did not answer. Try again.');
      }
      const translated = tidy(answer?.response);
      if (!translated) throw new TranslationError(502, 'translation-failed', `The translation of "${key}" came back empty. Try again.`);
      if (looksLikeHtml(translated)) throw new TranslationError(502, 'translation-failed', `The translation of "${key}" was not plain text. Try again.`);
      if (placeholders(translated).join() !== placeholders(text).join()) throw new TranslationError(502, 'translation-failed', `The translation of "${key}" lost a {placeholder}. Try again.`);
      return [key, translated];
    }),
  );
  return { texts: Object.fromEntries(results) };
}
