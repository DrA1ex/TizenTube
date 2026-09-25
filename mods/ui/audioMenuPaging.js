// Three choices plus previous/next keeps every audio submenu at at most five rows.
export function audioMenuPage(items, selectedIndex = 0, requestedPage) {
    const pageCount = Math.max(1, Math.ceil(items.length / 3));
    const page = Math.max(0, Math.min(pageCount - 1, requestedPage ?? Math.floor(selectedIndex / 3)));
    const start = page * 3;
    return { items: items.slice(start, start + 3), page, pageCount,
        selectedIndex: Math.max(0, Math.min(2, selectedIndex - start)) };
}
