import { audioText } from '../features/audioLocale.js';
import VOTClient from '@vot.js/ext';
import { VOTWorkerProvider } from '@vot.js/core/providers/votworker';
import { configRead, configWrite, configChangeEmitter } from '../config.js';
import { playbackSnapshot, videoIsCurrent, sourceLanguage } from './votPlayback.js';
import { probeVotLanguage } from './votLanguageProbe.js';
import { requestTranslationCycle, votTransportAttempts } from './votRequestPolicy.js';
import { showToast } from '../ui/ytUI.js';

const DEFAULT_WORKER_HOST = 'vot-worker.eu.cc';
const MAX_WAIT_MS = 30 * 60 * 1000;
const MIN_POLL_SECONDS = 5;
const MAX_POLL_SECONDS = 60;
const LOCAL_NATIVE_BRIDGE = 'http://127.0.0.1:8013';
const NATIVE_SYNC_HEARTBEAT_MS = 750;
const NATIVE_SYNC_DRIFT_MS = 900;

let generation = 0;
let audio = null;
let audioObjectUrl = null;
let nativeAudioActive = false;
let video = null;
let activeVideoId = null;
let originalVolume = null;
let state = 'idle';
let lastError = null;
let localBridgeAvailable = false;
let nativeHasToken = false;
let nativeForeground = true;
const commandEpoch = Date.now();
let commandSequence = 0;
const bridgeHeaders = () => ({ 'Content-Type': 'application/json', 'X-VOT-Key': window.__votBridgeKey || '' });

function label(key, fallback) {
    try {
        if (window.i18next && typeof window.i18next.t === 'function') {
            const value = window.i18next.t(key);
            if (value && value !== key) return value;
        }
    } catch (_) {}
    return fallback;
}

function toast(title, subtitle) {
    try {
        showToast(title, subtitle);
    } catch (_) {
        console.info(`[VOT] ${title}: ${subtitle}`);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getNativeBridge() {
    const bridge = window.votNative;
    return bridge
        && typeof bridge.request === 'function'
        && typeof bridge.command === 'function'
        ? bridge
        : null;
}

function hasNativeTransport() {
    return Boolean(getNativeBridge() || localBridgeAvailable);
}

async function detectLocalBridge() {
    try {
        const response = await fetch(`${LOCAL_NATIVE_BRIDGE}/health`, { cache: 'no-store', headers: bridgeHeaders(), signal: AbortSignal.timeout(3000) });
        localBridgeAvailable = response.ok;
        if (response.ok) {
            const health = await response.json();
            nativeHasToken = Boolean(health.hasToken);
            nativeForeground = health.foreground !== false;
        }
    } catch (_) {
        localBridgeAvailable = false;
    }
}

async function nativeCommand(action, parameters = {}) {
    const bridge = getNativeBridge();
    const body = JSON.stringify({ action, epoch: commandEpoch, seq: ++commandSequence, sentAt: Date.now(), ...parameters });
    if (bridge) {
        const raw = bridge.command(body);
        return raw ? JSON.parse(String(raw)) : null;
    }
    if (!localBridgeAvailable) return null;
    const response = await fetch(`${LOCAL_NATIVE_BRIDGE}/command`, {
        method: 'POST',
        headers: bridgeHeaders(),
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Native VOT command failed (${response.status})`);
    return response.json();
}

function queueNativeCommand(action, parameters = {}) {
    nativeCommand(action, parameters).catch(error => {
        console.error(`[VOT] Native command ${action} failed`, error);
    });
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function requestBodyBytes(body) {
    if (body == null) return new Uint8Array(0);
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return new TextEncoder().encode(String(body));
}

async function nativeFetch(url, options = {}) {
    if (options.signal?.aborted) throw new Error(audioText('trackSelectionCancelled'));
    const bridge = getNativeBridge();
    if (!bridge && !localBridgeAvailable) throw new Error('Native VOT bridge is unavailable');

    const headers = {};
    if (options.headers?.forEach) {
        options.headers.forEach((value, name) => { headers[name] = value; });
    } else {
        Object.assign(headers, options.headers || {});
    }

    const body = await requestBodyBytes(options.body);
    const requestJson = JSON.stringify({
        url: String(url),
        method: options.method || 'POST',
        headers,
        bodyBase64: bytesToBase64(body),
    });
    let response;
    if (bridge && !localBridgeAvailable) {
        const raw = bridge.request(requestJson);
        response = JSON.parse(String(raw));
    } else {
        const localResponse = await fetch(`${LOCAL_NATIVE_BRIDGE}/request`, {
            method: 'POST',
            headers: bridgeHeaders(),
            body: requestJson,
            cache: 'no-store',
            signal: options.signal || AbortSignal.timeout(65000),
        });
        if (!localResponse.ok) {
            throw new Error(`Native VOT request failed (${localResponse.status})`);
        }
        response = await localResponse.json();
    }
    if ([401, 403].includes(Number(response.status))) throw new Error('VOT authorization failed: HTTP ' + response.status);
    const payload = base64ToBytes(response.bodyBase64);
    const arrayBuffer = () => payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength
    );

    return {
        status: Number(response.status) || 599,
        ok: Number(response.status) >= 200 && Number(response.status) < 300,
        headers: {
            get(name) {
                return name.toLowerCase() === 'content-type' ? response.contentType || '' : null;
            },
        },
        async arrayBuffer() { return arrayBuffer(); },
        async text() { return new TextDecoder().decode(payload); },
        async json() { return JSON.parse(new TextDecoder().decode(payload)); },
    };
}

detectLocalBridge();

function getPlayerVideo() {
    return document.querySelector('video');
}

export function getCurrentVideoId() {
    try {
        const url = new URL(window.location.href);
        // TV uses #/watch?v=…; after closing, player.getVideoData() may retain the old ID.
        if (url.hash.startsWith('#/')) {
            const route = new URL(url.hash.slice(1), url);
            if (!route.pathname.includes('/watch')) return null;
            const id = route.searchParams.get('v');
            if (id) return id;
        }
    } catch (_) {}
    try {
        const player = document.querySelector('.html5-video-player');
        const playerData = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null;
        if (playerData?.video_id) return playerData.video_id;
    } catch (_) {}

    try {
        const url = new URL(window.location.href);
        return url.searchParams.get('v') || null;
    } catch (_) {
        return null;
    }
}

function getVideoData(currentVideo, videoId) {
    let duration = Number(currentVideo?.duration);
    if (!Number.isFinite(duration) || duration <= 0) duration = undefined;

    return {
        url: `https://youtu.be/${videoId}`,
        videoId,
        host: 'youtube',
        duration: duration ? Math.ceil(duration) : undefined,
    };
}

function normalizeWorkerHost(value) {
    const raw = String(value || DEFAULT_WORKER_HOST).trim();
    const normalized = raw.replace(/\/+$/, '');
    const identity = normalized.replace(/^https?:\/\//i, '');
    return identity === 'vot-worker.toil.cc' ? DEFAULT_WORKER_HOST : normalized;
}

function getToken() {
    return nativeHasToken ? 'native-stored-token' : String(configRead('votOAuthToken') || '').trim();
}

function makeClient(transport, lively, signal) {
    const token = getToken() || undefined;
    const fetchOpts = { timeout: 15000 };
    const native = hasNativeTransport();
    const fetchFn = signal ? async (url, options = {}) => {
        if (signal.aborted) throw new Error(audioText('trackSelectionCancelled'));
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, native ? 65000 : 15000);
        try {
            const response = await (native ? nativeFetch : fetch)(url, { ...options, signal: controller.signal });
            if (signal.aborted) throw new Error(audioText('trackSelectionCancelled'));
            return response;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        }
    } : native ? nativeFetch : undefined;
    if (transport === 'worker') {
        const worker = hasNativeTransport()
            ? DEFAULT_WORKER_HOST
            : normalizeWorkerHost(configRead('votWorkerHost'));
        return new VOTClient({
            host: worker,
            provider: VOTWorkerProvider,
            fetchOpts,
            fetchFn,
            apiToken: undefined,
        });
    }

    return new VOTClient({ apiToken: lively ? token : undefined, fetchOpts, fetchFn });
}

function getTransportAttempts(lively) {
    return votTransportAttempts(lively, hasNativeTransport(), configRead('votTransport'));
}

function getVoiceAttempts() {
    const mode = configRead('votVoiceMode');
    const hasToken = Boolean(getToken());

    if (mode === 'lively') {
        if (!hasToken) throw new Error('Lively voice requires a Yandex OAuth token');
        return [true];
    }
    if (mode === 'standard') return [false];
    return hasToken ? [true, false] : [false];
}

function nextPollDelay(result) {
    const remaining = Number(result?.remainingTime);
    if (!Number.isFinite(remaining) || remaining <= 0) return 15;
    return Math.max(MIN_POLL_SECONDS, Math.min(MAX_POLL_SECONDS, remaining));
}

async function pollTranslation(client, request, requestGeneration, videoId, transport, lively) {
    const started = Date.now();
    let firstWait = true;

    while (Date.now() - started < MAX_WAIT_MS) {
        if (requestGeneration !== generation || getCurrentVideoId() !== videoId) {
            throw new Error('Translation cancelled');
        }

        const result = await client.translateVideo(request);
        if (requestGeneration !== generation || getCurrentVideoId() !== videoId) throw new Error('Translation cancelled');
        // PART_CONTENT (5) may contain only the first ten minutes. Wait for the full track.
        if (result?.translated && result.url && result.status !== 5) return result;

        const delay = nextPollDelay(result);
        if (firstWait) {
            toast(
                label('vot.toast.waitingTitle', 'Voice-over Translation'),
                `${lively ? 'Lively' : 'Standard'} / ${transport}: waiting ~${delay}s`
            );
            firstWait = false;
        }
        await sleep(delay * 1000);
    }

    throw new Error('Timed out waiting for translation');
}

async function requestTranslation(currentVideo, videoId, requestGeneration) {
    const videoData = getVideoData(currentVideo, videoId);
    const voiceAttempts = getVoiceAttempts();
    let error = null;

    for (const lively of voiceAttempts) {
        const transportAttempts = getTransportAttempts(lively);
        for (const transport of transportAttempts) {
            try {
                console.info(`[VOT] Requesting ${lively ? 'lively' : 'standard'} translation via ${transport}`);
                const client = makeClient(transport, lively);
                const result = await pollTranslation(
                    client,
                    {
                        videoData,
                        requestLang: 'en',
                        responseLang: 'ru',
                        extraOpts: {
                            useLivelyVoice: lively,
                        },
                    },
                    requestGeneration,
                    videoId,
                    transport,
                    lively
                );

                return { ...result, lively, transport };
            } catch (err) {
                error = err;
                console.warn(`[VOT] ${lively ? 'lively' : 'standard'} via ${transport} failed`);
                if (requestGeneration !== generation) throw err;
            }
        }

        // Strict lively mode must never silently fall back to a standard voice.
        if (configRead('votVoiceMode') === 'lively') break;
        if (lively) toast(audioText('voiceOverTranslation'), audioText('expressiveVoiceIsUnavailableTryingStandard'));
    }

    throw error || new Error('Translation failed');
}

let translatedUrl = null;
let blockedAutoId = null;
let observedId = null;
let buffering = false;
let progressAt = Date.now();
let lastPosition = -1;
let eventsAttached = false;
let healthTick = 0;
let lastNativeError = '';
let activeVoice = null;
let lastNativeSyncAt = 0;
let lastNativeSnapshot = null;
const watchedEvents = ['playing', 'play', 'pause', 'waiting', 'stalled', 'seeking', 'seeked',
    'ratechange', 'volumechange', 'ended', 'emptied', 'abort', 'error', 'timeupdate', 'loadedmetadata'];

function playerElement() { return document.querySelector('.html5-video-player'); }

function currentIsValid() {
    return videoIsCurrent(video, activeVideoId, getCurrentVideoId(), getPlayerVideo(), document.hidden)
        && nativeForeground;
}

function snapshot() {
    return { ...playbackSnapshot(video, { hidden: document.hidden, buffering, progressAt }),
        volume: video.muted ? 0 : Math.max(0, Math.min(1, Number(configRead('votTranslationVolume')) || 0)),
        session: commandEpoch + ':' + generation, url: translatedUrl };
}

function nativeSyncIsDue(desired, now, force) {
    if (force || !lastNativeSnapshot) return true;
    if (desired.paused !== lastNativeSnapshot.paused
        || desired.rate !== lastNativeSnapshot.rate
        || desired.volume !== lastNativeSnapshot.volume
        || desired.session !== lastNativeSnapshot.session
        || desired.url !== lastNativeSnapshot.url) return true;
    const expected = lastNativeSnapshot.positionMs + (lastNativeSnapshot.paused
        ? 0 : (now - lastNativeSyncAt) * lastNativeSnapshot.rate);
    if (Math.abs(desired.positionMs - expected) > NATIVE_SYNC_DRIFT_MS) return true;
    return now - lastNativeSyncAt >= NATIVE_SYNC_HEARTBEAT_MS;
}

function syncPlayback(force = false) {
    if (!video || !translatedUrl) return;
    if (!currentIsValid()) { stopVot(); return; }
    const desired = snapshot();
    if (nativeAudioActive) {
        const now = Date.now();
        if (!nativeSyncIsDue(desired, now, force)) return;
        lastNativeSyncAt = now;
        lastNativeSnapshot = desired;
        const requestGeneration = generation;
        nativeCommand('sync', desired).then(status => {
            if (requestGeneration !== generation) return;
            if (status?.state === 'error' || status?.ok === false) {
                failPlayback(new Error(status.error || audioText('translationPlaybackError')));
            }
        }).catch(error => {
            if (requestGeneration === generation) failPlayback(error);
        });
    } else if (audio) {
        audio.volume = desired.volume;
        if (audio.playbackRate !== desired.rate) audio.playbackRate = desired.rate;
        if (Math.abs(audio.currentTime * 1000 - desired.positionMs) > 450) {
            try { audio.currentTime = desired.positionMs / 1000; } catch (_) {}
        }
        if (desired.paused) audio.pause();
        else if (audio.paused) {
            const currentAudio = audio;
            const requestGeneration = generation;
            audio.play().catch(error => {
                // pause/load can reject an older play request after a switch or seek.
                if (audio === currentAudio && generation === requestGeneration && !snapshot().paused) {
                    failPlayback(error);
                }
            });
        }
    }
}

function failPlayback(error) {
    lastNativeError = error.message || audioText('couldNotPlayTheTranslation');
    blockedAutoId = activeVideoId;
    stopVot();
    state = 'error';
    lastError = new Error(lastNativeError);
    toast(audioText('voiceOverTranslation'), lastNativeError);
}

function onVideoEvent(event) {
    if (['ended', 'emptied', 'abort', 'error'].includes(event.type)) { stopVot(); return; }
    if (['waiting', 'stalled', 'seeking'].includes(event.type)) buffering = true;
    if (['playing', 'seeked'].includes(event.type)) { buffering = false; progressAt = Date.now(); }
    if (event.type === 'timeupdate' && video && video.currentTime !== lastPosition) {
        lastPosition = video.currentTime;
        progressAt = Date.now();
        if (!video.seeking && video.readyState >= 3) buffering = false;
    }
    // timeupdate is already frequent. State transitions and D-pad seeks must
    // still reach native audio immediately; routine progress is coalesced.
    syncPlayback(event.type !== 'timeupdate');
}

function bindVideo(currentVideo, videoId) {
    video = currentVideo;
    activeVideoId = videoId;
    progressAt = Date.now();
    lastPosition = video.currentTime;
    buffering = video.readyState < 3;
    lastNativeSyncAt = 0;
    lastNativeSnapshot = null;
    watchedEvents.forEach(event => video.addEventListener(event, onVideoEvent));
    eventsAttached = true;
}

function applyVolumes() {
    if (!video || !translatedUrl) return;
    if (originalVolume === null) originalVolume = video.volume;
    const value = Number(configRead('votOriginalVolume'));
    video.volume = originalVolume * (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.2);
    syncPlayback(true);
}

function createTranslationAudio(url) {
    const created = document.createElement('audio');
    audio = created;
    created.id = 'tizentube-vot-audio';
    created.src = url;
    created.addEventListener('error', () => {
        if (audio === created) failPlayback(new Error(audioText('audioTrackIsUnavailable')));
    });
    document.body.appendChild(created);
}

function stopAudioOnly() {
    if (eventsAttached && video) watchedEvents.forEach(event => video.removeEventListener(event, onVideoEvent));
    eventsAttached = false;
    if (nativeAudioActive) queueNativeCommand('stop');
    if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.remove();
    }
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    if (video && originalVolume !== null) video.volume = originalVolume;
    audio = null;
    audioObjectUrl = null;
    translatedUrl = null;
    nativeAudioActive = false;
    video = null;
    activeVideoId = null;
    originalVolume = null;
    lastNativeSyncAt = 0;
    lastNativeSnapshot = null;
}

export function stopVot(showMessage = false) {
    if (showMessage) blockedAutoId = activeVideoId || getCurrentVideoId();
    generation++;
    stopAudioOnly();
    state = 'idle';
    activeVoice = null;
    if (showMessage) toast(audioText('voiceOverTranslation'), audioText('translationIsOffForThisVideo'));
}

export async function toggleVot(automatic = false) {
    if (state === 'loading' || state === 'playing') { if (!automatic) stopVot(true); return; }
    if (!configRead('enableVOT')) {
        if (!automatic) toast(audioText('voiceOverTranslation'), audioText('enableTranslationInVOTSettings'));
        return;
    }
    const currentVideo = getPlayerVideo();
    const videoId = getCurrentVideoId();
    if (!currentVideo || !videoId || !currentVideo.isConnected || document.hidden) {
        if (!automatic) toast(audioText('voiceOverTranslation'), audioText('openAVideoFirst'));
        return;
    }
    if (!Number.isFinite(currentVideo.duration) || playerElement()?.getPlayerResponse?.()?.videoDetails?.isLive) {
        if (!automatic) toast(audioText('voiceOverTranslation'), audioText('waitForTheVideoToLoad'));
        return;
    }
    const requestGeneration = ++generation;
    blockedAutoId = videoId;
    state = 'loading';
    lastError = null;
    bindVideo(currentVideo, videoId);
    toast(audioText('voiceOverTranslation'), audioText('preparingTranslation'));
    try {
        await detectLocalBridge();
        // One-time migration from development builds; never echo the token.
        const legacyToken = String(configRead('votOAuthToken') || '').trim();
        if (localBridgeAvailable && legacyToken) {
            const saved = await nativeCommand('authSet', { token: legacyToken });
            if (!saved?.ok) throw new Error(audioText('couldNotSaveTheTokenIn'));
            configWrite('votOAuthToken', '');
            await detectLocalBridge();
        }
        if (requestGeneration !== generation) return;
        if (!currentIsValid()) { stopVot(); return; }
        if (configRead('votVoiceMode') === 'lively' && !getToken()) {
            throw new Error(audioText('forExpressiveVoicesAddAToken'));
        }
        const result = await requestTranslation(currentVideo, videoId, requestGeneration);
        if (requestGeneration !== generation) return;
        if (!currentIsValid()) { stopVot(); return; }
        translatedUrl = result.url;
        activeVoice = result.lively ? audioText('expressive') : audioText('standard');
        nativeAudioActive = hasNativeTransport();
        originalVolume = video.volume;
        if (!nativeAudioActive) {
            createTranslationAudio(result.url);
        }
        state = 'playing';
        applyVolumes();
        toast(audioText('voiceOverTranslation'), activeVoice + audioText('voiceEnabled'));
    } catch (error) {
        if (requestGeneration !== generation) return;
        const message = String(error?.message || audioText('couldNotGetTheTranslation')).replace(/OAuth\s+\S+/gi, audioText('oauthRedacted'));
        failPlayback(new Error(message));
    }
}

export async function setOAuthToken() {
    stopVot(true);
    await detectLocalBridge();
    if (hasNativeTransport()) {
        const result = await nativeCommand('authDialog');
        if (!result?.ok) toast(audioText('yandexSignIn'), audioText('couldNotOpenTheTokenDialog'));
        return;
    }
    toast(audioText('yandexSignIn'), audioText('tokenEntryIsAvailableInThe'));
}

export async function clearOAuthToken() {
    stopVot();
    if (hasNativeTransport()) await nativeCommand('authClear');
    configWrite('votOAuthToken', '');
    await detectLocalBridge();
    toast(audioText('yandexSignIn'), audioText('tokenRemoved'));
}

export function setWorkerHost() {
    toast(audioText('voiceOverTranslation'), audioText('serviceAddressesAreConfiguredAutomaticallyIn'));
}

export function showVotStatus() {
    const description = getVotState();
    toast(audioText('voiceOverTranslation'), description.summary + (lastError ? ' · ' + lastError.message : ''));
}

export function getVotState() {
    const names = { idle: audioText('off'), loading: audioText('preparingTranslation2'), playing: video?.paused ? audioText('paused') : audioText('translationEnabled'), error: audioText('error') };
    return { state, activeVideoId, hasOAuthToken: Boolean(getToken()), foreground: nativeForeground, lastError,
        summary: names[state] + (activeVoice ? ' · ' + activeVoice + audioText('voice') : '') };
}

export async function refreshVotAuthorization() {
    await detectLocalBridge();
    const legacy = String(configRead('votOAuthToken') || '').trim();
    if (legacy && hasNativeTransport()) {
        const saved = await nativeCommand('authSet', { token: legacy });
        if (saved?.ok) { configWrite('votOAuthToken', ''); await detectLocalBridge(); }
    }
    return Boolean(getToken());
}

export async function loginYandex() {
    stopVot();
    await detectLocalBridge();
    if (!hasNativeTransport()) throw new Error(audioText('signInIsAvailableInThe'));
    const result = await nativeCommand('authLogin');
    if (!result?.ok) throw new Error(audioText('couldNotOpenTheSignIn'));
}

function waitForTranslation(ms, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error(audioText('trackSelectionCancelled'))); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
    });
}

/** Prepare independently of currently playing audio. The flow owns cancellation and selection. */
export async function prepareVotTrack({ lively, sourceLang, targetLang, videoId, media, signal, onStatus = () => {} }) {
    await refreshVotAuthorization();
    if (lively && !getToken()) {
        const error = new Error(audioText('signInToYandexForExpressive'));
        error.code = 'AUTH_REQUIRED';
        throw error;
    }
    const started = Date.now();
    const clients = getTransportAttempts(lively).map(transport => ({ client: makeClient(transport, lively, signal), transport }));
    const valid = () => !signal?.aborted && getCurrentVideoId() === videoId;
    while (valid() && Date.now() - started < MAX_WAIT_MS) {
        const request = { videoData: getVideoData(media, videoId),
            requestLang: sourceLang || 'auto', responseLang: targetLang,
            extraOpts: { useLivelyVoice: lively } };
        const cycle = await requestTranslationCycle(clients, request, valid, nextPollDelay);
        if (cycle.ready) {
            return { ...cycle.ready.result, lively, transport: cycle.ready.transport, videoId, targetLang };
        }
        if (!valid()) throw new Error(audioText('trackSelectionCancelled'));
        const authFailure = lively && cycle.failures.find(({ transport, error }) => transport === 'direct'
            && /auth required|unauthori[sz]ed|OAuth|401|403/i.test(String(error?.data?.data || error?.message || '')));
        if (authFailure) {
            const authError = new Error(audioText('yandexRejectedAuthorizationSignInAgain'));
            authError.code = 'AUTH_REQUIRED';
            throw authError;
        }
        if (!cycle.received) {
            onStatus({ state: 'retrying', attempts: cycle.attempts });
            const error = new Error(audioText('couldNotReachTheTranslationService'));
            error.cause = cycle.failures[cycle.failures.length - 1]?.error;
            throw error;
        }
        onStatus({ state: 'waiting', remaining: cycle.delay, partial: cycle.partial,
            attempts: cycle.attempts });
        await waitForTranslation(cycle.delay * 1000, signal);
    }
    if (!valid()) throw new Error(audioText('trackSelectionCancelled'));
    throw new Error(audioText('translationIsNotAvailableYetYou'));
}

export async function detectVotLanguage({ targetLang, videoId, media, signal }) {
    await refreshVotAuthorization();
    const videoData = getVideoData(media, videoId);
    let lastError;
    for (const transport of getTransportAttempts(false)) {
        if (signal?.aborted || getCurrentVideoId() !== videoId) throw new Error(audioText('languageDetectionCancelled'));
        try {
            const client = makeClient(transport, false, signal);
            const language = await probeVotLanguage(client, videoData, targetLang);
            if (signal?.aborted || getCurrentVideoId() !== videoId) throw new Error(audioText('languageDetectionCancelled'));
            return language;
        } catch (error) {
            lastError = error;
            if (signal?.aborted || getCurrentVideoId() !== videoId) throw error;
        }
    }
    throw lastError || new Error(audioText('couldNotDetectTheLanguage'));
}

export function activateVotTrack(result) {
    if (getCurrentVideoId() !== result.videoId) throw new Error(audioText('theVideoHasChanged'));
    const media = getPlayerVideo();
    if (!media || document.hidden) throw new Error(audioText('thePlayerIsInactive'));
    stopVot();
    bindVideo(media, result.videoId);
    translatedUrl = result.url;
    activeVoice = result.lively ? audioText('expressive') : audioText('standard');
    nativeAudioActive = hasNativeTransport();
    originalVolume = media.volume;
    if (!nativeAudioActive) {
        createTranslationAudio(result.url);
    }
    state = 'playing';
    lastError = null;
    applyVolumes();
}

// This monitor also covers reused/replaced video elements and cancellation during translation.
setInterval(() => {
    // Unified audio flow owns discovery while no translated track is active.
    // Avoid walking the player/DOM four times per second during normal video.
    if (!video && configRead('audioUnifiedFlow')) {
        if (++healthTick % 40 === 0) detectLocalBridge();
        return;
    }
    const id = getCurrentVideoId();
    if (id !== observedId) { observedId = id; blockedAutoId = null; }
    if (video) {
        if (!currentIsValid()) { stopVot(); return; }
        if (video.currentTime !== lastPosition) {
            lastPosition = video.currentTime;
            progressAt = Date.now();
        }
        syncPlayback();
    }
    if (++healthTick % 12 === 0) detectLocalBridge();
    const candidate = getPlayerVideo();
    if (!configRead('audioUnifiedFlow') && !video && state === 'idle' && configRead('enableVOT') && configRead('votAutoEnglish')
        && id && blockedAutoId !== id && candidate?.isConnected && candidate.getClientRects().length
        && !candidate.paused && !candidate.ended && candidate.readyState >= 3
        && !document.hidden && nativeForeground && sourceLanguage(playerElement()) === 'en') {
        toggleVot(true);
    }
}, 250);

function leaveVideo() {
    observedId = null;
    blockedAutoId = null;
    stopVot();
}
window.addEventListener('pagehide', leaveVideo);
['hashchange', 'popstate'].forEach(event => window.addEventListener(event, () => {
    if (activeVideoId && getCurrentVideoId() !== activeVideoId) leaveVideo();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) stopVot(); });
configChangeEmitter.addEventListener('configChange', ({ detail: { key, value } }) => {
    if (key === 'enableVOT' && !value) stopVot();
    if (['votTranslationVolume', 'votOriginalVolume'].includes(key)) applyVolumes();
    if (['votVoiceMode', 'votTransport'].includes(key)) {
        const restart = state === 'playing' || state === 'loading';
        stopVot();
        if (restart) toggleVot();
    }
    if (key === 'votAutoEnglish') blockedAutoId = null;
});
