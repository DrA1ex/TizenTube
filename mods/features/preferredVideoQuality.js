import { configRead, configWrite, configChangeEmitter } from "../config.js";
import { installQualityController } from './qualityController.js';

const controller = installQualityController({
    documentRef: document,
    windowRef: window,
    readPreference: () => configRead('preferredVideoQuality'),
    readSpeed: () => configRead('videoSpeed'),
    resetSpeed: speed => configWrite('videoSpeed', speed)
});

configChangeEmitter.addEventListener('configChange', event => {
    if (event.detail?.key === 'preferredVideoQuality') controller.onPreferenceChange();
    if (event.detail?.key === 'videoSpeed') controller.onSpeedChange();
});

window.preferredVideoQualityHandler = controller;
