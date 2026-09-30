import { videoFormats, targetQuality, speedCeiling, stickyQualityEntry, cachedSupport } from './preferredQualityPolicy.js';

const STICKY_KEY = 'yt-player-quality';
// Written by builds that lowered quality from frame counters.
const LEGACY_KEY = 'tt-acceleration-quality-restore';

const levelOf = label => Number.parseInt(label, 10) || 0;

// Chooses quality before a video loads instead of reacting to playback
// telemetry. Cobalt's frame counters are updated in batches, and a decoder
// that falls behind keeps the media clock and counters looking healthy while
// the picture freezes. The decoder limits reported by isTypeSupported are the
// reliable signal. Every range change restarts the TV player's media source,
// so a change is made only for a new video, a speed change, or a user choice.
export function installQualityController({ documentRef, windowRef, readPreference, readSpeed,
    resetSpeed, jsonTarget = windowRef.JSON, pollMs = 1000 }) {
    const supports = cachedSupport(type => windowRef.MediaSource?.isTypeSupported?.(type));
    let applied = null;
    let userChoice = null;
    let observed = null;

    const storage = () => { try { return windowRef.localStorage; } catch (_) { return null; } };
    const speed = () => { const value = Number(readSpeed()); return value > 0 ? value : 1; };
    const player = () => documentRef.querySelector('.html5-video-player');
    const preferenceFor = id => userChoice?.id === id ? userChoice.preference : readPreference();

    function writeSticky(target) {
        try {
            const local = storage();
            if (target) local?.setItem(STICKY_KEY, stickyQualityEntry(target.level));
            else local?.removeItem(STICKY_KEY);
        } catch (_) { /* The player falls back to its own choice. */ }
    }

    function currentVideo(instance) {
        const id = instance.getVideoData?.()?.video_id;
        if (!id) return null;
        let response = instance.getPlayerResponse?.();
        if (typeof response === 'string') response = JSON.parse(response);
        if (response?.videoDetails?.videoId !== id) return null;
        return { id, formats: videoFormats(response) };
    }

    function setRange(instance, min, max) {
        instance.setPlaybackQualityRange(min, max);
        observed = { id: applied?.id, preference: instance.getPreferredQuality?.() };
    }

    function enforce({ explicit = false } = {}) {
        const instance = player();
        if (!instance?.setPlaybackQualityRange) return;
        try {
            if (Object.values(instance.getVideoStats?.() || {}).includes('shortspage')) return;
            const video = currentVideo(instance);
            if (!video?.formats.length) return;
            const { id, formats } = video;
            const target = targetQuality(preferenceFor(id), speed(), formats, supports);
            const key = !target ? 'free' : (target.auto ? 'max:' : 'lock:') + target.quality;
            if (!explicit && applied?.id === id && applied.key === key) return;

            const available = instance.getAvailableQualityData?.() || [];
            const previous = applied?.id === id ? applied.key : null;
            if (!target) {
                // Release only a range this controller set, or a changed setting.
                applied = { id, key };
                if ((previous && previous !== 'free') || explicit) setRange(instance, 'auto', 'auto');
                else observed = { id, preference: instance.getPreferredQuality?.() };
                return;
            }
            // During a loader transition the list can be empty or partial.
            if (!available.some(item => item.quality === target.quality)) return;
            applied = { id, key };
            const current = levelOf(available.find(item => item.quality === instance.getPlaybackQuality?.())?.qualityLabel);
            if (target.auto && current <= target.level) setRange(instance, 'tiny', target.quality);
            else setRange(instance, target.quality, target.quality);
            console.info('[PlaybackQuality]', { id, speed: speed(), target: target.quality,
                auto: target.auto, limitedBySpeed: target.limited });
        } catch (error) {
            console.warn('[PlaybackQuality] Player is changing:', error);
        }
    }

    // The stock quality menu changes the preferred quality directly. Keep that
    // choice for the current video; if the decoder cannot show it at the
    // current speed, return to 1x as YouTube does for its own speed limit.
    function checkUserChoice() {
        const instance = player();
        if (!instance?.getPreferredQuality || !applied) return;
        try {
            const id = instance.getVideoData?.()?.video_id;
            const reported = instance.getPreferredQuality();
            if (!id || id !== applied.id || observed?.id !== id) {
                if (id && id === applied.id) observed = { id, preference: reported };
                return;
            }
            if (reported === observed.preference) return;
            observed = { id, preference: reported };
            const available = instance.getAvailableQualityData?.() || [];
            const level = levelOf(available.find(item => item.quality === reported)?.qualityLabel);
            if (reported !== 'auto' && !level) return;
            userChoice = { id, preference: reported === 'auto' ? 'auto' : level + 'p' };
            const video = currentVideo(instance);
            if (level && video && level > speedCeiling(video.formats, speed(), supports)) resetSpeed?.(1);
            applied = { id, key: reported === 'auto' ? 'free' : 'lock:' + reported };
        } catch (_) { /* Checked again on the next poll. */ }
    }

    // YouTube parses the player response before its loader reads the sticky
    // maximum, so the first stream already has the chosen quality.
    const parse = jsonTarget.parse;
    jsonTarget.parse = function (...args) {
        const result = parse.apply(this, args);
        try {
            const id = result?.videoDetails?.videoId;
            if (id && result.streamingData?.adaptiveFormats) {
                const formats = videoFormats(result);
                if (formats.length) writeSticky(targetQuality(preferenceFor(id), speed(), formats, supports));
            }
        } catch (_) { /* Never break response parsing. */ }
        return result;
    };

    try { storage()?.removeItem(LEGACY_KEY); } catch (_) { /* Optional cleanup. */ }
    const preference = readPreference();
    writeSticky(levelOf(preference) ? { level: levelOf(preference) } : null);

    const onMedia = event => {
        if (event.target === documentRef.querySelector('video')) enforce();
    };
    for (const type of ['loadedmetadata', 'playing']) documentRef.addEventListener(type, onMedia, true);
    const timer = windowRef.setInterval?.(checkUserChoice, pollMs);
    return {
        enforce,
        checkUserChoice,
        onPreferenceChange() { userChoice = null; enforce({ explicit: true }); },
        onSpeedChange() { enforce(); },
        stop() {
            jsonTarget.parse = parse;
            for (const type of ['loadedmetadata', 'playing']) documentRef.removeEventListener(type, onMedia, true);
            windowRef.clearInterval?.(timer);
        }
    };
}
