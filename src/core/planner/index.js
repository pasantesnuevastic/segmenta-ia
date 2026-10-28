const { LIMITS } = require('../validator/contract');
const { validatePlan } = require('../validator/validatePlan');
const { buildMessages } = require('./prompt');
const { PROVIDERS, DEFAULT_MODELS, ProviderError } = require('./providers');
const { resolvePlanActivities } = require('../activities');

const fail = (code, message, errors) => ({ ok: false, code, message, ...(errors && { errors }) });

// Pedido en lenguaje natural → plan validado. Nunca lanza: devuelve { ok: true, plan, usage, model }
// o { ok: false, code, message }. El modelo solo planifica; su respuesta se acepta únicamente si
// cumple el esquema y los límites del contrato.
async function planRequest({ request, provider, apiKey, model, fetchImpl = fetch }) {
  const call = PROVIDERS[provider];
  if (!call) return fail('bad_request', 'Proveedor de IA no válido.');
  if (!apiKey) return fail('no_key', 'Falta la llave de API del proveedor.');

  const text = typeof request === 'string' ? request.trim() : '';
  if (!text) return fail('bad_request', 'Escribe qué lista de negocios necesitas.');
  if (text.length > LIMITS.maxRequestLength) {
    return fail('bad_request', `El pedido supera ${LIMITS.maxRequestLength} caracteres; resúmelo.`);
  }

  const usedModel = model || DEFAULT_MODELS[provider];
  let answer;
  try {
    answer = await call({ apiKey, model: usedModel, ...buildMessages(text), fetchImpl });
  } catch (err) {
    if (err instanceof ProviderError) return fail('provider_error', err.message);
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(answer.text);
  } catch {
    return fail('invalid_json', 'El modelo no devolvió un plan en JSON. Intenta reformular el pedido.');
  }

  const result = validatePlan(parsed, { allowEmptySearches: true });
  if (!result.ok) {
    return fail('invalid_plan', 'El plan del modelo no cumple las reglas y se descartó. Intenta reformular el pedido.', result.errors);
  }
  if (result.plan.searches.length === 0) {
    if (result.plan.unknown_terms.length) {
      return fail(
        'unsupported_activity',
        `No hay una búsqueda configurada para «${result.plan.unknown_terms.join(', ')}». Prueba con otra actividad del catálogo o reformula el pedido.`,
      );
    }
    return fail('out_of_scope', 'No pude identificar una solicitud de búsqueda de negocios. Describe qué tipo de negocio quieres consultar y en qué ubicación.');
  }
  const resolved = resolvePlanActivities(result.plan);
  if (!resolved.ok) return fail(resolved.code, resolved.message);
  return { ok: true, plan: resolved.plan, usage: answer.usage, model: usedModel };
}

module.exports = { planRequest };
