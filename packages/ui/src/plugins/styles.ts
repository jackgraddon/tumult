/**
 * Plugin stylesheet injection.
 *
 * Plugins ship TypeScript modules, but a renderer's own CSS is usually easier
 * to write as text than as a scoped SFC, so `injectStylesheet(css)` appends one
 * `<style>` element to the document head and hands back a disposable that
 * removes it.
 *
 * The CSS is **not** shadowed or rewritten: it applies app-wide. A plugin's
 * stylesheet is first-party, app-authored CSS — the same trust level as the
 * module that injected it — and the shell has no shadow root to scope into.
 * What the guard below does buy is that an injected stylesheet can never make
 * the browser fetch a third-party resource: no `@import`, and no `url()`
 * except `data:`, `blob:` and same-document fragments. The dev CSP already
 * allows only `'self'` for styles and `data:`/`blob:`/`https:` for images, so
 * a remote reference would otherwise fail silently in the console; here it
 * becomes an install-time error naming the offending declaration.
 */

import type { Disposable } from "./types.ts";

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

/**
 * Append `css` as a `<style>` element owned by `owner` (a plugin id, or
 * `"shell"`). Throws when the stylesheet references anything remote, so the
 * install rolls back instead of half-applying. The returned disposable is
 * idempotent and removes exactly that element.
 */
export function injectStylesheet(css: string, owner: string): Disposable {
    const external = findExternalStylesheetReferences(css);
    if (external.length > 0) {
        throw new Error(
            `[tumult] the stylesheet from "${owner}" references external resources ` +
                `(${external.join(", ")}); inline them as data: URLs instead`,
        );
    }

    const element = document.createElement("style");
    element.dataset["tumultPluginStyles"] = owner;
    element.textContent = css;
    document.head.append(element);

    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        element.remove();
    };
}
