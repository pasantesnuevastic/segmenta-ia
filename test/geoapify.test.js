const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeoapifyProvider, GEOAPIFY_ATTRIBUTION } = require('../src/core/geoapify');
const { createOsmProvider, OSMError } = require('../src/core/osm');

const bounds = { south: 2.91, north: 2.94, west: -75.30, east: -75.27 };
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const feature = {
  type: 'Feature',
  properties: {
    name: 'Parqueadero Central',
    address_line2: 'Calle 8, Comuna Centro, Neiva',
    street: 'Calle 8',
    city: 'Neiva',
    lat: 2.92,
    lon: -75.29,
    phone: '+57 300 111 2233',
    website: 'https://parking.example',
    place_id: 'stable-geo-id',
    datasource: {
      raw: {
        osm_type: 'way',
        osm_id: 456,
        amenity: 'parking',
        timestamp: '2026-10-20T12:00:00Z',
      },
    },
  },
  geometry: { type: 'Point', coordinates: [-75.29, 2.92] },
};

test('consulta Geoapify por categoría y área; conserva procedencia, coordenadas y atribución', async () => {
  const calls = [];
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async (place) => {
      assert.equal(place, 'norte de Neiva');
      return bounds;
    },
    endpoint: 'https://geoapify.test/v2/places',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return response({ type: 'FeatureCollection', features: [feature] });
    },
  });
  const statuses = [];
  const result = await provider.search({
    query: 'parqueaderos',
    place: 'norte de Neiva',
    limit: 50,
    retrievedAt: '2026-10-26T21:00:00.000Z',
    onStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(statuses, ['geocoding', 'querying']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('categories'), 'parking');
  assert.equal(calls[0].url.searchParams.get('filter'), 'rect:-75.3,2.91,-75.27,2.94');
  assert.equal(calls[0].url.searchParams.get('limit'), '50');
  assert.equal(calls[0].options.headers['x-api-key'], 'geoapify-test-key');
  assert.equal(calls[0].url.searchParams.has('apiKey'), false);
  assert.deepEqual(result.elements[0], {
    name: 'Parqueadero Central',
    address: 'Calle 8, Comuna Centro, Neiva',
    phone: '+57 300 111 2233',
    website: 'https://parking.example',
    category: 'parking',
    latitude: 2.92,
    longitude: -75.29,
    source: 'Geoapify',
    source_url: 'https://www.openstreetmap.org/way/456',
    retrieved_at: '2026-10-26T21:00:00.000Z',
    source_updated_at: '2026-10-20T12:00:00Z',
    attribution: GEOAPIFY_ATTRIBUTION,
    osm_type: 'way',
    osm_id: 456,
    geoapify_place_id: 'stable-geo-id',
  });
});

test('resuelve Ibagué y envía su caja a Geoapify para buscar restaurantes', async () => {
  const requests = [];
  const ibague = {
    category: 'boundary',
    type: 'administrative',
    addresstype: 'city',
    name: 'Ibagué',
    display_name: 'Ibagué, Centro, Tolima, Colombia',
    boundingbox: ['4.2578563', '4.6993257', '-75.5246959', '-74.9667451'],
  };
  const locationProvider = createOsmProvider({
    nominatimUrl: 'https://nominatim.test/search',
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      return response([ibague]);
    },
  });
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: locationProvider.resolveLocation,
    endpoint: 'https://geoapify.test/v2/places',
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      return response({ type: 'FeatureCollection', features: [feature] });
    },
  });

  const result = await provider.search({
    query: 'restaurantes',
    place: 'Ibagué',
    limit: 10,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].hostname, 'nominatim.test');
  assert.equal(requests[1].hostname, 'geoapify.test');
  assert.equal(requests[1].searchParams.get('categories'), 'catering.restaurant');
  assert.equal(
    requests[1].searchParams.get('filter'),
    'rect:-75.5246959,4.2578563,-74.9667451,4.6993257',
  );
  assert.equal(result.elements.length, 1);
});

test('acepta respuesta sin coincidencias y marca registros sin identificador OSM sin inventar un enlace', async () => {
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    fetchImpl: async () => response({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Lugar sin ID', lat: 2.92, lon: -75.29 },
        geometry: { type: 'Point', coordinates: [-75.29, 2.92] },
      }],
    }),
  });
  const result = await provider.search({
    query: 'parqueaderos',
    place: 'Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  });

  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].source_url, '');
  assert.equal(result.elements[0].source_updated_at, '');
  assert.equal(result.elements[0].attribution, GEOAPIFY_ATTRIBUTION);
});

test('consulta todas las categorías relacionadas en una sola búsqueda Geoapify', async () => {
  let requestedCategories;
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    endpoint: 'https://geoapify.test/v2/places',
    fetchImpl: async (url) => {
      requestedCategories = new URL(url).searchParams.get('categories');
      return response({ type: 'FeatureCollection', features: [] });
    },
  });

  const result = await provider.search({
    query: 'tienda de mascotas',
    place: 'Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  });

  assert.equal(requestedCategories, 'commercial.pet,pet.shop');
  assert.equal(result.warnings.length, 0);
});

test('advierte cuando la categoría de una actividad es amplia', async () => {
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    fetchImpl: async () => response({ type: 'FeatureCollection', features: [] }),
  });

  const result = await provider.search({
    query: 'restaurante típico huilense',
    place: 'Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  });

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /categoría Geoapify.*es amplia/i);
});

test('advierte que una especialidad solicitada no se puede filtrar', async () => {
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    fetchImpl: async () => response({ type: 'FeatureCollection', features: [] }),
  });

  const result = await provider.search({
    query: 'Restaurantes',
    specialty: 'italianos',
    place: 'Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  });

  assert.ok(result.warnings.some((warning) => warning.includes('italianos')));
  assert.ok(result.warnings.some((warning) => warning.includes('no puede filtrarlo con precisión')));
});

test('no inventa una categoría para una actividad sin filtro específico', async () => {
  let calls = 0;
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    fetchImpl: async () => {
      calls += 1;
      return response({ type: 'FeatureCollection', features: [] });
    },
  });

  await assert.rejects(
    provider.search({
      query: 'reparación de celulares',
      place: 'Neiva',
      limit: 10,
      retrievedAt: '2026-10-26T21:00:00.000Z',
    }),
    (error) => error instanceof OSMError && error.code === 'unsupported_criteria',
  );
  assert.equal(calls, 0);
});

test('pagina en serie hasta el límite solicitado sin exceder 500 resultados por llamada', async () => {
  const calls = [];
  const provider = createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      calls.push({
        limit: Number(parsed.searchParams.get('limit')),
        offset: Number(parsed.searchParams.get('offset')),
      });
      return response({
        type: 'FeatureCollection',
        features: Array.from({ length: Number(parsed.searchParams.get('limit')) }, (_, index) => ({
          type: 'Feature',
          properties: { name: `Lugar ${calls.at(-1).offset + index}` },
          geometry: { type: 'Point', coordinates: [-75.29, 2.92] },
        })),
      });
    },
  });

  const result = await provider.search({
    query: 'parqueaderos',
    place: 'Neiva',
    limit: 1000,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  });

  assert.deepEqual(calls, [{ limit: 500, offset: 0 }, { limit: 500, offset: 500 }]);
  assert.equal(result.elements.length, 1000);
});

test('traduce límites de cuenta, llave inválida, JSON incorrecto y timeout a errores claros', async () => {
  const makeProvider = (fetchImpl) => createGeoapifyProvider({
    apiKey: 'geoapify-test-key',
    resolveLocation: async () => bounds,
    fetchImpl,
  });
  const search = {
    query: 'parqueaderos',
    place: 'Neiva',
    limit: 10,
    retrievedAt: '2026-10-26T21:00:00.000Z',
  };

  await assert.rejects(
    makeProvider(async () => response({}, 429)).search(search),
    (error) => error instanceof OSMError && error.code === 'rate_limited',
  );
  await assert.rejects(
    makeProvider(async () => response({}, 401)).search(search),
    (error) => error instanceof OSMError && error.code === 'invalid_api_key',
  );
  await assert.rejects(
    makeProvider(async () => response({})).search(search),
    (error) => error instanceof OSMError && error.code === 'invalid_response',
  );
  await assert.rejects(
    makeProvider(async () => { throw new DOMException('timeout', 'TimeoutError'); }).search(search),
    (error) => error instanceof OSMError && error.code === 'timeout',
  );
});

test('informa explícitamente cuando falta la llave configurada fuera de la interfaz', async () => {
  const provider = createGeoapifyProvider({
    apiKey: '',
    resolveLocation: async () => bounds,
    fetchImpl: async () => {
      throw new Error('No debe consultar sin llave');
    },
  });

  await assert.rejects(
    provider.search({
      query: 'parqueaderos',
      place: 'Neiva',
      limit: 10,
      retrievedAt: '2026-10-26T21:00:00.000Z',
    }),
    (error) => error instanceof OSMError && error.code === 'no_key'
      && error.message.includes('GEOAPIFY_API_KEY'),
  );
});
