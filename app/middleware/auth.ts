
import { getSecret } from "~/composables/useAppStorage";

export default defineNuxtRouteMiddleware(async (to, from) => {
    // We check stronghold/localStorage for the access token
    const hasToken = import.meta.client && await getSecret('matrix_access_token');

    if (!hasToken && to.path.startsWith('/chat')) {
        return navigateTo('/login');
    }
});