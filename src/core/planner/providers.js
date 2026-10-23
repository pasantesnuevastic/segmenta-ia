// Adaptadores de proveedor de IA. Cada uno hace UNA llamada y devuelve { text, usage }.
// Identificadores por defecto tomados de la documentación de cada proveedor el 23/10/2026;
// verificar disponibilidad y precio antes de desplegar (ver Anexo 2, sección 4.3).
const DEFAULT_MODELS = { gemini: 'gemini-3.5-flash-lite', openai: 'gpt-6-luna' };

// Topes por ejecución: acotan el costo de cada pedido (una sola llamada, salida limitada y tiempo máximo).
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 30000;

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function httpErrorMessage(status) {
  if (status === 400) return 'El proveedor rechazó la solicitud (revisa el modelo configurado).';
  if (status === 401 || status === 403) return 'La llave de API no es válida o no tiene permiso.';
  if (status === 429) return 'Se alcanzó el límite de uso o la cuota del proveedor.';
  if (status >= 500) return 'El servicio del proveedor no está disponible por ahora.';
  return `El proveedor respondió con el error ${status}.`;
}

async function post(fetchImpl, url, headers, body) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ProviderError(timedOut ? 'El proveedor tardó demasiado en responder.' : 'No hay conexión con el proveedor.');
  }
  if (!response.ok) throw new ProviderError(httpErrorMessage(response.status), response.status);
  return response.json();
}

async function callGemini({ apiKey, model, system, user, fetchImpl }) {
  const data = await post(
    fetchImpl,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': apiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' },
    },
  );
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text ?? '').join('') : '';
  const u = data?.usageMetadata ?? {};
  return {
    text,
    usage: { inputTokens: u.promptTokenCount ?? null, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
  };
}

// Sin "temperature": algunos modelos de OpenAI solo aceptan el valor por defecto.
async function callOpenAI({ apiKey, model, system, user, fetchImpl }) {
  const data = await post(
    fetchImpl,
    'https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    },
  );
  const u = data?.usage ?? {};
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    usage: { inputTokens: u.prompt_tokens ?? null, outputTokens: u.completion_tokens ?? null },
  };
}

const PROVIDERS = { gemini: callGemini, openai: callOpenAI };

module.exports = { PROVIDERS, DEFAULT_MODELS, ProviderError, MAX_OUTPUT_TOKENS, TIMEOUT_MS };
