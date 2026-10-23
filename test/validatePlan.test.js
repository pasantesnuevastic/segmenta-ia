const test = require('node:test');
const assert = require('node:assert');
const { validatePlan } = require('../src/core/validator/validatePlan');
const { LIMITS, ALLOWED_COLUMNS } = require('../src/core/validator/contract');

const valid = () => ({
  schema_version: '1.0',
  searches: [{ query: 'restaurantes', place: 'Neiva, Huila' }],
  columns: ['name', 'address', 'phone', 'website'],
  max_results: 100,
  explanation: 'Restaurantes de Neiva con teléfono y sitio web.',
  warnings: [],
  unknown_terms: [],
});

const rejects = (mutate, fragment) => {
  const plan = valid();
  mutate(plan);
  const result = validatePlan(plan);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes(fragment)), `esperaba «${fragment}» en ${result.errors}`);
};

test('acepta el plan de ejemplo del contrato', () => {
  const result = validatePlan(valid());
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.plan, valid());
});

test('completa explanation, warnings y unknown_terms si faltan, y recorta espacios', () => {
  const plan = valid();
  delete plan.explanation;
  delete plan.warnings;
  delete plan.unknown_terms;
  plan.searches[0].query = '  restaurantes  ';
  const result = validatePlan(plan);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.plan.explanation, '');
  assert.deepStrictEqual(result.plan.warnings, []);
  assert.strictEqual(result.plan.searches[0].query, 'restaurantes');
});

test('rechaza lo que no es un objeto', () => {
  for (const bad of [null, undefined, 'texto', 42, [], [valid()]]) {
    assert.strictEqual(validatePlan(bad).ok, false);
  }
});

test('rechaza campos desconocidos en el plan y en las búsquedas', () => {
  rejects((p) => { p.tool_calls = []; }, 'campo no permitido «tool_calls»');
  rejects((p) => { p.searches[0].url = 'http://x'; }, 'campo no permitido «url»');
});

test('exige la versión del esquema', () => {
  rejects((p) => { p.schema_version = '2.0'; }, 'schema_version');
  rejects((p) => { delete p.schema_version; }, 'schema_version');
});

test('límites de búsquedas', () => {
  rejects((p) => { p.searches = []; }, 'al menos una búsqueda');
  rejects((p) => { p.searches = Array(LIMITS.maxSearches + 1).fill({ query: 'a', place: 'b' }); }, 'supera');
  rejects((p) => { p.searches[0].query = ''; }, 'no puede estar vacío');
  rejects((p) => { p.searches[0].place = 'x'.repeat(LIMITS.maxTextLength + 1); }, 'supera');
  rejects((p) => { p.searches[0].query = 42; }, 'debe ser texto');
  rejects((p) => { p.searches[0].query = 'a\nb'; }, 'caracteres de control');
});

test('solo columnas permitidas y sin repetir', () => {
  rejects((p) => { p.columns = ['name', 'password']; }, 'columna no permitida');
  rejects((p) => { p.columns = []; }, 'al menos una columna');
  rejects((p) => { p.columns = ['name', 'name']; }, 'repetidas');
  const todas = valid();
  todas.columns = [...ALLOWED_COLUMNS];
  assert.strictEqual(validatePlan(todas).ok, true);
});

test('max_results: entero entre 1 y el tope', () => {
  rejects((p) => { p.max_results = LIMITS.maxResults + 1; }, 'max_results');
  rejects((p) => { p.max_results = 0; }, 'max_results');
  rejects((p) => { p.max_results = 10.5; }, 'max_results');
  rejects((p) => { p.max_results = '50'; }, 'max_results');
});

test('límites de textos y listas de avisos', () => {
  rejects((p) => { p.explanation = 'x'.repeat(LIMITS.maxExplanationLength + 1); }, 'explanation');
  rejects((p) => { p.warnings = Array(LIMITS.maxNotes + 1).fill('a'); }, 'warnings: supera');
  rejects((p) => { p.unknown_terms = 'no es lista'; }, 'unknown_terms');
});
