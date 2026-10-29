<script setup lang="ts">
import { computed } from "vue";
import { DEFAULT_THEME_NAME } from "@tumult/theme";

import { useTheme } from "../theme/controls.ts";
import { toHexColor } from "../theme/color.ts";
import type { SettingsTabProps } from "./tabs.ts";
import SegmentedChoice from "./SegmentedChoice.vue";
import AppearancePreview from "./AppearancePreview.vue";

// The client is not part of theming; declared so `client`/`close` do not fall
// through onto the section element.
defineProps<SettingsTabProps>();

// The everyday choices only: which theme, which mode, which density. Managing
// theme documents (gallery, install, edit, advanced CSS) is the Themes page.
const theme = useTheme();
const state = theme.state;

interface ThemeCard {
    name: string;
    title: string;
    detail: string;
    swatch: string | null;
    unusable: boolean;
}

const REFERENCE = /^var\(--([a-z0-9-]+)\)$/;

/**
 * The accent a card previews. A theme is a sparse document over the built-in
 * one, so a `var(--…)` reference is followed through the theme's own tokens
 * first and the built-in defaults after — the same inheritance the cascade
 * applies. Anything that does not bottom out in a colour draws no chip.
 */
function accentOf(tokens: Record<string, string> | undefined): string | null {
    let value = tokens?.["accent"] ?? theme.defaults["accent"];
    // Bounded: a reference cycle in a hand-written document must not hang.
    for (let hops = 0; value !== undefined && hops < 8; hops += 1) {
        const ref = REFERENCE.exec(value.trim());
        if (!ref) return toHexColor(value);
        const name = ref[1] as string;
        value = tokens?.[name] ?? theme.defaults[name];
    }
    return null;
}

const cards = computed<ThemeCard[]>(() => {
    const builtIn: ThemeCard = {
        name: DEFAULT_THEME_NAME,
        title: "Default",
        detail: "Built in",
        swatch: accentOf(undefined),
        unusable: false,
    };
    const user = state.value.themes
        .filter((entry) => entry.name !== DEFAULT_THEME_NAME)
        .map((entry) => ({
            name: entry.name,
            title: entry.name,
            detail: entry.css === "" ? "Cannot be used" : "Installed",
            swatch: accentOf(entry.json.tokens),
            unusable: entry.css === "",
        }));
    return [builtIn, ...user];
});

const activeEntry = computed(() => state.value.themes.find((entry) => entry.name === state.value.active));
const activeIssues = computed(() => activeEntry.value?.validation.issues ?? []);

const modeOptions = computed(() => state.value.modes.map((mode) => ({ value: mode, label: mode })));
const densityOptions = computed(() =>
    state.value.densities.map((density) => ({ value: density, label: density })),
);
</script>

<template>
    <!-- Pinned while the choices below scroll, so every toggle is seen as it lands. -->
    <div class="tumult-appearance-preview">
        <AppearancePreview />
    </div>

    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading" id="tumult-theme-active-label">Theme</h3>
        <div class="tumult-theme-cards" role="radiogroup" aria-labelledby="tumult-theme-active-label">
            <label
                v-for="card in cards"
                :key="card.name"
                class="tumult-theme-card"
                :data-theme-card="card.name"
            >
                <input
                    class="tumult-theme-card-input"
                    type="radio"
                    name="tumult-theme-active"
                    :value="card.name"
                    :checked="card.name === state.active"
                    @change="theme.select(card.name)"
                />
                <span
                    class="tumult-theme-card-swatch"
                    :style="card.swatch ? { background: card.swatch } : undefined"
                    aria-hidden="true"
                />
                <span class="tumult-theme-card-text">
                    <span class="tumult-theme-card-title">{{ card.title }}</span>
                    <span class="tumult-theme-card-detail" :data-unusable="card.unusable ? 'true' : undefined">
                        {{ card.detail }}
                    </span>
                </span>
            </label>
        </div>
        <p class="tumult-settings-note">Get more from the gallery or install your own on the Themes page.</p>
        <ul v-if="activeIssues.length > 0" class="tumult-appearance-issues">
            <li
                v-for="(issue, index) in activeIssues"
                :key="index"
                :class="issue.severity === 'error' ? 'tumult-dialog-error' : 'tumult-settings-note'"
            >
                {{ issue.message }}
            </li>
        </ul>
    </section>

    <section class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Mode</h3>
        <SegmentedChoice
            name="tumult-theme-mode"
            label="Mode"
            :options="modeOptions"
            :model-value="state.mode"
            @update:model-value="(mode) => theme.setMode(mode)"
        />
        <p class="tumult-settings-note">
            A theme offers the modes it implements; “dark” is its base.
        </p>
    </section>

    <section v-if="state.densities.length > 1" class="tumult-settings-section">
        <h3 class="tumult-settings-heading">Density</h3>
        <SegmentedChoice
            name="tumult-theme-density"
            label="Density"
            :options="densityOptions"
            :model-value="state.density"
            @update:model-value="(density) => theme.setDensity(density)"
        />
        <p class="tumult-settings-note">
            How tightly rows pack in the timeline, room list and member list.
        </p>
    </section>
</template>

<style scoped>
.tumult-appearance-preview {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: var(--space-2) 0;
    background: var(--settings-bg);
}
.tumult-theme-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--layout-menu-min-width), 1fr));
    gap: var(--space-2);
}
.tumult-theme-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--control-radius);
    background: var(--surface-pane);
    cursor: pointer;
    transition:
        background-color var(--motion-fast) var(--motion-ease),
        border-color var(--motion-fast) var(--motion-ease);
}
.tumult-theme-card:hover {
    background: var(--settings-nav-item-bg-hover);
}
.tumult-theme-card:has(:checked) {
    border-color: var(--accent);
    background: var(--settings-nav-item-bg-active);
}
.tumult-theme-card:has(:focus-visible) {
    outline: var(--focus-ring-outline) solid var(--focus-ring-color);
}
/* Visually hidden but focusable: the card is the control you see. */
.tumult-theme-card-input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
}
.tumult-theme-card-swatch {
    flex-shrink: 0;
    width: var(--icon-md);
    height: var(--icon-md);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-full);
    background: var(--surface-inset);
}
.tumult-theme-card-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.tumult-theme-card-title {
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tumult-theme-card-detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.tumult-theme-card-detail[data-unusable] {
    color: var(--danger);
}
.tumult-appearance-issues {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
