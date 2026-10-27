const $ = (id) => document.getElementById(id);

// ---------- Vistas ----------

const VIEWS = { start: $('viewStart'), progress: $('viewProgress'), results: $('viewResults') };

function showView(name) {
  for (const [key, view] of Object.entries(VIEWS)) view.hidden = key !== name;
}

function setMessage(element, text, kind = '') {
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

// ---------- Ajustes ----------

const provider = $('provider');
const apiKey = $('apiKey');
const passphrase = $('passphrase');
const unlockPass = $('unlockPass');
const status = $('status');
const settingsDialog = $('settingsDialog');
let keyReady = false;

function describeKeyStatus(hasKey, hasStoredKey) {
  if (hasKey && hasStoredKey) return 'Llave lista (guardada cifrada con tu contraseña).';
  if (hasKey) return 'Llave lista solo para esta sesión: no se guarda en el disco.';
  if (hasStoredKey) return 'Hay una llave guardada y bloqueada: escribe tu contraseña para desbloquearla.';
  return 'Aún no hay llave.';
}

function keySummary(s) {
  const name = provider.selectedOptions[0]?.textContent ?? s.provider;
  if (s.hasKey) return `llave de ${name} lista`;
  if (s.hasStoredKey) return `llave de ${name} bloqueada`;
  return 'falta la llave de IA';
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
  keyReady = s.hasKey;
  status.textContent = describeKeyStatus(s.hasKey, s.hasStoredKey);
  $('unlockBox').hidden = !(s.hasStoredKey && !s.hasKey);
  $('delete').disabled = !(s.hasKey || s.hasStoredKey);
  $('keySummary').textContent = keySummary(s);
  $('keyDot').className = `dot ${s.hasKey ? 'ok' : 'warn'}`;
  if (s.hasKey) $('startMessage').textContent = '';
}

function openSettings() {
  settingsDialog.showModal();
  (keyReady ? provider : $('unlockBox').hidden ? apiKey : unlockPass).focus();
}

$('openSettings').addEventListener('click', openSettings);
$('footSettings').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});

provider.addEventListener('change', async () => show(await window.segmenta.setProvider(provider.value)));
$('save').addEventListener('click', async () => {
  show(await window.segmenta.saveKey({ apiKey: apiKey.value, passphrase: passphrase.value }));
});
$('unlock').addEventListener('click', async () => show(await window.segmenta.unlock(unlockPass.value)));
$('delete').addEventListener('click', async () => show(await window.segmenta.deleteKey()));

// ---------- 1 · Inicio ----------

const request = $('request');
const run = $('run');
const startMessage = $('startMessage');

function updateRunState() {
  $('charCount').textContent = `${request.value.length}/500`;
  run.disabled = !request.value.trim();
}

request.addEventListener('input', updateRunState);
request.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || !event.shiftKey) && !run.disabled) {
    event.preventDefault();
    run.click();
  }
});

// ---------- 2 · Progreso ----------

const progress = $('progress');
const barFill = $('barFill');
const STEP_ORDER = ['interpret', 'validate', 'search', 'dedupe', 'ready'];
const steps = Object.fromEntries([...document.querySelectorAll('#steps li')].map((li) => [li.dataset.step, li]));

// Marca como terminados los pasos anteriores a `name` y como activo el paso `name`.
function setStep(name, state = 'active') {
  const index = STEP_ORDER.indexOf(name);
  STEP_ORDER.forEach((step, i) => {
    steps[step].className = i < index ? 'done' : i === index ? state : '';
  });
}

function setBar(fraction, kind = '') {
  barFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  barFill.className = `bar-fill ${kind}`.trim();
}

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

// La barra reserva 0–20 % para el plan, 20–85 % para las búsquedas y el resto para el cierre.
function onSearchProgress(event) {
  setMessage(progress, progressMessage(event));
  if (event.totalSearches && event.searchIndex) {
    const done = event.status === 'search_started' ? event.searchIndex - 1 : event.searchIndex;
    setBar(0.2 + 0.65 * (done / event.totalSearches));
  }
  if (event.status === 'completed') {
    setStep('dedupe');
    setBar(0.92);
  }
}

function appendItems(list, items) {
  list.replaceChildren(...items.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function renderPlan(plan) {
  const places = [...new Set(plan.searches.map((s) => s.place))];
  const queries = [...new Set(plan.searches.map((s) => s.query))];
  const rows = [
    ['Buscar', queries.join(', ')],
    ['Lugar', places.join(', ')],
    ['Columnas', plan.columns.join(', ')],
    ['Máximo', `${plan.max_results} resultados`],
  ];
  $('planDetails').replaceChildren(...rows.flatMap(([term, value]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    return [dt, dd];
  }));
  const notes = [plan.explanation, ...plan.warnings.map((w) => `Aviso: ${w}`)];
  if (plan.unknown_terms.length) notes.push(`No interpretado: ${plan.unknown_terms.join(', ')}`);
  appendItems($('planNotes'), notes.filter(Boolean));
  $('planCard').hidden = false;
}

function fail(step, message, details = []) {
  setStep(step, 'failed');
  setBar(barFill.style.width ? parseFloat(barFill.style.width) / 100 : 0, 'failed');
  setMessage(progress, '');
  $('progressErrorText').textContent = message;
  appendItems($('progressErrorList'), details);
  $('progressError').hidden = false;
  $('backFromError').focus();
}

$('backFromError').addEventListener('click', () => {
  showView('start');
  request.focus();
});

// ---------- 3 · Resultado ----------

const exportButton = $('export');
const exportMessage = $('exportMessage');
let lastResults = null;
const PREVIEW_ROWS = 50;

const COLUMN_LABELS = {
  name: 'Negocio',
  category: 'Categoría',
  address: 'Dirección',
  phone: 'Teléfono',
  website: 'Sitio web',
  location: 'Ubicación',
};

// Nombres en español de las categorías de Geoapify más comunes; las demás se muestran tal cual.
const CATEGORY_LABELS = {
  restaurant: 'Restaurante', fast_food: 'Comida rápida', cafe: 'Café', bar: 'Bar', pub: 'Bar',
  ice_cream: 'Heladería', bakery: 'Panadería', supermarket: 'Supermercado', convenience: 'Tienda',
  pharmacy: 'Farmacia', chemist: 'Droguería', hotel: 'Hotel', hostel: 'Hostal', hairdresser: 'Peluquería',
  beauty: 'Belleza', clothing: 'Ropa', shoes: 'Calzado', hardware: 'Ferretería', car_repair: 'Taller',
  fuel: 'Gasolinera', bank: 'Banco', dentist: 'Odontología', doctor: 'Consultorio', clinic: 'Clínica',
  hospital: 'Hospital', gym: 'Gimnasio', school: 'Colegio', veterinary: 'Veterinaria',
};

// Solo cambia cómo se ve el valor; el CSV conserva el dato original.
function formatCell(column, value) {
  if (column === 'website') return value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  if (column === 'category') {
    const parts = value.split(/[;,]/)[0].trim().split('.');
    const key = [...parts].reverse().find((part) => CATEGORY_LABELS[part]);
    if (key) return CATEGORY_LABELS[key];
    const last = parts.pop().replace(/_/g, ' ');
    return last.charAt(0).toLocaleUpperCase('es') + last.slice(1);
  }
  return value;
}

// Latitud y longitud se muestran juntas para ahorrar espacio.
function cellValue(row, column) {
  if (column !== 'location') return String(row[column] ?? '').trim();
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (row.latitude === '' || row.longitude === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(5)},\n${lon.toFixed(5)}`;
}

function renderResults(result) {
  $('fileName').textContent = `${result.resultCount} prospecto(s) encontrados`;
  $('summary').textContent = `${result.duplicateCount} duplicado(s) eliminado(s) · Fuente: ${result.source}. ${result.attribution}`;
  $('warnings').replaceChildren(...result.warnings.map((warning) => {
    const item = document.createElement('p');
    item.textContent = `Aviso: ${warning}`;
    return item;
  }));

  // La tabla muestra solo los datos del negocio; la procedencia de cada fila va en el CSV.
  const columns = result.columns.filter((column) => COLUMN_LABELS[column]);
  if (result.columns.includes('latitude') || result.columns.includes('longitude')) columns.push('location');
  const table = $('resultsTable');
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const column of ['#', ...columns]) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.className = `col-${column === '#' ? 'index' : column}`;
    cell.textContent = column === '#' ? '#' : COLUMN_LABELS[column];
    headerRow.append(cell);
  }
  head.append(headerRow);

  const body = document.createElement('tbody');
  result.rows.slice(0, PREVIEW_ROWS).forEach((row, index) => {
    const tableRow = document.createElement('tr');
    const number = document.createElement('td');
    number.className = 'col-index';
    number.textContent = index + 1;
    tableRow.append(number);
    for (const column of columns) {
      const cell = document.createElement('td');
      const value = cellValue(row, column);
      cell.className = `col-${column}`;
      if (value) {
        cell.textContent = formatCell(column, value);
        cell.title = value;
      } else {
        cell.textContent = '—';
        cell.classList.add('empty');
      }
      tableRow.append(cell);
    }
    body.append(tableRow);
  });
  table.replaceChildren(head, body);

  const notes = [];
  if (result.rows.length > PREVIEW_ROWS) notes.push(`Se muestran los primeros ${PREVIEW_ROWS} resultados; el CSV incluirá los ${result.resultCount}.`);
  if (!result.resultCount) notes.push('La consulta terminó sin coincidencias; puedes guardar un CSV con encabezados y avisos.');
  else notes.push('El CSV incluye además la fuente, el enlace, las fechas y la atribución de cada fila.');
  $('resultsNote').textContent = notes.join(' ');

  exportButton.disabled = false;
  exportButton.hidden = false;
  $('openCsv').hidden = $('showFolder').hidden = true;
  setMessage(exportMessage, '');
}

$('newSearch').addEventListener('click', () => {
  showView('start');
  request.select();
  request.focus();
});

exportButton.addEventListener('click', async () => {
  if (!lastResults) return;
  exportButton.disabled = true;
  setMessage(exportMessage, 'Preparando el CSV…');
  try {
    const saved = await window.segmenta.exportCsv({
      columns: lastResults.columns,
      rows: lastResults.rows,
    });
    if (!saved.ok) {
      setMessage(exportMessage, saved.code === 'cancelled' ? 'Guardado cancelado.' : saved.message, saved.code === 'cancelled' ? '' : 'error');
      return;
    }
    const name = saved.path.split(/[\\/]/).pop();
    $('fileName').textContent = name;
    setMessage(exportMessage, `CSV guardado (${saved.rowCount} filas) en: ${saved.path}`, 'ok');
    exportButton.textContent = 'Guardar otra copia';
    exportButton.className = 'ghost';
    $('openCsv').hidden = $('showFolder').hidden = false;
  } catch {
    setMessage(exportMessage, 'No se pudo exportar el CSV. Intenta de nuevo.', 'error');
  } finally {
    exportButton.disabled = false;
  }
});

async function openExport(action) {
  const opened = await window.segmenta[action]();
  if (!opened.ok) setMessage(exportMessage, opened.message, 'error');
}
$('openCsv').addEventListener('click', () => openExport('openCsv'));
$('showFolder').addEventListener('click', () => openExport('showCsvFolder'));

// ---------- Flujo principal ----------

run.addEventListener('click', async () => {
  if (!request.value.trim()) return;
  run.disabled = true;
  lastResults = null;
  setMessage(startMessage, '');
  exportButton.textContent = 'Guardar CSV';
  exportButton.className = 'primary';

  showView('progress');
  $('planCard').hidden = true;
  $('progressError').hidden = true;
  setStep('interpret');
  setBar(0.05);
  setMessage(progress, 'La IA está interpretando tu pedido…');

  let unsubscribe = () => {};
  try {
    const planned = await window.segmenta.createPlan(request.value);
    if (!planned.ok) {
      if (planned.code === 'locked') openSettings();
      fail(planned.errors?.length ? 'validate' : 'interpret', planned.message, planned.errors || []);
      return;
    }
    setStep('validate');
    renderPlan(planned.plan);
    setBar(0.2);

    setStep('search');
    setMessage(progress, 'Ejecutando el plan…');
    unsubscribe = window.segmenta.onSearchProgress(onSearchProgress);
    const result = await window.segmenta.executePlan(planned.plan);
    if (!result.ok) {
      fail('search', result.message);
      return;
    }

    setStep('ready');
    setBar(1, 'done');
    lastResults = result;
    renderResults(result);
    STEP_ORDER.forEach((step) => { steps[step].className = 'done'; });
    showView('results');
    exportButton.focus();
  } catch {
    fail('interpret', 'Ocurrió un error inesperado. Intenta de nuevo.');
  } finally {
    unsubscribe();
    updateRunState();
  }
});

// ---------- Arranque ----------

updateRunState();
request.focus();
window.segmenta.getSettings().then((result) => {
  show(result);
  if (result.ok && !result.status.hasKey) {
    setMessage(startMessage, result.status.hasStoredKey
      ? 'Desbloquea tu llave de IA en Ajustes para empezar.'
      : 'Configura tu llave de IA en Ajustes para empezar.');
  }
}).catch(() => {
  status.textContent = 'No se pudieron cargar los ajustes.';
});
