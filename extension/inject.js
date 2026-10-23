(() => {
  "use strict";
  if (window.__fbAutoPostCarregado) return;
  window.__fbAutoPostCarregado = true;

  const MARCA = "fb-autopost";
  const GRAPHQL = "https://www.facebook.com/api/graphql/";
  const CODIGOS_BLOQUEIO = new Set([368, 1357004, 1404006, 1404102, 1390008]);
  const RE_COMPOSER = /composer|story.*create|create.*story|group.*post|post.*group|share/i;

  window.__SP_CAPTURADOS = [];

  const emitir = (tipo, dados) =>
    window.postMessage({ fonte: MARCA, direcao: "saida", tipo, dados }, location.origin);

  // ---------- helpers ----------
  const percorrer = (obj, fn, caminho = []) => {
    if (obj === null || typeof obj !== "object") return;
    for (const chave of Object.keys(obj)) {
      const valor = obj[chave], c = caminho.concat(chave);
      fn(valor, chave, c);
      if (valor && typeof valor === "object") percorrer(valor, fn, c);
    }
  };

  const valorEm = (o, c) => c.reduce((a, k) => (a == null ? a : a[k]), o);
  const definirEm = (o, c, v) => {
    for (let i = 0; i < c.length - 1; i++) o = o[c[i]];
    o[c[c.length - 1]] = v;
  };

  const pegarPrimeiro = (html, ...regexes) => {
    for (const r of regexes) {
      const m = html.match(r);
      if (m) return m[1];
    }
    return null;
  };

  // ---------- tokens da página ----------
  function tokensDaPagina() {
    const html = document.documentElement.innerHTML;
    const dtsg = pegarPrimeiro(
      html,
      /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
      /"dtsg":\{"token":"([^"]+)"/,
      /name="fb_dtsg"\s+value="([^"]+)"/,
      /"token":"(Av[\w-]{10,})"/
    );
    let jazoest = pegarPrimeiro(html, /"jazoest=(\d+)"/, /name="jazoest"\s+value="(\d+)"/);
    if (!jazoest && dtsg) {
      let s = 0;
      for (const c of dtsg) s += c.charCodeAt(0);
      jazoest = "2" + s;
    }
    return {
      dtsg,
      jazoest,
      uid: document.cookie.match(/c_user=(\d+)/)?.[1] || null,
      lsd: pegarPrimeiro(html, /"LSD",\[\],\{"token":"([^"]+)"/, /name="lsd"\s+value="([^"]+)"/),
      spin_r: pegarPrimeiro(html, /"__spin_r":(\d+)/, /"spin_r":(\d+)/),
      spin_b: pegarPrimeiro(html, /"__spin_b":"?([\w-]+)"?/, /"spin_b":"?([\w-]+)"?/),
      spin_t: pegarPrimeiro(html, /"__spin_t":(\d+)/, /"spin_t":(\d+)/),
      rev: pegarPrimeiro(html, /"server_revision":(\d+)/, /"client_revision":(\d+)/),
      hsi: pegarPrimeiro(html, /"hsi":"(\d+)"/),
    };
  }

  // ---------- captura de templates ----------
  function montarTemplate(nomeAmigavel, params) {
    let variaveis;
    try { variaveis = JSON.parse(params.get("variables") || "{}"); }
    catch { return null; }

    const slugGrupo = (location.pathname.match(/groups\/([^\/?]+)/) || [])[1] || null;
    let idGrupoDetectado = null;
    if (slugGrupo && /^\d+$/.test(slugGrupo)) idGrupoDetectado = slugGrupo;
    if (!idGrupoDetectado) {
      idGrupoDetectado = pegarPrimeiro(
        document.documentElement.innerHTML,
        /"groupID":"?(\d{5,})/,
        /"group_id":"?(\d{5,})/,
        /"target_group_id":"?(\d{5,})/
      );
    }

    const caminhosTexto = [], caminhosGrupo = [], caminhosIdMutacao = [];
    percorrer(variaveis, (v, k, c) => {
      if (/client_mutation_id|mutation_id/i.test(k)) caminhosIdMutacao.push(c);
      if (typeof v === "string" && /^(text|message|raw_text|comment_text)$/i.test(k) && v.length)
        caminhosTexto.push(c);
      if (/group|audience|feed_location|target_id|container_id/i.test(k) &&
          (typeof v === "string" || typeof v === "number") && String(v).length >= 4)
        caminhosGrupo.push(c);
      if (idGrupoDetectado && String(v) === idGrupoDetectado &&
          !caminhosGrupo.some(g => g.join() === c.join()))
        caminhosGrupo.push(c);
    });

    const resto = new URLSearchParams(params.toString());
    ["fb_dtsg", "jazoest", "__user", "variables", "doc_id", "fb_api_req_friendly_name", "lsd"]
      .forEach(k => resto.delete(k));

    return {
      nomeAmigavel,
      docId: params.get("doc_id"),
      params: Object.fromEntries(resto.entries()),
      variaveis,
      caminhosTexto, caminhosGrupo, caminhosIdMutacao,
      idGrupo: idGrupoDetectado,
      capturadoEm: Date.now(),
      urlPagina: location.href,
    };
  }

  function inspecionarBodyGraphql(body) {
    try {
      const params = new URLSearchParams(typeof body === "string" ? body : "");
      const nomeAmigavel = params.get("fb_api_req_friendly_name");
      if (!nomeAmigavel) return;
      if (!RE_COMPOSER.test(nomeAmigavel)) return;
      const tpl = montarTemplate(nomeAmigavel, params);
      if (!tpl) return;
      window.__SP_CAPTURADOS.push(tpl);
      if (window.__SP_CAPTURADOS.length > 10) window.__SP_CAPTURADOS.shift();
      emitir("capturado", {
        nomeAmigavel: tpl.nomeAmigavel,
        docId: tpl.docId,
        idGrupo: tpl.idGrupo,
        caminhosGrupo: tpl.caminhosGrupo.length,
        caminhosTexto: tpl.caminhosTexto.length,
        capturadoEm: tpl.capturadoEm,
        ok: tpl.caminhosTexto.length > 0 && tpl.caminhosGrupo.length > 0,
      });
    } catch {}
  }

  const _fetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const [url, opts] = args;
      const u = typeof url === "string" ? url : url?.url || "";
      const body = opts?.body || (typeof url !== "string" ? url?.body : null);
      if (u.startsWith(GRAPHQL) && body && typeof body === "string")
        inspecionarBodyGraphql(body);
    } catch {}
    return _fetch.apply(this, args);
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__spUrl = url;
    return _open.call(this, metodo, url, ...resto);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__spUrl?.startsWith(GRAPHQL) && typeof body === "string")
        inspecionarBodyGraphql(body);
    } catch {}
    return _send.call(this, body);
  };

  // ---------- resolver de grupo ----------
  async function resolverIdGrupo(bruto) {
    bruto = String(bruto || "").trim();
    const m = bruto.match(/groups\/([^\/?\s&#]+)/);
    const slug = m ? m[1] : bruto;
    if (/^\d+$/.test(slug)) return { idGrupo: slug };
    const res = await fetch(`https://www.facebook.com/groups/${encodeURIComponent(slug)}/`,
      { credentials: "same-origin" });
    const html = await res.text();
    const id = pegarPrimeiro(
      html,
      /"groupID":"?(\d{5,})/,
      /"group_id":"?(\d{5,})/,
      /facebook\.com\/groups\/(\d{5,})/,
      /"entity_id":"?(\d{5,})"[^}]{0,120}"entity_type":"?GROUP/i
    );
    if (!id) throw new Error(`não achei o ID do grupo: ${slug}`);
    return { idGrupo: id };
  }

  // ---------- replay ----------
  function montarCorpoReplay(tpl, { idGrupo, texto }) {
    const vars = JSON.parse(JSON.stringify(tpl.variaveis));
    for (const c of tpl.caminhosIdMutacao)
      definirEm(vars, c, String(Math.floor(Math.random() * 1e9)));
    for (const c of tpl.caminhosTexto) {
      const original = valorEm(tpl.variaveis, c);
      definirEm(vars, c, typeof original === "string" ? texto : String(texto));
    }
    for (const c of tpl.caminhosGrupo) {
      const original = valorEm(tpl.variaveis, c);
      definirEm(vars, c, typeof original === "number" ? Number(idGrupo) : String(idGrupo));
    }

    const t = tokensDaPagina();
    if (!t.dtsg) throw new Error("fb_dtsg não encontrado — recarregue a página do Facebook");

    const corpo = new URLSearchParams();
    for (const [k, v] of Object.entries(tpl.params)) corpo.set(k, v);
    if (t.lsd) corpo.set("lsd", t.lsd);
    if (t.spin_r) corpo.set("__spin_r", t.spin_r);
    if (t.spin_b) corpo.set("__spin_b", t.spin_b);
    if (t.spin_t) corpo.set("__spin_t", t.spin_t);
    if (t.rev) corpo.set("__rev", t.rev);
    if (t.hsi) corpo.set("__hsi", t.hsi);
    corpo.set("fb_dtsg", t.dtsg);
    corpo.set("jazoest", t.jazoest);
    corpo.set("__a", "1");
    if (t.uid) corpo.set("__user", t.uid);
    corpo.set("fb_api_caller_class", tpl.params.fb_api_caller_class || "RelayModern");
    corpo.set("fb_api_req_friendly_name", tpl.nomeAmigavel);
    corpo.set("variables", JSON.stringify(vars));
    corpo.set("doc_id", tpl.docId);
    return corpo;
  }

  function classificarResposta(statusHttp, bruto) {
    const texto = bruto.trim();
    if (!texto || texto[0] === "<")
      return { resultado: "bloqueado", erro: `resposta não-JSON (checkpoint/WAF), http ${statusHttp}` };
    let j;
    try { j = JSON.parse(texto.split("\n")[0]); }
    catch { return { resultado: "bloqueado", erro: `resposta inválida, http ${statusHttp}` }; }

    const erro = (Array.isArray(j.errors) ? j.errors : j.error ? [j.error] : [])[0];
    if (erro) {
      const codigo = erro.code ?? erro.api_error_code;
      const msg = erro.summary || erro.message || "erro GraphQL";
      if (CODIGOS_BLOQUEIO.has(codigo))
        return { resultado: "bloqueado", erro: `${msg} (código ${codigo})` };
      if (erro.requires_reauth || erro.severity === "CRITICAL")
        return { resultado: "bloqueado", erro: `${msg} (reauth/crítico)` };
      return { resultado: "erro", erro: `${msg} (código ${codigo ?? "?"})` };
    }
    if (/PENDING|AWAITING|REVIEW/i.test(texto.slice(0, 4000)))
      return { resultado: "ok", situacao: "pendente" };
    return { resultado: "ok", situacao: "publicado" };
  }

  async function postarNoGrupo(dados) {
    const tpl = window.__SP_CAPTURADOS
      .filter(t => t.caminhosTexto.length && t.caminhosGrupo.length)
      .sort((a, b) => b.capturadoEm - a.capturadoEm)[0];
    if (!tpl)
      return { resultado: "erro", erro: "sem calibração — poste manualmente num grupo primeiro" };
    let corpo;
    try { corpo = montarCorpoReplay(tpl, dados); }
    catch (e) { return { resultado: "erro", erro: e.message }; }

    try {
      const res = await fetch(GRAPHQL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: corpo.toString(),
      });
      const bruto = await res.text();
      return classificarResposta(res.status, bruto);
    } catch (e) {
      return { resultado: "erro", erro: e.message || "fetch falhou" };
    }
  }

  // ---------- ponte de mensagens ----------
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.fonte !== MARCA || d.direcao !== "entrada") return;
    const { id, acao, dados } = d;
    (async () => {
      try {
        if (acao === "postar") emitir("resposta", { id, resultado: await postarNoGrupo(dados) });
        else if (acao === "resolver") emitir("resposta", { id, resultado: await resolverIdGrupo(dados.bruto) });
        else if (acao === "ping") emitir("resposta", { id, resultado: { ok: true, capturados: window.__SP_CAPTURADOS.length } });
        else emitir("resposta", { id, resultado: { resultado: "erro", erro: "ação desconhecida" } });
      } catch (e) {
        emitir("resposta", { id, resultado: { resultado: "erro", erro: e.message } });
      }
    })();
  });
})();
