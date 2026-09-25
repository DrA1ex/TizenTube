// TV player format IDs are itag + optional xtags, not the resolution's quality ID.
export function playbackFormats(formats = []) {
    return formats.filter(format => format.mimeType?.startsWith('video/') && format.itag
        && format.width > 0 && format.height > 0 && format.fps > 0 && format.quality)
        .map(format => ({
            id: String(format.itag) + (format.xtags ? ';' + format.xtags : ''),
            quality: format.quality, width: Number(format.width), height: Number(format.height),
            fps: Number(format.fps), bitrate: Number(format.bitrate) || Number(format.averageBitrate) || 0,
            mimeType: format.mimeType, projection: format.projectionType || 'RECTANGULAR',
            pixelRate: format.width * format.height * format.fps
        }));
}

export function lighterPlaybackFormats(formats, current, tried, supported) {
    if (!current) return [];

    return formats.filter(format => format.id !== current.id && !tried.has(format.id)
        && format.quality === current.quality && format.width === current.width && format.height === current.height
        && format.projection === current.projection
        && (format.pixelRate < current.pixelRate || (format.pixelRate === current.pixelRate
            && format.bitrate > 0 && current.bitrate > 0 && format.bitrate < current.bitrate))
        && supported(format.mimeType))
        .sort((a, b) => a.pixelRate - b.pixelRate || (a.bitrate || Infinity) - (b.bitrate || Infinity));
}

export function currentPlaybackFormat(player, formats) {
    try {
        const id = String(player.getVideoStats?.()?.fmt || '');
        const exact = formats.find(format => format.id === id);
        if (exact) return exact;

        const stats = player.getStatsForNerds?.();
        const itag = stats?.codecs?.split(' / ')[0].match(/\((\d+)\)/)?.[1];
        const resolution = stats?.resolution?.match(/^(\d+)x(\d+)@([\d.]+)/);
        // Stats-for-nerds doesn't expose xtags. Do not claim an exact match if
        // several variants share this itag, or use the requested/optimal size.
        const matches = formats.filter(format => format.id.split(';')[0] === itag);
        const format = matches.length === 1 ? matches[0] : null;
        if (format && resolution && format.width === Number(resolution[1])
            && format.height === Number(resolution[2]) && Math.abs(format.fps - Number(resolution[3])) < 1) return format;
    } catch (_) { /* Telemetry may be unavailable during a player transition. */ }

    return null;
}

export function supportsPlaybackFormat(video, mimeType) {
    try {
        const windowRef = video.ownerDocument?.defaultView || globalThis.window;
        return windowRef?.MediaSource?.isTypeSupported?.(mimeType) === true;
    } catch (_) { return false; }
}
