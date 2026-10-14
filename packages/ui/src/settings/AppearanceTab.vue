<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { DEFAULT_THEME_NAME, TOKEN_CONTRACT_VERSION } from "@tumult/theme";
import type { ThemeEntry, ThemeJson, ValidationIssue } from "@tumult/theme";

import { useTheme } from "../theme/controls.ts";
import type { SettingsTabProps } from "./tabs.ts";
import ThemeEditor from "./ThemeEditor.vue";

// The client is not part of theming; declared so `client`/`close` do not fall
// through onto the section element.
defineProps<SettingsTabProps>();

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
const activeEntry = computed(() => state.value.themes.find((entry) => entry.name === state.value.active));
const activeIssues = computed(() => activeEntry.value?.validation.issues ?? []);

const installErrors = computed(() => installIssues.value.filter((issue) => issue.severity === "error"));
const installNotes = computed(() => installIssues.value.filter((issue) => issue.severity !== "error"));
const advancedErrors = computed(() => advancedIssues.value.filter((issue) => issue.severity === "error"));

const shownJson = computed(() => {
    const name = jsonShown.value;
    if (name === null) return "";
    const entry = state.value.themes.find((candidate) => candidate.name === name);
    return entry ? JSON.stringify(entry.json, null, 2) : "";
});

function onSelect(event: Event): void {
    theme.select((event.target as HTMLSelectElement).value);
}

function onMode(event: Event): void {
    theme.setMode((event.target as HTMLSelectElement).value);
}

function onDensity(event: Event): void {
    theme.setDensity((event.target as HTMLSelectElement).value);
}

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

    <section v-else class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Theme</h3>
        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-theme-active">Active theme</label>
            <select
                id="tumult-theme-active"
                class="tumult-appearance-select"
                :value="state.active"
                @change="onSelect"
            >
                <option :value="DEFAULT_THEME_NAME">Default (built in)</option>
                <option v-for="entry in userThemes" :key="entry.name" :value="entry.name">
                    {{ entry.name }}{{ entry.css === "" ? " — unusable" : "" }}
                </option>
            </select>
        </div>

        <div class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-theme-mode">Mode</label>
            <select
                id="tumult-theme-mode"
                class="tumult-appearance-select"
                :value="state.mode"
                @change="onMode"
            >
                <option v-for="mode in state.modes" :key="mode" :value="mode">{{ mode }}</option>
            </select>
            <p class="tumult-dialog-hint">
                A theme offers the modes it implements. “dark” is the base map; other modes are
                the theme's overrides.
            </p>
        </div>

        <div v-if="state.densities.length > 1" class="tumult-dialog-field">
            <label class="tumult-dialog-label" for="tumult-theme-density">Density</label>
            <select
                id="tumult-theme-density"
                class="tumult-appearance-select"
                :value="state.density"
                @change="onDensity"
            >
                <option v-for="density in state.densities" :key="density" :value="density">
                    {{ density }}
                </option>
            </select>
            <p class="tumult-dialog-hint">
                How tightly rows pack in the timeline, room list and member list. A theme offers
                the densities it implements.
            </p>
        </div>

        <ul v-if="activeIssues.length > 0" class="tumult-appearance-issues">
            <li
                v-for="(issue, index) in activeIssues"
                :key="index"
                :class="issue.severity === 'error' ? 'tumult-dialog-error' : 'tumult-settings-note'"
            >
                {{ issue.message }}
            </li>
        </ul>

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

        <template v-if="userThemes.length > 0">
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
        </template>

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

<style scoped>
.tumult-appearance-select {
    padding: var(--space-2);
    border: var(--border-width) solid var(--input-border);
    border-radius: var(--control-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font: inherit;
    font-size: var(--text-sm);
}
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
