const RESTORE_KEY = 'tt-acceleration-quality-restore';
const restoredPlayers = new WeakSet();
const states = new WeakMap();
const observed = new WeakMap();

function storage(video) {
    try { return video?.ownerDocument?.defaultView?.localStorage; } catch (_) { return null; }
}
function savePreference(state) {
    try {
        if (state.cap) storage(state.video)?.setItem(RESTORE_KEY,
            JSON.stringify({ preferred: state.preferred, cap: state.cap }));
        else storage(state.video)?.removeItem(RESTORE_KEY);
    } catch (_) { /* In-session recovery still works without storage. */ }
}
function writeRange(player, min, max) {
    const original = observed.get(player)?.original || player.setPlaybackQualityRange;
    original.call(player, min, max);
}

// Older builds stored temporary quality caps as YouTube's sticky preference.
export function restoreLegacyQualityPreference(player, video) {
    if (!player || restoredPlayers.has(player) || video?.seeking) return;
    const local = storage(video);
    if (!local) return;
    let saved;
    try { saved = JSON.parse(local.getItem(RESTORE_KEY) || 'null'); } catch (_) { saved = null; }
    if (saved?.cap && typeof saved.preferred === 'string') {
        if (!player.getPreferredQuality || !player.setPlaybackQualityRange) return;
        try {
            if (player.getPreferredQuality() === saved.cap) writeRange(player, saved.preferred, saved.preferred);
        } catch (_) { return; }
    }
    try { local.removeItem(RESTORE_KEY); } catch (_) { return; }
    restoredPlayers.add(player);
}

export function qualityLevels(available = []) {
    const levels = new Map();
    for (const item of available) {
        const height = Number.parseInt(item.qualityLabel, 10);
        if (height > 0 && item.quality && item.isPlayable !== false && !item.paygatedQualityDetails)
            levels.set(item.quality, { quality: item.quality, height });
    }
    return [...levels.values()].sort((a, b) => a.height - b.height);
}
export function bufferedAhead(video) {
    try {
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime + 0.1 && video.buffered.end(i) > video.currentTime)
                return video.buffered.end(i) - video.currentTime;
        }
    } catch (_) { /* The source may be changing. */ }
    return 0;
}
function frameCounts(video) {
    try {
        const quality = video.getVideoPlaybackQuality?.();
        const total = quality?.totalVideoFrames ?? video.webkitDecodedFrameCount;
        const dropped = quality?.droppedVideoFrames ?? video.webkitDroppedFrameCount;
        if (Number.isFinite(total) && Number.isFinite(dropped) && total >= dropped && dropped >= 0)
            return { total, dropped, presented: total - dropped };
    } catch (_) { /* Counter availability differs between devices. */ }
    return null;
}
function resetSamples(state) {
    state.sample = null;
    state.badSince = null;
    state.networkSince = null;
}

// Observe actual API selections too, including the stock YouTube quality menu.
// Guard writes bypass this wrapper; internal ABR does not use this public API.
export function observeQualitySelections(player, onResetSpeed) {
    if (!player?.setPlaybackQualityRange || observed.has(player)) return;
    const original = player.setPlaybackQualityRange;
    const wrapper = function (min, max, ...args) {
        const candidate = states.get(player);
        const state = candidate?.id === player.getVideoData?.()?.video_id ? candidate : null;
        if (state) {
            manualQualityChoice(player, state, max, onResetSpeed);
            state.preferred = max || 'auto';
            state.cap = null;
            state.pending = null;
            resetSamples(state);
            savePreference(state);
        }
        const result = original.call(this, min, max, ...args);
        if (state) state.reportedPreference = player.getPreferredQuality?.();
        return result;
    };
    observed.set(player, { original, wrapper, onResetSpeed });
    player.setPlaybackQualityRange = wrapper;
}
function manualQualityChoice(player, state, quality, resetSpeed) {
    const height = state.levels.find(item => item.quality === quality)?.height;
    if (state.speed > 1.01 && height && state.rejectedHeight && height >= state.rejectedHeight) {
        // Choosing the previously failing resolution is an explicit preference
        // for picture quality. Keep that resolution and return to normal speed.
        resetSpeed?.(1);
        if (player.getPlaybackRate?.() !== 1) player.setPlaybackRate?.(1);
        state.video.playbackRate = 1;
        state.speed = 1;
    }
}
export function hasPlaybackQualityCap(player) {
    const state = states.get(player);
    return Boolean(state?.cap && state.id === player.getVideoData?.()?.video_id);
}
export function applyPreferredQuality(player, quality, { manual = false } = {}) {
    const candidate = states.get(player);
    const state = candidate?.id === player.getVideoData?.()?.video_id ? candidate : null;
    if (state) {
        if (manual) manualQualityChoice(player, state, quality, observed.get(player)?.onResetSpeed);
        // A delayed configured-quality callback must not undo recovery.
        if (!manual && state.cap && state.preferred === quality) return;
        state.preferred = quality;
        state.cap = null;
        state.pending = null;
        resetSamples(state);
        savePreference(state);
    }
    writeRange(player, quality, quality);
    if (state) state.reportedPreference = player.getPreferredQuality?.();
}

export function prepareNewVideoQuality(player, nextId) {
    const state = states.get(player);
    if (!state?.cap || !nextId || nextId === state.id) return;
    // Release the old cap on navigation before the next loader starts.
    writeRange(player, state.preferred, state.preferred);
    state.cap = null;
    state.pending = null;
    state.reportedPreference = player.getPreferredQuality?.();
    savePreference(state);
    resetSamples(state);
}

// Sample at 500 ms, not on every frame. All workload decisions come from live
// progress and drop counters; no device-specific resolution/rate budget exists.
export function guardPlaybackQuality(player, video, speed, now = Date.now(), { hidden = false } = {}) {
    if (!player?.setPlaybackQualityRange || !video) return;
    try {
        const id = player.getVideoData?.()?.video_id;
        if (!id) return;
        const levels = qualityLevels(player.getAvailableQualityData?.());
        if (!levels.length) return;
        let state = states.get(player);
        if (!state || state.id !== id) {
            if (state?.cap && player.getPreferredQuality?.() === state.cap)
                prepareNewVideoQuality(player, id);
            state = { id, video, speed, levels, preferred: player.getPreferredQuality?.() || 'auto',
                cap: null, rejectedHeight: null, sample: null, pending: null, settleUntil: 0,
                reportedPreference: player.getPreferredQuality?.() };
            states.set(player, state);
            savePreference(state);
        }
        state.levels = levels;
        // Some TV clients retain a bound copy of the original API method.
        // Also watch the reported choice, so those manual changes are handled.
        const reported = player.getPreferredQuality?.();
        if (reported !== state.reportedPreference && reported !== state.cap
            && (reported === 'auto' || levels.some(item => item.quality === reported))) {
            manualQualityChoice(player, state, reported, observed.get(player)?.onResetSpeed);
            speed = Number(video.playbackRate) || speed;
            state.preferred = reported;
            state.cap = null;
            state.pending = null;
            resetSamples(state);
            savePreference(state);
        }
        state.reportedPreference = reported;
        if (state.video !== video || state.speed !== speed) {
            const reduced = speed < state.speed;
            state.video = video;
            state.speed = speed;
            resetSamples(state);
            if (reduced && state.cap) {
                writeRange(player, state.preferred, state.preferred);
                state.cap = null;
                state.pending = null;
                state.reportedPreference = player.getPreferredQuality?.();
                savePreference(state);
            }
        }
        if (hidden || video.paused || video.seeking || video.ended || video.readyState === 0) {
            resetSamples(state);
            if (state.pending) state.pending.at = now;
            return;
        }
        const current = levels.find(item => item.quality === player.getPlaybackQuality?.());
        if (!current) { resetSamples(state); return; }
        const fixed = state.preferred !== 'auto';
        const ahead = bufferedAhead(video);
        const frames = frameCounts(video);
        const sample = state.sample;
        const dt = sample && now - sample.at;
        const progress = sample && video.currentTime - sample.time;
        const continuous = sample && dt > 0 && dt <= 2500 && progress >= -0.05
            && progress <= dt / 1000 * Math.max(1, speed) * 2 + 0.5;
        if (!continuous || (frames && sample.frames &&
            (frames.total < sample.frames.total || frames.dropped < sample.frames.dropped))) {
            const frameAt = sample && dt > 2500 && progress >= 0
                && progress <= dt / 1000 * Math.max(1, speed) * 2 + 0.5
                && frames && sample.frames && frames.total >= sample.frames.total
                && frames.presented === sample.frames.presented ? sample.frameAt : now;
            resetSamples(state);
            state.sample = { at: now, time: video.currentTime, frames, progressAt: now, frameAt,
                windowAt: now, windowTime: video.currentTime, windowFrames: frames };
            return;
        }
        if (progress > 0.01) sample.progressAt = now;
        if (!frames || !sample.frames || frames.presented > sample.frames.presented) sample.frameAt = now;
        const buffered = ahead >= Math.max(0.75, speed * 0.5);
        let reason = null;
        // The media clock can advance with audio while the picture is frozen.
        const frozen = frames && sample.frames && (frames.total > 0 || sample.frames.total > 0)
            && now - sample.frameAt >= (fixed ? 4500 : 2000);
        const stopped = now - sample.progressAt >= (fixed ? 4500 : 2000);
        if (buffered && (frozen || stopped)) reason = frozen ? 'frozen-frames' : 'stopped-clock';
        const windowMs = now - sample.windowAt;
        if (windowMs >= 1000) {
            const total = frames && sample.windowFrames && frames.total - sample.windowFrames.total;
            const drops = frames && sample.windowFrames && frames.dropped - sample.windowFrames.dropped;
            const slow = video.currentTime - sample.windowTime < windowMs / 1000 * speed * 0.55;
            const dropping = total >= 10 && drops / total >= 0.2;
            if (buffered && (slow || dropping)) {
                state.badSince ??= sample.windowAt;
                if (now - state.badSince >= (fixed ? 4000 : 1500)) reason ||= dropping ? 'dropped-frames' : 'slow-clock';
            } else state.badSince = null;
            sample.windowAt = now;
            sample.windowTime = video.currentTime;
            sample.windowFrames = frames;
        }
        // Auto's network ABR stays free to react to an empty buffer. A fixed
        // quality may never recover on its own, so give it the same bounded trial.
        if (!buffered && video.readyState < 3 && fixed) {
            state.networkSince ??= now;
            if (now - state.networkSince >= 4500) reason = 'empty-buffer';
        } else state.networkSince = null;
        sample.at = now;
        sample.time = video.currentTime;
        sample.frames = frames;

        if (state.pending && current.height <= state.pending.height) state.pending = null;
        if (now < state.settleUntil) return;
        if (state.pending && now - state.pending.at >= 2000 && current.height > state.pending.height) {
            if (!state.pending.locked) {
                // An upper bound may not replace the stalled decoder promptly.
                writeRange(player, state.cap, state.cap);
                state.pending.locked = true;
                state.pending.at = now;
                state.settleUntil = now + 500;
                resetSamples(state);
                return;
            }
            reason = 'unconfirmed-switch';
        }
        if (!reason) return;
        const ceiling = Math.min(current.height, state.pending?.height || Infinity,
            levels.find(item => item.quality === state.cap)?.height || Infinity);
        const lower = levels.filter(item => item.height < ceiling).at(-1);
        if (!lower) return;
        writeRange(player, fixed ? lower.quality : 'tiny', lower.quality);
        state.rejectedHeight = Math.min(state.rejectedHeight || Infinity, current.height);
        state.cap = lower.quality;
        state.reportedPreference = player.getPreferredQuality?.();
        state.pending = { height: lower.height, at: now, locked: fixed };
        state.settleUntil = now + 500;
        savePreference(state);
        resetSamples(state);
        console.info('[PlaybackQuality] Recovery:', { reason, speed, from: current.quality, to: lower.quality, ahead, frames });
    } catch (error) {
        console.warn('[PlaybackQuality] Player is changing:', error);
    }
}
