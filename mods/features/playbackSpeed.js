import { guardPlaybackQuality } from './playbackQualityGuard.js';

const MIN_SPEED = 0.25;
const MAX_SPEED = 5;

function isCobalt(documentRef) {
    const windowRef = documentRef?.defaultView || globalThis.window;
    return Boolean(windowRef?.__votBridgeKey || /Cobalt\//i.test(windowRef?.navigator?.userAgent || ''));
}

export function normalizePlaybackSpeed(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
        throw new RangeError(`Playback speed must be between ${MIN_SPEED} and ${MAX_SPEED}`);
    }
    return speed;
}

export function applyPlaybackSpeed(value, targets = {}) {
    const speed = normalizePlaybackSpeed(value);
    const documentRef = targets.documentRef || globalThis.document;
    const player = targets.player || documentRef?.querySelector?.('.html5-video-player');
    const video = targets.video || documentRef?.querySelector?.('video');
    const cobalt = targets.cobalt ?? isCobalt(documentRef);

    // Keep the loader's media ratechange path without YouTube's blanket HFR cap.
    // Our temporary quality range accounts for resolution * FPS * speed instead.
    if (cobalt) {
        if (!video) return { applied: false, via: 'unavailable', speed };
        try {
            if (typeof player?.getPlaybackRate === 'function' && typeof player?.setPlaybackRate === 'function'
                && player.getPlaybackRate() !== 1) {
                player.setPlaybackRate(1);
            }

            guardPlaybackQuality(player, video, speed);
            if (video.playbackRate !== speed) video.playbackRate = speed;
            return { applied: true, via: 'cobalt-media', speed };
        } catch (error) {
            console.warn('[PlaybackSpeed] Cobalt speed is not ready yet:', error);
            return { applied: false, via: 'cobalt-error', speed };
        }
    }

    if (typeof player?.setPlaybackRate === 'function') {
        try {
            if (player.getPlaybackRate?.() === speed && (!video || video.playbackRate === speed)) {
                return { applied: true, via: 'player', speed };
            }

            player.setPlaybackRate(speed);
            return { applied: true, via: 'player', speed };
        } catch (error) {
            // Do not bypass an existing player API when it is merely not ready.
            // canplay will retry after the player finishes its transition.
            console.warn('[PlaybackSpeed] Player API is not ready yet:', error);
            return { applied: false, via: 'player-error', speed };
        }
    }

    if (video) {
        if (video.playbackRate !== speed) video.playbackRate = speed;
        return { applied: true, via: 'media-fallback', speed };
    }

    return { applied: false, via: 'unavailable', speed };
}

export function installPlaybackSpeed(documentRef, readSpeed) {
    const apply = () => applyPlaybackSpeed(readSpeed(), { documentRef });
    // Media events do not bubble. Capture also covers elements replaced by YouTube.
    const onMediaEvent = event => {
        if (event.type === 'ratechange' && !isCobalt(documentRef)) return;
        if (event.target === documentRef.querySelector('video')) apply();
    };
    documentRef.addEventListener('canplay', onMediaEvent, true);
    documentRef.addEventListener('ratechange', onMediaEvent, true);
    documentRef.addEventListener('loadedmetadata', onMediaEvent, true);
    if (documentRef.querySelector('video')) apply();

    // timeupdate/canplay stop during the very stall we need to recover from.
    // A cheap timer also catches manual quality changes and reused video nodes.
    const windowRef = documentRef.defaultView;
    const timer = windowRef?.setInterval?.(() => {
        if (isCobalt(documentRef) && documentRef.querySelector('video')) apply();
    }, 1000);

    return () => {
        for (const type of ['canplay', 'ratechange', 'loadedmetadata']) {
            documentRef.removeEventListener(type, onMediaEvent, true);
        }

        windowRef?.clearInterval?.(timer);
    };
}
