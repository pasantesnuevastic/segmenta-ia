const { SCHEMA_VERSION, ALLOWED_COLUMNS, LIMITS } = require('./contract');

const PLAN_KEYS = ['schema_version', 'searches', 'columns', 'max_results', 'explanation', 'warnings', 'unknown_terms'];
const SEARCH_KEYS = ['query', 'place'];
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${where}: campo no permitido «${key}»`);
  }
}

function checkText(value, max, where, errors) {
  if (typeof value !== 'string') {
    errors.push(`${where}: debe ser texto`);
    return null;
  }
  const text = value.trim();
  if (!text) errors.push(`${where}: no puede estar vacío`);
  else if (text.length > max) errors.push(`${where}: supera ${max} caracteres`);
  else if (CONTROL_CHARS.test(text)) errors.push(`${where}: contiene caracteres de control`);
  return text;
}

function checkNotes(value, where, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${where}: debe ser una lista`);
    return [];
  }
  if (value.length > LIMITS.maxNotes) errors.push(`${where}: supera ${LIMITS.maxNotes} elementos`);
  return value.map((note, i) => checkText(note, LIMITS.maxNoteLength, `${where}[${i}]`, errors));
}

// Valida un plan ya convertido a objeto. Rechaza (no recorta) todo lo que no cumple el contrato.
// Devuelve { ok: true, plan } con el plan normalizado, o { ok: false, errors }.
function validatePlan(input) {
  const errors = [];
  if (!isObject(input)) return { ok: false, errors: ['El plan debe ser un objeto JSON'] };

  checkKeys(input, PLAN_KEYS, 'plan', errors);
  if (input.schema_version !== SCHEMA_VERSION) errors.push(`schema_version: debe ser «${SCHEMA_VERSION}»`);

  const searches = [];
  if (!Array.isArray(input.searches)) {
    errors.push('searches: debe ser una lista');
  } else {
    if (input.searches.length < 1) errors.push('searches: debe tener al menos una búsqueda');
    if (input.searches.length > LIMITS.maxSearches) errors.push(`searches: supera ${LIMITS.maxSearches} búsquedas`);
    input.searches.forEach((s, i) => {
      if (!isObject(s)) return errors.push(`searches[${i}]: debe ser un objeto`);
      checkKeys(s, SEARCH_KEYS, `searches[${i}]`, errors);
      searches.push({
        query: checkText(s.query, LIMITS.maxTextLength, `searches[${i}].query`, errors),
        place: checkText(s.place, LIMITS.maxTextLength, `searches[${i}].place`, errors),
      });
    });
  }

  if (!Array.isArray(input.columns)) {
    errors.push('columns: debe ser una lista');
  } else {
    if (input.columns.length < 1) errors.push('columns: debe tener al menos una columna');
    input.columns.forEach((c, i) => {
      if (!ALLOWED_COLUMNS.includes(c)) errors.push(`columns[${i}]: columna no permitida «${String(c).slice(0, 40)}»`);
    });
    if (new Set(input.columns).size !== input.columns.length) errors.push('columns: hay columnas repetidas');
  }

  if (!Number.isInteger(input.max_results) || input.max_results < 1 || input.max_results > LIMITS.maxResults) {
    errors.push(`max_results: debe ser un entero entre 1 y ${LIMITS.maxResults}`);
  }

  const explanation = input.explanation === undefined ? '' : input.explanation;
  if (typeof explanation !== 'string') errors.push('explanation: debe ser texto');
  else if (explanation.length > LIMITS.maxExplanationLength) {
    errors.push(`explanation: supera ${LIMITS.maxExplanationLength} caracteres`);
  } else if (CONTROL_CHARS.test(explanation.replace(/[\n\t]/g, ' '))) {
    errors.push('explanation: contiene caracteres de control');
  }

  const warnings = checkNotes(input.warnings, 'warnings', errors);
  const unknownTerms = checkNotes(input.unknown_terms, 'unknown_terms', errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      schema_version: SCHEMA_VERSION,
      searches,
      columns: [...input.columns],
      max_results: input.max_results,
      explanation: explanation.trim(),
      warnings,
      unknown_terms: unknownTerms,
    },
  };
}

module.exports = { validatePlan };
