import type { MatrixClient } from "matrix-js-sdk";
// Value import needs the .js extension: Node's ESM loader won't guess it
// (typecheck and Vite both resolve the extensionless form, so the build
// forgives this — only `node --test` catches it).
import { SearchOrderBy } from "matrix-js-sdk/lib/@types/search.js";
import type { ISearchRequestBody, ISearchResults } from "matrix-js-sdk/lib/@types/search";

import type { SearchPage } from "../contract.ts";
import { mapEvent, type MappableEvent } from "../timeline/map.ts";

/**
 * Page size lives in the FILTER (the spec has no `page_size`); Synapse honors
 * `filter.limit` and defaults it to 10 anyway — stating it keeps pages the
 * same size on every server.
 */
export const SEARCH_PAGE_SIZE = 10;

/**
 * Server-side, room-scoped history search.
 *
 * Deliberately raw (`matrix.search` + `processRoomEventsSearch`) instead of
 * `searchRoomEvents`: the high-level helper can only fetch page one — it has
 * no `next_batch` input — while this shape rebuilds the identical body per
 * call, so the contract can stay stateless (`search(room, term, { nextBatch })`).
 *
 * The server only matches cleartext: an encrypted event's body is ciphertext
 * on the wire, so encrypted rooms effectively return nothing. That is a v1
 * non-goal (client-side search over decrypted history), not an error.
 */
export async function searchRoomHistory(
    matrix: MatrixClient,
    roomId: string,
    term: string,
    nextBatch?: string,
): Promise<SearchPage> {
    const trimmed = term.trim();
    // An empty term isn't a query; don't spend a roundtrip to prove it.
    if (trimmed.length === 0) return { hits: [], nextBatch: null, total: 0 };

    const body: ISearchRequestBody = {
        search_categories: {
            room_events: {
                search_term: trimmed,
                // Room scope: cross-room search is a later pane, not this one.
                filter: { rooms: [roomId], limit: SEARCH_PAGE_SIZE },
                order_by: SearchOrderBy.Recent,
                event_context: { before_limit: 1, after_limit: 1, include_profile: true },
            },
        },
    };
    const response = await matrix.search({
        body,
        ...(nextBatch !== undefined && nextBatch.length > 0 ? { next_batch: nextBatch } : {}),
    });

    // Same mapping path as searchRoomEvents: getEventMapper + member
    // metadata, so hits come out as ordinary MatrixEvents for mapEvent.
    const accumulator: ISearchResults = { _query: body, results: [], highlights: [] };
    const processed = matrix.processRoomEventsSearch(accumulator, response);
    // Same bridge as the feed: MatrixEvent satisfies MappableEvent at runtime,
    // but its richer typings don't narrow structurally.
    const hits = processed.results.map((result) =>
        mapEvent(result.context.getEvent() as unknown as MappableEvent),
    );
    return {
        hits,
        nextBatch: processed.next_batch ?? null,
        total: processed.count ?? hits.length,
    };
}
