/** Keep external titles literal and URL delimiters safe in a Markdown link. */
export function articleMarkdownLink(title: string, url: string): string {
  const label = title.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>!|~]/g, '\\$&');
  const destination = url.replace(/[\s()<>\\]/g, character => encodeURIComponent(character).replace(/\(/g, '%28').replace(/\)/g, '%29'));
  return `[${label}](${destination})`;
}
