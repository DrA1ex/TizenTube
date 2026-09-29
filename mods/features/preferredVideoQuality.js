import { configRead, configChangeEmitter } from "../config.js";
import { PreferredQualitySession } from './preferredQualitySession.js';

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    CONFIG_CHANGE: 'configChange',
};

const CONFIG_KEYS = {
    QUALITY: 'preferredVideoQuality',
};

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;
    #retryTimeout = null;
    #quality = new PreferredQualitySession();

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
        document.addEventListener('loadedmetadata', event => {
            if (event.target === document.querySelector('video')) this.#applyQuality(false, true);
        }, true);
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 100);
            return;
        }

        this.#player = playerElement;

        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#handleStateChange();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.QUALITY) {
                this.#applyQuality(true);
            }
        });
    }

    #handleStateChange = () => {
        this.#applyQuality();
    };

    #applyQuality(configChanged = false, starting = false) {
        const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
        try {
            const applied = this.#quality.apply(this.#player, preferredQuality, { configChanged, starting });
            clearTimeout(this.#retryTimeout);
            if (!applied && preferredQuality && preferredQuality !== 'auto') {
                let playing = false;
                try { playing = Boolean(this.#player?.getPlayerStateObject?.()?.isPlaying); } catch (_) {}
                if (playing) this.#retryTimeout = setTimeout(() => this.#applyQuality(), 1000);
            }
            return applied;
        } catch (e) {
            console.warn('[PreferredQuality] Failed to apply quality:', e);
            return false;
        }
    }
}

window.preferredVideoQualityHandler = new PreferredQualityHandler();
