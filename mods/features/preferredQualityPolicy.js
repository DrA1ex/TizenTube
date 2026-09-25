const qualityValue = (label) => Number.parseInt(label, 10) || 0;

export function determineQuality(preference, availableQualities) {
    if (!availableQualities?.length) return null;

    const target = qualityValue(preference);
    if (!target) return null;

    const candidates = availableQualities
        .map(item => ({ item, value: qualityValue(item.qualityLabel) }))
        .filter(candidate => candidate.value > 0)
        .sort((left, right) => right.value - left.value);

    const exact = candidates.find(candidate => candidate.value === target);
    if (exact) return exact.item.quality;

    // Never turn a missing preference into "highres": that silently selects
    // the heaviest stream. Pick the best available quality not above the cap.
    const below = candidates.find(candidate => candidate.value < target);
    return (below || candidates.at(-1))?.item.quality || null;
}
