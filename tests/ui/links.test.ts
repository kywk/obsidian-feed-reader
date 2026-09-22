import { expect, it } from 'vitest';
import { articleMarkdownLink } from '../../src/ui/links';

it('copies ordinary titles and original URLs in Markdown format', () => {
  expect(articleMarkdownLink('An article', 'https://example.com/?a=1&b=2')).toBe('[An article](https://example.com/?a=1&b=2)');
});
it('escapes titles and URL delimiters so external data cannot break the link', () => {
  expect(articleMarkdownLink('A [title]\n*news*', 'https://example.com/a(b) c')).toBe('[A \\[title\\] \\*news\\*](https://example.com/a%28b%29%20c)');
});
