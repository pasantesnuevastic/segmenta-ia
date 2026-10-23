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

window.segmenta.getSettings().then(showStatus);
