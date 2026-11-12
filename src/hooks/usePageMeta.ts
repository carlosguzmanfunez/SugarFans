import { useEffect } from 'react';
import { BRAND } from '../config/brand';
import { useLanguage } from '../context/LanguageContext';

// Per-page title, description and canonical address. index.html carries the home
// values for every route (it's a single-page app), so without this Google and
// AI search see every page as a copy of the home page. The home values come back
// when the page closes.
// jsonLd: structured data for this page (schema.org), e.g. a creator's ProfilePage.
type PageMeta = { title: string; description: string; path: string; jsonLd?: Record<string, unknown> };

const SELECTORS = {
  description: ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'],
  title: ['meta[property="og:title"]', 'meta[name="twitter:title"]'],
  url: ['meta[property="og:url"]'],
};

export const pageTitle = (title: string) => `${title} | ${BRAND.name}`;

export const usePageMeta = ({ title, description, path, jsonLd }: PageMeta, ready = true) => {
  const structured = jsonLd ? JSON.stringify(jsonLd).replace(/</g, '\\u003c') : '';
  useEffect(() => {
    if (!ready || !title) return;
    const fullTitle = pageTitle(title);
    const url = `${BRAND.url}${path}`;
    const changes: [Element, string, string][] = [];
    const set = (selectors: string[], attr: string, value: string) =>
      selectors.forEach((s) => {
        const el = document.head.querySelector(s);
        if (!el) return;
        changes.push([el, attr, el.getAttribute(attr) ?? '']);
        el.setAttribute(attr, value);
      });

    const previousTitle = document.title;
    document.title = fullTitle;
    set(SELECTORS.title, 'content', fullTitle);
    set(SELECTORS.description, 'content', description);
    set(SELECTORS.url, 'content', url);
    set(['link[rel="canonical"]'], 'href', url);
    let script: HTMLScriptElement | null = null;
    if (structured) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.page = 'true';
      script.textContent = structured;
      document.head.appendChild(script);
    }

    return () => {
      script?.remove();
      document.title = previousTitle;
      changes.reverse().forEach(([el, attr, value]) => el.setAttribute(attr, value));
    };
  }, [title, description, path, structured, ready]);
};

// The public pages with their texts in LanguageContext ('seo.<key>.title' / '.description').
export const useSeoPage = (key: 'explore' | 'reserve' | 'tour' | 'help' | 'legal', path: string) => {
  const { t } = useLanguage();
  usePageMeta({ title: t(`seo.${key}.title`), description: t(`seo.${key}.description`), path });
};
