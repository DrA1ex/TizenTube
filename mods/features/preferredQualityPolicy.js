const qualityValue = (label) => Number.parseInt(label, 10) || 0;

// Video formats from a player response, grouped by the quality level the
// player API uses (hd2160, hd1440, ...). The label, not the coded height,
// defines the level: portrait and cropped videos have unusual heights.
export function videoFormats(response) {
    const formats = response?.streamingData?.adaptiveFormats;
    if (!Array.isArray(formats)) return [];
    return formats.filter(format => format?.mimeType?.startsWith('video/') && format.quality
        && format.width > 0 && format.height > 0 && format.fps > 0)
        .map(format => ({
            quality: format.quality, level: qualityValue(format.qualityLabel) || Number(format.height),
            width: Number(format.width), height: Number(format.height), fps: Number(format.fps),
            mimeType: format.mimeType
        }));
}

// Keep the preferred codec wherever it exists, but never let it lower the
// maximum resolution: some videos offer VP9 only up to 240p and H.264 above.
export function preferVideoCodec(formats, codec) {
    const level = format => qualityValue(format.qualityLabel) || Number(format.height) || 0;
    const preferred = formats.filter(format => format?.mimeType?.startsWith('video/') && format.mimeType.includes(codec));
    if (!preferred.length) return formats;
    const highest = Math.max(...preferred.map(level));
    return formats.filter(format => !format?.mimeType?.startsWith('video/')
        || format.mimeType.includes(codec) || level(format) > highest);
}

function decoderType(format, fps) {
    return `${format.mimeType}; width=${format.width}; height=${format.height}; framerate=${Math.ceil(fps)}`;
}

// Cobalt answers MediaSource.isTypeSupported with the platform decoder's
// size/frame-rate limits. At speed S a format needs fps * S decoded frames per
// second. A level is usable when each of its formats that plays at 1x also
// decodes at the accelerated rate. Returns Infinity when nothing is limited.
export function speedCeiling(formats, speed, supports) {
    if (!(speed > 1) || !formats.length) return Infinity;
    const levels = new Map();
    for (const format of formats) {
        if (!supports(decoderType(format, format.fps))) continue;
        const fast = supports(decoderType(format, format.fps * speed));
        levels.set(format.level, (levels.get(format.level) ?? true) && fast);
    }
    const playable = [...levels.keys()].sort((a, b) => b - a);
    if (!playable.length || levels.get(playable[0])) return Infinity;
    return playable.find(level => levels.get(level)) ?? playable.at(-1);
}

// Returns null when the player may choose freely (Auto without a decoder
// limit). Otherwise { quality, level, auto, limited }: a fixed preference is
// locked to that level; Auto only uses it as an upper bound.
export function targetQuality(preference, speed, formats, supports) {
    const levels = [...new Map(formats.map(format => [format.level, format.quality])).entries()]
        .map(([level, quality]) => ({ level, quality })).sort((a, b) => b.level - a.level);
    if (!levels.length) return null;
    const auto = !preference || preference === 'auto' || !qualityValue(preference);
    const preferred = auto ? Infinity : qualityValue(preference);
    const decodable = speedCeiling(formats, speed, supports);
    const ceiling = Math.min(preferred, decodable);
    if (ceiling === Infinity) return null;
    const chosen = levels.find(item => item.level <= ceiling) || levels.at(-1);
    return { quality: chosen.quality, level: chosen.level, auto, limited: decodable < preferred };
}

// YouTube stores the last explicit choice as a sticky maximum and reads it
// when the next video's loader starts. Its storage wrapper keeps JSON data
// together with expiration and creation times; entries older than 30 days
// are ignored by the player.
export function stickyQualityEntry(level, now = Date.now()) {
    return JSON.stringify({ data: JSON.stringify({ quality: level, previousQuality: level }),
        expiration: now + 31104e6, creation: now });
}

export function stickyQualityLevel(value) {
    try {
        const entry = JSON.parse(value);
        return Number(JSON.parse(entry.data).quality) || 0;
    } catch (_) { return 0; }
}

export function cachedSupport(isTypeSupported) {
    const cache = new Map();
    return type => {
        if (!cache.has(type)) {
            let supported = false;
            try { supported = isTypeSupported(type) === true; } catch (_) { /* Treat as unsupported. */ }
            cache.set(type, supported);
        }
        return cache.get(type);
    };
}
