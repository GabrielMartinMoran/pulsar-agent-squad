/**
 * Format a caveman progress note body into v3 marker lines.
 *
 * Rules derived from Gherkin @caveman-truthful-v2-probe:
 *  - result starts with "RED." (or whatever the first token of body is)
 *  - result is at most 5 lines long
 *  - result contains the body verbatim
 */
export function format_caveman_progress(body: string): string {
  const lines: string[] = [];

  // First line: the leading marker (first sentence up to ".")
  const dotIndex = body.indexOf('.');
  if (dotIndex !== -1) {
    lines.push(body.substring(0, dotIndex + 1));
  } else {
    lines.push(body);
  }

  // Second line: the body verbatim
  lines.push(body);

  return lines.join('\n');
}
