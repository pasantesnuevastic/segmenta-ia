# Segmenta IA

Aplicación de escritorio para Windows que convierte un pedido en lenguaje natural en un CSV de prospectos empresariales.

> **Estado: EN DESARROLLO.** Construcción iniciada el 23/10/2026; demostración prevista para el 30/10/2026. La aplicación de escritorio funciona en el entorno de desarrollo; falta completar la prueba de aceptación de búsqueda real con una llave Geoapify.

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
| Búsqueda Geoapify + geocodificación Nominatim, depuración y exportación a CSV | Implementadas; cubiertas por pruebas simuladas, pendientes de aceptación con una llave Geoapify real |
| Consulta directa a Overpass | Sustituida como proveedor principal por la indisponibilidad observada del servicio público |
| Modelo local sin conexión | Propuesto |
| ≤ 5 min del pedido al CSV (hasta 1000 registros); 100 % de filas con fuente y fecha | Meta (por validar en un piloto) |

## Desarrollo

Requiere Node.js 22 o superior en Windows.

```bash
npm install
npm start      # abre la ventana con el flujo completo de plan, búsqueda Geoapify y exportación CSV
npm test
```

La ventana actual completa el flujo: genera un plan, consulta Geoapify, presenta el estado y los resultados y permite guardar el CSV. Se requiere una llave de IA (Gemini u OpenAI) y otra llave independiente de Geoapify. La cuenta gratuita de Geoapify documenta hasta 3.000 solicitudes al día sin tarjeta de crédito, sujeta a cuotas, límites y condiciones vigentes; esto no constituye una garantía de disponibilidad. La búsqueda Geoapify y la geocodificación Nominatim tienen pruebas automatizadas simuladas; falta una consulta de aceptación con una llave Geoapify real.

### Configuración de las llaves

1. Crea un proyecto en [Geoapify MyProjects](https://myprojects.geoapify.com/) y copia una llave habilitada para Places API.
2. Desde la raíz del proyecto, copia `.env.example` a `.env` con PowerShell: `Copy-Item .env.example .env`.
3. Abre `.env` y asigna la llave a `GEOAPIFY_API_KEY=tu_llave`. No pegues la llave en archivos `.js`.
4. Guarda el archivo y reinicia Electron. La app carga `.env` en el proceso principal al iniciar; la llave no aparece en la interfaz ni se expone al renderer.
5. Configura Gemini u OpenAI en la sección **Proveedor de IA**, escribe una solicitud y ejecuta la búsqueda.

`.env` ya está excluido por `.gitignore`; Git normalmente no lo incluirá en commits. Verifica la exclusión con `git check-ignore -v .env`. La plantilla `.env.example` no contiene secretos y sí se versiona. No uses `git add -f .env` ni copies la llave a un archivo versionado: ningún `.gitignore` puede impedir que alguien fuerce intencionalmente un archivo. Usa una llave dedicada a esta app, vigila su cuota y configura las restricciones disponibles. La llave no se envía a Gemini/OpenAI ni se coloca en el URL de Geoapify: el proceso principal de Electron la envía en el encabezado de autenticación.

Estructura: `src/main` (proceso principal e IPC), `src/renderer` (interfaz), `src/core/validator` (contrato y validador del plan), `src/core/planner` (prompt, proveedores de IA y orquestación), `src/core/osm.js` (geocodificación Nominatim y categorías OSM), `src/core/geoapify.js` (búsqueda de lugares y normalización), `src/core/runner.js` (ejecución serial del plan), `src/core/results.js` (deduplicación y CSV), `src/store` (ajustes y llaves cifradas), `test/`.

## Contrato para integrar la interfaz

`window.segmenta` ya incluye estas operaciones:

- `createPlan(request)` → `{ ok: true, plan, usage, model }` o `{ ok: false, code, message, errors? }`. No ejecuta la búsqueda.
- `executePlan(plan)` → `{ ok, code?, message?, source, retrievedAt, columns, rows, resultCount, duplicateCount, failedSearchCount, warnings }`. La entrada es el plan completo devuelto por `createPlan`; también se valida antes de ejecutar. Las búsquedas por zona se hacen en serie: un fallo en una zona se registra y no impide intentar las siguientes. Si alguna zona falla, pero otra responde, los resultados se devuelven con avisos; si fallan todas, devuelve un error que identifica cada zona. La interfaz actual ya lo llama.
- `onSearchProgress(listener)` → registra un listener y devuelve una función para cancelar la suscripción. Estados: `search_started`, `geocoding`, `querying`, `search_completed`, `search_failed`, `failed`, `completed`. Los eventos incluyen `searchIndex`, `totalSearches` y, cuando aplica, `query`, `place`, `resultCount`, `code` y `message`.
- `exportCsv({ columns, rows })` → `{ ok: true, path, rowCount }`, `{ ok: false, code: 'cancelled', message }` o un error con código y mensaje. Pasar `columns` y `rows` directamente desde la respuesta exitosa de `executePlan`; Electron abre el diálogo de guardado. La interfaz actual ya realiza esta llamada desde el botón para guardar.

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

El planificador aplica 50 resultados por defecto si la persona no indica una cantidad. Los valores válidos son de 1 a 1000; pide al modelo limitar a 1000 y avisar si la persona solicita más. El validador rechaza un plan que supere el máximo. Una solicitud ajena a la búsqueda de negocios debe producir un plan válido sin búsquedas; el planificador lo convierte en `out_of_scope` con un mensaje para reformular. Los códigos de error de ejecución incluyen `invalid_plan`, `unsupported_criteria`, `location_not_found`, `location_too_large`, `no_key`, `invalid_api_key`, `timeout`, `rate_limited`, `service_unavailable`, `network_error` e `invalid_response`; la interfaz debe mostrar `message`. Si ya hay una consulta activa, devuelve `busy`. La exportación puede devolver `cancelled`, `bad_request` o `write_failed`; también debe mostrar `message`. Por prudencia con la consulta geográfica pública, se rechazan ubicaciones cuya caja geográfica exceda 0,5 grados en latitud o longitud. Una ejecución sin coincidencias es exitosa, con `rows: []`, `resultCount: 0` y un aviso. Si Geoapify o Nominatim falla, la app informa el servicio y conserva el detalle; no cambia automáticamente a otra fuente.

Las columnas CSV se escriben en este orden fijo: las columnas solicitadas según `ALLOWED_COLUMNS` (`name`, `address`, `phone`, `website`, `category`, `latitude`, `longitude`), seguidas de `source`, `source_url`, `retrieved_at`, `source_updated_at` y `attribution`. Se incluyen solo las columnas solicitadas y siempre los cinco campos de trazabilidad/licencia. La fecha ISO `retrieved_at` la asigna la aplicación; `source_updated_at` conserva la fecha de actualización OSM si Geoapify la incluye y queda vacía si no está disponible. `attribution` indica Geoapify y OpenStreetMap. Identificadores OSM se conservan cuando están disponibles (`osm_type`, `osm_id`) y se usan para deduplicar, pero no se agregan como columnas CSV. Si el proveedor no entrega un identificador OSM, el enlace del registro queda vacío en vez de inventarse.

La deduplicación conserva la primera aparición: primero usa el identificador estable `tipo + ID` de OpenStreetMap; si falta, usa nombre y dirección normalizados (Unicode, tildes, mayúsculas y puntuación); si no hay dirección, usa nombre y teléfono. Si no hay una combinación suficiente, conserva la fila. Los campos ausentes se representan como celdas vacías.

La búsqueda de lugares utiliza Geoapify Places con categorías explícitamente mapeadas en `src/core/geoapify.js`; restaurantes se consultan como `catering.restaurant` y parqueaderos como `parking`. Los criterios que no se pueden traducir se devuelven en `warnings`, nunca se envían como filtros arbitrarios. Geoapify agrupa algunas categorías de salud; cuando la equivalencia es más amplia que el pedido, la app lo avisa. Nominatim resuelve el área geográfica a una caja delimitadora de hasta 0,75 grados por lado; Geoapify busca dentro de ese rectángulo y puede incluir elementos cercanos al borde que queden dentro de la caja. Este umbral permite consultas de ciudades como Ibagué, cuya caja municipal supera 0,5 grados en longitud, sin aceptar áreas de escala regional o nacional. Geoapify pagina secuencialmente hasta el máximo del plan (500 elementos por página como máximo), sin solicitudes paralelas ni reintentos automáticos. Los campos ausentes quedan vacíos. Nominatim usa un `User-Agent` identificable, caché en memoria e intervalo mínimo de un segundo. La llave de Geoapify se lee desde `GEOAPIFY_API_KEY` en el archivo local ignorado `.env`; nunca se expone a la interfaz. Las respuestas que incluyen identificadores OSM usan su enlace directo; si no, no se inventa un enlace. La aplicación muestra y exporta la atribución `Powered by Geoapify; © OpenStreetMap contributors (ODbL)`. Revisar las condiciones vigentes antes del piloto: [Geoapify pricing](https://www.geoapify.com/pricing/), [Places API](https://apidocs.geoapify.com/docs/places/) y [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/). El límite gratuito publicado puede cambiar y no equivale a un SLA.

## Datos y privacidad

- Al proveedor de IA solo se envía el texto del pedido, las columnas permitidas y los límites; nunca filas de resultados. A Geoapify se envían la categoría y la caja delimitadora, no el pedido libre ni la llave Gemini/OpenAI. Nominatim recibe el texto de ubicación para geocodificarlo.
- La llave de IA se administra en Ajustes; la llave de Geoapify se configura solo en `.env` local, ignorado por Git. En ambos casos la llave se mantiene en el proceso principal y no se envía a la interfaz. La llave Geoapify se envía al servicio para autenticar cada búsqueda; una app de escritorio no puede ocultar completamente una llave a alguien con control del equipo, por lo que se recomienda usar una llave dedicada con límites y restricciones.
- Límite conocido: un programa malicioso que corra con el mismo usuario de Windows podría leer la llave de la memoria mientras la aplicación está abierta. Conviene usar una llave dedicada, con límites de uso en el proveedor.
- `.env.example` es una plantilla sin secretos. La aplicación carga `.env` al arrancar; no compartas ni confirmes ese archivo.
- Los resultados dependen de la cobertura de las fuentes públicas y no son un universo completo; verifique los datos antes de contactar.
- Quien use los CSV responde por el tratamiento posterior de los datos de contacto (Ley 1581 de 2012).

## Atribución de datos

Datos de OpenStreetMap: © colaboradores de OpenStreetMap, licencia [ODbL](https://opendatacommons.org/licenses/odbl/).

## Autores

Juan Andrés Vidarte Dussán y Leonardo Ignacio Quiroga Bautista.

## Licencia

Aún no se ha definido una licencia para este repositorio.
