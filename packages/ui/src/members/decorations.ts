import { inject, type Component, type InjectionKey } from "vue";
import type { MemberView } from "@tumult/core";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/** Props every decoration component receives. */
export interface MemberDecorationProps {
    member: MemberView;
    /** The room the member row belongs to. */
    roomId: string;
}

/**
 * A small component rendered after a member row's built-in badges (Invited /
 * Banned) — role icons, bot flags, anything a plugin wants to mark a member
 * with. `match` is the only way to filter, and it runs on every roster
 * rebuild; keep it cheap.
 */
export interface MemberDecoration {
    /** Stable, namespaced id — the registry keys by it. */
    id: string;
    component: Component;
    /** Higher sorts further right. Default 0. */
    priority?: number;
    /** Render only for members this returns true for. Default: every member. */
    match?(member: MemberView): boolean;
}

/**
 * Per-shell member-decoration registry (provide/inject — never a module
 * singleton).
 */
export class MemberDecorationsRegistry {
    private readonly list = new ContributionList<MemberDecoration>(
        (decoration) => decoration.id,
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    public add(decoration: MemberDecoration): Disposable {
        return this.list.add(decoration);
    }

    public remove(id: string): boolean {
        return this.list.remove(id);
    }

    /** Decorations that apply to `member`, highest priority first. */
    public resolve(member: MemberView): MemberDecoration[] {
        return this.list.all().filter((decoration) => (decoration.match ? decoration.match(member) : true));
    }
}

export const MemberDecorationsKey: InjectionKey<MemberDecorationsRegistry> = Symbol("tumult/member-decorations");

export function useMemberDecorations(): MemberDecorationsRegistry {
    const registry = inject(MemberDecorationsKey);
    if (!registry) throw new Error("useMemberDecorations() requires TumultShell above it.");
    return registry;
}
