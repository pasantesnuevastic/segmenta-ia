const test = require('node:test');
const assert = require('node:assert/strict');
const { createOsmProvider, OSMError, USER_AGENT, OSM_ATTRIBUTION } = require('../src/core/osm');

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const location = [{
  category: 'boundary',
  type: 'administrative',
  name: 'Neiva',
  display_name: 'Neiva, Huila, Colombia',
  address: { city: 'Neiva', state: 'Huila', country: 'Colombia' },
  boundingbox: ['-2.95', '-2.85', '-75.35', '-75.20'],
}];
const element = {
  type: 'node',
  id: 123,
  timestamp: '2026-10-20T12:30:00Z',
  lat: -2.9,
  lon: -75.3,
  tags: {
    name: 'Café "La Esquina", Neiva',
    amenity: 'restaurant',
    'contact:phone': '+57 300 123 4567',
    website: 'https://ejemplo.test',
    'addr:street': 'Calle 8',
  },
};

test('consulta Nominatim y Overpass en serie y normaliza procedencia y fecha de fuente', async () => {
  const fake = fakeFetch([response(location), response({ elements: [element] })]);
  const provider = createOsmProvider({
    fetchImpl: fake.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });
  const result = await provider.search({
    query: 'restaurantes',
    place: 'Neiva, Huila',
    limit: 10,
    retrievedAt: '2026-10-26T19:00:00.000Z',
  });

  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[0].url, /q=Neiva%2C\+Huila/);
  assert.equal(fake.calls[0].options.headers['User-Agent'], USER_AGENT);
  assert.equal(fake.calls[0].options.signal.aborted, false);
  assert.equal(fake.calls[1].options.method, 'POST');
  const query = new URLSearchParams(fake.calls[1].options.body).get('data');
  assert.match(query, /nwr\["amenity"="restaurant"\].*out meta center;/);
  assert.doesNotMatch(query, /\["name"\]/);
  assert.deepEqual(result.elements[0], {
    name: 'Café "La Esquina", Neiva',
    address: 'Calle 8',
    phone: '+57 300 123 4567',
    website: 'https://ejemplo.test',
    category: 'restaurant',
    latitude: -2.9,
    longitude: -75.3,
    source: 'OpenStreetMap',
    source_url: 'https://www.openstreetmap.org/node/123',
    retrieved_at: '2026-10-26T19:00:00.000Z',
    source_updated_at: '2026-10-20T12:30:00Z',
    attribution: OSM_ATTRIBUTION,
    osm_type: 'node',
    osm_id: 123,
  });
});

test('informa criterios no traducibles sin enviarlos como consulta arbitraria', async () => {
  const fake = fakeFetch([response(location), response({ elements: [] })]);
  const provider = createOsmProvider({
    fetchImpl: fake.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });
  const result = await provider.search({
    query: 'restaurantes italianos con teléfono y sitio web',
    place: 'Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T19:00:00.000Z',
  });

  assert.deepEqual(result.warnings, ['Criterios no traducidos a OpenStreetMap: italianos.']);
  const query = new URLSearchParams(fake.calls[1].options.body).get('data');
  assert.doesNotMatch(query, /italianos/);
});

test('caché de ubicaciones evita solicitudes repetidas a Nominatim', async () => {
  const fake = fakeFetch([
    response(location),
    response({ elements: [] }),
    response({ elements: [] }),
  ]);
  const provider = createOsmProvider({
    fetchImpl: fake.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });
  const search = { query: 'restaurantes', place: 'Neiva', limit: 10, retrievedAt: '2026-10-26T19:00:00.000Z' };

  await provider.search(search);
  await provider.search(search);
  assert.equal(fake.calls.length, 3);
});

test('serializa las solicitudes Nominatim concurrentes con al menos un segundo de separación', async () => {
  let clock = 100;
  const starts = [];
  const waits = [];
  const provider = createOsmProvider({
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://nominatim.test/')) {
        starts.push(clock);
        const place = new URL(url).searchParams.get('q');
        return response([{
          ...location[0],
          name: place,
          display_name: place,
          address: { city: place },
        }]);
      }
      return response({ elements: [] });
    },
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
    now: () => clock,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
  });
  const search = (place) => provider.search({
    query: 'restaurantes',
    place,
    limit: 1,
    retrievedAt: '2026-10-26T19:00:00.000Z',
  });

  await Promise.all([search('Neiva'), search('Rivera')]);
  assert.deepEqual(starts, [100, 1100]);
  assert.deepEqual(waits, [1000]);
});

test('reporta ubicaciones vacías, límites HTTP y tiempos de espera como errores claros', async () => {
  const noLocation = createOsmProvider({
    fetchImpl: async () => response([]),
    nominatimUrl: 'https://nominatim.test/search',
    sleep: async () => {},
  });
  await assert.rejects(
    noLocation.search({ query: 'restaurantes', place: 'Lugar desconocido', limit: 1, retrievedAt: 'x' }),
    (error) => error instanceof OSMError && error.code === 'location_not_found',
  );

  const tooLarge = createOsmProvider({
    fetchImpl: async () => response([{
      category: 'boundary',
      name: 'Colombia',
      boundingbox: ['-5', '5', '-80', '-70'],
    }]),
    nominatimUrl: 'https://nominatim.test/search',
    sleep: async () => {},
  });
  await assert.rejects(
    tooLarge.search({ query: 'restaurantes', place: 'Colombia', limit: 1, retrievedAt: 'x' }),
    (error) => error instanceof OSMError && error.code === 'location_too_large',
  );

  const limitedFetch = fakeFetch([response(location), response({}, 429)]);
  const limited = createOsmProvider({
    fetchImpl: limitedFetch.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });
  await assert.rejects(
    limited.search({ query: 'restaurantes', place: 'Neiva', limit: 1, retrievedAt: 'x' }),
    (error) => error instanceof OSMError && error.code === 'rate_limited',
  );
  assert.equal(limitedFetch.calls.length, 2);

  const unavailableFetch = fakeFetch([response(location), response({}, 503)]);
  const unavailable = createOsmProvider({
    fetchImpl: unavailableFetch.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });
  await assert.rejects(
    unavailable.search({ query: 'restaurantes', place: 'Neiva', limit: 1, retrievedAt: 'x' }),
    (error) => error instanceof OSMError && error.code === 'service_unavailable',
  );
  assert.equal(unavailableFetch.calls.length, 2);

  let timeoutCalls = 0;
  const timedOut = createOsmProvider({
    fetchImpl: async () => {
      timeoutCalls += 1;
      throw new DOMException('timeout', 'TimeoutError');
    },
    nominatimUrl: 'https://nominatim.test/search',
  });
  await assert.rejects(
    timedOut.search({ query: 'restaurantes', place: 'Neiva', limit: 1, retrievedAt: 'x' }),
    (error) => error instanceof OSMError && error.code === 'timeout',
  );
  assert.equal(timeoutCalls, 1);
});

test('acepta la caja administrativa de Ibagué y continúa con la consulta de negocios', async () => {
  const ibague = {
    category: 'boundary',
    type: 'administrative',
    addresstype: 'city',
    name: 'Ibagué',
    display_name: 'Ibagué, Centro, Tolima, Colombia',
    boundingbox: ['4.2578563', '4.6993257', '-75.5246959', '-74.9667451'],
  };
  const fake = fakeFetch([response([ibague]), response({ elements: [] })]);
  const provider = createOsmProvider({
    fetchImpl: fake.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });

  const result = await provider.search({
    query: 'restaurantes',
    place: 'Ibagué',
    limit: 10,
    retrievedAt: '2026-10-26T19:00:00.000Z',
  });

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(result.location, {
    south: 4.2578563,
    north: 4.6993257,
    west: -75.5246959,
    east: -74.9667451,
  });
  assert.deepEqual(result.elements, []);
});

test('resuelve zonas aunque la primera coincidencia sea un negocio y conserva parqueaderos sin nombre', async () => {
  const comuna = {
    category: 'boundary',
    type: 'administrative',
    name: 'Comuna Centro',
    display_name: 'Comuna Centro, Neiva, Huila, Colombia',
    address: { city: 'Neiva', state: 'Huila', country: 'Colombia' },
    boundingbox: ['2.9195133', '2.9343182', '-75.2976238', '-75.2789688'],
  };
  const unnamedParking = {
    type: 'node',
    id: 456,
    lat: 2.92,
    lon: -75.29,
    tags: { amenity: 'parking' },
  };
  const fake = fakeFetch([
    response([{ category: 'shop', name: 'Ferretería', boundingbox: ['2.92', '2.93', '-75.30', '-75.29'] }]),
    response([comuna]),
    response({ elements: [unnamedParking] }),
  ]);
  const provider = createOsmProvider({
    fetchImpl: fake.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
    sleep: async () => {},
  });
  const result = await provider.search({
    query: 'parqueaderos',
    place: 'centro de Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T19:00:00.000Z',
  });

  assert.equal(fake.calls.length, 3);
  assert.equal(new URL(fake.calls[0].url).searchParams.get('q'), 'centro de Neiva');
  assert.equal(new URL(fake.calls[1].url).searchParams.get('q'), 'centro neiva');
  assert.deepEqual(result.location, {
    south: 2.9195133,
    north: 2.9343182,
    west: -75.2976238,
    east: -75.2789688,
  });
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].name, '');
  const query = new URLSearchParams(fake.calls[2].options.body).get('data');
  assert.match(query, /nwr\["amenity"="parking"\]\(/);
  assert.doesNotMatch(query, /\["name"\]/);
});

test('rechaza una búsqueda que no tenga ninguna categoría soportada', async () => {
  let calls = 0;
  const provider = createOsmProvider({
    fetchImpl: async () => { calls += 1; return response([]); },
    nominatimUrl: 'https://nominatim.test/search',
  });
  await assert.rejects(
    provider.search({ query: 'lugares mágicos', place: 'Neiva', limit: 1, retrievedAt: 'x' }),
    (error) => error instanceof OSMError && error.code === 'unsupported_criteria',
  );
  assert.equal(calls, 0);
});

test('traduce parqueaderos a la etiqueta amenity=parking de OpenStreetMap', async () => {
  const fake = fakeFetch([response(location), response({ elements: [] })]);
  const provider = createOsmProvider({
    fetchImpl: fake.fetchImpl,
    nominatimUrl: 'https://nominatim.test/search',
    overpassUrl: 'https://overpass.test/api/interpreter',
  });
  await provider.search({
    query: 'parqueaderos',
    place: 'centro, Neiva, Huila',
    limit: 10,
    retrievedAt: '2026-10-26T19:00:00.000Z',
  });
  const query = new URLSearchParams(fake.calls[1].options.body).get('data');
  assert.match(query, /nwr\["amenity"="parking"\]\(/);
  assert.doesNotMatch(query, /\["name"\]/);
});
