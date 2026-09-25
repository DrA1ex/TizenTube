const label = value => value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
export function unifyPlayerAudioEntry(items, replacement) {
    const isAudio = item => {
        const link = item?.compactLinkRenderer;
        const title = label(link?.title).trim();
        return link?.icon?.iconType === 'AUDIO_TRACK'
            || /^(?:Аудио|Аудиодорожка|Аудиодорожки|Аудио и перевод|Audio|Audio track|Audio tracks|Audio and translation)$/i.test(title);
    };
    const first = items.findIndex(isAudio);
    const before = first < 0 ? Math.min(2, items.length) : items.slice(0, first).filter(item => !isAudio(item)).length;
    const result = items.filter(item => !isAudio(item));
    result.splice(before, 0, replacement);
    return result;
}
