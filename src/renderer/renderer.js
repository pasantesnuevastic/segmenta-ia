const $ = (id) => document.getElementById(id);
const provider = $('provider');
const apiKey = $('apiKey');
const passphrase = $('passphrase');
const unlockPass = $('unlockPass');
const status = $('status');

function describeKeyStatus(hasKey, hasStoredKey) {
  if (hasKey && hasStoredKey) return 'Llave lista (guardada cifrada con tu contraseña).';
  if (hasKey) return 'Llave lista solo para esta sesión: no se guarda en el disco.';
  if (hasStoredKey) return 'Hay una llave guardada y bloqueada: escribe tu contraseña para desbloquearla.';
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
  status.textContent = describeKeyStatus(s.hasKey, s.hasStoredKey);
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
const progress = $('progress');
const resultsBox = $('results');
const exportButton = $('export');
let lastResults = null;

const PROGRESS_MESSAGES = {
  search_started: (event) => `Búsqueda ${event.searchIndex} de ${event.totalSearches}: ${event.query} en ${event.place}.`,
  geocoding: (event) => `Resolviendo ubicación: ${event.place}…`,
  querying: () => 'Consultando Geoapify…',
  search_completed: (event) => `Búsqueda ${event.searchIndex} de ${event.totalSearches} terminada; ${event.resultCount} resultado(s) acumulado(s).`,
  search_failed: (event) => `No se pudo consultar la zona ${event.searchIndex} de ${event.totalSearches} (${event.place}): ${event.message} Se continuará con las demás zonas del plan.`,
  failed: (event) => event.message,
  completed: (event) => {
    const failures = event.failedSearchCount ? ` ${event.failedSearchCount} zona(s) no se pudieron consultar.` : '';
    return `Consulta terminada: ${event.resultCount} resultado(s), ${event.duplicateCount} duplicado(s) eliminado(s).${failures}`;
  },
};

function progressMessage(event) {
  return PROGRESS_MESSAGES[event.status]?.(event) ?? `Estado: ${event.status}`;
}

function describePlan(r) {
  if (!r.ok) return [r.message, ...(r.errors || []).map((e) => `· ${e}`)].join('\n');
  const { plan } = r;
  const lines = [
    'Plan aprobado:',
    plan.explanation,
    ...plan.searches.map((s) => `· Buscar «${s.query}» en ${s.place}`),
    `Columnas: ${plan.columns.join(', ')} (más fuente, fechas, enlace y atribución)`,
    `Máximo de resultados: ${plan.max_results}`,
  ];
  if (plan.warnings.length) lines.push('Avisos:', ...plan.warnings.map((w) => `· ${w}`));
  if (plan.unknown_terms.length) lines.push(`No interpretado: ${plan.unknown_terms.join(', ')}`);
  return lines.join('\n');
}

function renderResults(result) {
  resultsBox.hidden = false;
  exportButton.disabled = false;
  $('summary').textContent = `${result.resultCount} resultado(s); ${result.duplicateCount} duplicado(s) eliminado(s). Fuente: ${result.source}. ${result.attribution}`;
  $('warnings').replaceChildren();
  for (const warning of result.warnings) {
    const item = document.createElement('p');
    item.textContent = `Aviso: ${warning}`;
    $('warnings').append(item);
  }

  const table = $('resultsTable');
  table.replaceChildren();
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const column of result.columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    headerRow.append(cell);
  }
  head.append(headerRow);
  table.append(head);

  const body = document.createElement('tbody');
  for (const row of result.rows.slice(0, 20)) {
    const tableRow = document.createElement('tr');
    for (const column of result.columns) {
      const cell = document.createElement('td');
      cell.textContent = String(row[column] ?? '');
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(body);
  if (result.rows.length > 20) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Se muestran los primeros 20 resultados; el CSV incluirá los ${result.resultCount}.`;
    $('warnings').append(note);
  }
}

run.addEventListener('click', async () => {
  run.disabled = true;
  exportButton.disabled = true;
  lastResults = null;
  resultsBox.hidden = true;
  progress.textContent = 'Generando plan…';
  planBox.textContent = 'Generando plan…';
  let unsubscribe = () => {};
  try {
    const planned = await window.segmenta.createPlan($('request').value);
    planBox.textContent = describePlan(planned);
    if (!planned.ok) {
      progress.textContent = planned.message;
      return;
    }

    progress.textContent = 'Ejecutando el plan…';
    unsubscribe = window.segmenta.onSearchProgress((event) => {
      progress.textContent = progressMessage(event);
    });
    const result = await window.segmenta.executePlan(planned.plan);
    if (!result.ok) {
      progress.textContent = result.message;
      return;
    }

    lastResults = result;
    renderResults(result);
    progress.textContent = result.resultCount
      ? 'Puedes revisar los resultados y guardar el CSV.'
      : 'La consulta terminó sin coincidencias; puedes guardar un CSV con encabezados y avisos.';
  } catch {
    progress.textContent = 'Ocurrió un error inesperado. Intenta de nuevo.';
  } finally {
    unsubscribe();
    run.disabled = false;
  }
});

exportButton.addEventListener('click', async () => {
  if (!lastResults) return;
  exportButton.disabled = true;
  progress.textContent = 'Preparando el CSV…';
  try {
    const saved = await window.segmenta.exportCsv({
      columns: lastResults.columns,
      rows: lastResults.rows,
    });
    if (!saved.ok) {
      progress.textContent = saved.code === 'cancelled' ? 'Guardado cancelado.' : saved.message;
      return;
    }
    progress.textContent = `CSV guardado en: ${saved.path} (${saved.rowCount} filas).`;
  } catch {
    progress.textContent = 'No se pudo exportar el CSV. Intenta de nuevo.';
  } finally {
    exportButton.disabled = false;
  }
});

window.segmenta.getSettings().then(show).catch(() => {
  status.textContent = 'No se pudieron cargar los ajustes.';
});
