
export const useRegionDetection = () => {
    const isEU = ref(false);
    const isLoading = ref(true);

    const checkRegion = async () => {
        isLoading.value = true;
        try {
            // 2026 Best Practice: Check browser locale and use a lightweight
            // geolocation check to detect EU users affected by DMA.
            const locale = navigator.language || 'en-US';
            const euLocales = [
                'at', 'be', 'bg', 'cy', 'cz', 'de', 'dk', 'ee', 'es', 'fi',
                'fr', 'gr', 'hr', 'hu', 'ie', 'it', 'lt', 'lu', 'lv', 'mt',
                'nl', 'pl', 'pt', 'ro', 'se', 'si', 'sk'
            ];

            const localeCountry = locale.split('-')[1]?.toLowerCase();
            if (euLocales.includes(localeCountry)) {
                isEU.value = true;
                return;
            }

            // Fallback: Lightweight IP check (Using a public API as a proxy for this task)
            const res = await fetch('https://ipapi.co/json/').catch(() => null);
            if (res && res.ok) {
                const data = await res.json();
                if (data.in_eu) {
                    isEU.value = true;
                }
            }
        } catch (e) {
            console.warn('[RegionDetection] Failed to detect region:', e);
        } finally {
            isLoading.value = false;
        }
    };

    onMounted(checkRegion);

    return {
        isEU,
        isLoading
    };
};
