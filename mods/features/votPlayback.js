// Pure policy shared by the controller and local regression tests.
export function languageCode(value) {
    return typeof value === 'string' ? value.toLowerCase().split(/[-_.]/)[0] : '';
}

export function sourceLanguage(player) {
    try {
        const track = player?.getAudioTrack?.();
        const explicit = track?.languageCode || track?.language || track?.id;
        if (explicit) return languageCode(explicit);
        const response = player?.getPlayerResponse?.();
        const details = response?.videoDetails;
        const declared = details?.defaultAudioLanguage || details?.language;
        if (declared) return languageCode(declared);
        // ASR is evidence of spoken language; availability of translated captions isn't.
        const captions = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        const asr = captions?.find(track => track.kind === 'asr');
        return languageCode(asr?.languageCode);
    } catch (_) { return ''; }
}

export function playbackSnapshot(media, { hidden = false, buffering = false, now = Date.now(), progressAt = now } = {}) {
    return {
        positionMs: Math.max(0, Math.round((Number(media.currentTime) || 0) * 1000)),
        rate: Math.max(0.25, Math.min(5, Number(media.playbackRate) || 1)),
        paused: Boolean(hidden || buffering || media.paused || media.seeking || media.ended
            || media.readyState < 3 || now - progressAt > 1000),
    };
}

export function videoIsCurrent(media, expectedId, currentId, currentMedia, hidden = false) {
    return Boolean(media && media.isConnected && media === currentMedia && expectedId
        && expectedId === currentId && !media.ended && !hidden);
}
