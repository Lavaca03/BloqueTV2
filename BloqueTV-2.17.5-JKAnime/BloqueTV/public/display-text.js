// Apply only to visible copy. URLs, identifiers and saved records stay intact.
export function displayText(value = '', fallback = '') {
  const text = String(value ?? '');
  const clean = text.replace(/\b(?:https?:\/\/)?(?:www\.)?donghua[\s-]*life(?:\.com)?(?:\s+2\.0)?\b/gi, '');
  if (clean === text) return text || fallback;
  return clean
    .replace(/([-–—|·])(?:\s*[-–—|·])+/g, '$1')
    .replace(/^\s*(?:[-–—|·:]\s*)+|(?:\s*[-–—|·:])+\s*$/g, '')
    .replace(/\s*[-–—|·]\s*(?=\.[a-z\d]{2,5}$)/i, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim() || fallback;
}

export function mediaTitle(...candidates) {
  for (const candidate of candidates) {
    const title = displayText(candidate).replace(/\s+/g, ' ').trim();
    const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!title || title.length > 170 || /^(?:(?:temporadas?|episodios?|capitulos?|seasons?|episodes?)(?:\s*\d+)?|comentarios|sinopsis|recomendados|mas vistos|inicio)$/.test(normalized)) continue;
    return title;
  }
  return '';
}
