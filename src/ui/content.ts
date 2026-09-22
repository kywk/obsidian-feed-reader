import createDOMPurify from 'dompurify';

/**
 * Returns HTML that is safe to insert into the reader or turn into Markdown.
 * Links and images are resolved against the feed article URL and are limited to
 * HTTP(S), which also keeps a saved note from preserving executable schemes.
 */
const ARTICLE_SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['iframe', 'script', 'object', 'embed', 'base', 'form', 'style'],
  FORBID_ATTR: ['srcset', 'style', 'class', 'id', 'color', 'bgcolor', 'face', 'size', 'width', 'height'],
};

function articlePurifier(baseUrl?: string) {
  const purifier = createDOMPurify(window);
  purifier.addHook('afterSanitizeAttributes', element => {
    for (const attribute of ['href', 'src'] as const) {
      if (!element.hasAttribute(attribute)) continue;
      const safeUrl = resolveSafeHttpUrl(element.getAttribute(attribute) ?? '', baseUrl);
      if (safeUrl) element.setAttribute(attribute, safeUrl);
      else element.removeAttribute(attribute);
    }
  });
  return purifier;
}

export function sanitizeArticleHtml(html: string, baseUrl?: string): string {
  return articlePurifier(baseUrl).sanitize(html, ARTICLE_SANITIZE_OPTIONS);
}

/** Uses the same cleaning rules as saved notes without reparsing HTML in the UI. */
export function sanitizeArticleFragment(html: string, baseUrl?: string): DocumentFragment {
  return articlePurifier(baseUrl).sanitize(html, {
    ...ARTICLE_SANITIZE_OPTIONS,
    RETURN_DOM_FRAGMENT: true,
  });
}

function resolveSafeHttpUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
