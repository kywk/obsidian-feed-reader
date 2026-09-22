import createDOMPurify from 'dompurify';

/**
 * Returns HTML that is safe to insert into the reader or turn into Markdown.
 * Links and images are resolved against the feed article URL and are limited to
 * HTTP(S), which also keeps a saved note from preserving executable schemes.
 */
export function sanitizeArticleHtml(html: string, baseUrl?: string): string {
  const purifier = createDOMPurify(window);
  const clean = purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['iframe', 'script', 'object', 'embed', 'base', 'form', 'style'],
    FORBID_ATTR: ['srcset', 'style', 'class', 'id', 'color', 'bgcolor', 'face', 'size', 'width', 'height'],
  });
  const template = document.createElement('template');
  template.innerHTML = clean;

  for (const element of template.content.querySelectorAll<HTMLElement>('[href], [src]')) {
    for (const attribute of ['href', 'src'] as const) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute) ?? '';
      const safeUrl = resolveSafeHttpUrl(value, baseUrl);
      if (safeUrl) element.setAttribute(attribute, safeUrl);
      else element.removeAttribute(attribute);
    }
  }
  return template.innerHTML;
}

function resolveSafeHttpUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
