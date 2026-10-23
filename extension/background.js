chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// botão flutuante na página → abre o painel (gesto do clique propaga)
chrome.runtime.onMessage.addListener((msg, remetente) => {
  if (msg?.tipo !== "abrirPainel" || !remetente.tab) return;
  chrome.sidePanel.open({ windowId: remetente.tab.windowId }).catch(() => {});
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

// kill-switch por cookie (portado: o service worker deles vigia c_user —
// logout/expiração invalida a sessão mesmo sem aba do FB aberta)
let uidConhecido = null;
async function verificarSessao(motivo) {
  try {
    const c = await chrome.cookies.get({ url: "https://www.facebook.com/", name: "c_user" });
    const uid = c?.value?.trim();
    if (uid && /^\d+$/.test(uid)) {
      uidConhecido = uid;
      // fbActiveProfile deles: uid ativo persistido (útil p/ multi-conta depois)
      chrome.storage.local.set({ fbPerfilAtivo: { uid, detectadoEm: Date.now() } });
      return;
    }
  } catch {}
  if (uidConhecido) {
    uidConhecido = null;
    chrome.storage.local.set({ sessaoOff: Date.now() });
    chrome.runtime.sendMessage({
      tipo: "sessaoInvalidada", dados: { motivo },
    }).catch(() => {});
  }
}
chrome.cookies?.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name === "c_user" &&
      cookie.domain.replace(/^\./, "").endsWith("facebook.com"))
    verificarSessao(removed ? "cookie c_user removido" : "sessão alterada");
});
verificarSessao("boot");
