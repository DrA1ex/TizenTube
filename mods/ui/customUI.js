// Custom UI for video player

import { extractAssignedFunctions } from "../utils/ASTParser.js";
import { configRead } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";
import { audioText } from '../features/audioLocale.js';
import { t } from 'i18next';

function applyPatches() {
    if (!window._yttv) return setTimeout(applyPatches, 250);
    const method = Object.keys(window._yttv).find(key => {
        return typeof window._yttv[key] === 'function' && window._yttv[key].toString().includes('TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION');
    });

    if (!method) {
        setTimeout(applyPatches, 250);
        return;
    }

    const origMethod = window._yttv[method];
    // Parse once when installing the patch, before constructing any watch UI.
    // Repeating this AST walk in every player constructor blocks first paint.
    let functions;
    try { functions = extractAssignedFunctions(origMethod.toString()); }
    catch (error) { console.warn('[Player UI] Unsupported constructor', error); return; }
    const methodName = predicate => functions.find(predicate)?.left?.split('.')[1];
    const isClass = /^class\s/.test(origMethod.toString());
    const settingActionGroup = methodName(func => func.rhs.includes('TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS'));
    const engagementActionButton = methodName(func => func.rhs.includes('props.data.engagementActions'));
    const previousButtonName = methodName(func => func.rhs.indexOf('skipPreviousButton') > func.rhs.indexOf('skipNextButton')
        && func.rhs.includes('skipNextButton'));
    const nextButtonName = methodName(func => func.rhs.indexOf('skipNextButton') > func.rhs.indexOf('skipPreviousButton')
        && func.rhs.includes('skipPreviousButton'));

    function YtlrPlayerActionsContainer() {
        const args = Array.prototype.slice.call(arguments);

        function constructAsNew(ctor, argsList) {
            if (typeof Reflect !== 'undefined' && typeof Reflect.construct === 'function') {
                return Reflect.construct(ctor, argsList, YtlrPlayerActionsContainer);
            }
            return new origMethod(...argsList);
        }

        if (!(this instanceof YtlrPlayerActionsContainer)) {
            if (isClass) return constructAsNew(origMethod, args);
            return origMethod.apply(this, args);
        }

        let inst;
        if (isClass) {
            inst = constructAsNew(origMethod, args);
        } else {
            origMethod.apply(this, args);
            inst = this;
        }

        const pipCommand = {
            "type": "TRANSPORT_CONTROLS_BUTTON_TYPE_PIP",
            "button": {
                "buttonRenderer": ButtonRenderer(
                    false,
                    configRead('enableSwapMPWithPIP') ? t('player.pictureInPicture') : t('player.miniPlayer'),
                    'CLEAR_COOKIES',
                    {
                        customAction: {
                            action: configRead('enableSwapMPWithPIP') ? 'ENTER_PIP' : 'ENTER_MP',
                        }
                    }
                )
            }
        }

        if (!settingActionGroup) return inst;

        const origSettingActionGroup = inst[settingActionGroup];
        if (configRead('enableMPButton')) {
            inst[settingActionGroup] = function () {
                const res = origSettingActionGroup.apply(this, arguments);
                const idx = res.findIndex(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP') || res.splice(idx, 0, pipCommand);
                return res;
            };
        }

        if (engagementActionButton) {
            const originalActions = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                let res = originalActions.apply(this, arguments);
                if (configRead('audioUnifiedFlow')) {
                    res = res.filter(item => !/AUDIO_TRACK|AUDIO_LANGUAGE/.test(item.type || ''));
                }
                const add = (type, title, icon, action) => {
                    const button = { type, button: { buttonRenderer: ButtonRenderer(false, title, icon, { customAction: { action } }) } };
                    const index = res.findIndex(item => item.type === type);
                    if (index < 0) res.push(button); else res[index] = button;
                };
                if (configRead('enableSpeedControlsButton')) {
                    add('TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED',
                        t('player.playbackSpeed.button') + ' · ' + Number(configRead('videoSpeed')) + 'x',
                        'SLOW_MOTION_VIDEO', 'TT_SPEED_SETTINGS_SHOW');
                }
                if (configRead('audioUnifiedFlow')) {
                    add('TRANSPORT_CONTROLS_BUTTON_TYPE_AUDIO', audioText('audioAndTranslation'),
                        'AUDIO_TRACK', 'TT_VOT_SETTINGS_SHOW');
                }
                return res;
            };
        }

        if (engagementActionButton && !configRead('enableSuperThanksButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SUPER_THANKS');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SHOPPING');
                return shoppingFiltered;
            }
        }
        
        if (engagementActionButton && !configRead('enableAIAskButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_YOUCHAT_BUTTON');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_YOUCHAT_BUTTON');
                return shoppingFiltered;
            }
        }

        if (configRead('enablePreviousNextButtons')) {
            if (!previousButtonName || !nextButtonName) return inst;
            inst[previousButtonName] = function () {
                return ButtonRenderer(
                    false,
                    t('player.previous'),
                    'SKIP_PREVIOUS',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_PREVIOUS'
                        }
                    }
                )
            }

            inst[nextButtonName] = function () {
                return ButtonRenderer(
                    false,
                    t('player.next'),
                    'SKIP_NEXT',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_NEXT'
                        }
                    }
                )
            }

        }

        return inst;
    }

    if (configRead('enablePatchingVideoPlayer')) {
        YtlrPlayerActionsContainer.prototype = origMethod.prototype;
        window._yttv[method] = YtlrPlayerActionsContainer;
    }
}


if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyPatches();
} else {
    window.addEventListener('DOMContentLoaded', applyPatches);
}
