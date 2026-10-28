const { ALLOWED_COLUMNS } = require('./validator/contract');

const PROVENANCE_COLUMNS = ['source', 'source_url', 'retrieved_at', 'source_updated_at', 'attribution'];
const CSV_COLUMNS = [...ALLOWED_COLUMNS, ...PROVENANCE_COLUMNS];

function canonical(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function deduplicationKey(row) {
  if (row.geoapify_place_id) return `geoapify:${row.geoapify_place_id}`;
  if (row.osm_type && row.osm_id !== '' && row.osm_id !== null && row.osm_id !== undefined) {
    return `osm:${row.osm_type}:${row.osm_id}`;
  }
  const name = canonical(row.name);
  const address = canonical(row.address);
  const phone = canonical(row.phone);
  if (name && address) return `name-address:${name}:${address}`;
  if (name && phone) return `name-phone:${name}:${phone}`;
  return null;
}

function deduplicateResults(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = deduplicationKey(row);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function outputColumns(planColumns) {
  const selected = new Set(planColumns);
  return [...ALLOWED_COLUMNS.filter((column) => selected.has(column)), ...PROVENANCE_COLUMNS];
}

function normalizeResults(rows, planColumns) {
  const columns = outputColumns(planColumns);
  const unique = deduplicateResults(rows);
  return {
    columns,
    rows: unique.map((row) => ({
      ...Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])),
      osm_type: row.osm_type ?? '',
      osm_id: row.osm_id ?? '',
      attribution: row.attribution ?? '',
    })),
    duplicateCount: rows.length - unique.length,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeCsv(rows, columns) {
  if (!Array.isArray(rows) || !Array.isArray(columns) || columns.some((column) => !CSV_COLUMNS.includes(column))) {
    throw new TypeError('La estructura de resultados no es válida para exportar.');
  }
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('Cada fila del CSV debe ser un objeto.');
    }
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

module.exports = {
  PROVENANCE_COLUMNS,
  CSV_COLUMNS,
  deduplicationKey,
  deduplicateResults,
  outputColumns,
  normalizeResults,
  serializeCsv,
};
