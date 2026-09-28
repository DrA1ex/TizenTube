import { determineQuality } from './preferredQualityPolicy.js';

function responseForVideo(player, videoId) {
    try {
        let response = player.getPlayerResponse?.();
        if (typeof response === 'string') response = JSON.parse(response);
        if (response?.videoDetails?.videoId && response.videoDetails.videoId !== videoId) return null;
        return response;
    } catch (_) { return null; }
}

// Keep a configured choice for one video. During a loader transition both the
// video ID and the available-quality list can temporarily disappear or shrink.
export class PreferredQualitySession {
    #videoId = null;
    #appliedPreference = null;
    #appliedQuality = null;

    apply(player, preference, { configChanged = false } = {}) {
        if (!player) return false;
        let videoId;
        try { videoId = player.getVideoData?.()?.video_id; } catch (_) { return false; }
        if (!videoId) return false;
        if (videoId !== this.#videoId) {
            this.#videoId = videoId;
            this.#appliedPreference = null;
            this.#appliedQuality = null;
        }

        if (!configChanged) {
            let state;
            try { state = player.getPlayerStateObject?.(); } catch (_) { return false; }
            if (!state?.isPlaying) return false;
        }
        try {
            if (Object.values(player.getVideoStats?.() || {}).includes('shortspage')) return false;
        } catch (_) { /* Stats are optional while the loader starts. */ }

        if (!preference || preference === 'auto') {
            if (configChanged && this.#appliedQuality) {
                player.setPlaybackQualityRange('auto', 'auto');
                this.#appliedQuality = null;
            }
            this.#appliedPreference = 'auto';
            return true;
        }
        if (this.#appliedPreference === preference) return true;

        let available;
        try { available = player.getAvailableQualityData?.(); } catch (_) { return false; }
        const quality = determineQuality(preference, available);
        if (!quality) return false;

        // A partial list must not turn a 4K preference into a sticky 240p cap.
        // Fall back only after the response confirms that the chosen level is
        // the highest format this video actually offers.
        const preferredHeight = Number.parseInt(preference, 10);
        const selectedHeight = Number.parseInt(available.find(item => item.quality === quality)?.qualityLabel, 10);
        if (selectedHeight < preferredHeight) {
            const response = responseForVideo(player, videoId);
            const formats = response?.streamingData?.adaptiveFormats?.filter(format =>
                format.mimeType?.startsWith('video/') && format.height > 0) || [];
            if (!formats.length || formats.some(format => format.height > selectedHeight)) return false;
        }

        player.setPlaybackQualityRange(quality, quality);
        this.#appliedPreference = preference;
        this.#appliedQuality = quality;
        return true;
    }
}
