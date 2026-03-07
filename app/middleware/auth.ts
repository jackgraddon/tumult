
import { getSecret } from "~/composables/useAppStorage";

export default defineNuxtRouteMiddleware(async (to, from) => {
    if (!import.meta.client) return;

    const matrixStore = useMatrixStore();

    // If we are currently restoring a session, wait for it to complete or fail
    if (matrixStore.isRestoringSession && !matrixStore.isAuthenticated) {
        console.log('[AuthMiddleware] Waiting for session restoration...');
        // We poll every 100ms for up to 5 seconds
        let attempts = 0;
        while (matrixStore.isRestoringSession && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
    }

    // We check stronghold/localStorage for the access token
    const hasToken = await getSecret('matrix_access_token');

    if (!hasToken && to.path.startsWith('/chat')) {
        console.log('[AuthMiddleware] No token found, redirecting to login');
        return navigateTo('/login');
    }
});