import { restoreLegacyQualityPreference, guardPlaybackQuality, observeQualitySelections, prepareNewVideoQuality } from './playbackQualityGuard.js';
import { installBufferedWaitingFilter } from './bufferedWaitingFilter.js';

const MIN_SPEED = 0.25;
const MAX_SPEED = 5;
const playerRates = new WeakMap();

function exposeMediaPlaybackRate(player, video) {
    if (!player || typeof player.getPlaybackRate !== 'function') return;
    let entry = playerRates.get(player);
    if (!entry) {
        entry = { original: player.getPlaybackRate, video };
        try {
            // UI consumers use the public getter. Cobalt's internal API rate is
            // kept at 1 to avoid its blanket HFR cap; the media rate is audible.
            player.getPlaybackRate = () => Number(entry.video?.playbackRate) || entry.original.call(player);
            playerRates.set(player, entry);
        } catch (_) { return; }
    }
    entry.video = video;
}
function apiPlaybackRate(player) {
    const getter = playerRates.get(player)?.original || player?.getPlaybackRate;
    return getter?.call(player);
}

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
    // The telemetry guard separately handles confirmed playback failures.
    if (cobalt) {
        if (!video) return { applied: false, via: 'unavailable', speed };
        try {
            exposeMediaPlaybackRate(player, video);
            if (typeof player?.getPlaybackRate === 'function' && typeof player?.setPlaybackRate === 'function'
                && apiPlaybackRate(player) !== 1) {
                player.setPlaybackRate(1);
            }

            restoreLegacyQualityPreference(player, video);
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

export function installPlaybackSpeed(documentRef, readSpeed, { resetSpeed } = {}) {
    const apply = () => applyPlaybackSpeed(readSpeed(), { documentRef });
    const stopWaitingFilter = isCobalt(documentRef)
        ? installBufferedWaitingFilter(documentRef, readSpeed) : null;
    // Media events do not bubble. Capture also covers elements replaced by YouTube.
    const onMediaEvent = event => {
        if (event.type === 'ratechange' && !isCobalt(documentRef)) return;
        if (event.target === documentRef.querySelector('video')) apply();
    };
    documentRef.addEventListener('canplay', onMediaEvent, true);
    documentRef.addEventListener('ratechange', onMediaEvent, true);
    documentRef.addEventListener('loadedmetadata', onMediaEvent, true);
    for (const type of ['waiting', 'stalled', 'playing', 'pause', 'seeking', 'seeked']) {
        documentRef.addEventListener(type, onMediaEvent, true);
    }
    if (documentRef.querySelector('video')) apply();

    // The timer restores the configured speed if a reused video node resets it.
    const windowRef = documentRef.defaultView;
    const timer = windowRef?.setInterval?.(() => {
        if (!isCobalt(documentRef)) return;
        const video = documentRef.querySelector('video');
        const player = documentRef.querySelector('.html5-video-player');
        if (!video || !player) return;
        observeQualitySelections(player, resetSpeed);
        apply();
        guardPlaybackQuality(player, video, Number(readSpeed()), Date.now(), { hidden: documentRef.hidden });
    }, 500);

    const onNavigation = () => {
        const id = windowRef?.location?.hash?.match(/[?&]v=([^&#]+)/)?.[1];
        prepareNewVideoQuality(documentRef.querySelector('.html5-video-player'), id);
    };
    windowRef?.addEventListener?.('hashchange', onNavigation);
    return () => {
        windowRef?.removeEventListener?.('hashchange', onNavigation);
        stopWaitingFilter?.();
        for (const type of ['canplay', 'ratechange', 'loadedmetadata',
            'waiting', 'stalled', 'playing', 'pause', 'seeking', 'seeked']) {
            documentRef.removeEventListener(type, onMediaEvent, true);
        }

        windowRef?.clearInterval?.(timer);
    };
}
