import { inject, type InjectionKey } from "vue";
import type { ChatClient } from "@tumult/core";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/**
 * What an action sees when it runs — and the only way it touches the draft.
 * Building the context requires a room and a client, so an action cannot run
 * outside them.
 */
export interface ComposerActionContext {
    /** The room the composer is writing into. */
    roomId: string;
    /** The draft exactly as typed when the action ran. */
    draft: string;
    /** The chat client (send, react, …) — the same contract the UI uses. */
    client: ChatClient;
    /** Replace the draft without sending (e.g. insert text for review). */
    setDraft(text: string): void;
}

/**
 * One button in the composer's action row (next to the attach button). Buttons
 * are icon-first, so `label` is required — it is the accessible name and the
 * tooltip.
 */
export interface ComposerAction {
    /** Stable, namespaced id — the registry keys by it. */
    id: string;
    /** Accessible name; also the tooltip. */
    label: string;
    /** Glyph rendered in the button; falls back to the label text. */
    icon?: string;
    /** Higher sorts further left. Default 0. */
    priority?: number;
    run(ctx: ComposerActionContext): void | Promise<void>;
}

/**
 * Per-shell composer-action registry (provide/inject — never a module
 * singleton, same rule as `TimelineRegistry`).
 */
export class ComposerActionsRegistry {
    private readonly list = new ContributionList<ComposerAction>(
        (action) => action.id,
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    public add(action: ComposerAction): Disposable {
        return this.list.add(action);
    }

    public remove(id: string): boolean {
        return this.list.remove(id);
    }

    /** Highest priority first. */
    public all(): ComposerAction[] {
        return this.list.all();
    }
}

export const ComposerActionsKey: InjectionKey<ComposerActionsRegistry> = Symbol("tumult/composer-actions");

/**
 * `null` outside a shell: `MessageComposer` is an exported primitive, and a
 * standalone use renders no plugin affordances rather than throwing.
 */
export function useComposerActions(): ComposerActionsRegistry | null {
    return inject(ComposerActionsKey, null);
}
