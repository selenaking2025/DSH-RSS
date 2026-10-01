import createDOMPurify from 'dompurify';
import { isAllowedIframeSrc } from './utils';

export function createArticleSanitizer() {
  const purify = createDOMPurify(window);
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'iframe' && !isAllowedIframeSrc((node as Element).getAttribute('src') ?? '')) {
      node.parentNode?.removeChild(node);
    }
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLElement)) return;
    // Publisher palettes (especially WeChat's white panels) must follow the reader theme.
    for (const property of ['background', 'background-color', 'background-image', 'color', '-webkit-text-fill-color', 'color-scheme']) {
      node.style.removeProperty(property);
    }
    if (node.hasAttribute('style') && !node.getAttribute('style')?.trim()) node.removeAttribute('style');
  });
  return purify;
}

export const articleSanitizeOptions = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'referrerpolicy'],
  FORBID_TAGS: ['style'],
  FORBID_ATTR: ['bgcolor', 'color', 'background'],
};

export function resolveArticleLinks(html: string, articleUrl: string | null): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')!;
    if (href.startsWith('#')) continue;
    try {
      const url = new URL(href, articleUrl ?? undefined);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error();
      anchor.setAttribute('href', url.href);
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.setAttribute('target', '_blank');
    } catch { anchor.removeAttribute('href'); }
  }
  return template.innerHTML;
}
