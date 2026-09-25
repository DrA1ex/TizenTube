import { audioText } from '../features/audioLocale.js';
import { languageCode, sourceLanguage } from './votPlayback.js';

const AUDIO_TRACK_BUILD = 'v7.11';
if (typeof window !== 'undefined') window.__ttAudioTrackBuild = AUDIO_TRACK_BUILD;

// No URLs, token values, account fields or translation payloads: only track-selection evidence.
function recordOriginalDecision(inventory, decision) {
    const track = item => item ? { id: item.id, language: item.language, original: item.original, dubbed: item.dubbed,
        dubStatusUnknown: item.dubStatusUnknown, flags: item.flagEvidence } : null;
    const record = { build: AUDIO_TRACK_BUILD, time: Date.now(), decision,
        keepCurrentAudio: inventory.keepCurrentAudio, originalLanguage: inventory.originalLanguage,
        evidence: inventory.evidence, selected: track(inventory.selected), original: track(inventory.original),
        trackCount: inventory.tracks.length, tracks: inventory.tracks.slice(0, 30).map(track) };
    if (typeof window !== 'undefined') {
        const history = Array.isArray(window.__ttAudioTrackDiagnostics) ? window.__ttAudioTrackDiagnostics : [];
        window.__ttAudioTrackDiagnostics = [...history.slice(-7), record];
    }
    console.info('[TT audio decision]', JSON.stringify(record));
}

export const LANGUAGE_NAMES = { ru: 'Русский', en: 'Английский', kk: 'Казахский', de: 'Немецкий', fr: 'Французский',
    es: 'Испанский', it: 'Итальянский', zh: 'Китайский', ja: 'Японский', ko: 'Корейский', ar: 'Арабский',
    lt: 'Литовский', lv: 'Латышский', uk: 'Украинский', pt: 'Португальский', tr: 'Турецкий', hi: 'Хинди' };
// Verified against upstream LANG_SUPPORT.md (2026-09-13). Availability of a voice is decided by the API.
export const YANDEX_TARGETS = ['ru', 'en', 'kk'];
export const YANDEX_SOURCES = ['ru', 'en', 'zh', 'ko', 'lt', 'lv', 'ar', 'fr', 'it', 'es', 'de', 'ja'];
const LANGUAGE_NAMES_EN = { ru: 'Russian', en: 'English', kk: 'Kazakh', de: 'German', fr: 'French',
    es: 'Spanish', it: 'Italian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
    lt: 'Lithuanian', lv: 'Latvian', uk: 'Ukrainian', pt: 'Portuguese', tr: 'Turkish', hi: 'Hindi' };
export const languageName = code => code && LANGUAGE_NAMES[code]
    ? audioText(LANGUAGE_NAMES_EN[code], LANGUAGE_NAMES[code])
    : code || audioText('Language not specified', 'Язык не указан');
export const supportsTranslation = (source, target) => source !== target && YANDEX_SOURCES.includes(source) && YANDEX_TARGETS.includes(target);
export const getAudioPlayer = () => document.querySelector('.html5-video-player');
const text = value => typeof value === 'string' ? value : value?.simpleText || value?.runs?.map(x => x.text).join('') || '';
const trackLanguage = value => {
    const code = languageCode(value);
    return /^[a-z]{2,3}$/.test(code) && code !== 'und' ? code : '';
};

// YouTube may return a track class with boolean query METHODS rather than JSON flags.
// Boolean(method) and Boolean('false') are both true and must never mean dubbed/original.
function readTrackFlag(owner, key) {
    let inputType = 'undefined';
    try {
        let value = owner?.[key];
        inputType = typeof value;
        if (typeof value === 'function') value = value.call(owner);
        if (value == null) return { inputType, value: false, unknown: false };
        if (typeof value === 'boolean') return { inputType, value, unknown: false };
        if (value === 1 || value === 0) return { inputType, value: value === 1, unknown: false };
        if (typeof value === 'string' && /^(true|false|0|1)$/i.test(value.trim()))
            return { inputType, value: /^(true|1)$/i.test(value.trim()), unknown: false };
        return { inputType, value: false, unknown: true };
    } catch (_) { return { inputType, value: false, unknown: true }; }
}

export function normalizeTrack(raw) {
    let languageInfo;
    try { languageInfo = raw?.getLanguageInfo?.(); } catch (_) {}
    const info = languageInfo || raw?.audioTrackInfo || raw || {};
    // The player's opaque ID is selectable; the language ID (e.g. en-US.4) is not.
    const id = raw?.id || info.id || info.audioTrackId;
    if (!id) return null;
    const name = text(info.displayName || raw.displayName || info.name);
    const flagEvidence = {};
    const owners = info === raw ? [['track', info]] : [['info', info], ['track', raw]];
    for (const [label, owner] of owners) for (const key of ['isOriginal', 'isAutoDubbed', 'isDubbed'])
        flagEvidence[label + '.' + key] = readTrackFlag(owner, key);
    const flags = suffix => Object.entries(flagEvidence).filter(([key]) => key.endsWith('.' + suffix)).map(([, flag]) => flag);
    const dubFlags = [...flags('isAutoDubbed'), ...flags('isDubbed')];
    return { id: String(id), languageId: String(info.id || id),
        language: trackLanguage(info.languageCode || info.language || info.id || id), name,
        original: Boolean(flags('isOriginal').some(flag => flag.value) || info.audioTrackType === 'ORIGINAL'
            || /(?:\boriginal\b|оригинал)/i.test(name)),
        dubbed: Boolean(dubFlags.some(flag => flag.value) || /auto.?dub|автодуб|автоматическ/i.test(name)),
        dubStatusUnknown: dubFlags.some(flag => flag.unknown), flagEvidence,
        raw };
}

export function audioInventory(player = getAudioPlayer()) {
    let response = {}, available = [], selected = null;
    try {
        response = player?.getPlayerResponse?.() || {};
        if (typeof response === 'string') response = JSON.parse(response);
        available = player?.getAvailableAudioTracks?.() || [];
        selected = normalizeTrack(player?.getAudioTrack?.());
    } catch (_) {}
    if (!Array.isArray(available)) available = [];
    const tracks = available.map(normalizeTrack).filter(Boolean);
    for (const format of response?.streamingData?.adaptiveFormats || []) {
        if (!format.audioTrack) continue;
        const track = normalizeTrack(format.audioTrack);
        if (!track) continue;
        const actual = tracks.find(x => x.languageId === track.id || x.id === track.id);
        if (actual) {
            actual.original ||= track.original;
            actual.dubbed ||= track.dubbed;
            actual.language ||= track.language;
            actual.name ||= track.name;
        }
        // Format JSON is metadata, never a selectable player descriptor.
        // With no API tracks retain it for language discovery only.
        else if (!available.length && !tracks.some(x => x.id === track.id)) tracks.push(track);
    }
    if (selected && !tracks.some(x => x.id === selected.id)) tracks.push(selected);
    const declared = languageCode(response?.videoDetails?.defaultAudioLanguage || response?.videoDetails?.language);
    const asr = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.find(x => x.kind === 'asr');
    const source = declared || languageCode(asr?.languageCode);
    let original = tracks.find(x => x.original && !x.dubbed && !x.dubStatusUnknown)
        || (source ? tracks.find(x => x.language === source && !x.dubbed && !x.dubStatusUnknown) : null);
    // A single non-dubbed track needs no switch; default/current multi-track is NOT proof of original.
    if (!original && tracks.length === 1 && !tracks[0].dubbed && !tracks[0].dubStatusUnknown) original = tracks[0];
    const originalLanguage = original?.language || source || (tracks.length === 0 ? trackLanguage(sourceLanguage(player)) : '');
    return { tracks, selected, original, originalLanguage,
        evidence: { availableCount: available.length,
            formatTrackCount: (response?.streamingData?.adaptiveFormats || []).filter(format => format.audioTrack).length },
        // Old players expose no audio-track descriptors at all. Keep the current audio;
        // this is not language evidence and must not enable language-based auto translation.
        keepCurrentAudio: tracks.length === 0 || (tracks.length === 1 && !tracks[0].dubbed && !tracks[0].dubStatusUnknown),
        canSelect: typeof player?.setAudioTrack === 'function', player };
}

export function filteredYouTubeTracks(inventory, languages) {
    return inventory.tracks.filter(x => !x.original && x.id !== inventory.original?.id && languages.includes(x.language));
}

export async function selectYouTubeTrack(id, { isCurrent = () => true, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    let inventory = audioInventory();
    const track = inventory.tracks.find(x => x.id === id);
    if (!track) throw new Error(audioText('This track is no longer available', 'Эта дорожка больше недоступна'));
    if (inventory.selected?.id === id) return;
    if (!inventory.canSelect) throw new Error(audioText('YouTube did not provide audio track controls', 'YouTube не предоставил управление аудиодорожками'));
    if (!isCurrent()) throw new Error(audioText('Track selection cancelled', 'Выбор дорожки отменён'));
    // Resolve afresh immediately before switching. Passing adaptiveFormats.audioTrack
    // makes the TV loader fail to resolve its ID and dereference null.reason.
    const available = inventory.player.getAvailableAudioTracks?.() || [];
    const descriptor = available.find(raw => String(raw?.id) === id);
    if (!descriptor) throw new Error(audioText('YouTube has not made this track available for switching yet', 'YouTube пока не предоставил эту дорожку для переключения'));
    await inventory.player.setAudioTrack(descriptor);
    for (let i = 0; i < 30; i++) {
        if (!isCurrent()) throw new Error(audioText('Track selection cancelled', 'Выбор дорожки отменён'));
        inventory = audioInventory();
        if (inventory.selected?.id === id) return;
        await delay(100);
    }
    throw new Error(audioText('YouTube did not confirm the track switch', 'YouTube не подтвердил переключение дорожки'));
}

export async function ensureOriginal(options) {
    const inventory = audioInventory();
    if (options?.isCurrent && !options.isCurrent()) throw new Error(audioText('Track selection cancelled', 'Выбор дорожки отменён'));
    recordOriginalDecision(inventory, inventory.keepCurrentAudio ? 'keep-current' : inventory.original ? 'switch-original' : 'reject-unknown-original');
    if (inventory.keepCurrentAudio) return;
    if (inventory.original) return selectYouTubeTrack(inventory.original.id, options);
    if (!inventory.tracks.length && inventory.originalLanguage) return;
    throw new Error(audioText('YouTube has not identified the original track yet [AT-74]', 'YouTube пока не сообщил, какая дорожка оригинальная [AT-74]'));
}
