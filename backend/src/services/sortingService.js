// Client-specified sort order used everywhere stones are listed:
// Color (A-Z) -> Clarity (A-Z) -> Shape (A-Z) -> Size (carat asc)

const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H', 'I'];
const CLARITY_ORDER = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];

function rankOf(list, value) {
  if (!value) return list.length; // unknowns sort last, not first
  const idx = list.indexOf(String(value).toUpperCase());
  return idx === -1 ? list.length : idx;
}

/**
 * Sorts an array of stones (loose_diamonds rows, or request_stones joined
 * with loose_diamonds) by Color -> Clarity -> Shape -> Size (carat asc).
 * Jewelry pieces (no color/clarity/carat in the same sense) sort after all
 * loose diamonds, alphabetically by category then item.
 */
function sortStones(stones) {
  return [...stones].sort((a, b) => {
    const aIsLoose = a.item_type ? a.item_type === 'loose' : a.color !== undefined;
    const bIsLoose = b.item_type ? b.item_type === 'loose' : b.color !== undefined;

    if (aIsLoose !== bIsLoose) return aIsLoose ? -1 : 1;

    if (!aIsLoose) {
      // Jewelry: alphabetical by category, then item description
      const cat = (a.category || '').localeCompare(b.category || '');
      if (cat !== 0) return cat;
      return (a.item || '').localeCompare(b.item || '');
    }

    const colorDiff = String(a.color || '').localeCompare(String(b.color || ''));
    if (colorDiff !== 0) return colorDiff;

    const clarityDiff = String(a.clarity || '').localeCompare(String(b.clarity || ''));
    if (clarityDiff !== 0) return clarityDiff;

    const shapeDiff = (a.shape || '').localeCompare(b.shape || '');
    if (shapeDiff !== 0) return shapeDiff;

    const aCarat = a.carat != null ? Number(a.carat) : 0;
    const bCarat = b.carat != null ? Number(b.carat) : 0;
    return aCarat - bCarat;
  });
}

module.exports = { sortStones, COLOR_ORDER, CLARITY_ORDER };
