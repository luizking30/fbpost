(() => {
  "use strict";
  const MARCA = "fb-autopost";
  const pendentes = new Map();

  // ---------- contexto invalidado (index.js deles) ----------
  // extensão recarregada/atualizada → sendMessage lança → banner fixo
  // Zn deles: erros típicos de contexto morto cobrem port closed,
  // "Receiving end does not exist" e property-read no runtime/chrome
  const RE_CTX_MORTO =
    /Extension context invalidated|context invalidated|message port closed|Receiving end does not exist|Cannot read propert(?:y|ies) of undefined \(reading '(?:local|session|sync|onMessage|onChanged|sendMessage|lastError|id|connect|getURL)'\)/i;
  const ehErroCtx = (e) => RE_CTX_MORTO.test(e instanceof Error ? e.message : String(e ?? ""));
  let avisado = false;
  const avisoRecarga = () => {
    if (avisado) return;
    avisado = true;
    const d = document.createElement("div");
    d.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
      "background:#b45309;color:#fff;padding:8px 14px;font:600 13px " +
      "system-ui,sans-serif;text-align:center";
    d.innerHTML =
      'FB AutoPost: a extensão foi atualizada — recarregue a página ' +
      '<button id="fbap-reload" style="margin-left:10px;cursor:pointer;border:0;' +
      'border-radius:8px;padding:4px 12px;background:#4f46e5;color:#fff;' +
      'font:600 12px system-ui">Recarregar</button>';
    (document.body || document.documentElement).appendChild(d);
    document.getElementById("fbap-reload")
      ?.addEventListener("click", () => location.reload());
    document.querySelector("#fbap-fab")?.remove();
  };
  // deles: qualquer erro/rejection com cara de contexto morto → banner
  window.addEventListener("error", (e) => {
    if (!ehErroCtx(e.error ?? e.message) && chrome.runtime?.id) return;
    avisoRecarga();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (!ehErroCtx(e.reason) && chrome.runtime?.id) return;
    avisoRecarga();
  });
  const enviar = (msg) => {
    if (!chrome.runtime?.id) return void avisoRecarga();
    try {
      return chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      avisoRecarga();
    }
  };

  // ---------- botão flutuante (#app-grupos-painel deles) ----------
  // em /groups/<x> vira menu contextual: ações rápidas que pré-enchem
  // o painel (acaoPendente no storage); fora de grupo só abre o painel
  const slugGrupo = () => {
    const m = location.pathname.match(/^\/groups\/([^/?#]+)/);
    return m ? `https://www.facebook.com/groups/${m[1]}` : null;
  };
  const montarFab = () => {
    if (document.getElementById("fbap-fab") || avisado) return;
    const b = document.createElement("button");
    b.id = "fbap-fab";
    b.textContent = "FB AutoPost";
    b.style.cssText =
      "position:fixed;bottom:18px;right:18px;z-index:2147483646;" +
      "background:#2563eb;color:#fff;border:0;border-radius:999px;" +
      "padding:10px 16px;font:700 13px system-ui,sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer";
    document.body.appendChild(b);

    const g = slugGrupo();
    if (!g) {
      b.addEventListener("click", () => enviar({ tipo: "abrirPainel" }));
      return;
    }
    // menu contextual (overlay deles tem ações por contexto do grupo)
    const menu = document.createElement("div");
    menu.id = "fbap-menu";
    menu.style.cssText =
      "position:fixed;bottom:66px;right:18px;z-index:2147483646;" +
      "display:none;flex-direction:column;gap:6px";
    const mkBtn = (txt, acao) => {
      const x = document.createElement("button");
      x.textContent = txt;
      x.style.cssText =
        "background:#161a22;color:#e5e7eb;border:1px solid #2d3442;" +
        "border-radius:8px;padding:8px 12px;font:600 12px system-ui," +
        "sans-serif;cursor:pointer;text-align:right;" +
        "box-shadow:0 4px 14px rgba(0,0,0,.35)";
      x.addEventListener("click", () => {
        if (acao) {
          try {
            chrome.storage.local.set({ acaoPendente: { acao, grupo: g } });
          } catch { avisoRecarga(); return; }
        }
        menu.style.display = "none";
        enviar({ tipo: "abrirPainel" });
      });
      return x;
    };
    menu.append(
      mkBtn("Abrir painel", null),
      mkBtn("Postar neste grupo", "postar"),
      mkBtn("Engajar neste grupo", "engajar"),
      mkBtn("Aquecer membros", "aquecer"),
    );
    document.body.appendChild(menu);
    b.textContent = "FB AutoPost ▾";
    b.addEventListener("click", () => {
      menu.style.display = menu.style.display === "flex" ? "none" : "flex";
    });
  };
  const rotaComFab = () =>
    location.pathname === "/" || location.pathname.startsWith("/groups/");
  const gerirFab = () => {
    if (!document.body) return;
    if (rotaComFab() && chrome.runtime?.id) montarFab();
    else document.getElementById("fbap-fab")?.remove();
  };
  const quandoPronto = (fn) =>
    document.body ? fn() :
      new MutationObserver((_, o) => {
        if (document.body) { o.disconnect(); fn(); }
      }).observe(document.documentElement, { childList: true });
  quandoPronto(gerirFab);
  setInterval(gerirFab, 2000); // SPA: rota muda sem reload

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.fonte !== MARCA || d.direcao !== "saida") return;

    if (d.tipo === "capturado") {
      try {
        chrome.storage.local.get("calibracoes", ({ calibracoes = {} }) => {
          calibracoes[d.dados.tipo] = d.dados;
          chrome.storage.local.set({ calibracoes });
        });
      } catch { avisoRecarga(); }
      enviar({ tipo: "capturado", dados: d.dados });
      return;
    }

    if (d.tipo === "stats") {
      enviar({ tipo: "stats", dados: d.dados });
      return;
    }

    if (d.tipo === "probesStats") {
      chrome.storage.local.set({ probes: d.dados });
      return;
    }

    if (d.tipo === "domProgresso" || d.tipo === "domFim") {
      // pill de status na página (overlay deles mostra progresso no feed)
      const dd = d.dados ?? {};
      let el = document.getElementById("fbap-status");
      if (!el && document.body) {
        el = document.createElement("div");
        el.id = "fbap-status";
        el.style.cssText =
          "position:fixed;bottom:66px;right:18px;z-index:2147483645;" +
          "background:#161a22;color:#4ade80;border:1px solid #2d3442;" +
          "border-radius:999px;padding:6px 12px;font:600 11px system-ui," +
          "sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35)";
        document.body.appendChild(el);
      }
      if (el) {
        if (d.tipo === "domProgresso")
          el.textContent = dd.aguardando
            ? `DOM ${dd.feitos}/${dd.limite} — ${dd.aguardando}/${dd.total}s`
            : `DOM ${dd.feitos}/${dd.limite} posts`;
        else {
          el.textContent = `DOM: ${dd.status ?? "fim"} (${dd.feitos ?? 0}/${dd.limite ?? "?"})`;
          setTimeout(() => el.remove(), 8000);
        }
      }
      enviar({ tipo: d.tipo, dados: d.dados });
      return;
    }

    if (d.tipo === "sessaoInvalidada") {
      enviar({ tipo: "sessaoInvalidada", dados: d.dados });
      return;
    }

    if (d.tipo === "photoSessionStale") {
      enviar({ tipo: "photoSessionStale", dados: d.dados });
      return;
    }

    if (d.tipo === "resposta" && pendentes.has(d.dados.id)) {
      pendentes.get(d.dados.id)(d.dados.resultado);
      pendentes.delete(d.dados.id);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo !== "comando") return;
    // envelope v1 (portado do canal validado deles): versao + requestId 8-64 + ts
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const expira = setTimeout(() => {
      pendentes.delete(id);
      responder({ resultado: "erro", erro: "timeout na página" });
    }, 120000);
    pendentes.set(id, (resultado) => {
      clearTimeout(expira);
      responder(resultado);
    });
    window.postMessage(
      { fonte: MARCA, direcao: "entrada", versao: 1, id, ts: Date.now(), acao: msg.acao, dados: msg.dados },
      location.origin
    );
    return true;
  });

  // scores adaptativos dos probes: devolve os persistidos pra página
  // (a ponte já está ouvindo — inject registra o listener antes deste script)
  chrome.storage.local.get("probes", ({ probes }) => {
    if (!probes) return;
    window.postMessage(
      {
        fonte: MARCA, direcao: "entrada", versao: 1, ts: Date.now(),
        id: "seed-" + Date.now().toString(36), acao: "probesStats", dados: probes,
      },
      location.origin
    );
  });
})();
