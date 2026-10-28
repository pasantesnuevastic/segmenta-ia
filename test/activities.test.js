const test = require('node:test');
const assert = require('node:assert/strict');
const {
  catalog,
  activities,
  resolveActivity,
  resolvePlanActivities,
  activityPromptCatalog,
} = require('../src/core/activities');
const { planRequest } = require('../src/core/planner');
const { createGeoapifyProvider } = require('../src/core/geoapify');
const { runPlan } = require('../src/core/runner');

test('carga las 110 actividades del catálogo, pero no habilita las que carecen de categoría', () => {
  assert.equal(activities.length, 110);
  assert.equal(new Set(activities.map((activity) => activity.id)).size, 110);
  assert.equal(activities.filter((activity) => activity.geoapify_categories.length).length, 100);
  assert.equal(activities.filter((activity) => activity.precision === 'Amplia').length, 35);
  assert.deepEqual(
    activities.filter((activity) => activity.geoapify_categories.length === 0).map((activity) => activity.id),
    [65, 66, 76, 77, 97, 104, 105, 106, 107, 108],
  );
  assert.equal(catalog.source, 'Catalogo_actividades_Neiva_Huila_Colombia.xlsx');
});

test('resuelve variantes normalizadas y evita forzar expresiones ambiguas', () => {
  assert.equal(resolveActivity('FARMACIAS').name, 'Farmacias y droguerías');
  assert.equal(resolveActivity('fama de carnes').name, 'Carnicerías');
  assert.equal(resolveActivity('salon de uñas').name, 'Salones de uñas');
  assert.equal(resolveActivity('café'), null);
  assert.equal(resolveActivity('restaurante italiano'), null);
  for (const activity of activities) {
    for (const phrase of [activity.name, ...activity.aliases]) {
      assert.equal(resolveActivity(phrase)?.id, activity.id, `alias ambiguo o no indexado: ${phrase}`);
    }
  }
});

test('el catálogo del prompt incluye variantes y marca actividades sin filtro', () => {
  const prompt = activityPromptCatalog();
  assert.match(prompt, /Restaurantes; variantes:/);
  assert.match(prompt, /Reparación de celulares; variantes:.*SIN CATEGORÍA DE BÚSQUEDA/);
  assert.match(prompt, /correspondencia amplia/);
  assert.match(prompt, /distinguir:/);
});

test('normaliza un alias a su actividad canónica antes de ejecutar el plan', () => {
  const result = resolvePlanActivities({
    searches: [{ query: 'farmacias', place: 'Neiva' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.searches[0].query, 'Farmacias y droguerías');
});

test('rechaza actividades no catalogadas y actividades sin categoría de proveedor', () => {
  const unknown = resolvePlanActivities({
    searches: [{ query: 'negocios mágicos', place: 'Neiva' }],
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unsupported_activity');

  const noCategory = resolvePlanActivities({
    searches: [{ query: 'reparación de celulares', place: 'Neiva' }],
  });
  assert.equal(noCategory.ok, false);
  assert.equal(noCategory.code, 'unsupported_activity');
  assert.match(noCategory.message, /no tiene una categoría de búsqueda específica/);
});

test('recorre IA, normalización, Geoapify, aviso de especialidad y resultado con datos simulados', async () => {
  const generatedPlan = {
    schema_version: '1.1',
    searches: [{ query: 'Restaurantes', place: 'Neiva', specialty: 'italianos' }],
    columns: ['name', 'category'],
    max_results: 10,
    explanation: 'Restaurantes de Neiva.',
    warnings: [],
    unknown_terms: [],
  };
  const planned = await planRequest({
    request: '10 restaurantes italianos en Neiva',
    provider: 'gemini',
    apiKey: 'simulated-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(generatedPlan) }] } }],
        usageMetadata: {},
      }),
    }),
  });
  assert.equal(planned.ok, true);

  let requestedCategories;
  const provider = createGeoapifyProvider({
    apiKey: 'simulated-geoapify-key',
    resolveLocation: async () => ({ south: 2.9, north: 2.95, west: -75.3, east: -75.25 }),
    fetchImpl: async (url) => {
      requestedCategories = new URL(url).searchParams.get('categories');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {
              name: 'Restaurante de prueba',
              place_id: 'geoapify-simulated-id',
              datasource: { raw: { amenity: 'restaurant' } },
            },
            geometry: { type: 'Point', coordinates: [-75.28, 2.92] },
          }],
        }),
      };
    },
  });
  const result = await runPlan({ plan: planned.plan, osmProvider: provider });

  assert.equal(requestedCategories, 'catering.restaurant');
  assert.equal(result.ok, true);
  assert.equal(result.resultCount, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('italianos')));
});

test('el ejecutor también bloquea planes que piden actividades sin filtro específico', async () => {
  let calls = 0;
  const result = await runPlan({
    plan: {
      schema_version: '1.1',
      searches: [{ query: 'reparación de celulares', place: 'Neiva', specialty: '' }],
      columns: ['name'],
      max_results: 10,
      explanation: '',
      warnings: [],
      unknown_terms: [],
    },
    osmProvider: {
      async search() {
        calls += 1;
        return { elements: [], warnings: [] };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_activity');
  assert.equal(calls, 0);
});
