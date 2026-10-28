const catalog = require('./catalog.json');

function normalizeActivityText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const activities = catalog.activities;
const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));
const activitiesByPhrase = new Map();

for (const activity of activities) {
  for (const phrase of [activity.name, ...activity.aliases]) {
    const key = normalizeActivityText(phrase);
    if (!key) continue;
    if (!activitiesByPhrase.has(key)) {
      activitiesByPhrase.set(key, activity);
    } else {
      const existing = activitiesByPhrase.get(key);
      if (existing && existing.id !== activity.id) activitiesByPhrase.set(key, null);
    }
  }
}

function resolveActivity(phrase) {
  return activitiesByPhrase.get(normalizeActivityText(phrase)) ?? null;
}

function resolvePlanActivities(plan) {
  const searches = [];
  for (const search of plan.searches) {
    const activity = resolveActivity(search.query);
    if (!activity) {
      return {
        ok: false,
        code: 'unsupported_activity',
        message: `No pude relacionar «${search.query}» con una actividad reconocida. Prueba con una actividad del catálogo, como restaurantes, farmacias, talleres de vehículos o tiendas de ropa.`,
      };
    }
    if (activity.geoapify_categories.length === 0) {
      return {
        ok: false,
        code: 'unsupported_activity',
        message: `«${activity.name}» está en el catálogo, pero no tiene una categoría de búsqueda específica disponible en Geoapify. No se ejecutó una búsqueda aproximada.`,
      };
    }
    searches.push({ ...search, query: activity.name });
  }
  return { ok: true, plan: { ...plan, searches } };
}

function activityPromptCatalog() {
  return activities.map((activity) => {
    const aliases = activity.aliases.length ? `; variantes: ${activity.aliases.join(', ')}` : '';
    const availability = activity.geoapify_categories.length ? '' : '; SIN CATEGORÍA DE BÚSQUEDA';
    const precision = activity.precision === 'Amplia' ? '; correspondencia amplia' : '';
    const distinctions = activity.specialty_notes ? `; distinguir: ${activity.specialty_notes}` : '';
    return `- ${activity.name}${aliases}${precision}${availability}${distinctions}`;
  }).join('\n');
}

module.exports = {
  catalog,
  activities,
  activitiesById,
  normalizeActivityText,
  resolveActivity,
  resolvePlanActivities,
  activityPromptCatalog,
};
