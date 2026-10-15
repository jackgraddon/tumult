<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { ALL_TOKENS } from "@tumult/theme";
import type { ThemeJson, TokenDef, TokenTier, ValidationIssue } from "@tumult/theme";

import { tokenHex } from "../theme/color.ts";
import { useTheme } from "../theme/controls.ts";

/**
 * The minimal theme editor: a token tree with colour pickers and a JSON view,
 * previewing live.
 *
 * It edits a *draft* and never stores anything itself — every change goes to
 * `preview()`, which validates and applies it to the document without
 * persisting, so the app repaints as you type. Save hands the draft to
 * `install()`; Cancel (or unmounting) calls `endPreview()`, which restores the
 * stored selection. That split is why a broken draft cannot leave the app
 * wearing a half-applied theme.
 *
 * The draft is intentionally sparse: a token that is not in `tokens` is shown
 * with the built-in theme's value as the placeholder and simply inherits it, so
 * saving a theme writes only what was actually changed. Mode overrides
 * (`modes.*`) come along for the ride when editing an existing theme but are
 * not editable here — author those by pasting JSON into the Install box in the
 * Appearance tab.
 */
const props = defineProps<{ initial: ThemeJson; title: string }>();
const emit = defineEmits<{ done: [] }>();

const theme = useTheme();

const draft = ref<ThemeJson>(clone(props.initial));
const issues = shallowRef<ValidationIssue[]>([]);

const query = ref("");
const tier = ref<TokenTier | "all">("all");
const onlyChanged = ref(false);
const tiers: TokenTier[] = ["primitive", "semantic", "component"];

/** Deep copy with a guaranteed `tokens` map, so the rows never index null. */
function clone(json: ThemeJson): ThemeJson {
    const copy = JSON.parse(JSON.stringify(json)) as ThemeJson;
    if (copy.tokens === null || typeof copy.tokens !== "object") copy.tokens = {};
    return copy;
}

function isOverridden(name: string): boolean {
    return draft.value.tokens[name] !== undefined;
}

function isChanged(def: TokenDef): boolean {
    const value = draft.value.tokens[def.name];
    return value !== undefined && value !== def.value;
}

const rows = computed<TokenDef[]>(() => {
    const needle = query.value.trim().toLowerCase();
    return ALL_TOKENS.filter((def) => {
        if (tier.value !== "all" && def.tier !== tier.value) return false;
        if (onlyChanged.value && !isChanged(def)) return false;
        if (needle === "") return true;
        return def.name.toLowerCase().includes(needle) || def.description.toLowerCase().includes(needle);
    });
});

const jsonText = computed(() => JSON.stringify(draft.value, null, 2));

const changedCount = computed(() => ALL_TOKENS.filter(isChanged).length);

function valueOf(name: string): string {
    return draft.value.tokens[name] ?? "";
}

function setValue(name: string, value: string): void {
    if (value === "") delete draft.value.tokens[name];
    else draft.value.tokens[name] = value;
}

function onText(event: Event): void {
    const input = event.target as HTMLInputElement;
    setValue(input.dataset["token"] ?? "", input.value);
}

function onPick(name: string, event: Event): void {
    setValue(name, (event.target as HTMLInputElement).value);
}

function swatch(name: string): string {
    return tokenHex(name, draft.value.tokens, theme.defaults) ?? "#000000";
}

/** Throw the edits away and go back to the document this editor opened with. */
function discard(): void {
    draft.value = clone(props.initial);
    issues.value = [];
}

// Live preview: the last *valid* draft stays applied while the draft is broken,
// so clearing a field to retype it does not blank the app.
watch(
    draft,
    () => {
        issues.value = theme.preview(draft.value).issues;
    },
    { deep: true },
);

function save(): void {
    const result = theme.install(draft.value);
    issues.value = result.issues;
    if (result.ok) emit("done");
}

function cancel(): void {
    emit("done");
}

// Leaving the editor (saving, cancelling, or the tab unmounting) must always
// drop the preview slot; `install` clears it too, so this is only the backstop.
onBeforeUnmount(() => theme.endPreview());

theme.preview(draft.value);
</script>

<template>
    <section class="tumult-settings-section">
        <header class="tumult-editor-head">
            <h3 class="tumult-settings-heading">{{ props.title }}</h3>
            <p class="tumult-editor-count" role="status">
                {{ changedCount }} token{{ changedCount === 1 ? "" : "s" }} changed
            </p>
        </header>

        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-theme-name">Theme name</label>
            <input
                id="tumult-theme-name"
                v-model="draft.name"
                class="tumult-dialog-input"
                type="text"
                maxlength="64"
                spellcheck="false"
            />
            <p class="tumult-dialog-hint">
                Letters, digits, dots, dashes and underscores. It becomes the theme's CSS
                selector, so it must be safe there — and “default” is reserved for the
                built-in theme. Changes preview live.
            </p>
        </div>

        <ul v-if="issues.some((issue) => issue.severity === 'error')" class="tumult-theme-issues">
            <li
                v-for="(issue, index) in issues.filter((issue) => issue.severity === 'error')"
                :key="index"
                class="tumult-dialog-error"
            >
                {{ issue.message }}
            </li>
        </ul>

        <div class="tumult-editor-filters">
            <input
                v-model="query"
                class="tumult-dialog-input"
                type="search"
                placeholder="Search tokens and descriptions"
                aria-label="Search tokens"
            />
            <select v-model="tier" class="tumult-editor-select" aria-label="Token tier">
                <option value="all">All tiers</option>
                <option v-for="name in tiers" :key="name" :value="name">{{ name }}</option>
            </select>
            <label class="tumult-dialog-check">
                <input v-model="onlyChanged" type="checkbox" />
                Only changed
            </label>
        </div>

        <div class="tumult-editor-tokens">
            <div v-for="def in rows" :key="def.name" class="tumult-token">
                <span class="tumult-token-name" :title="def.description">--{{ def.name }}</span>
                <span class="tumult-token-kind">{{ def.kind }}</span>
                <input
                    class="tumult-dialog-input tumult-token-value"
                    type="text"
                    spellcheck="false"
                    :value="valueOf(def.name)"
                    :placeholder="theme.defaults[def.name] ?? def.value ?? ''"
                    :data-token="def.name"
                    :aria-label="`Value for --${def.name}`"
                    @input="onText"
                />
                <input
                    v-if="def.kind === 'color'"
                    class="tumult-token-swatch"
                    type="color"
                    :value="swatch(def.name)"
                    :aria-label="`Colour swatch for --${def.name}`"
                    @input="onPick(def.name, $event)"
                />
                <span v-else class="tumult-token-swatch tumult-token-swatch-empty" />
                <button
                    v-if="isOverridden(def.name)"
                    type="button"
                    class="tumult-dialog-button tumult-token-reset"
                    :aria-label="`Reset --${def.name} to its default`"
                    @click="setValue(def.name, '')"
                >
                    Reset
                </button>
                <span v-else class="tumult-token-reset" />
            </div>
            <p v-if="rows.length === 0" class="tumult-settings-note">No tokens match this filter.</p>
        </div>

        <details class="tumult-editor-json">
            <summary class="tumult-editor-summary">JSON</summary>
            <textarea
                class="tumult-dialog-textarea"
                :value="jsonText"
                readonly
                spellcheck="false"
                aria-label="Theme JSON"
            />
        </details>

        <div class="tumult-dialog-actions">
            <button type="button" class="tumult-dialog-button" @click="discard">Discard changes</button>
            <button type="button" class="tumult-dialog-button" @click="cancel">Cancel</button>
            <button type="button" class="tumult-dialog-button tumult-dialog-primary" @click="save">
                Save theme
            </button>
        </div>
    </section>
</template>

<style scoped>
.tumult-editor-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
}
.tumult-editor-count {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-theme-issues {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-editor-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}
.tumult-editor-filters .tumult-dialog-input {
    flex: 1 1 var(--menu-min-width);
}
.tumult-editor-select {
    padding: var(--space-2);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
.tumult-editor-tokens {
    max-height: var(--picker-results-max-height);
    overflow-y: auto;
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
}
.tumult-token {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 2fr) auto auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
}
.tumult-token + .tumult-token {
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-token-name {
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}
.tumult-token-kind {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-token-swatch {
    inline-size: var(--icon-md);
    block-size: var(--icon-md);
    padding: 0;
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
}
.tumult-token-swatch-empty {
    display: inline-block;
}
.tumult-token-reset {
    font-size: var(--text-xs);
}
.tumult-editor-summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-editor-json .tumult-dialog-textarea {
    margin-top: var(--space-2);
}
</style>
