chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// retomada de lotes: abre o painel quando o alarme dispara
chrome.alarms.onAlarm.addListener(async (alarme) => {
  if (alarme.name !== "retomar_fila") return;
  try {
    const janelas = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const alvo = janelas.find((j) => j.focused) || janelas[0];
    if (alvo) await chrome.sidePanel.open({ windowId: alvo.id });
    chrome.storage.local.set({ retomarPendente: true });
  } catch {}
});
