import editorial from './scenarioEditorial.json';
import tractors from '../engine/scenarios/tractors-v3.json';
import ipad from '../engine/scenarios/ipad-v3.json';
import emobile from '../engine/scenarios/emobile-v3.json';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n')
  .replace(/^.*~{3,}.*(?:\n|$)/gm, '')
  .replace(/([а-яёa-z])-\n(?=[а-яёa-z])/gi, '$1').replace(/\s+/g, ' ').trim();
// Match the complete source, never period number alone: preserve user-edited news.
const editions = new Map<string, string>();
for (const [name, source] of Object.entries({ tractors, ipad, emobile })) {
  source.periods.forEach((period, index) => {
    const formatted = editorial[name as keyof typeof editorial][index];
    if (formatted) editions.set(normalize(period.news), formatted);
  });
}

/** Normalize DOS line wrapping without changing the stored scenario text. */
export function scenarioParagraphs(text: string): string[] {
  const edition = editions.get(normalize(text));
  if (edition) return edition.split('\n\n');
  // New scenarios should already contain authored paragraphs and bullet lists.
  if (!text.includes('~~~') && text.includes('\n\n')) return text.trim().split(/\n\s*\n/).filter(Boolean);
  const clean = text.replace(/\r\n?/g, '\n').replace(/^.*~{3,}.*(?:\n|$)/gm, '')
    .replace(/([а-яёa-z])-\n(?=[а-яёa-z])/gi, '$1').trim();
  if (!clean) return [];
  return clean.split(/\n\s*\n/).flatMap(block => {
    const joined = block.replace(/\s+/g, ' ').trim();
    if (joined.length <= 400) return [joined];
    // Break long source paragraphs at sentence boundaries, preserving punctuation.
    const sentences = joined.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«"])/);
    const paragraphs: string[] = []; let paragraph = '';
    for (const sentence of sentences) {
      if (paragraph && paragraph.length + sentence.length > 350) { paragraphs.push(paragraph); paragraph = ''; }
      paragraph += (paragraph ? ' ' : '') + sentence;
    }
    if (paragraph) paragraphs.push(paragraph);
    return paragraphs;
  }).filter(Boolean);
}
