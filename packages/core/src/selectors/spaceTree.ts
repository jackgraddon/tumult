import type { RoomSummary } from "../contract.ts";

export interface SpaceTreeOptions {
    maxDepth?: number;
    maxNodes?: number;
}

export interface SpaceNode {
    room: RoomSummary;
    /** Path of space ids from the guild root to this node (inclusive). */
    path: string[];
    depth: number;
    rooms: RoomSummary[];
    spaces: SpaceNode[];
    truncated: boolean;
    aggregateUnread: number;
    aggregateHighlight: number;
}

export interface SpaceTree {
    guilds: SpaceNode[];
    /** Orphaned non-space rooms: the DMs tab. */
    orphans: RoomSummary[];
    /**
     * Rooms the user tagged `m.favourite`, sorted by tag `order` (higher values
     * first; no `order` sorts last, ties broken by name). Feeds the rail's
     * Favourites band. Tag-less rooms are absent.
     */
    favourites: RoomSummary[];
    promotedGuildIds: string[];
    guildIdsByRoomId: Map<string, string[]>;
    truncatedCount: number;
}

const collator = new Intl.Collator("en");
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 2000;

function sortRooms(rooms: RoomSummary[]): RoomSummary[] {
    return [...rooms].sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Order favourites in the rail: tag `order' desc (higher = nearer the top),
 * rooms without an order last, ties broken by name. A favourited room carrying
 * no explicit order (favourite=true, favouriteOrder=null) survives the presence
 * filter and lands here, so the guards keep it behind every ordinal one.
 */
function compareFavouriteOrder(a: RoomSummary, b: RoomSummary): number {
    const ao = a.favouriteOrder;
    const bo = b.favouriteOrder;
    if (ao === null && bo === null) return collator.compare(a.name, b.name);
    if (ao === null) return 1;
    if (bo === null) return -1;
    if (ao !== bo) return bo - ao;
    return collator.compare(a.name, b.name);
}

export function selectSpaceTree(
    rooms: readonly RoomSummary[],
    options: SpaceTreeOptions = {},
): SpaceTree {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const byId = new Map<string, RoomSummary>();
    for (const r of rooms) byId.set(r.id, r);

    // Phase 1: sanitise edges — keep parents that exist, are spaces, aren't self.
    const parentsOf = new Map<string, string[]>();
    const childrenOf = new Map<string, string[]>();
    for (const r of rooms) {
        const clean = r.parentSpaceIds.filter(
            (p) => p !== r.id && byId.get(p)?.isSpace === true,
        );
        parentsOf.set(r.id, [...new Set(clean)].sort());
        for (const p of clean) {
            const list = childrenOf.get(p) ?? [];
            list.push(r.id);
            childrenOf.set(p, list);
        }
    }

    const spaces = rooms.filter((r) => r.isSpace);
    // Phase 2: roots = parent-less spaces. Then promote unreachable cyclic components.
    const roots = sortRooms(spaces.filter((s) => (parentsOf.get(s.id) ?? []).length === 0)).map(
        (s) => s.id,
    );

    // Reachable set from roots (through space->space edges only).
    const reachable = new Set<string>(roots);
    const queue = [...roots];
    while (queue.length > 0) {
        const cur = queue.pop() as string;
        for (const childId of childrenOf.get(cur) ?? []) {
            const child = byId.get(childId);
            if (!child?.isSpace || reachable.has(childId)) continue;
            reachable.add(childId);
            queue.push(childId);
        }
    }

    const promotedGuildIds: string[] = [];
    const unreachable = sortRooms(spaces.filter((s) => !reachable.has(s.id)));
    // Group unreachable into components via undirected walk, then promote enough
    // entry points per component that their *forward* (childrenOf) closures union
    // to the whole component — never just the lowest id.
    //
    // Promotion exists so a cyclic component with no reachable entry doesn't drop
    // its rooms. But buildNode only descends via childrenOf (parent -> child), and
    // the lowest id in an undirected component is not necessarily a node whose
    // downward closure covers the rest: a leaf "pendant" space (something whose
    // only edge is *being* a child of a cycle member) can sort first and have no
    // children of its own, in which case promoting it alone silently drops
    // everything else in the component — no truncation flag, nothing in orphans,
    // the rooms simply vanish. Keep promoting the lowest remaining id, walking
    // forward from it, until the whole component is covered.
    const visited = new Set<string>();
    for (const s of unreachable) {
        if (visited.has(s.id)) continue;
        const component: string[] = [];
        const stack = [s.id];
        visited.add(s.id);
        while (stack.length > 0) {
            const cur = stack.pop() as string;
            component.push(cur);
            const neighbours = [
                ...(parentsOf.get(cur) ?? []).filter((p) => !reachable.has(p)),
                ...(childrenOf.get(cur) ?? []).filter((c) => byId.get(c)?.isSpace && !reachable.has(c)),
            ];
            for (const n of neighbours) {
                if (!visited.has(n)) {
                    visited.add(n);
                    stack.push(n);
                }
            }
        }

        const uncovered = new Set(component);
        while (uncovered.size > 0) {
            const entry = [...uncovered].sort()[0] as string;
            promotedGuildIds.push(entry);
            const forward = [entry];
            uncovered.delete(entry);
            while (forward.length > 0) {
                const cur = forward.pop() as string;
                for (const childId of childrenOf.get(cur) ?? []) {
                    if (!uncovered.has(childId)) continue;
                    if (byId.get(childId)?.isSpace !== true) continue;
                    uncovered.delete(childId);
                    forward.push(childId);
                }
            }
        }
    }
    promotedGuildIds.sort();

    const guildIdsByRoomId = new Map<string, string[]>();
    let truncatedCount = 0;
    let nodeCount = 0;

    // Phase 3: DFS per root with path-scoped ancestor set.
    function buildNode(spaceId: string, path: string[], depth: number, ancestors: Set<string>): SpaceNode | null {
        const room = byId.get(spaceId);
        if (!room) return null;
        if (ancestors.has(spaceId)) {
            truncatedCount++;
            return {
                room,
                path: [...path, spaceId],
                depth,
                rooms: [],
                spaces: [],
                truncated: true,
                aggregateUnread: 0,
                aggregateHighlight: 0,
            };
        }
        if (depth > maxDepth || nodeCount >= maxNodes) {
            truncatedCount++;
            return {
                room,
                path: [...path, spaceId],
                depth,
                rooms: [],
                spaces: [],
                truncated: true,
                aggregateUnread: room.unreadCount,
                aggregateHighlight: room.highlightCount,
            };
        }
        nodeCount++;
        const fullPath = [...path, spaceId];
        ancestors.add(spaceId);

        const childIds = childrenOf.get(spaceId) ?? [];
        const childRooms = sortRooms(
            childIds.map((id) => byId.get(id)).filter((r): r is RoomSummary => !!r && !r.isSpace),
        );
        const childSpaces = sortRooms(
            childIds.map((id) => byId.get(id)).filter((r): r is RoomSummary => !!r && r.isSpace),
        );

        const spaces: SpaceNode[] = [];
        for (const child of childSpaces) {
            if (nodeCount >= maxNodes) {
                truncatedCount++;
                spaces.push({
                    room: child,
                    path: [...fullPath, child.id],
                    depth: depth + 1,
                    rooms: [],
                    spaces: [],
                    truncated: true,
                    aggregateUnread: 0,
                    aggregateHighlight: 0,
                });
                continue;
            }
            const node = buildNode(child.id, fullPath, depth + 1, ancestors);
            if (node) spaces.push(node);
        }
        ancestors.delete(spaceId);

        let aggregateUnread = room.unreadCount;
        let aggregateHighlight = room.highlightCount;
        for (const r of childRooms) {
            aggregateUnread += r.unreadCount;
            aggregateHighlight += r.highlightCount;
            const guilds = guildIdsByRoomId.get(r.id) ?? [];
            guilds.push(fullPath[0] as string);
            guildIdsByRoomId.set(r.id, guilds);
        }
        for (const s of spaces) {
            aggregateUnread += s.aggregateUnread;
            aggregateHighlight += s.aggregateHighlight;
        }

        return {
            room,
            path: fullPath,
            depth,
            rooms: childRooms,
            spaces,
            truncated: false,
            aggregateUnread,
            aggregateHighlight,
        };
    }

    const guildRoots = [...roots, ...promotedGuildIds.filter((id) => !roots.includes(id))];
    const guilds: SpaceNode[] = [];
    for (const rootId of guildRoots) {
        const node = buildNode(rootId, [], 0, new Set());
        if (node) guilds.push(node);
    }

    // Orphans: non-space rooms with no (sanitised) parents.
    const orphans = sortRooms(
        rooms.filter((r) => !r.isSpace && (parentsOf.get(r.id) ?? []).length === 0),
    );

    // Favourites: every favourited room, sorted by tag order (higher first, no
    // order sorts last, ties by name). Tag-less rooms are absent. Feeds the
    // rail's Favourites band. The comparator already orders everything, so do
    // NOT re-sort by the room-list (alphabetical-name) order — that would
    // defeat the per-tag ordering.
    const favourites = rooms.filter((r) => r.favourite).sort(compareFavouriteOrder);

    return { guilds, orphans, favourites, promotedGuildIds, guildIdsByRoomId, truncatedCount };
}
