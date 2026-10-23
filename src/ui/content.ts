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

let activeBaseUrl: string | undefined;
let purifierWindow: Window | undefined;
let purifierInstance: ReturnType<typeof createDOMPurify> | undefined;

function getPurifier() {
  if (!purifierInstance || purifierWindow !== window) {
    purifierWindow = window;
    purifierInstance = createDOMPurify(window);
    purifierInstance.addHook('afterSanitizeAttributes', element => {
      for (const attribute of ['href', 'src'] as const) {
        if (!element.hasAttribute(attribute)) continue;
        const safeUrl = resolveSafeHttpUrl(element.getAttribute(attribute) ?? '', activeBaseUrl);
        if (safeUrl) element.setAttribute(attribute, safeUrl);
        else element.removeAttribute(attribute);
      }
    });
  }
  return purifierInstance;
}

export function sanitizeArticleHtml(html: string, baseUrl?: string): string {
  activeBaseUrl = baseUrl;
  try {
    return getPurifier().sanitize(html, ARTICLE_SANITIZE_OPTIONS);
  } finally {
    activeBaseUrl = undefined;
  }
}

/** Uses the same cleaning rules as saved notes without reparsing HTML in the UI. */
export function sanitizeArticleFragment(html: string, baseUrl?: string): DocumentFragment {
  activeBaseUrl = baseUrl;
  try {
    return getPurifier().sanitize(html, {
      ...ARTICLE_SANITIZE_OPTIONS,
      RETURN_DOM_FRAGMENT: true,
    });
  } finally {
    activeBaseUrl = undefined;
  }
}

function resolveSafeHttpUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
