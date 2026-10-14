/**
 * Injected-CSS guard.
 *
 * Themes can inject CSS (the advanced opt-in), and plugins can inject
 * stylesheets, but neither may make the browser fetch a third-party resource:
 * the CSP allows only `'self'` for styles and `data:`/`blob:` for images, so a
 * remote reference would otherwise fail *silently* in the console. This guard
 * turns it into an error at install/apply time, naming the offending
 * declaration, and the install rolls back instead of half-applying.
 *
 * It lives here (not in the UI package) because both consumers share it: the
 * plugin host in `@tumult/ui` and the app's boot path (`@tumult/theme/runtime`)
 * that re-applies saved advanced CSS before the first paint.
 */

/** `@import` — the one at-rule that can pull in a whole remote stylesheet. */
const IMPORT = /@import\b[^;]*;?/gi;
/** Any `url(...)`, quoted or not. */
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

/** Printable form of a matched declaration: one line, no padded whitespace. */
function snippet(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/**
 * Only these reference forms cannot reach the network: an inline `data:` URL, a
 * `blob:` URL the app itself minted, or a same-document fragment (`url(#id)`).
 */
function isLocalReference(target: string): boolean {
    const value = target.trim();
    return value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#");
}

/**
 * Every declaration in `css` that could make the browser load a third-party
 * resource, as printable snippets (`[]` when the stylesheet is self-contained).
 *
 * `@import url(...)` is one offence, not two: a `url()` inside an `@import` is
 * already covered by the at-rule that carries it.
 */
export function findExternalStylesheetReferences(css: string): string[] {
    const imports: Array<{ start: number; end: number }> = [];
    const found: string[] = [];
    for (const match of css.matchAll(IMPORT)) {
        const start = match.index ?? 0;
        imports.push({ start, end: start + match[0].length });
        found.push(snippet(match[0]));
    }
    for (const match of css.matchAll(URL_REF)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (imports.some((span) => start >= span.start && end <= span.end)) continue;
        const target = match[1] ?? match[2] ?? match[3] ?? "";
        if (!isLocalReference(target)) {
            found.push(snippet(match[0]));
        }
    }
    return found;
}
