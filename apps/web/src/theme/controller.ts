/**
 * The app's `ThemeControls` implementation: a localStorage-backed `ThemeStore`
 * plus DOM application, wrapped in one Vue reactive snapshot.
 *
 * The UI renders the editor but owns none of this: storage, the `data-theme`/
 * `data-mode` attributes and the injected stylesheets are app business. There
 * is exactly one controller per document (like one client per renderer) — the
 * theme is a document-level property, so two of them could only fight.
 */
import { shallowRef, type Ref } from "vue";
import {
    DEFAULT_THEME_DENSITY,
    DEFAULT_THEME_MODE,
    DEFAULT_THEME_NAME,
    ThemeStore,
    loadTheme,
    loadThemeText,
} from "@tumult/theme";
import type { ThemeDensity, ThemeJson, ThemeMode, ValidationIssue } from "@tumult/theme";
import type { ThemeControls, ThemeGalleryEntry, ThemeResult, ThemeState } from "@tumult/ui";

import defaultThemeDocument from "@tumult/theme/themes/default.json";

import { applyAdvancedCss, setDocumentTheme, setThemeSlot } from "./apply.ts";
import { parseGallery } from "./gallery.ts";

const RESERVED_NAME_ISSUE: ValidationIssue = {
    code: "invalid-name",
    severity: "error",
    message: `"${DEFAULT_THEME_NAME}" is reserved for the built-in theme; rename this one to preview it.`,
};

function refused(message: string): ThemeResult {
    return { ok: false, issues: [{ code: "invalid-envelope", severity: "error", message }] };
}

class AppThemeController implements ThemeControls {
    public readonly state: Ref<ThemeState>;

    /**
     * The built-in theme document, imported as JSON (not hardcoded): the editor
     * resolves swatches and placeholders against it, since the registry carries
     * structure only and `base.css` — compiled from this same file — is what the
     * app actually wears.
     */
    public readonly defaults: Record<string, string> = { ...defaultThemeDocument.tokens };

    /**
     * Shipped gallery themes, fetched from the app's own static assets. The
     * fetch lives here because the gallery is app data; the tab only sees the
     * parsed list.
     */
    public readonly gallery: Ref<ThemeGalleryEntry[]> = shallowRef<ThemeGalleryEntry[]>([]);

    private galleryRequested = false;

    private readonly store: ThemeStore;

    public constructor(storage: Storage) {
        this.store = new ThemeStore(storage);
        this.state = shallowRef(this.snapshot());
        this.paint();
    }

    /** Select the stored theme (and mode/density) on the document. */
    private paint(): void {
        setDocumentTheme(this.store.active(), this.store.mode(), this.store.density());
        setThemeSlot("active", this.store.activeCss());
    }

    private snapshot(): ThemeState {
        return {
            active: this.store.active(),
            mode: this.store.mode(),
            modes: this.store.activeModes(),
            density: this.store.density(),
            densities: this.store.activeDensities(),
            themes: this.store.list(),
            advancedCss: this.store.advancedCss(),
        };
    }

    private sync(): void {
        this.state.value = this.snapshot();
    }

    public select(name: string): void {
        if (!this.store.select(name)) return;
        this.endPreview();
        this.paint();
        this.sync();
    }

    public setMode(mode: ThemeMode): void {
        if (!this.store.setMode(mode)) return;
        this.paint();
        this.sync();
    }

    public setDensity(density: ThemeDensity): void {
        if (!this.store.setDensity(density)) return;
        this.paint();
        this.sync();
    }

    public install(input: unknown): ThemeResult {
        const result = this.store.save(input);
        if (!result.ok) return { ok: false, issues: result.issues };
        this.endPreview();
        this.paint();
        this.sync();
        return { ok: true, issues: result.entry.validation.issues };
    }

    public remove(name: string): void {
        if (!this.store.remove(name)) return;
        this.endPreview();
        this.paint();
        this.sync();
    }

    public loadGallery(): void {
        // Idempotent: the tab mounts every time it opens, the index is static.
        if (this.galleryRequested) return;
        this.galleryRequested = true;
        void fetch("/themes/index.json")
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                const entries = parseGallery(data);
                if (entries.length > 0) this.gallery.value = entries;
            })
            .catch(() => {
                // A gallery that will not load is not an error the user must
                // see: the section simply has nothing to offer.
            });
    }

    public async installGallery(id: string): Promise<ThemeResult> {
        try {
            const response = await fetch(`/themes/${encodeURIComponent(id)}.json`);
            if (!response.ok) return refused(`Could not load the “${id}” theme (HTTP ${response.status}).`);
            return this.install(await response.text());
        } catch {
            return refused(`Could not load the “${id}” theme.`);
        }
    }

    public preview(input: unknown): ThemeResult {
        const loaded = typeof input === "string" ? loadThemeText(input) : loadTheme(input);

        // A broken draft keeps the last *valid* preview applied (the editor is
        // being typed into, so blanking the app on every half-finished value
        // would be worse than showing a slightly stale one) — but it must not
        // be applied, and it must explain itself.
        if (loaded.css === null) return { ok: false, issues: loaded.validation.issues };
        if (loaded.name === DEFAULT_THEME_NAME) {
            // The built-in theme's CSS is compiled at build time under this very
            // selector; previewing another document under it would corrupt it.
            return { ok: false, issues: [RESERVED_NAME_ISSUE] };
        }

        setDocumentTheme(loaded.name, this.previewMode(loaded.json), this.previewDensity(loaded.json));
        setThemeSlot("preview", loaded.css);
        return { ok: true, issues: loaded.validation.issues };
    }

    /**
     * The mode to preview in: the current one when the draft implements it,
     * else the base map — the same rule the store applies when the draft is
     * saved, so the preview is what `Save` would produce.
     */
    private previewMode(json: ThemeJson): ThemeMode {
        const current = this.store.mode();
        if (current !== DEFAULT_THEME_MODE && json.modes !== undefined && current in json.modes) return current;
        return DEFAULT_THEME_MODE;
    }

    /** The density to preview in, by the same rule as the mode. */
    private previewDensity(json: ThemeJson): ThemeDensity {
        const current = this.store.density();
        if (current !== DEFAULT_THEME_DENSITY && json.densities !== undefined && current in json.densities) {
            return current;
        }
        return DEFAULT_THEME_DENSITY;
    }

    public endPreview(): void {
        setThemeSlot("preview", "");
        this.paint();
    }

    public setAdvancedCss(css: string): ThemeResult {
        const result = this.store.setAdvancedCss(css);
        if (!result.ok) return { ok: false, issues: result.issues };

        const rejected = applyAdvancedCss(this.store.advancedCss());
        if (rejected.length > 0) {
            // Stored CSS is guarded before it is persisted, so this is a "can't
            // happen" — report it as a failure rather than leaving the slot stale.
            return {
                ok: false,
                issues: [
                    {
                        code: "banned-url",
                        severity: "error",
                        message: `Advanced CSS cannot reference external resources (${rejected.join(", ")}).`,
                    },
                ],
            };
        }
        this.sync();
        return { ok: true, issues: [] };
    }

    public reset(): void {
        this.store.reset();
        this.endPreview();
        applyAdvancedCss("");
        this.sync();
    }
}

export const themeController: ThemeControls = new AppThemeController(localStorage);
