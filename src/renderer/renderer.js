const $ = (id) => document.getElementById(id);
const provider = $('provider');
const apiKey = $('apiKey');
const passphrase = $('passphrase');
const unlockPass = $('unlockPass');
const status = $('status');

function describeStatus(s) {
  if (s.hasKey && s.hasStoredKey) return 'Llave lista (guardada cifrada con tu contraseña).';
  if (s.hasKey) return 'Llave lista solo para esta sesión: no se guarda en el disco.';
  if (s.hasStoredKey) return 'Hay una llave guardada y bloqueada: escribe tu contraseña para desbloquearla.';
  return 'Aún no hay llave.';
}

// Muestra el resultado de una operación de ajustes; los campos de contraseña se vacían siempre.
function show(result) {
  apiKey.value = passphrase.value = unlockPass.value = '';
  if (!result.ok) {
    status.textContent = result.message;
    return;
  }
  const s = result.status;
  provider.value = s.provider;
  status.textContent = describeStatus(s);
  $('unlockBox').hidden = !(s.hasStoredKey && !s.hasKey);
  $('delete').disabled = !(s.hasKey || s.hasStoredKey);
}

provider.addEventListener('change', async () => show(await window.segmenta.setProvider(provider.value)));
$('save').addEventListener('click', async () => {
  show(await window.segmenta.saveKey({ apiKey: apiKey.value, passphrase: passphrase.value }));
});
$('unlock').addEventListener('click', async () => show(await window.segmenta.unlock(unlockPass.value)));
$('delete').addEventListener('click', async () => show(await window.segmenta.deleteKey()));

const planBox = $('plan');
const run = $('run');

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
    planBox.textContent = describePlan(await window.segmenta.createPlan($('request').value));
  } catch {
    planBox.textContent = 'No se pudo generar el plan.';
  } finally {
    run.disabled = false;
  }
});

window.segmenta.getSettings().then(show);
