const NOMINATIM_DEFAULT_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_DEFAULT_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'SegmentaIA/0.1 (https://github.com/pasantesnuevastic/segmenta-ia)';
const NOMINATIM_TIMEOUT_MS = 10000;
const OVERPASS_TIMEOUT_MS = 35000;
const OVERPASS_QUERY_TIMEOUT_SECONDS = 25;
const NOMINATIM_RESULT_LIMIT = 5;
const NOMINATIM_MIN_INTERVAL_MS = 1000;
const MAX_BOUNDS_SPAN_DEGREES = 0.5;
const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
const LOCATION_CONNECTORS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'zona', 'sector']);

const CATEGORY_TERMS = [
  { phrases: ['restaurantes', 'restaurante', 'restaurants', 'restaurant'], key: 'amenity', value: 'restaurant' },
  { phrases: ['parqueaderos', 'parqueadero', 'estacionamientos', 'estacionamiento', 'parking lots', 'parking lot', 'parking'], key: 'amenity', value: 'parking' },
  { phrases: ['cafeterias', 'cafeteria', 'cafes', 'cafe'], key: 'amenity', value: 'cafe' },
  { phrases: ['bares', 'bar'], key: 'amenity', value: 'bar' },
  { phrases: ['panaderias', 'panaderia', 'bakeries', 'bakery'], key: 'shop', value: 'bakery' },
  { phrases: ['supermercados', 'supermercado', 'supermarkets', 'supermarket'], key: 'shop', value: 'supermarket' },
  { phrases: ['farmacias', 'farmacia', 'pharmacies', 'pharmacy'], key: 'amenity', value: 'pharmacy' },
  { phrases: ['hoteles', 'hotel'], key: 'tourism', value: 'hotel' },
  { phrases: ['bancos', 'banco', 'banks', 'bank'], key: 'amenity', value: 'bank' },
  { phrases: ['gasolineras', 'gasolinera', 'estaciones de servicio', 'fuel stations', 'gas station'], key: 'amenity', value: 'fuel' },
  { phrases: ['tiendas de ropa', 'ropa', 'clothing stores', 'clothing'], key: 'shop', value: 'clothes' },
  { phrases: ['ferreterias', 'ferreteria', 'hardware stores', 'hardware'], key: 'shop', value: 'hardware' },
  { phrases: ['librerias', 'libreria', 'bookstores', 'bookstore'], key: 'shop', value: 'books' },
  { phrases: ['peluquerias', 'peluqueria', 'hairdressers', 'hairdresser'], key: 'shop', value: 'hairdresser' },
  { phrases: ['dentistas', 'dentista', 'odontologos', 'odontologo', 'dentists', 'dentist'], key: 'amenity', value: 'dentist' },
  { phrases: ['hospitales', 'hospital'], key: 'amenity', value: 'hospital' },
  { phrases: ['clinicas', 'clinica', 'clinics', 'clinic'], key: 'amenity', value: 'clinic' },
  { phrases: ['colegios', 'colegio', 'escuelas', 'escuela', 'schools', 'school'], key: 'amenity', value: 'school' },
];

const IGNORED_TERMS = [
  'negocios', 'negocio', 'empresas', 'empresa', 'establecimientos', 'establecimiento',
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'y', 'para', 'que', 'por',
  'telefono', 'telefonos', 'celular', 'movil', 'contacto', 'sitio', 'web', 'pagina',
  'internet', 'direccion', 'ubicacion', 'nombre', 'categoria', 'restaurante',
];

class OSMError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeText(text) {
  return text.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function translateCriteria(query, place = '') {
  let remaining = normalizeText(query);
  const categories = [];
  const placeTerms = new Set(normalizeText(place).split(/\s+/).filter(Boolean));

  const phrases = CATEGORY_TERMS.flatMap((entry) =>
    entry.phrases.map((phrase) => ({ phrase, key: entry.key, value: entry.value })),
  ).sort((a, b) => b.phrase.length - a.phrase.length);

  for (const entry of phrases) {
    const phrase = normalizeText(entry.phrase);
    const source = `(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`;
    if (new RegExp(source).test(remaining)) {
      categories.push({ key: entry.key, value: entry.value });
      remaining = remaining.replace(new RegExp(source, 'g'), ' ');
    }
  }

  const ignored = new Set(IGNORED_TERMS);
  const unsupportedTerms = [...new Set(remaining.split(/\s+/)
    .filter((word) => word && !ignored.has(word) && !placeTerms.has(word)))];
  const uniqueCategories = categories.filter(
    (category, index) => categories.findIndex((candidate) => candidate.key === category.key && candidate.value === category.value) === index,
  );

  return { categories: uniqueCategories, unsupportedTerms };
}

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

function locationQueries(place) {
  const simplified = normalizeText(place).split(/\s+/)
    .filter((term) => term && !LOCATION_CONNECTORS.has(term))
    .join(' ');
  return [...new Set([place.trim(), simplified])].filter(Boolean);
}

function areaCandidates(data, query) {
  if (!Array.isArray(data)) return [];
  const terms = normalizeText(query).split(/\s+/)
    .filter((term) => term && !LOCATION_CONNECTORS.has(term));
  return data.flatMap((match) => {
    if (!['boundary', 'place'].includes(match?.category)) return [];
    const box = match.boundingbox?.map(Number);
    if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(value))) return [];
    const bounds = { south: box[0], north: box[1], west: box[2], east: box[3] };
    if (bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180
      || bounds.south > bounds.north || bounds.west > bounds.east) return [];

    const name = normalizeText(match.name || '');
    const displayName = normalizeText(match.display_name || '');
    const address = normalizeText(Object.values(match.address || {}).join(' '));
    const nameMatches = terms.filter((term) => name.split(/\s+/).includes(term)).length;
    if (!nameMatches) return [];
    const addressMatches = terms.filter((term) => address.split(/\s+/).includes(term)).length;
    const displayMatches = terms.filter((term) => displayName.split(/\s+/).includes(term)).length;
    const area = (bounds.north - bounds.south) * (bounds.east - bounds.west);
    return [{ bounds, score: nameMatches * 8 + addressMatches * 4 + displayMatches, area }];
  }).sort((a, b) => b.score - a.score || a.area - b.area);
}

async function readJson(fetchImpl, url, options, service) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const guidance = service === 'Overpass'
        ? ' El servicio público puede estar saturado; espera un poco antes de reintentar.'
        : '';
      throw new OSMError('timeout', `${service} tardó demasiado en responder.${guidance}`);
    }
    throw new OSMError('network_error', `No hay conexión con ${service}.`);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new OSMError('rate_limited', `${service} alcanzó su límite temporal. Espera antes de volver a intentarlo.`);
    }
    if (response.status >= 500) {
      throw new OSMError('service_unavailable', `${service} no está disponible por ahora.`);
    }
    throw new OSMError('provider_error', `${service} respondió con el error ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new OSMError('invalid_response', `${service} devolvió una respuesta que no se pudo leer.`);
  }
}

function osmAddress(tags) {
  if (tags['addr:full']) return tags['addr:full'];
  return [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city'],
    tags['addr:postcode'],
    tags['addr:state'],
    tags['addr:country'],
  ].filter(Boolean).join(', ');
}

function normalizeElement(element, retrievedAt) {
  const tags = element.tags ?? {};
  const center = element.center ?? {};
  const coordinates = {
    latitude: element.lat ?? center.lat ?? '',
    longitude: element.lon ?? center.lon ?? '',
  };
  const categoryKey = ['amenity', 'shop', 'tourism', 'leisure', 'office'].find((key) => tags[key]);

  return {
    name: tags.name ?? '',
    address: osmAddress(tags),
    phone: tags.phone ?? tags['contact:phone'] ?? '',
    website: tags.website ?? tags['contact:website'] ?? '',
    category: categoryKey ? tags[categoryKey] : '',
    ...coordinates,
    source: 'OpenStreetMap',
    source_url: `https://www.openstreetmap.org/${encodeURIComponent(element.type)}/${encodeURIComponent(element.id)}`,
    retrieved_at: retrievedAt,
    source_updated_at: element.timestamp ?? '',
    attribution: OSM_ATTRIBUTION,
    osm_type: element.type ?? '',
    osm_id: element.id ?? '',
  };
}

function createOsmProvider({
  fetchImpl = fetch,
  nominatimUrl = process.env.SEGMENTA_NOMINATIM_URL || NOMINATIM_DEFAULT_URL,
  overpassUrl = process.env.SEGMENTA_OVERPASS_URL || OVERPASS_DEFAULT_URL,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const geocodeCache = new Map();
  let nextNominatimAt = 0;
  let nominatimQueue = Promise.resolve();

  function geocode(place) {
    const cacheKey = normalizeText(place);
    if (geocodeCache.has(cacheKey)) return Promise.resolve(geocodeCache.get(cacheKey));

    const request = nominatimQueue.then(async () => {
      if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
      let oversizedAreaFound = false;
      for (const query of locationQueries(place)) {
        const delay = Math.max(0, nextNominatimAt - now());
        if (delay) await sleep(delay);
        nextNominatimAt = now() + NOMINATIM_MIN_INTERVAL_MS;

        const url = new URL(nominatimUrl);
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', String(NOMINATIM_RESULT_LIMIT));
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('accept-language', 'es');
        const data = await readJson(fetchImpl, url, {
          headers: { 'User-Agent': USER_AGENT, accept: 'application/json' },
          signal: timeoutSignal(NOMINATIM_TIMEOUT_MS),
        }, 'Nominatim');

        const candidates = areaCandidates(data, query);
        for (const candidate of candidates) {
          const { bounds } = candidate;
          if (bounds.north - bounds.south > MAX_BOUNDS_SPAN_DEGREES
            || bounds.east - bounds.west > MAX_BOUNDS_SPAN_DEGREES) {
            oversizedAreaFound = true;
            continue;
          }
          geocodeCache.set(cacheKey, bounds);
          return bounds;
        }
      }
      if (oversizedAreaFound) {
        throw new OSMError('location_too_large', 'La ubicación es demasiado extensa para una consulta pública. Indica una ciudad o zona más pequeña.');
      }
      throw new OSMError('location_not_found', `No se pudo resolver «${place}» como una zona geográfica en OpenStreetMap. Prueba con el nombre de un barrio, comuna o ciudad.`);
    });
    nominatimQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  async function search({ query, place, limit, retrievedAt, onStatus = () => {} }) {
    const translated = translateCriteria(query, place);
    if (!translated.categories.length) {
      throw new OSMError('unsupported_criteria', `No se encontraron criterios compatibles con OpenStreetMap en «${query}».`);
    }

    onStatus('geocoding');
    const bounds = await geocode(place);
    onStatus('querying');
    const selectors = translated.categories.map(({ key, value }) =>
      `nwr["${key}"="${value}"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});`,
    );
    const overpassQuery = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];(${selectors.join('')});out meta center;`;
    const body = new URLSearchParams({ data: overpassQuery }).toString();
    const response = await readJson(fetchImpl, overpassUrl, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
      signal: timeoutSignal(OVERPASS_TIMEOUT_MS),
    }, 'Overpass');

    if (!Array.isArray(response?.elements)) {
      throw new OSMError('invalid_response', 'Overpass devolvió una respuesta sin una lista de elementos válida.');
    }
    const warnings = [];
    if (translated.unsupportedTerms.length) {
      warnings.push(`Criterios no traducidos a OpenStreetMap: ${translated.unsupportedTerms.join(', ')}.`);
    }
    if (response.elements.length > limit) {
      warnings.push(`Se limitó la respuesta a ${limit} registros según el plan.`);
    }
    return {
      elements: response.elements.slice(0, limit).map((element) => normalizeElement(element, retrievedAt)),
      warnings,
      location: bounds,
    };
  }

  return { search };
}

module.exports = {
  createOsmProvider,
  OSMError,
  translateCriteria,
  normalizeElement,
  NOMINATIM_DEFAULT_URL,
  OVERPASS_DEFAULT_URL,
  USER_AGENT,
  OSM_ATTRIBUTION,
  NOMINATIM_TIMEOUT_MS,
  OVERPASS_TIMEOUT_MS,
  MAX_BOUNDS_SPAN_DEGREES,
};
