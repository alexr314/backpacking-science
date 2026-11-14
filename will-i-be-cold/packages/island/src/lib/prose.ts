/**
 * Engine prose, made house style before it is shown.
 *
 * The client's standing rule is no em dashes anywhere; the engine's sentences use them. The
 * engine owns its wording, so the panel restructures at the seam rather than editing it:
 * a spaced dash becomes a colon in a headline (one clause announcing the next) and a semicolon
 * in running text; an unspaced one becomes a comma. The character is written as its escape
 * so this file carries none either.
 */

export function plain(text: string): string {
  return text.replace(/\s+\u2014\s+/g, '; ').replace(/\u2014/g, ', ');
}

/**
 * The headline sentence for a single-phase panel. The tab and the scene already say which
 * time of day this is, so the engine's phase phrase ("in camp in the evening") comes out, and
 * its one dash becomes a colon.
 */
export function headline(verdict: string, phasePhrase: string): string {
  const shorn = verdict.replace(new RegExp(`\\s+in\\s+${phasePhrase}\\b`), '').replace(new RegExp(`\\s+${phasePhrase}\\b`), '');
  return shorn.replace(/\s+\u2014\s+/, ': ').replace(/\s+\u2014\s+/g, '; ').replace(/\u2014/g, ', ');
}
