import { audioText } from '../features/audioLocale.js';
import { configRead, configWrite, configChangeEmitter } from '../config.js';
import { AudioFlowController } from './audioFlowController.js';
import { audioInventory, selectYouTubeTrack, ensureOriginal } from './audioTracks.js';
import { getCurrentVideoId, getVotState, stopVot, prepareVotTrack, activateVotTrack,
    detectVotLanguage, refreshVotAuthorization } from './vot.js';
import { showToast } from '../ui/ytUI.js';
import { updateAudioWaitingIndicator } from './audioWaitingIndicator.js';

// Migration preserves v6's opt-in; installing an update must not silently enable auto-translation.
if (!configRead('audioPreferencesMigrated')) {
    configWrite('audioAutoStart', Boolean(configRead('votAutoEnglish')));
    configWrite('audioPreferredProvider', configRead('votVoiceMode') === 'standard' ? 'standard' : 'lively');
    configWrite('audioPreferencesMigrated', true);
}
export const audioFlow = new AudioFlowController({
    videoId: getCurrentVideoId,
    media: () => document.querySelector('video'),
    hidden: () => document.hidden,
    inventory: audioInventory,
    preferences: () => ({ auto: configRead('audioAutoStart'), provider: configRead('audioPreferredProvider'),
        target: configRead('audioTargetLanguage'), translateDifferent: configRead('audioAutoDifferentLanguage'),
        detectUnknown: configRead('audioDetectUnknownLanguage'), translateUnknown: configRead('audioAutoUnknownLanguage'),
        readyBehavior: configRead('audioReadyBehavior'), waitingTrack: configRead('audioWaitingTrack') }),
    selectTrack: selectYouTubeTrack, selectOriginal: ensureOriginal,
    prepare: prepareVotTrack, detectLanguage: detectVotLanguage, activate: activateVotTrack, stop: stopVot,
    playbackState: () => getVotState().state,
    hasToken: () => getVotState().hasOAuthToken,
    notify: message => showToast(audioText('audioAndTranslation'), message)
});
let ticking = false;
let authResume = null;
export function rememberAudioLogin() {
    authResume = audioFlow.requested ? { id: audioFlow.id, target: audioFlow.target,
        choice: { ...audioFlow.requested }, background: false, expires: Date.now() + 15 * 60 * 1000 } : null;
    audioFlow.cancelWaiting();
    stopVot();
}
setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
        if (authResume) {
            if (authResume.id !== getCurrentVideoId() || Date.now() > authResume.expires) authResume = null;
            else if (document.hidden || !getVotState().foreground) { authResume.background = true; return; }
            else if (authResume.background) {
                await refreshVotAuthorization();
                if (!getVotState().foreground) return;
                const resume = authResume; authResume = null;
                if (getVotState().hasOAuthToken) {
                    await audioFlow.tick();
                    audioFlow.target = resume.target;
                    await audioFlow.select(resume.choice);
                    return;
                }
            }
        }
        await audioFlow.tick();
    } catch (error) { console.warn('[Audio flow]', error.message); }
    finally { ticking = false; }
}, 1000);
window.addEventListener('pagehide', () => audioFlow.leave());
['hashchange', 'popstate'].forEach(event => window.addEventListener(event, () => {
    // Closing a player submenu also changes history, without leaving the video.
    if (getCurrentVideoId() !== audioFlow.id) audioFlow.leave();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) audioFlow.leave(); else refreshVotAuthorization(); });
configChangeEmitter.addEventListener('configChange', ({ detail: { key, value } }) => {
    if (key === 'audioAutoStart' && !value && audioFlow.automatic) audioFlow.cancelWaiting();
});
// Independent of the asynchronous flow tick: cancelling hides the status even
// when an old network request or a YouTube track switch has not returned yet.
setInterval(() => updateAudioWaitingIndicator(audioFlow.snapshot()), 1000);
window.addEventListener('pagehide', () => updateAudioWaitingIndicator({}));
