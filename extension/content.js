(() => {
  "use strict";
  const MARCA = "fb-autopost";
  const pendentes = new Map();

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.fonte !== MARCA || d.direcao !== "saida") return;

    if (d.tipo === "capturado") {
      chrome.storage.local.get("calibracoes", ({ calibracoes = {} }) => {
        calibracoes[d.dados.tipo] = d.dados;
        chrome.storage.local.set({ calibracoes });
      });
      chrome.runtime.sendMessage({ tipo: "capturado", dados: d.dados }).catch(() => {});
      return;
    }

    if (d.tipo === "stats") {
      chrome.runtime.sendMessage({ tipo: "stats", dados: d.dados }).catch(() => {});
      return;
    }

    if (d.tipo === "sessaoInvalidada") {
      chrome.runtime.sendMessage({ tipo: "sessaoInvalidada", dados: d.dados }).catch(() => {});
      return;
    }

    if (d.tipo === "resposta" && pendentes.has(d.dados.id)) {
      pendentes.get(d.dados.id)(d.dados.resultado);
      pendentes.delete(d.dados.id);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo !== "comando") return;
    const id = Math.random().toString(36).slice(2);
    const expira = setTimeout(() => {
      pendentes.delete(id);
      responder({ resultado: "erro", erro: "timeout na página" });
    }, 120000);
    pendentes.set(id, (resultado) => {
      clearTimeout(expira);
      responder(resultado);
    });
    window.postMessage(
      { fonte: MARCA, direcao: "entrada", id, acao: msg.acao, dados: msg.dados },
      location.origin
    );
    return true;
  });
})();
