<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { DEFAULT_THEME_NAME, TOKEN_CONTRACT_VERSION } from "@tumult/theme";
import type { ThemeEntry, ThemeJson, ValidationIssue } from "@tumult/theme";

import { useTheme } from "../theme/controls.ts";
import { toHexColor } from "../theme/color.ts";
import type { SettingsTabProps } from "./tabs.ts";
import ThemeEditor from "./ThemeEditor.vue";

// The client is not part of theming; declared so `client`/`close` do not fall
// through onto the section element.
defineProps<SettingsTabProps>();

// Managing theme documents: the gallery, installing, editing, advanced CSS and
// reset. Picking which theme is live is the Appearance page.

const theme = useTheme();
const state = theme.state;

/** Non-null while the token editor is open; it replaces this whole panel. */
const editor = shallowRef<{ title: string; initial: ThemeJson } | null>(null);

const pasted = ref("");
const installIssues = shallowRef<ValidationIssue[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const advancedEnabled = ref(state.value.advancedCss !== "");
const advancedText = ref(state.value.advancedCss);
const advancedIssues = shallowRef<ValidationIssue[]>([]);

const resetArmed = ref(false);
/** Name of the entry whose stored JSON is being shown, or null. */
const jsonShown = ref<string | null>(null);

const userThemes = computed(() => state.value.themes.filter((entry) => entry.name !== DEFAULT_THEME_NAME));

const installErrors = computed(() => installIssues.value.filter((issue) => issue.severity === "error"));
const installNotes = computed(() => installIssues.value.filter((issue) => issue.severity !== "error"));
const advancedErrors = computed(() => advancedIssues.value.filter((issue) => issue.severity === "error"));

const galleryIssues = shallowRef<ValidationIssue[]>([]);
/** Id of the gallery theme whose document is in flight, or null. */
const galleryBusy = ref<string | null>(null);

const gallery = computed(() => theme.gallery.value);
/** Gallery rows the user has already installed show "Use" instead of "Install". */
const installed = computed(() => new Set(userThemes.value.map((entry) => entry.name)));

// The index is a static asset the app ships; fetching it on open keeps the cost
// off users who never look at theming (the controller fetches it once, ever).
onMounted(() => theme.loadGallery());

/**
 * A gallery swatch is a theme-authored colour, resolved to a hex for the chip.
 * The fallback is only reachable if the shipped index drifts from the document
 * it points at (the guard test pins them together).
 */
function swatchHex(colour: string): string {
    return toHexColor(colour) ?? "transparent";
}

async function installGallery(id: string): Promise<void> {
    galleryBusy.value = id;
    const result = await theme.installGallery(id);
    galleryBusy.value = null;
    galleryIssues.value = result.ok ? [] : result.issues;
}

const shownJson = computed(() => {
    const name = jsonShown.value;
    if (name === null) return "";
    const entry = state.value.themes.find((candidate) => candidate.name === name);
    return entry ? JSON.stringify(entry.json, null, 2) : "";
});

function install(): void {
    const result = theme.install(pasted.value);
    installIssues.value = result.issues;
    if (result.ok) pasted.value = "";
}

async function onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // re-picking the same file must still fire `change`
    if (!file) return;
    try {
        pasted.value = await file.text();
    } catch {
        installIssues.value = [
            { code: "invalid-envelope", severity: "error", message: `Could not read ${file.name}.` },
        ];
    }
}

function startNew(): void {
    editor.value = {
        title: "New theme",
        initial: { version: TOKEN_CONTRACT_VERSION, name: "my-theme", tokens: {} },
    };
}

function startEdit(entry: ThemeEntry): void {
    editor.value = { title: `Edit ${entry.name}`, initial: entry.json };
}

function finishEditor(): void {
    editor.value = null;
}

function remove(name: string): void {
    theme.remove(name);
    if (jsonShown.value === name) jsonShown.value = null;
}

function toggleJson(name: string): void {
    jsonShown.value = jsonShown.value === name ? null : name;
}

function applyAdvanced(): void {
    const result = theme.setAdvancedCss(advancedEnabled.value ? advancedText.value : "");
    advancedIssues.value = result.ok ? [] : result.issues;
}

// Turning the opt-in off has to take effect immediately, not on the next Apply
// — the checkbox is the switch that makes the CSS live.
watch(advancedEnabled, (enabled) => {
    if (enabled) return;
    const result = theme.setAdvancedCss("");
    advancedIssues.value = result.ok ? [] : result.issues;
});

function reset(): void {
    theme.reset();
    resetArmed.value = false;
    pasted.value = "";
    installIssues.value = [];
    advancedEnabled.value = false;
    advancedText.value = "";
    advancedIssues.value = [];
    jsonShown.value = null;
}
</script>

<template>
    <ThemeEditor
        v-if="editor"
        :title="editor.title"
        :initial="editor.initial"
        @done="finishEditor"
    />

    <template v-else>
        <section v-if="gallery.length > 0" class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Theme gallery</h3>
            <p class="tumult-settings-note">
                Accent themes that ship with Tumult. Installing stores a copy of the document you
                can edit or delete like any other.
            </p>
            <ul class="tumult-appearance-list">
                <li
                    v-for="item in gallery"
                    :key="item.id"
                    class="tumult-appearance-row"
                    :data-gallery-theme="item.id"
                >
                    <span class="tumult-appearance-name">
                        <span class="tumult-gallery-swatches" aria-hidden="true">
                            <span
                                v-for="(colour, index) in item.swatch"
                                :key="index"
                                class="tumult-gallery-swatch"
                                :style="{ background: swatchHex(colour) }"
                            />
                        </span>
                        <span class="tumult-gallery-text">
                            <span class="tumult-gallery-title">{{ item.title }}</span>
                            <span class="tumult-appearance-detail">{{ item.description }}</span>
                        </span>
                    </span>
                    <span class="tumult-appearance-actions">
                        <button
                            v-if="installed.has(item.id)"
                            type="button"
                            class="tumult-dialog-button"
                            :data-gallery-use="item.id"
                            @click="theme.select(item.id)"
                        >
                            Use
                        </button>
                        <button
                            v-else
                            type="button"
                            class="tumult-dialog-button tumult-dialog-primary"
                            :data-gallery-install="item.id"
                            :disabled="galleryBusy !== null"
                            @click="installGallery(item.id)"
                        >
                            {{ galleryBusy === item.id ? "Installing…" : "Install" }}
                        </button>
                    </span>
                </li>
            </ul>
            <ul v-if="galleryIssues.length > 0" class="tumult-appearance-issues">
                <li v-for="(issue, index) in galleryIssues" :key="index" class="tumult-dialog-error">
                    {{ issue.message }}
                </li>
            </ul>
        </section>

        <section class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Install a theme</h3>
            <p class="tumult-settings-note">
                Paste a theme document or pick a <code>.json</code> file. It is validated before it is
                stored: unknown tokens, unsafe values and references that could fetch remote resources
                are refused, and nothing is saved unless the whole document is valid.
            </p>
            <textarea
                id="tumult-theme-install"
                v-model="pasted"
                class="tumult-dialog-textarea"
                spellcheck="false"
                placeholder='{ "version": 1, "name": "my-theme", "tokens": { "accent": "#7aa2f7" } }'
            />
            <ul v-if="installErrors.length > 0" class="tumult-appearance-issues">
                <li v-for="(issue, index) in installErrors" :key="index" class="tumult-dialog-error">
                    {{ issue.message }}
                </li>
            </ul>
            <ul v-else-if="installNotes.length > 0" class="tumult-appearance-issues">
                <li v-for="(issue, index) in installNotes" :key="index" class="tumult-settings-note">
                    {{ issue.message }}
                </li>
            </ul>
            <div class="tumult-dialog-actions">
                <input
                    id="tumult-theme-file"
                    ref="fileInput"
                    class="tumult-appearance-file"
                    type="file"
                    accept="application/json,.json"
                    aria-label="Theme file"
                    @change="onFile"
                />
                <button
                    type="button"
                    class="tumult-dialog-button"
                    data-testid="theme-new"
                    @click="startNew"
                >
                    New theme
                </button>
                <button
                    type="button"
                    class="tumult-dialog-button tumult-dialog-primary"
                    data-testid="theme-install"
                    :disabled="pasted.trim() === ''"
                    @click="install"
                >
                    Install
                </button>
            </div>
        </section>

        <section v-if="userThemes.length > 0" class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Your themes</h3>
            <ul class="tumult-appearance-list">
                <li
                    v-for="entry in userThemes"
                    :key="entry.name"
                    class="tumult-appearance-row"
                    :data-theme-name="entry.name"
                >
                    <span class="tumult-appearance-name">
                        {{ entry.name }}
                        <span v-if="entry.css === ''" class="tumult-appearance-badge">cannot be used</span>
                    </span>
                    <span class="tumult-appearance-actions">
                        <button
                            type="button"
                            class="tumult-dialog-button"
                            :data-theme-edit="entry.name"
                            @click="startEdit(entry)"
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            class="tumult-dialog-button"
                            :data-theme-json="entry.name"
                            @click="toggleJson(entry.name)"
                        >
                            JSON
                        </button>
                        <button
                            type="button"
                            class="tumult-dialog-button tumult-dialog-danger"
                            :data-theme-delete="entry.name"
                            @click="remove(entry.name)"
                        >
                            Delete
                        </button>
                    </span>
                </li>
            </ul>
            <textarea
                v-if="jsonShown"
                class="tumult-dialog-textarea"
                :value="shownJson"
                readonly
                spellcheck="false"
                aria-label="Stored theme JSON"
            />
        </section>

        <section class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Advanced CSS</h3>
            <label class="tumult-dialog-check">
                <input
                    id="tumult-theme-advanced"
                    v-model="advancedEnabled"
                    type="checkbox"
                    data-testid="theme-advanced"
                />
                Enable advanced CSS (CSP-aware)
            </label>
            <p class="tumult-settings-note">
                Arbitrary CSS applied after the theme. It can restyle anything in the app, so only use
                CSS you understand. It cannot load remote resources — <code>@import</code> and any
                <code>url()</code> that is not a <code>data:</code> URL are rejected.
            </p>
            <textarea
                id="tumult-theme-advanced-css"
                v-model="advancedText"
                class="tumult-dialog-textarea"
                spellcheck="false"
                :disabled="!advancedEnabled"
                placeholder=".tumult-timeline { letter-spacing: 0.01em; }"
            />
            <ul v-if="advancedErrors.length > 0" class="tumult-appearance-issues">
                <li v-for="(issue, index) in advancedErrors" :key="index" class="tumult-dialog-error">
                    {{ issue.message }}
                </li>
            </ul>
            <div class="tumult-dialog-actions">
                <button
                    type="button"
                    class="tumult-dialog-button"
                    data-testid="theme-advanced-apply"
                    :disabled="!advancedEnabled"
                    @click="applyAdvanced"
                >
                    Apply CSS
                </button>
            </div>
        </section>

        <section class="tumult-settings-section">
            <h3 class="tumult-settings-heading">Reset</h3>
            <p class="tumult-settings-note">
                Removes every stored theme and the advanced CSS, and returns to the built-in theme.
            </p>
            <div class="tumult-dialog-actions">
                <button
                    v-if="!resetArmed"
                    type="button"
                    class="tumult-dialog-button"
                    data-testid="theme-reset"
                    @click="resetArmed = true"
                >
                    Reset theme settings
                </button>
                <button
                    v-else
                    type="button"
                    class="tumult-dialog-button tumult-dialog-danger"
                    data-testid="theme-reset-confirm"
                    @click="reset"
                >
                    Confirm reset
                </button>
            </div>
        </section>
    </template>
</template>

<style scoped>
.tumult-appearance-issues {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-appearance-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.tumult-appearance-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
}
.tumult-appearance-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-primary);
    font-size: var(--text-md);
}
.tumult-appearance-badge {
    color: var(--danger);
    font-size: var(--text-xs);
}
.tumult-appearance-detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-gallery-swatches {
    display: inline-flex;
    flex-shrink: 0;
}
.tumult-gallery-swatch {
    width: var(--icon-sm);
    height: var(--icon-sm);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-sm);
}
.tumult-gallery-swatch + .tumult-gallery-swatch {
    /* The hover colour tucks under the accent, Discord-avatar style. */
    margin-left: calc(var(--space-1) * -1 + var(--space-px));
}
.tumult-gallery-text {
    display: flex;
    flex-direction: column;
}
.tumult-gallery-title {
    color: var(--text-primary);
    font-size: var(--text-md);
}
.tumult-appearance-actions {
    display: inline-flex;
    gap: var(--space-1);
}
.tumult-appearance-file {
    /* Takes the slack on the install row so the picker sits at the left edge
       instead of drifting to the middle when the buttons wrap. */
    flex: 1;
    min-width: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
</style>
