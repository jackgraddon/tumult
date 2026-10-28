import type { ActionsContext } from "../actions.ts";
import { copyOrLog } from "../clipboard.ts";
import type { SpaceMenuAction } from "./spaceMenu.ts";

/**
 * Run a space-menu item. Shared by the rail tile and the room list's category
 * header, which are the same space shown two ways. `toggle-collapse` is the one
 * item the caller owns (it is local view state), so it is passed in.
 */
export function runSpaceAction(
    action: SpaceMenuAction,
    space: { id: string; name: string; link: string },
    actions: ActionsContext,
    toggleCollapse?: () => void,
): void {
    switch (action) {
        case "mark-read":
            actions.requestMarkSpaceRead(space.id);
            break;
        case "toggle-collapse":
            toggleCollapse?.();
            break;
        case "create-channel":
            actions.requestSpaceCreateChannel(space.id);
            break;
        case "invite":
            actions.requestSpaceInvite(space.id);
            break;
        case "settings":
            actions.requestSpaceSettings(space.id);
            break;
        case "copy-link":
            copyOrLog(space.link, "space link");
            break;
        case "copy-id":
            copyOrLog(space.id, "space id");
            break;
        case "leave":
            actions.requestLeave({ id: space.id, name: space.name, isSpace: true });
            break;
    }
}
