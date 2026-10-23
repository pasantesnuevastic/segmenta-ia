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
| Planificador con LLM, validador, ejecutor, depurador y generador de CSV | En desarrollo |
| Fuente base: OpenStreetMap | En desarrollo |
| Fuente adicional: Google Places (requiere llave con facturación) | Propuesto |
| Modelo local sin conexión | Propuesto |
| ≤ 5 min del pedido al CSV (hasta 100 registros); 100 % de filas con fuente y fecha | Meta (por validar en un piloto) |

## Desarrollo

Requiere Node.js 22 o superior en Windows.

```bash
npm install
npm start      # abre la ventana (hoy: esqueleto con ajustes de proveedor y llave)
npm test
```

Hoy existen: el esqueleto de la ventana, los ajustes (proveedor de IA y llave de API, en memoria o cifrada con una contraseña), el contrato del plan con su validador y el planificador que pide el plan al modelo. El planificador está probado solo con respuestas simuladas, todavía no contra las API reales. La búsqueda, la depuración y el CSV siguen En desarrollo.

Estructura: `src/main` (proceso principal), `src/renderer` (interfaz), `src/core/validator` (contrato y validador del plan), `src/core/planner` (prompt, proveedores de IA y orquestación), `src/store` (ajustes y llave cifrada), `test/`.

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
