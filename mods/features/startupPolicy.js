export function startupCommand({ enabled, destination, embedded, href }) {
    if (!enabled) return null;
    // Opening a deep link must not trigger a late home reload when video appears.
    try {
        const url = new URL(href);
        const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url) : url;
        if (route.pathname === '/watch' || route.searchParams.has('v')) return null;
    } catch (_) { return null; }

    if (destination) return JSON.parse(destination);
    // Embedded mods are already installed in this document. Reloading the home
    // page as soon as its preview video appears adds another startup request.
    return embedded ? null : { signalAction: { signal: 'SOFT_RELOAD_PAGE' } };
}
