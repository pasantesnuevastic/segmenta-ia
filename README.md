# Segmenta IA

Aplicación de escritorio para Windows que convierte un pedido en lenguaje natural en un CSV de prospectos empresariales.

> **Estado: EN DESARROLLO.** Construcción iniciada el 23/10/2026; demostración prevista para el 30/10/2026. Este repositorio todavía no contiene una aplicación que funcione, y nada de lo descrito abajo debe leerse como una capacidad ya disponible.

## Idea

La persona escribe, por ejemplo, «restaurantes de Neiva con teléfono y sitio web» y la aplicación entrega un CSV con los negocios encontrados, la fuente y la fecha de consulta de cada fila.

## Cómo está pensada (diseño, En desarrollo)

1. **Pedido** en lenguaje natural.
2. **Plan**: un modelo de lenguaje por API (Gemini u OpenAI, intercambiable) devuelve un plan en JSON. La IA solo planifica: no ve resultados ni ejecuta código.
3. **Validación**: esquema, columnas permitidas y límites por ejecución.
4. **Ejecución determinista** sobre fuentes públicas.
5. **Depuración**: duplicados; fuente y fecha en cada fila; lo que la fuente no entrega queda vacío.
6. **CSV local**, revisión humana e importación opcional en Segmenta.

## Estado por componente

| Componente | Estado |
|---|---|
| Plataforma Segmenta (proyecto aparte; se relaciona con esta aplicación solo mediante archivos CSV) | Existente |
| Aplicación de escritorio (Electron, Windows) | En desarrollo |
| Planificador con LLM y validador del plan | Implementados; planificador probado con respuestas simuladas |
| Ejecución OpenStreetMap, depuración y exportación a CSV | Implementadas en el proceso principal y cubiertas por pruebas simuladas; la interfaz actual todavía no conecta estos pasos |
| Fuente adicional: Google Places (requiere llave con facturación) | Propuesto |
| Modelo local sin conexión | Propuesto |
| ≤ 5 min del pedido al CSV (hasta 1000 registros); 100 % de filas con fuente y fecha | Meta (por validar en un piloto) |

## Desarrollo

Requiere Node.js 22 o superior en Windows.

```bash
npm install
npm start      # abre la ventana de desarrollo (la interfaz aún solo genera y muestra planes)
npm test
```

La aplicación expone la búsqueda, el procesamiento y la exportación por IPC/preload para que la interfaz pueda conectarlos. Los proveedores de IA siguen probados con respuestas simuladas; la búsqueda tiene pruebas simuladas y requiere una prueba de aceptación contra los servicios públicos antes de la demostración.

Estructura: `src/main` (proceso principal e IPC), `src/renderer` (interfaz), `src/core/validator` (contrato y validador del plan), `src/core/planner` (prompt, proveedores de IA y orquestación), `src/core/osm.js` (Nominatim y Overpass), `src/core/runner.js` (ejecución serial del plan), `src/core/results.js` (deduplicación y CSV), `src/store` (ajustes y llave cifrada), `test/`.

## Contrato para integrar la interfaz

`window.segmenta` ya incluye estas operaciones:

- `createPlan(request)` → `{ ok: true, plan, usage, model }` o `{ ok: false, code, message, errors? }`. No ejecuta la búsqueda.
- `executePlan(plan)` → `{ ok, code?, message?, source, retrievedAt, columns, rows, resultCount, duplicateCount, warnings }`. La entrada es el plan completo devuelto por `createPlan`; también se valida antes de ejecutar.
- `onSearchProgress(listener)` → registra un listener y devuelve una función para cancelar la suscripción. Estados: `search_started`, `geocoding`, `querying`, `search_completed`, `failed`, `completed`. Los eventos incluyen `searchIndex`, `totalSearches` y, cuando aplica, `query`, `place`, `resultCount`, `code` y `message`.
- `exportCsv({ columns, rows })` → `{ ok: true, path, rowCount }`, `{ ok: false, code: 'cancelled', message }` o un error con código y mensaje. Pasar `columns` y `rows` directamente desde la respuesta exitosa de `executePlan`; Electron abre el diálogo de guardado.

Ejemplo de integración desde el renderer:

```js
const unsubscribe = window.segmenta.onSearchProgress((event) => {
  // Mostrar event.status y event.searchIndex / event.totalSearches.
});
const planned = await window.segmenta.createPlan(requestText);
if (planned.ok) {
  const result = await window.segmenta.executePlan(planned.plan);
  if (result.ok) {
    const saved = await window.segmenta.exportCsv({ columns: result.columns, rows: result.rows });
    if (saved.ok) console.log(saved.path);
  }
}
unsubscribe();
```

El planificador aplica 50 resultados por defecto si la persona no indica una cantidad. Los valores válidos son de 1 a 1000; pide al modelo limitar a 1000 y avisar si la persona solicita más. El validador rechaza un plan que supere el máximo. Una solicitud ajena a la búsqueda de negocios debe producir un plan válido sin búsquedas; el planificador lo convierte en `out_of_scope` con un mensaje para reformular. Los códigos de error de ejecución incluyen `invalid_plan`, `unsupported_criteria`, `location_not_found`, `location_too_large`, `timeout`, `rate_limited`, `service_unavailable`, `network_error` e `invalid_response`; la interfaz debe mostrar `message`. Si ya hay una consulta activa, devuelve `busy`. La exportación puede devolver `cancelled`, `bad_request` o `write_failed`; también debe mostrar `message`. Por prudencia con el servicio público, se rechazan ubicaciones cuya caja geográfica exceda 0,5 grados en latitud o longitud. Una ejecución sin coincidencias es exitosa, con `rows: []`, `resultCount: 0` y un aviso.

Las columnas CSV se escriben en este orden fijo: las columnas solicitadas según `ALLOWED_COLUMNS` (`name`, `address`, `phone`, `website`, `category`, `latitude`, `longitude`), seguidas de `source`, `source_url`, `retrieved_at`, `source_updated_at` y `attribution`. Se incluyen solo las columnas solicitadas y siempre los cinco campos de trazabilidad/licencia. La fecha ISO `retrieved_at` la asigna la aplicación; `source_updated_at` conserva la marca de actualización de OpenStreetMap y queda vacía si no está disponible. `attribution` contiene `© OpenStreetMap contributors (ODbL)`. Identificadores OSM se conservan en la respuesta de búsqueda (`osm_type`, `osm_id`) y se usan para deduplicar, pero no se agregan como columnas CSV.

La deduplicación conserva la primera aparición: primero usa el identificador estable `tipo + ID` de OpenStreetMap; si falta, usa nombre y dirección normalizados (Unicode, tildes, mayúsculas y puntuación); si no hay dirección, usa nombre y teléfono. Si no hay una combinación suficiente, conserva la fila. Los campos ausentes se representan como celdas vacías.

OpenStreetMap se consulta solo para categorías explícitamente mapeadas en `src/core/osm.js`; el resto de criterios se devuelve en `warnings` y no se convierte en una búsqueda libre. Overpass solo devuelve objetos con nombre, usa un límite de ejecución de 25 segundos y la aplicación conserva hasta el máximo permitido por el plan. Las solicitudes se hacen una a una; Nominatim usa un `User-Agent` identificable, caché en memoria y un intervalo mínimo de un segundo. Los endpoints pueden sustituirse mediante `SEGMENTA_NOMINATIM_URL` y `SEGMENTA_OVERPASS_URL`. La aplicación atribuye los datos a OpenStreetMap (© colaboradores de OpenStreetMap, ODbL). Verificar las políticas antes de un piloto: [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) y [Overpass API Commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html). El control de frecuencia local no limita el tráfico agregado de todas las copias; para un piloto con varias personas, configurar un proxy/proveedor propio o un servicio con capacidad y políticas adecuadas.

## Datos y privacidad

- Al proveedor de IA solo se envía el texto del pedido, las columnas permitidas y los límites; nunca filas de resultados.
- La llave de API se pega en los ajustes de la aplicación y nunca va en este repositorio. Por defecto vive solo en memoria durante la sesión y no se escribe en el disco. Si la persona elige una contraseña, se guarda cifrada (scrypt + AES-256-GCM); la contraseña no se guarda y, si se olvida, hay que pegar la llave de nuevo. La interfaz nunca recibe la llave de vuelta.
- Límite conocido: un programa malicioso que corra con el mismo usuario de Windows podría leer la llave de la memoria mientras la aplicación está abierta. Conviene usar una llave dedicada, con límites de uso en el proveedor.
- `.env.example` solo lista nombres de variables, sin valores; la aplicación todavía no lee ese archivo.
- Los resultados dependen de la cobertura de las fuentes públicas y no son un universo completo; verifique los datos antes de contactar.
- Quien use los CSV responde por el tratamiento posterior de los datos de contacto (Ley 1581 de 2012).

## Atribución de datos

Datos de OpenStreetMap: © colaboradores de OpenStreetMap, licencia [ODbL](https://opendatacommons.org/licenses/odbl/).

## Autores

Juan Andrés Vidarte Dussán y Leonardo Ignacio Quiroga Bautista.

## Licencia

Aún no se ha definido una licencia para este repositorio.
