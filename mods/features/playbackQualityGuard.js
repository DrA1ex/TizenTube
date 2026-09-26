import {
    playbackFormats, lighterPlaybackFormats, currentPlaybackFormat, supportsPlaybackFormat
} from './playbackFormats.js';

// GX1's known working baseline is 3840x2160 at 60 fps, not 4K at 90/120 fps.
// This is a conservative workload budget, not a codec capability measurement.
export const VIDEO_PIXEL_RATE_BUDGET = 3840 * 2160 * 60;
const states = new WeakMap();
const RESTORE_KEY = 'tt-acceleration-quality-restore';
const STALL_MS = 1500;
const NETWORK_STALL_MS = 2000;
const SWITCH_SETTLE_MS = 1500;
const FORMAT_TRIAL_MS = 4000;
const MAX_SAMPLE_GAP_MS = 2000;

export function playbackQualityCandidates(available, formats = []) {
    const candidates = new Map();
    for (const item of available || []) {
        if (item.isPlayable === false || item.paygatedQualityDetails || !item.quality) continue;

        const label = String(item.qualityLabel || '');
        const height = Number.parseInt(label, 10);
        if (!(height > 0)) continue;

        const matching = formats.filter(format => format.quality === item.quality
            && format.mimeType?.startsWith('video/') && format.width > 0 && format.height > 0);
        // A quality range selects a resolution, not an individual FPS variant.
        // Budget for the heaviest variant that the player can select at that level.
        const fps = Number(label.match(/p(\d+(?:\.\d+)?)/i)?.[1]) || 60;
        const pixelRate = matching.length
            ? Math.max(...matching.map(format => format.width * format.height * (Number(format.fps) || fps)))
            : Math.ceil(height * 16 / 9) * height * fps;
        const previous = candidates.get(item.quality);
        candidates.set(item.quality, {
            quality: item.quality, height, pixelRate: Math.max(pixelRate, previous?.pixelRate || 0)
        });
    }

    return [...candidates.values()].sort((a, b) => a.height - b.height);
}

export function accelerationQualityLimit(candidates, speed) {
    // Preserve the existing 1.0001x stutter workaround and normal-speed quality.
    if (speed <= 1.01 || !candidates.length) return null;

    const safe = candidates.filter(item => item.pixelRate * speed <= VIDEO_PIXEL_RATE_BUDGET);
    const limit = safe.at(-1) || candidates[0];
    return limit === candidates.at(-1) ? null : limit;
}

function bufferedAhead(video) {
    for (let index = 0; index < (video.buffered?.length || 0); index++) {
        if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) > video.currentTime) {
            return video.buffered.end(index) - video.currentTime;
        }
    }

    return 0;
}

function frameCounts(video) {
    let frames;
    try { frames = video.getVideoPlaybackQuality?.(); } catch (_) { return null; }
    if (!Number.isFinite(frames?.totalVideoFrames) || !Number.isFinite(frames?.droppedVideoFrames)
        || frames.droppedVideoFrames < 0 || frames.totalVideoFrames < frames.droppedVideoFrames) return null;

    return { total: frames.totalVideoFrames, presented: frames.totalVideoFrames - frames.droppedVideoFrames };
}

function restoreStorage(video) {
    try { return video.ownerDocument?.defaultView?.localStorage; } catch (_) { return null; }
}

function saveRestorePreference(video, preferred, cap) {
    // YouTube's public quality API also writes its sticky quality preference.
    // Keep the original across app restarts, not just in the in-memory guard.
    try {
        const storage = restoreStorage(video);
        if (cap) storage?.setItem(RESTORE_KEY, JSON.stringify({ preferred, cap }));
        else storage?.removeItem(RESTORE_KEY);
    } catch (_) { /* Storage can be disabled; in-session restoration still works. */ }
}

export function applyPreferredQuality(player, quality) {
    const state = states.get(player);
    if (state?.format?.choice.quality === quality) {
        // The configured-quality handler runs on playback start, sometimes after
        // canplay. Its resolution write must not erase a pending format choice.
        player.setPlaybackQualityRange(quality, quality, state.format.choice.id);
        state.preferred = quality;
        saveRestorePreference(state.video, quality, state.cap);
    } else {
        player.setPlaybackQualityRange(quality, quality);
    }
}

// Called on speed/media changes, buffering events and a short timer. There is no
// per-frame JS work, seeking, or alteration of compressed frame dependencies.
export function guardPlaybackQuality(player, video, speed, now = Date.now()) {
    if (!player?.setPlaybackQualityRange || !player.getAvailableQualityData || !video) return;

    try {
        const videoId = player.getVideoData?.()?.video_id || '';
        let state = states.get(player);
        const preferred = player.getPreferredQuality?.();
        if (!state) {
            state = { preferred: preferred || 'auto', cap: null, video, videoId, speed, tried: new Set() };
            try {
                const saved = JSON.parse(restoreStorage(video)?.getItem(RESTORE_KEY) || 'null');
                if (saved?.cap === preferred && typeof saved.preferred === 'string') {
                    state.preferred = saved.preferred;
                    state.cap = saved.cap;
                } else if (saved && preferred) {
                    saveRestorePreference(video, null, null);
                }
            } catch (_) { /* Ignore missing or invalid saved state. */ }

            states.set(player, state);
        }

        // Track manual choices, including changes made outside TizenTube's menu.
        const manualChange = preferred && preferred !== state.cap && preferred !== state.preferred;
        if (preferred && preferred !== state.cap) state.preferred = preferred;

        const changed = state.video !== video || state.videoId !== videoId || state.speed !== speed;
        if (changed || manualChange) {
            state.video = video;
            state.videoId = videoId;
            state.speed = speed;
            state.recoveryHeight = null;
            state.sample = null;
            state.cooldownUntil = now;
            state.tried.clear();
            state.networkSince = null;
            state.hasProgress = false;
            state.releaseFormat = Boolean(state.format);
            state.format = null;
        }

        let response = player.getPlayerResponse?.();
        if (typeof response === 'string') response = JSON.parse(response);
        const candidates = playbackQualityCandidates(player.getAvailableQualityData(),
            response?.streamingData?.adaptiveFormats);
        if (!candidates.length) return;

        const formats = playbackFormats(response?.streamingData?.adaptiveFormats);
        const currentFormat = currentPlaybackFormat(player, formats);
        let needsRecovery = false;
        const playing = !video.paused && !video.ended && !video.seeking;
        const ahead = bufferedAhead(video);
        const buffered = playing && ahead >= speed * 2 && (video.readyState === undefined || video.readyState >= 3);
        const frames = buffered ? frameCounts(video) : null;
        const sample = state.sample;
        // A long gap means the JS timer was suspended. A seek can also jump the
        // media clock without a seeking event reaching this document.
        if (!playing) state.hasProgress = false;
        if (!buffered || !sample || now - sample.now > MAX_SAMPLE_GAP_MS
            || video.currentTime < sample.time || video.currentTime - sample.time > (now - sample.now) / 1000 * speed * 1.5) {
            state.sample = buffered ? { now, time: video.currentTime, frames,
                progressAt: now, frameAt: now, windowAt: now, windowTime: video.currentTime,
                windowFrames: frames } : null;
        } else {
            if (video.currentTime > sample.time) {
                sample.progressAt = now;
                state.hasProgress = true;
            }
            if (frames && sample.frames && frames.presented > sample.frames.presented) sample.frameAt = now;
            if (!frames || !sample.frames || frames.total < sample.frames.total) sample.frameAt = now;
            const elapsed = (now - sample.windowAt) / 1000;
            const progress = video.currentTime - sample.windowTime;
            const presented = frames && sample.windowFrames && frames.presented - sample.windowFrames.presented;
            const slow = elapsed >= STALL_MS / 1000 && elapsed <= MAX_SAMPLE_GAP_MS / 1000
                && progress >= 0 && progress < elapsed * speed * 0.55;
            const dropping = elapsed >= STALL_MS / 1000 && currentFormat && frames && sample.windowFrames
                && frames.total > sample.windowFrames.total && presented >= 0
                && presented < elapsed * Math.min(60, currentFormat.fps * speed) * 0.55;
            const frozen = sample.frames?.presented > 0 && frames && frames.total >= sample.frames.total
                && now - sample.frameAt >= STALL_MS;
            if (now >= (state.cooldownUntil || 0)
                && (now - sample.progressAt >= STALL_MS || frozen || slow || dropping)) needsRecovery = true;
            if (elapsed >= STALL_MS / 1000) {
                sample.windowAt = now;
                sample.windowTime = video.currentTime;
                sample.windowFrames = frames;
            }
            sample.now = now;
            sample.time = video.currentTime;
            sample.frames = frames;
        }

        // A locked format can starve even when the decoder is healthy. Only
        // react to an empty buffer after playback has previously advanced.
        const starving = playing && video.readyState < 3 && ahead < speed;
        state.networkSince = starving && state.hasProgress ? (state.networkSince ?? now) : null;
        if (starving && state.networkSince !== null && now - state.networkSince >= NETWORK_STALL_MS
            && now >= (state.cooldownUntil || 0)) needsRecovery = true;

        if (state.format) {
            if (currentFormat?.id === state.format.choice.id) state.format.lastSeen = now;
            else if (video.paused || video.seeking || video.ended) state.format.started = now;
            else if (now - Math.max(state.format.started, state.format.lastSeen || 0) >= FORMAT_TRIAL_MS) {
                // A successful API call is not proof that the loader accepted the
                // format. Future player versions may ignore the third argument.
                needsRecovery = true;
            }

            // Pinning a format temporarily suspends ABR. Do not keep that pin
            // through a network stall; try a lighter variant or release it below.
            if (!needsRecovery) return;
        }

        const currentQuality = player.getPlaybackQuality?.();
        const targetQuality = state.format?.choice.quality
            || (needsRecovery ? currentQuality : state.preferred !== 'auto' ? state.preferred : currentQuality);
        const target = candidates.find(item => item.quality === targetQuality) || candidates.at(-1);
        // If telemetry is unavailable, estimate from the heaviest variant, but
        // still require actual telemetry to confirm any requested replacement.
        const baseline = (currentFormat?.quality === target.quality ? currentFormat : null) || state.format?.choice
            || formats.filter(format => format.quality === target.quality)
                .sort((a, b) => b.pixelRate - a.pixelRate || b.bitrate - a.bitrate)[0];
        const overloaded = (baseline?.pixelRate || target.pixelRate) * speed > VIDEO_PIXEL_RATE_BUDGET;
        if ((needsRecovery || (speed > 1.01 && overloaded))
            && (player.getVideoStats || player.getStatsForNerds)) {
            if (state.format) state.tried.add(state.format.choice.id);
            const alternatives = lighterPlaybackFormats(formats, baseline, state.tried,
                mimeType => supportsPlaybackFormat(video, mimeType));
            for (const choice of alternatives) {
                state.tried.add(choice.id);
                try {
                    // The exact format preference is honored only for a locked
                    // resolution range in both TV DASH and SABR loaders.
                    player.setPlaybackQualityRange(choice.quality, choice.quality, choice.id);
                    state.format = { choice, started: now, lastSeen: 0 };
                    state.releaseFormat = false;
                    state.cap = choice.quality;
                    saveRestorePreference(video, state.preferred, state.cap);
                    state.cooldownUntil = now + SWITCH_SETTLE_MS;
                    state.networkSince = null;
                    state.sample = null;
                    console.info('[PlaybackSpeed] Trying lighter format:', choice.id, choice.quality, choice.fps);
                    return;
                } catch (_) { /* Try the next supported variant before lowering resolution. */ }
            }
        }

        let recoveryHeight = state.recoveryHeight;
        if (needsRecovery) {
            const lower = candidates.filter(item => item.height < target.height
                && (!recoveryHeight || item.height < recoveryHeight)).at(-1);
            if (lower) recoveryHeight = lower.height;
        }

        let limit = accelerationQualityLimit(candidates, speed);
        // A confirmed lighter current stream can fit even though another variant
        // at the same resolution exceeds the conservative range-only budget.
        if (!needsRecovery && currentFormat && currentFormat.pixelRate * speed <= VIDEO_PIXEL_RATE_BUDGET
            && (!state.cap || state.releaseFormat || currentFormat.quality === candidates.at(-1).quality)) limit = null;
        if (recoveryHeight) {
            const recovery = candidates.filter(item => item.height <= recoveryHeight).at(-1);
            if (recovery && (!limit || recovery.height < limit.height)) limit = recovery;
        }

        const wanted = candidates.find(item => item.quality === state.preferred);
        if (wanted && limit && wanted.height <= limit.height) limit = null;
        const cap = limit?.quality || null;
        if (cap) {
            if (state.cap !== cap || state.format || state.releaseFormat || (preferred && preferred !== cap)) {
                // Upper bound only: leave ABR free to go lower when bandwidth falls.
                player.setPlaybackQualityRange('tiny', cap);
                state.cap = cap;
                state.recoveryHeight = recoveryHeight;
                state.format = null;
                state.releaseFormat = false;
                saveRestorePreference(video, state.preferred, cap);
                state.cooldownUntil = now + SWITCH_SETTLE_MS;
                state.sample = null;
                console.info('[PlaybackSpeed] Temporary quality limit:', cap, 'at', speed);
            }
        } else if (state.cap) {
            const restore = wanted?.quality || 'auto';
            player.setPlaybackQualityRange(restore, restore);
            state.cap = null;
            state.format = null;
            state.releaseFormat = false;
            saveRestorePreference(video, null, null);
            state.sample = null;
        }
    } catch (error) {
        // Player APIs can be unavailable during an ad or a video transition.
        // Keep state for a later retry; never restart or seek the video here.
        console.warn('[PlaybackSpeed] Quality guard is not ready yet:', error);
    }
}
