// Contrato del plan (versión 1.1). Única fuente de verdad de columnas y límites: la usan
// tanto el validador como el prompt del planificador.
const SCHEMA_VERSION = '1.1';

// Columnas que el modelo puede elegir. Fuente, fecha de consulta y enlace los agrega siempre el depurador.
const ALLOWED_COLUMNS = ['name', 'address', 'phone', 'website', 'category', 'latitude', 'longitude'];

const LIMITS = {
  maxSearches: 5,
  maxResults: 1000,
  maxTextLength: 100, // query y place
  maxExplanationLength: 300,
  maxNotes: 5, // warnings y unknown_terms
  maxNoteLength: 200,
  maxRequestLength: 500, // pedido en lenguaje natural
};

module.exports = { SCHEMA_VERSION, ALLOWED_COLUMNS, LIMITS };
