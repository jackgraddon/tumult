/**
 * Cleans a URL by removing common tracking parameters that can cause
 * "Request-URI Too Large" (414) errors on some Matrix homeservers or
 * reverse proxies.
 *
 * Specifically targets Etsy, Amazon, and generic UTM parameters.
 */
export function cleanUrl(url: string): string {
    try {
        const urlObj = new URL(url);

        // Generic tracking parameters (Exact matches only)
        const exactParamsToRemove = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'msclkid'
        ];

        // Platform-specific bloat
        if (urlObj.hostname.includes('etsy.com')) {
            exactParamsToRemove.push('ga_order', 'ga_search_type', 'ga_view_type', 'ga_search_query', 'ref', 'pro', 'bes', 'content_source', 'logging_key', 'ls');
        }

        if (urlObj.hostname.includes('amazon.')) {
            exactParamsToRemove.push('qid', 'sr', 'keywords');

            // Amazon specific prefix matches that are safe
            const keys = Array.from(urlObj.searchParams.keys());
            keys.forEach(key => {
                if (key.startsWith('pd_rd_') || key.startsWith('pf_rd_') || key === 'ref_') {
                    urlObj.searchParams.delete(key);
                }
            });
        }

        exactParamsToRemove.forEach(param => {
            urlObj.searchParams.delete(param);
        });

        return urlObj.toString();
    } catch {
        // If not a valid URL, return as-is
        return url;
    }
}
