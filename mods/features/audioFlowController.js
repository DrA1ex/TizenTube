import { audioText } from '../features/audioLocale.js';
import { supportsTranslation } from './audioTracks.js';

// One video, one requested choice, one audible choice. Global preferences are read-only here.
export class AudioFlowController {
    constructor(deps) {
        this.d = deps;
        this.id = null;
        this.revision = 0;
        this.applyRevision = 0;
        this.cache = new Map();
        this.resetState();
    }
    resetState() {
        this.requested = null;
        this.audible = null;
        this.ready = null;
        this.status = 'idle';
        this.error = '';
        this.override = false;
        this.automatic = false;
        this.ended = false;
        this.applying = false;
        this.waited = false;
        this.fallbackStarted = false;
        this.detectionAttempted = false;
        this.requestAttempts = [];
        this.sourceLanguage = '';
        this.target = this.d.preferences().target;
    }
    valid(revision) { return revision === this.revision && this.id && this.id === this.d.videoId() && !this.ended; }
    cancelPending() {
        this.revision++;
        this.applyRevision++;
        this.abort?.abort();
        this.abort = null;
        this.applying = false;
        this.ready = null;
    }
    leave() {
        this.cancelPending();
        this.d.stop();
        this.cache.clear();
        this.id = null;
        this.resetState();
    }
    async tick() {
        const id = this.d.videoId();
        if (id !== this.id) { this.leave(); this.id = id; }
        if (!id || this.d.hidden()) return;
        const media = this.d.media();
        if (!media) return;
        if (media.ended) {
            if (!this.ended) {
                this.cancelPending(); this.d.stop(); this.audible = null;
                this.status = 'idle'; this.ended = true;
            }
            return;
        }
        if (!media.isConnected || media.readyState < 3) return;
        const prefs = this.d.preferences();
        if (this.ended) {
            // Seeking away from the end while paused is not a replay yet.
            if (media.paused || media.seeking) return;
            this.ended = false;
            // Same-video overrides survive replay; cancelled requests must get a new generation.
            if (this.requested && (!this.automatic || prefs.auto)) {
                if (this.requested.provider !== 'current') await this.select(this.requested, this.automatic);
                return;
            }
            this.requested = null;
            this.automatic = false;
        }
        const inventory = this.d.inventory();
        if (!this.requested && !this.override && prefs.auto && !media.paused) {
            if (inventory.originalLanguage === prefs.target) {
                await this.select({ provider: 'original' }, true);
            } else if (inventory.originalLanguage && prefs.translateDifferent !== false
                && (prefs.provider === 'youtube' || supportsTranslation(inventory.originalLanguage, prefs.target))) {
                await this.select({ provider: prefs.provider }, true);
            } else if (!inventory.originalLanguage && prefs.detectUnknown && !this.detectionAttempted) {
                await this.detectUnknown(prefs);
            } else if (!inventory.originalLanguage && prefs.translateUnknown) {
                await this.select({ provider: prefs.provider }, true);
            }
        }
        if (this.requested?.provider === 'youtube' && this.status === 'waiting') {
            const track = inventory.tracks.find(x => x.language === this.target);
            if (track) this.arrived({ provider: 'youtube', trackId: track.id }, this.revision);
        }
        if (this.status === 'auth' && !this.authHadToken && this.d.hasToken()) {
            await this.select(this.requested, this.automatic);
        }
        if (this.audible?.provider === 'standard' || this.audible?.provider === 'lively') {
            const playback = this.d.playbackState();
            if (!this.applying && playback === 'error') {
                this.audible = null;
                if (this.status === 'playing') {
                    this.status = 'error';
                    this.error = audioText('couldNotPlayTheTranslationSelect');
                }
                return;
            }

            if (!this.applying && this.status !== 'error' && (playback === 'idle'
                || (inventory.original && inventory.selected?.id !== inventory.original.id))) {
                // A quality/track reload can replace the video element. Reattach only for the same video.
                await this.apply(this.audible, this.revision, true);
            }
        }
    }
    async detectUnknown(prefs) {
        this.cancelPending();
        this.abort = new AbortController();
        this.requested = { provider: 'detect' };
        this.automatic = true;
        this.override = false;
        this.status = 'detecting';
        this.error = '';
        this.sourceLanguage = '';
        this.detectionAttempted = true;
        const revision = this.revision;
        try {
            const detected = await this.d.detectLanguage({ targetLang: this.target, videoId: this.id,
                media: this.d.media(), signal: this.abort.signal });
            if (!this.valid(revision)) return;
            this.sourceLanguage = String(detected || '').toLowerCase().split(/[-_.]/)[0];
            this.requested = null;
            this.status = 'idle';
            if (this.sourceLanguage === this.target) {
                // With unknown track metadata there may be no safe descriptor to
                // switch to. Keep the audio that was actually probed.
                this.requested = { provider: 'current' };
                this.audible = { provider: 'current' };
                this.status = 'playing';
            } else if (this.sourceLanguage && prefs.translateDifferent !== false) {
                await this.select({ provider: prefs.provider, sourceLang: this.sourceLanguage }, true);
            } else if (!this.sourceLanguage && prefs.translateUnknown) {
                await this.select({ provider: prefs.provider }, true);
            }
        } catch (error) {
            if (!this.valid(revision)) return;
            this.requested = null;
            this.status = 'idle';
            if (prefs.translateUnknown) await this.select({ provider: prefs.provider }, true);
            else this.error = audioText('couldNotDetectTheLanguageSo');
        }
    }
    async select(choice, automatic = false) {
        const id = this.d.videoId();
        if (!id) { this.d.notify(audioText('openAVideoFirst')); return; }
        if (id !== this.id) { this.leave(); this.id = id; }
        this.cancelPending();
        this.abort = new AbortController();
        this.ended = false;
        this.requested = { ...choice };
        this.override = !automatic;
        this.automatic = automatic;
        this.error = '';
        this.authHadToken = this.d.hasToken();
        this.waited = false;
        this.fallbackStarted = false;
        this.requestAttempts = [];
        const revision = this.revision;
        if (choice.provider === 'original' || choice.trackId) {
            this.status = 'switching';
            await this.apply(choice, revision);
            return;
        }
        if (choice.provider === 'youtube') {
            const track = this.d.inventory().tracks.find(x => x.language === this.target);
            if (track) await this.apply({ ...choice, trackId: track.id }, revision);
            else { this.status = 'waiting'; this.waited = true; this.d.notify(audioText('waitingForTheYouTubeTrackPlayback')); }
            return;
        }
        if (!['standard', 'lively'].includes(choice.provider)) return;
        const source = choice.sourceLang || this.d.inventory().originalLanguage;
        this.sourceLanguage = source;
        if (!['ru', 'en', 'kk'].includes(this.target) || (source && !supportsTranslation(source, this.target))) {
            this.status = 'error'; this.error = audioText('yandexDoesNotSupportThisLanguage'); return;
        }
        const cacheKey = choice.provider + ':' + this.target;
        if (this.cache.has(cacheKey)) { await this.apply(this.cache.get(cacheKey), revision); return; }
        this.status = 'preparing';
        // Keep watching while this promise runs. No video pause or volume change is made here.
        const signal = this.abort.signal;
        this.d.prepare({ lively: choice.provider === 'lively', sourceLang: source, targetLang: this.target,
            videoId: id, media: this.d.media(), signal, onStatus: update => {
                if (!this.valid(revision)) return;
                this.status = update.state === 'retrying' ? 'retrying' : 'waiting'; this.waited = true;
                this.remaining = update.remaining;
                this.requestAttempts = update.attempts;
                if (update.state !== 'retrying') this.beginFallback(revision, signal);
            } }).then(result => {
                if (!this.valid(revision)) return;
                const ready = { provider: choice.provider, result };
                this.cache.set(cacheKey, ready);
                return this.arrived(ready, revision);
            }).catch(error => {
                if (!this.valid(revision)) return;
                this.status = error.code === 'AUTH_REQUIRED' ? 'auth' : 'error';
                this.error = error.message;
                this.d.notify(this.error);
            });
    }
    async beginFallback(revision, signal) {
        if (this.fallbackStarted) return;
        this.fallbackStarted = true;
        const fallback = this.d.preferences().waitingTrack;
        if (fallback === 'original') {
            await this.apply({ provider: 'original' }, revision, true);
        } else if (fallback === 'standard' && this.requested?.provider === 'lively') {
            try {
                const result = await this.d.prepare({ lively: false,
                    sourceLang: this.requested?.sourceLang || this.d.inventory().originalLanguage,
                    targetLang: this.target, videoId: this.id, media: this.d.media(), signal });
                if (!this.valid(revision) || this.ready || this.status === 'playing') return;
                const track = { provider: 'standard', result };
                this.cache.set('standard:' + this.target, track);
                await this.apply(track, revision, true);
            } catch (_) { /* Continue with the current audio; the requested voice is still being prepared. */ }
        }
    }
    async arrived(track, revision) {
        if (!this.valid(revision)) return;
        this.ready = track;
        if (this.waited && this.d.preferences().readyBehavior === 'notify') {
            this.status = 'ready';
            this.d.notify(audioText('theRequestedTrackIsReadyAudio'));
        } else await this.apply(track, revision);
    }
    async applyReady() {
        if (this.ready) await this.apply(this.ready, this.revision);
    }
    async apply(track, revision, interim = false) {
        if (!this.valid(revision)) return;
        const application = ++this.applyRevision;
        this.applying = true;
        const valid = () => this.valid(revision) && application === this.applyRevision;
        try {
            this.d.stop();
            if (track.provider === 'youtube') await this.d.selectTrack(track.trackId, { isCurrent: valid });
            else await this.d.selectOriginal({ isCurrent: valid });
            if (!valid()) return;
            if (track.result) this.d.activate(track.result);
            this.audible = track;
            if (!interim) { this.status = 'playing'; this.ready = null; this.error = ''; }
        } catch (error) {
            if (valid()) { this.status = 'error'; this.error = error.message; this.d.notify(this.error); }
        } finally {
            if (application === this.applyRevision) this.applying = false;
        }
    }
    async setTarget(language) {
        if (this.d.videoId() !== this.id) { this.leave(); this.id = this.d.videoId(); }
        this.target = language;
        const choice = this.requested || { provider: this.d.preferences().provider };
        // A concrete YouTube track ID belongs to the old language; reselect by language.
        await this.select({ provider: choice.provider });
    }
    cancelWaiting() {
        this.cancelPending();
        this.override = true;
        this.requested = this.audible || { provider: 'current' };
        this.status = this.audible ? 'playing' : 'idle';
        this.error = '';
    }
    snapshot() {
        return { videoId: this.id, target: this.target, requested: this.requested, audible: this.audible,
            ready: this.ready, status: this.status, error: this.error, override: this.override,
            remaining: this.remaining, sourceLanguage: this.sourceLanguage,
            detectionAttempted: this.detectionAttempted, requestAttempts: this.requestAttempts };
    }
}
