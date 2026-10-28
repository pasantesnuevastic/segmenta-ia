const { OSMError, OSM_ATTRIBUTION } = require('./osm');
const { resolveActivity } = require('./activities');

const GEOAPIFY_DEFAULT_URL = 'https://api.geoapify.com/v2/places';
const GEOAPIFY_TIMEOUT_MS = 30000;
const GEOAPIFY_PAGE_SIZE = 500;
const GEOAPIFY_ATTRIBUTION = `Powered by Geoapify; ${OSM_ATTRIBUTION}`;

function requestUrl(endpoint, bounds, categories, limit, offset) {
  const url = new URL(endpoint);
  url.searchParams.set('categories', categories.join(','));
  url.searchParams.set('filter', `rect:${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('lang', 'es');
  return url;
}

async function readGeoapifyJson(fetchImpl, url, apiKey) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(GEOAPIFY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new OSMError('timeout', 'Geoapify tardó demasiado en responder. Intenta de nuevo más tarde.');
    }
    throw new OSMError('network_error', 'No hay conexión con Geoapify.');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new OSMError('invalid_api_key', 'Geoapify rechazó la llave. Revísala en Ajustes.');
    }
    if (response.status === 429) {
      throw new OSMError('rate_limited', 'Geoapify alcanzó el límite de solicitudes de la cuenta. Espera antes de volver a intentarlo.');
    }
    if (response.status >= 500) {
      throw new OSMError('service_unavailable', 'Geoapify no está disponible por ahora.');
    }
    throw new OSMError('provider_error', `Geoapify respondió con el error ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new OSMError('invalid_response', 'Geoapify devolvió una respuesta que no se pudo leer.');
  }
}

function featureToElement(feature, retrievedAt, activity) {
  const properties = feature?.properties ?? {};
  const raw = properties.datasource?.raw ?? {};
  const coordinates = feature?.geometry?.coordinates ?? [];
  const latitude = Number.isFinite(properties.lat) ? properties.lat : coordinates[1];
  const longitude = Number.isFinite(properties.lon) ? properties.lon : coordinates[0];
  const streetAddress = [
    properties.housenumber,
    properties.street,
    properties.suburb,
    properties.city,
    properties.state,
    properties.postcode,
    properties.country,
  ].filter(Boolean).join(', ');
  const osmType = raw.osm_type ?? raw.type ?? '';
  const osmId = raw.osm_id ?? raw.id ?? '';
  const hasOsmId = ['node', 'way', 'relation'].includes(osmType) && osmId !== '';
  const sourceUrl = hasOsmId
    ? `https://www.openstreetmap.org/${encodeURIComponent(osmType)}/${encodeURIComponent(osmId)}`
    : '';
  const rawCategory = ['amenity', 'shop', 'tourism', 'leisure', 'office'].find((key) => raw[key]);

  return {
    name: properties.name ?? raw.name ?? properties.address_line1 ?? '',
    address: properties.address_line2 ?? streetAddress,
    phone: raw.phone ?? raw['contact:phone'] ?? properties.contact?.phone ?? properties.phone ?? '',
    website: raw.website ?? raw['contact:website'] ?? properties.website ?? '',
    category: rawCategory ? raw[rawCategory] : activity.name,
    ...(Number.isFinite(latitude) && { latitude }),
    ...(Number.isFinite(longitude) && { longitude }),
    source: 'Geoapify',
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    source_updated_at: raw.timestamp ?? '',
    attribution: GEOAPIFY_ATTRIBUTION,
    osm_type: hasOsmId ? osmType : '',
    osm_id: hasOsmId ? osmId : '',
    geoapify_place_id: properties.place_id ?? '',
  };
}

function createGeoapifyProvider({
  apiKey,
  resolveLocation,
  fetchImpl = fetch,
  endpoint = process.env.SEGMENTA_GEOAPIFY_URL || GEOAPIFY_DEFAULT_URL,
} = {}) {
  async function search({ query, place, specialty = '', limit, retrievedAt, onStatus = () => {} }) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new OSMError('no_key', 'Falta la llave de Geoapify. Configura GEOAPIFY_API_KEY en el archivo .env y reinicia la aplicación.');
    }
    if (typeof resolveLocation !== 'function') {
      throw new OSMError('provider_error', 'El geocodificador no está configurado.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new OSMError('bad_request', 'El límite de resultados debe ser un entero entre 1 y 1000.');
    }

    const activity = resolveActivity(query);
    if (!activity) {
      throw new OSMError('unsupported_criteria', `«${query}» no corresponde a una actividad del catálogo aprobado.`);
    }
    const categories = [...new Set(activity.geoapify_categories)];
    if (!categories.length) {
      throw new OSMError('unsupported_criteria', `«${activity.name}» no tiene una categoría específica disponible en Geoapify.`);
    }

    onStatus('geocoding');
    const bounds = await resolveLocation(place);
    onStatus('querying');
    const rows = [];
    const warnings = [];
    if (specialty.trim()) {
      warnings.push(`Se solicitó el subtipo «${specialty.trim()}» de «${activity.name}», pero Geoapify no puede filtrarlo con precisión; los resultados pueden incluir otros tipos de la actividad.`);
    }
    if (activity.precision === 'Amplia') {
      warnings.push(`La categoría Geoapify de «${activity.name}» es amplia; los resultados pueden incluir actividades relacionadas. ${activity.search_guidance}`);
    }
    const total = limit;
    const pageSize = Math.min(GEOAPIFY_PAGE_SIZE, total);

    for (let offset = 0; offset < total; offset += pageSize) {
      const requested = Math.min(pageSize, total - offset);
      const url = requestUrl(endpoint, bounds, categories, requested, offset);
      const response = await readGeoapifyJson(fetchImpl, url, apiKey.trim());
      if (!Array.isArray(response?.features)) {
        throw new OSMError('invalid_response', 'Geoapify devolvió una respuesta sin una lista de lugares válida.');
      }

      rows.push(...response.features.map((feature) => featureToElement(feature, retrievedAt, activity)));
      if (response.features.length < requested) break;
    }

    return {
      elements: rows,
      warnings,
      source: 'Geoapify',
      attribution: GEOAPIFY_ATTRIBUTION,
      location: bounds,
    };
  }

  return { search, source: 'Geoapify', attribution: GEOAPIFY_ATTRIBUTION };
}

module.exports = {
  createGeoapifyProvider,
  GEOAPIFY_DEFAULT_URL,
  GEOAPIFY_ATTRIBUTION,
  GEOAPIFY_TIMEOUT_MS,
  GEOAPIFY_PAGE_SIZE,
  featureToElement,
};
