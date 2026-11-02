import { inject, type Component, type InjectionKey } from "vue";
import type { ChatClient, MemberView } from "@tumult/core/contract";

import { ContributionList } from "../plugins/contributions.ts";
import type { Disposable } from "../plugins/types.ts";

/** Props every profile section receives. */
export interface ProfileSectionProps {
    /** The member whose card is open. */
    member: MemberView;
    /** The room the card was opened from — carried for room-scoped data. */
    roomId: string;
    /**
     * The shell's client. Handed over rather than re-read from a registry so a
     * section reads the same contract the card does and can subscribe to its
     * own feeds (a favourite game, a biography) without a second seam.
     */
    client: ChatClient;
}

/**
 * One block inside a member's profile card — the popover a click on a member
 * row opens. The shell draws the card's header (avatar, name, id, presence);
 * a section draws whatever it owns *below* that, and the row keeps its context
 * menu for every action (a card is a read-only profile surface).
 *
 * `match` is the only filter, and it runs whenever the card is open — keep it
 * cheap: it may run for a person the user is merely hovering past.
 */
export interface ProfileSection {
    /** Stable, namespaced id — the registry keys by it. */
    id: string;
    component: Component;
    /** Higher sorts higher in the card. Default 0. */
    priority?: number;
    /** Draw this section only for members it accepts. Default: every member. */
    match?(member: MemberView): boolean;
}

/**
 * Per-shell profile-section registry (provide/inject — never a module
 * singleton).
 */
export class ProfileSectionsRegistry {
    private readonly list = new ContributionList<ProfileSection>(
        (section) => section.id,
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    public add(section: ProfileSection): Disposable {
        return this.list.add(section);
    }

    public remove(id: string): boolean {
        return this.list.remove(id);
    }

    /** Every section, highest priority first (reactive). */
    public all(): ProfileSection[] {
        return this.list.all();
    }

    /**
     * The sections that apply to `member`, highest priority first. A throwing
     * `match` counts as a refusal — one bad plugin must not blank the card.
     */
    public resolve(member: MemberView): ProfileSection[] {
        const out: ProfileSection[] = [];
        for (const section of this.all()) {
            if (section.match) {
                try {
                    if (!section.match(member)) continue;
                } catch (error) {
                    console.error(`[tumult] profile section "${section.id}" match threw`, error);
                    continue;
                }
            }
            out.push(section);
        }
        return out;
    }
}

export const ProfileSectionsKey: InjectionKey<ProfileSectionsRegistry> =
    Symbol("tumult/profile-sections");

export function useProfileSections(): ProfileSectionsRegistry {
    const registry = inject(ProfileSectionsKey);
    if (!registry) throw new Error("useProfileSections() requires TumultShell above it.");
    return registry;
}
