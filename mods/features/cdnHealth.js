const STORAGE_KEY = 'tt-cdn-node-health';
const DEAD_MS = 60 * 60 * 1000;
const ALIVE_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 2500;
const NODE_HOST = /^rr(\d+)---(sn-[a-z0-9-]+)\.googlevideo\.com$/i;

// A googlevideo URL names a cache node in its host and lists fallback nodes in
// `mn`. The TV player waits several seconds on a node that does not answer
// before it tries the next one, which leaves a black screen at every video
// start. Remember unreachable nodes for a while and start with a live one.
export function createNodeHealth({ storage, probe, now = Date.now }) {
    const inFlight = new Set();
    let table = {};
    try { table = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { table = {}; }

    const save = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(table)); } catch (_) { /* Memory only. */ } };
    const state = node => {
        const entry = table[node];
        return entry && entry.until > now() ? (entry.dead ? 'dead' : 'alive') : 'unknown';
    };
    const record = (node, alive) => {
        table[node] = { dead: !alive, until: now() + (alive ? ALIVE_MS : DEAD_MS) };
        for (const key of Object.keys(table)) if (table[key].until <= now()) delete table[key];
        save();
    };
    const check = (node, host) => {
        if (inFlight.has(node)) return;
        inFlight.add(node);
        Promise.resolve().then(() => probe(host)).then(alive => record(node, alive === true), () => record(node, false))
            .finally(() => inFlight.delete(node));
    };

    function preferLive(url) {
        let parsed;
        try { parsed = new URL(url); } catch (_) { return url; }
        const match = parsed.hostname.match(NODE_HOST);
        if (!match) return url;
        const [, prefix, node] = match;
        const fvip = /^\d+$/.test(parsed.searchParams.get('fvip') || '') ? parsed.searchParams.get('fvip') : prefix;
        const hostFor = name => `rr${fvip}---${name}.googlevideo.com`;
        const current = state(node);
        if (current === 'unknown') check(node, hostFor(node));
        if (current !== 'dead') return url;
        const alternatives = (parsed.searchParams.get('mn') || '').split(',')
            .filter(name => /^sn-[a-z0-9-]+$/i.test(name) && name !== node);
        const live = alternatives.find(name => state(name) !== 'dead');
        if (!live) return url;
        if (state(live) === 'unknown') check(live, hostFor(live));
        parsed.hostname = hostFor(live);
        return parsed.toString();
    }

    function apply(streamingData) {
        if (!streamingData) return false;
        let changed = false;
        const rewrite = holder => {
            if (typeof holder?.serverAbrStreamingUrl === 'string') {
                const next = preferLive(holder.serverAbrStreamingUrl);
                if (next !== holder.serverAbrStreamingUrl) { holder.serverAbrStreamingUrl = next; changed = true; }
            }
            if (typeof holder?.url === 'string') {
                const next = preferLive(holder.url);
                if (next !== holder.url) { holder.url = next; changed = true; }
            }
        };
        rewrite(streamingData);
        for (const format of streamingData.adaptiveFormats || []) rewrite(format);
        for (const format of streamingData.formats || []) rewrite(format);
        return changed;
    }

    return { apply, preferLive, state, record };
}

// Any HTTP answer, even an opaque one, proves the node is reachable.
export function probeNode(host, { fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = PROBE_TIMEOUT_MS,
    AbortControllerClass = globalThis.AbortController, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (!fetchFn) return Promise.resolve(true);
    const controller = new AbortControllerClass();
    const timer = setTimer(() => controller.abort(), timeoutMs);
    return fetchFn(`https://${host}/generate_204`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
        .then(() => true, () => false)
        .finally(() => clearTimer(timer));
}
