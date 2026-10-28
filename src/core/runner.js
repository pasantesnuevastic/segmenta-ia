const { validatePlan } = require('./validator/validatePlan');
const { OSMError, OSM_ATTRIBUTION } = require('./osm');
const { normalizeResults } = require('./results');
const { resolvePlanActivities } = require('./activities');
const DEFAULT_SOURCE = 'OpenStreetMap';

function fail(code, message, errors) {
  return { ok: false, code, message, ...(errors && { errors }) };
}

async function runPlan({ plan: input, osmProvider, onProgress = () => {}, now = () => new Date() }) {
  const validation = validatePlan(input);
  if (!validation.ok) return fail('invalid_plan', 'El plan no cumple el contrato y no se ejecutó.', validation.errors);
  if (!osmProvider || typeof osmProvider.search !== 'function') {
    return fail('provider_error', 'El proveedor de lugares no está configurado.');
  }

  const activityResolution = resolvePlanActivities(validation.plan);
  if (!activityResolution.ok) return fail(activityResolution.code, activityResolution.message);
  const plan = activityResolution.plan;
  const retrievedAt = now().toISOString();
  const gathered = [];
  const warnings = [...plan.warnings];
  const searchFailures = [];
  let source = osmProvider.source || DEFAULT_SOURCE;
  let attribution = osmProvider.attribution || OSM_ATTRIBUTION;
  let duplicateCount = 0;

  for (let index = 0; index < plan.searches.length; index += 1) {
    const search = plan.searches[index];
    onProgress({ status: 'search_started', searchIndex: index + 1, totalSearches: plan.searches.length, ...search });
    try {
      const result = await osmProvider.search({
        ...search,
        limit: Math.max(1, plan.max_results - normalizeResults(gathered, plan.columns).rows.length),
        retrievedAt,
        onStatus: (status) => onProgress({
          status,
          searchIndex: index + 1,
          totalSearches: plan.searches.length,
          ...search,
        }),
      });
      source = result.source || source;
      attribution = result.attribution || attribution;
      warnings.push(...(result.warnings ?? []));
      gathered.push(...(result.elements ?? []));

      const normalized = normalizeResults(gathered, plan.columns);
      duplicateCount = normalized.duplicateCount;
      onProgress({
        status: 'search_completed',
        searchIndex: index + 1,
        totalSearches: plan.searches.length,
        resultCount: normalized.rows.length,
        ...search,
      });
      if (normalized.rows.length >= plan.max_results) break;
    } catch (error) {
      if (!(error instanceof OSMError)) throw error;
      const failure = {
        searchIndex: index + 1,
        query: search.query,
        place: search.place,
        code: error.code,
        message: error.message,
      };
      searchFailures.push(failure);
      onProgress({ status: 'search_failed', totalSearches: plan.searches.length, ...failure });
    }
  }

  if (searchFailures.length === plan.searches.length) {
    const message = searchFailures.length === 1
      ? searchFailures[0].message
      : `No se pudieron consultar las ${searchFailures.length} zonas solicitadas: ${
        searchFailures.map((failure) => `${failure.place} (${failure.code}): ${failure.message}`).join(' | ')
      }`;
    onProgress({ status: 'failed', code: searchFailures[0].code, message, failedSearches: searchFailures });
    return fail(searchFailures[0].code, message);
  }

  for (const failure of searchFailures) {
    warnings.push(`No se pudo consultar «${failure.place}» (${failure.code}): ${failure.message}`);
  }

  const normalized = normalizeResults(gathered, plan.columns);
  duplicateCount = Math.max(duplicateCount, normalized.duplicateCount);
  if (normalized.rows.length === 0) warnings.push(`${source} no devolvió resultados para esta consulta.`);
  onProgress({
    status: 'completed',
    resultCount: normalized.rows.length,
    duplicateCount,
    failedSearchCount: searchFailures.length,
  });
  return {
    ok: true,
    source,
    attribution,
    retrievedAt,
    columns: normalized.columns,
    rows: normalized.rows.slice(0, plan.max_results),
    resultCount: Math.min(normalized.rows.length, plan.max_results),
    duplicateCount,
    failedSearchCount: searchFailures.length,
    warnings: [...new Set(warnings)],
  };
}

module.exports = { runPlan };
