const provider = document.getElementById('provider');
const apiKey = document.getElementById('apiKey');
const status = document.getElementById('status');

function showStatus(s) {
  provider.value = s.provider;
  status.textContent = s.encryptionAvailable
    ? (s.hasKey ? 'Llave guardada (cifrada).' : 'Aún no hay llave guardada.')
    : 'El cifrado del sistema no está disponible: no se podrán guardar llaves.';
}

document.getElementById('save').addEventListener('click', async () => {
  try {
    showStatus(await window.segmenta.saveSettings({ provider: provider.value, apiKey: apiKey.value }));
    apiKey.value = '';
  } catch (err) {
    status.textContent = err.message;
  }
});

const planBox = document.getElementById('plan');
const run = document.getElementById('run');

function describePlan(r) {
  if (!r.ok) return [r.message, ...(r.errors || []).map((e) => `· ${e}`)].join('\n');
  const { plan } = r;
  const lines = [
    'Plan (aún no ejecutado):',
    plan.explanation,
    ...plan.searches.map((s) => `· Buscar «${s.query}» en ${s.place}`),
    `Columnas: ${plan.columns.join(', ')} (más fuente y fecha de consulta)`,
    `Máximo de resultados: ${plan.max_results}`,
  ];
  if (plan.warnings.length) lines.push('Avisos:', ...plan.warnings.map((w) => `· ${w}`));
  if (plan.unknown_terms.length) lines.push(`No interpretado: ${plan.unknown_terms.join(', ')}`);
  return lines.join('\n');
}

run.addEventListener('click', async () => {
  run.disabled = true;
  planBox.textContent = 'Generando plan…';
  try {
    planBox.textContent = describePlan(await window.segmenta.createPlan(document.getElementById('request').value));
  } catch {
    planBox.textContent = 'No se pudo generar el plan.';
  } finally {
    run.disabled = false;
  }
});

window.segmenta.getSettings().then(showStatus);
