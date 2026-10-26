const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OSMError } = require('../src/core/osm');
const { runPlan } = require('../src/core/runner');
const { deduplicateResults, normalizeResults, serializeCsv } = require('../src/core/results');

const plan = {
  schema_version: '1.0',
  searches: [
    { query: 'restaurantes', place: 'Neiva, Huila' },
    { query: 'cafeterias', place: 'Neiva, Huila' },
  ],
  columns: ['name', 'address', 'phone', 'website'],
  max_results: 100,
  explanation: 'Negocios en Neiva.',
  warnings: [],
  unknown_terms: [],
};

const record = (overrides = {}) => ({
  name: 'Café "La Esquina", Neiva',
  address: 'Calle 8',
  phone: '',
  website: '',
  category: 'restaurant',
  latitude: -2.9,
  longitude: -75.3,
  source: 'OpenStreetMap',
  source_url: 'https://www.openstreetmap.org/node/1',
  retrieved_at: '2026-10-26T19:00:00.000Z',
  source_updated_at: '',
  attribution: '© OpenStreetMap contributors (ODbL)',
  osm_type: 'node',
  osm_id: 1,
  ...overrides,
});

test('elimina duplicados por ID OSM y por nombre/dirección normalizados, sin cambiar el orden', () => {
  const rows = [
    record(),
    record({ name: 'Nombre distinto con el mismo ID' }),
    record({ osm_id: 2, name: 'CAFE LA ESQUINA NEIVA', address: 'CALLE 8' }),
    record({ osm_id: '', osm_type: '', name: 'Sin dirección', phone: '' }),
    record({ osm_id: '', osm_type: '', name: 'Sin dirección', phone: '' }),
  ];
  const unique = deduplicateResults(rows);
  assert.equal(unique.length, 3);
  assert.equal(unique[0].name, rows[0].name);
  assert.equal(unique[1].osm_id, 2);
});

test('normaliza las columnas seleccionadas y mantiene fuente, fecha de extracción y actualización separadas', () => {
  const result = normalizeResults([record()], ['name', 'website']);
  assert.deepEqual(result.columns, ['name', 'website', 'source', 'source_url', 'retrieved_at', 'source_updated_at', 'attribution']);
  assert.deepEqual(result.rows[0], {
    name: 'Café "La Esquina", Neiva',
    website: '',
    source: 'OpenStreetMap',
    source_url: 'https://www.openstreetmap.org/node/1',
    retrieved_at: '2026-10-26T19:00:00.000Z',
    source_updated_at: '',
    attribution: '© OpenStreetMap contributors (ODbL)',
    osm_type: 'node',
    osm_id: 1,
  });
});

test('serializa CSV UTF-8 con comillas, comas, saltos de línea, tildes y campos ausentes', () => {
  const csv = serializeCsv([
    { name: 'Café "La Esquina", Neiva', address: 'Calle 8\r\nLocal 2', phone: '', source: 'OpenStreetMap' },
  ], ['name', 'address', 'phone', 'source']);

  assert.equal(csv, '\uFEFF"name","address","phone","source"\r\n"Café ""La Esquina"", Neiva","Calle 8\r\nLocal 2","","OpenStreetMap"\r\n');
});

test('escribe y vuelve a leer un CSV procesado sin perder la codificación ni la procedencia', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'segmenta-csv-'));
  const file = path.join(directory, 'resultados.csv');
  const normalized = normalizeResults([record()], ['name', 'address', 'phone']);
  try {
    await fs.writeFile(file, serializeCsv(normalized.rows, normalized.columns), 'utf8');
    const saved = await fs.readFile(file, 'utf8');
    assert.ok(saved.startsWith('\uFEFF'));
    assert.ok(saved.includes('"Café ""La Esquina"", Neiva"'));
    assert.ok(saved.includes('"OpenStreetMap"'));
    assert.ok(saved.includes('"https://www.openstreetmap.org/node/1"'));
    assert.ok(saved.includes('"2026-10-26T19:00:00.000Z"'));
    assert.ok(saved.includes('"© OpenStreetMap contributors (ODbL)"'));
    assert.ok(saved.includes('""'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('procesa una búsqueda con resultados y emite progreso y procedencia', async () => {
  const progress = [];
  const result = await runPlan({
    plan,
    now: () => new Date('2026-10-26T19:00:00.000Z'),
    onProgress: (event) => progress.push(event),
    osmProvider: {
      async search({ query, retrievedAt }) {
        return {
          elements: query === 'restaurantes'
            ? [record({ retrieved_at: retrievedAt })]
            : [record({ retrieved_at: retrievedAt })],
          warnings: [],
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resultCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.rows[0].source, 'OpenStreetMap');
  assert.equal(result.rows[0].retrieved_at, '2026-10-26T19:00:00.000Z');
  assert.equal(result.rows[0].source_url, 'https://www.openstreetmap.org/node/1');
  assert.ok(progress.some((event) => event.status === 'search_started'));
  assert.equal(progress.at(-1).status, 'completed');
});

test('procesa una consulta sin resultados como éxito exportable y reporta el estado vacío', async () => {
  const result = await runPlan({
    plan: { ...plan, searches: [plan.searches[0]] },
    osmProvider: { async search() { return { elements: [], warnings: [] }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.resultCount, 0);
  assert.deepEqual(result.rows, []);
  assert.ok(result.warnings.some((warning) => warning.includes('no devolvió resultados')));
});

test('devuelve al integrador el error de proveedor y notifica progreso fallido', async () => {
  const progress = [];
  const result = await runPlan({
    plan: { ...plan, searches: [plan.searches[0]] },
    onProgress: (event) => progress.push(event),
    osmProvider: {
      async search() {
        throw new OSMError('timeout', 'Overpass tardó demasiado en responder.');
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    code: 'timeout',
    message: 'Overpass tardó demasiado en responder.',
  });
  assert.equal(progress.at(-1).status, 'failed');
});

test('si falla una zona, continúa en serie con la siguiente y conserva sus resultados', async () => {
  const calls = [];
  const progress = [];
  const result = await runPlan({
    plan: {
      ...plan,
      searches: [
        { query: 'parqueaderos', place: 'Centro, Neiva' },
        { query: 'parqueaderos', place: 'Norte, Neiva' },
      ],
    },
    onProgress: (event) => progress.push(event),
    osmProvider: {
      async search({ place }) {
        calls.push(place);
        if (place.startsWith('Centro')) {
          throw new OSMError('service_unavailable', 'Overpass no está disponible por ahora.');
        }
        return { elements: [record()], warnings: [] };
      },
    },
  });

  assert.deepEqual(calls, ['Centro, Neiva', 'Norte, Neiva']);
  assert.equal(result.ok, true);
  assert.equal(result.resultCount, 1);
  assert.equal(result.failedSearchCount, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('Centro, Neiva')));
  assert.ok(progress.some((event) => event.status === 'search_failed' && event.place === 'Centro, Neiva'));
  assert.equal(progress.at(-1).status, 'completed');
});

test('si todas las zonas fallan, devuelve errores identificables para cada una', async () => {
  const calls = [];
  const progress = [];
  const result = await runPlan({
    plan: {
      ...plan,
      searches: [
        { query: 'parqueaderos', place: 'Centro, Neiva' },
        { query: 'parqueaderos', place: 'Norte, Neiva' },
      ],
    },
    onProgress: (event) => progress.push(event),
    osmProvider: {
      async search({ place }) {
        calls.push(place);
        throw new OSMError('service_unavailable', 'Overpass no está disponible por ahora.');
      },
    },
  });

  assert.deepEqual(calls, ['Centro, Neiva', 'Norte, Neiva']);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'service_unavailable');
  assert.match(result.message, /Centro, Neiva/);
  assert.match(result.message, /Norte, Neiva/);
  assert.equal(progress.at(-1).status, 'failed');
  assert.equal(progress.at(-1).failedSearches.length, 2);
});
