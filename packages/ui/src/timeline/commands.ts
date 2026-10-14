import { inject, type InjectionKey } from "vue";
import type { ChatClient } from "@tumult/core";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/** What a command sees when it runs. */
export interface CommandContext {
    /** The room the command was typed into. */
    roomId: string;
    /** The chat client (send, react, …) — the same contract the UI uses. */
    client: ChatClient;
    /** Everything after `/name`, trimmed ("" when the command had no args). */
    args: string;
    /** The full typed line, e.g. `/shrug deal with it`. */
    raw: string;
}

/**
 * A slash command. Typing `/name args` and submitting runs it instead of
 * sending the text; the composer's suggestion list is built from `name`,
 * `description` and `usage`.
 */
export interface Command {
    /** Lowercase name without the slash — a leading "/" and case are normalized. */
    name: string;
    /** Palette line under the name. */
    description?: string;
    /** Palette hint next to the name, e.g. `<text>`. */
    usage?: string;
    run(ctx: CommandContext): void | Promise<void>;
}

/** A command match — `resolve()` keeps the parsed args with the command. */
export interface ResolvedCommand {
    command: Command;
    args: string;
    raw: string;
}

/** Command names normalize to one lowercase token (used as the registry key). */
function normalize(name: string): string {
    const token = name.trim().toLowerCase().replace(/^\//, "");
    return /[\s/]/.test(token) ? "" : token;
}

/**
 * Per-shell slash-command registry (provide/inject — never a module
 * singleton).
 */
export class CommandsRegistry {
    private readonly list = new ContributionList<Command>(
        (command) => command.name,
        (a, b) => a.name.localeCompare(b.name),
    );

    /** Add a command. A leading "/" and casing are normalized; bad names throw. */
    public add(command: Command): Disposable {
        const name = normalize(command.name);
        if (!name) throw new Error(`[tumult] invalid command name: "${command.name}"`);
        return this.list.add({ ...command, name });
    }

    public remove(name: string): boolean {
        return this.list.remove(normalize(name));
    }

    /** Commands whose name starts with `prefix` ("" → all), alphabetical. */
    public suggest(prefix: string): Command[] {
        const needle = normalize(prefix);
        return this.list.all().filter((command) => command.name.startsWith(needle));
    }

    /**
     * Parse `/name args` — an exact name match at the start of `input`.
     * Returns `null` for anything else (plain text, an unknown command, or a
     * longer word that merely starts the same), so the composer sends those
     * verbatim instead of guessing.
     */
    public resolve(input: string): ResolvedCommand | null {
        const raw = input.trim();
        if (!raw.startsWith("/")) return null;
        const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(raw);
        if (!match) return null;
        const token = match[1] ?? "";
        // A name is one bare token: a second slash is not a command, so
        // `//shrug` stays literal text.
        if (token.includes("/")) return null;
        const command = this.list.get(token.toLowerCase());
        if (!command) return null;
        return { command, args: (match[2] ?? "").trim(), raw };
    }

    /** Alphabetical snapshot. */
    public all(): Command[] {
        return this.list.all();
    }
}

export const CommandsKey: InjectionKey<CommandsRegistry> = Symbol("tumult/commands");

/**
 * `null` outside a shell: `MessageComposer` is an exported primitive, and a
 * standalone use simply has no commands to run.
 */
export function useCommands(): CommandsRegistry | null {
    return inject(CommandsKey, null);
}
