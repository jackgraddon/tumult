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
/**
 * Functions that take a bare STRING as an image or resource reference, with no
 * `url()` in sight: `image-set("https://…" 1x)` and its prefixed form, and
 * `src("…")`. A guard that only looked for `url(` let these through (security
 * review finding F2).
 */
const STRING_REF_FUNCTION = /(?:-webkit-)?image-set\(|\bsrc\(/gi;
/** A quoted CSS string. */
const STRING = /"([^"]*)"|'([^']*)'/g;

/**
 * The text the browser actually tokenizes: CSS escapes decoded (`\` + 1–6 hex
 * digits and one optional whitespace, or `\` + any other character) and
 * comments removed. Scanning the raw text let `u\72l(…)` — which IS `url(` to
 * the browser — slip past (F2).
 */
function tokenizerView(css: string): string {
    const decoded = css.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f])/g, (_match, hex: string | undefined, char: string | undefined) => {
        if (hex === undefined) return char ?? "";
        const code = Number.parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    });
    return decoded.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** The text inside the parentheses that open at `open` (the index of "("), or null if unbalanced. */
function argumentsAt(text: string, open: number): string | null {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
    }
    return null;
}

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
export function findExternalStylesheetReferences(raw: string): string[] {
    const css = tokenizerView(raw);
    const imports: Array<{ start: number; end: number }> = [];
    const found: string[] = [];
    for (const match of css.matchAll(STRING_REF_FUNCTION)) {
        const open = (match.index ?? 0) + match[0].length - 1;
        const args = argumentsAt(css, open);
        if (args === null) {
            // Unbalanced: the browser would read to the end. Refuse rather than guess.
            found.push(snippet(css.slice(match.index ?? 0, (match.index ?? 0) + 80)));
            continue;
        }
        // url() arguments are judged by the url() rule below; here only the
        // bare strings, which reach the network with no url() around them.
        const bare = args.replace(URL_REF, " ");
        for (const string of bare.matchAll(STRING)) {
            if (!isLocalReference(string[1] ?? string[2] ?? "")) {
                found.push(snippet(`${match[0]}${args})`));
                break;
            }
        }
    }
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
