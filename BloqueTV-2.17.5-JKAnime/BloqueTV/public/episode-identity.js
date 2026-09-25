// Shared by the reader, the API and the UI. Episode numbers alone are not IDs.
function catalogPage(value, base) {
  try {
    const u = new URL(value, base);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    const match = u.pathname.match(/^\/(series|season|episode)\/([^/]+)\/?$/);
    if (!match) return null;
    const slug = decodeURIComponent(match[2]).toLowerCase();
    if (/[\/\\?#]/.test(slug)) return null;
    u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/$/, '');
    return {url:u.href, host:u.host.toLowerCase().replace(/^www\./, ''), kind:match[1], slug};
  } catch { return null; }
}

export function sameCatalogPage(a, b) {
  const left = catalogPage(a), right = catalogPage(b);
  return Boolean(left && right && left.host === right.host && left.kind === right.kind && left.slug === right.slug);
}

export function donghuaEpisodeIdentity(episodeUrl, listUrl) {
  const list = catalogPage(listUrl), ep = catalogPage(episodeUrl, list?.url);
  if (!list || !ep || ep.kind !== 'episode' || ep.host !== list.host) return null;
  const match = ep.slug.match(/^(.+)-episodio-x(\d+)$/);
  if (!match) return null;
  const episode = Number(match[2]);
  if (!Number.isSafeInteger(episode) || episode < 1) return null;
  const owner = match[1];
  let season;
  if (list.kind === 'season') {
    if (owner !== list.slug) return null;
    season = Number(owner.match(/-(\d+)$/)?.[1]) || 1;
  } else if (list.kind === 'series') {
    const suffix = owner.startsWith(list.slug + '-') ? owner.slice(list.slug.length + 1) : '';
    if (owner !== list.slug && !/^\d+$/.test(suffix)) return null;
    season = suffix ? Number(suffix) : 1;
  } else return null;
  if (!Number.isSafeInteger(season) || season < 1) return null;
  return {url:ep.url, episode_number:episode, season_number:season};
}

export function filterDonghuaEpisodes(episodes, listUrl, seasonNumber = null) {
  const list = catalogPage(listUrl), unique = new Map();
  for (const ep of Array.isArray(episodes) ? episodes : []) {
    const identity = donghuaEpisodeIdentity(ep?.url, listUrl);
    if (!identity || Number(ep.episode_number) !== identity.episode_number) continue;
    // A direct series list may contain several seasons, each rendered separately.
    if (list.kind === 'series' && seasonNumber != null && identity.season_number !== Number(seasonNumber)) continue;
    const key = `${identity.season_number}:${identity.episode_number}`;
    if (!unique.has(key)) unique.set(key, {...ep, ...identity});
  }
  return [...unique.values()].sort((a,b) => a.season_number-b.season_number || a.episode_number-b.episode_number);
}

export function donghuaSeasonBelongsToSeries(season, seriesUrl) {
  const series = catalogPage(seriesUrl), list = catalogPage(season?.url);
  if (!series || series.kind !== 'series' || !list || list.host !== series.host) return false;
  if (list.kind === 'series') return sameCatalogPage(list.url, series.url);
  if (list.kind !== 'season') return false;
  if (list.slug === series.slug || (list.slug.startsWith(series.slug + '-') && /^\d+$/.test(list.slug.slice(series.slug.length+1)))) return true;
  // Aliases and named specials may use a different slug. Their relationship
  // must come from the series' main season list, which the reader records.
  return sameCatalogPage(season.seriesUrl, series.url);
}

export function filterDonghuaDetail(detail, selectedUrl) {
  const series = catalogPage(selectedUrl);
  if (!series || series.kind !== 'series' || (detail?.url && !sameCatalogPage(detail.url, series.url))) {
    throw new Error('La ficha recibida no corresponde al título seleccionado. Vuelve a abrirla.');
  }
  const seasons = [], seen = new Set();
  for (const raw of Array.isArray(detail?.seasons) ? detail.seasons : []) {
    if (!raw || typeof raw !== 'object') continue;
    const season = {...raw, url:raw.url || series.url};
    if (!donghuaSeasonBelongsToSeries(season, series.url)) continue;
    const episodes = filterDonghuaEpisodes(season.episodes, season.url, season.season_number);
    if (!episodes.length) continue;
    const key = `${catalogPage(season.url).url}:${season.season_number ?? 'special'}`;
    if (seen.has(key)) continue;
    seen.add(key); seasons.push({...season, seriesUrl:series.url, episodes});
  }
  return {...detail, url:series.url, seasons, episodeCount:seasons.reduce((n,s)=>n+s.episodes.length,0), episodes:seasons.length===1?seasons[0].episodes:[]};
}
