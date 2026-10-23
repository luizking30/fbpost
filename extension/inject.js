(() => {
  "use strict";
  if (window.__fbAutoPostCarregado) return;
  window.__fbAutoPostCarregado = true;

  const MARCA = "fb-autopost";
  const GRAPHQL = "https://www.facebook.com/api/graphql/";
  const CODIGOS_BLOQUEIO = new Set([368, 1357004, 1404006, 1404102, 1390008]);
  const ID_REACAO_LIKE = "1635855486666999";

  const RE = {
    marketplace: /(marketplace|commerce|sale)[a-z]*composer[a-z]*(create|publish|story)/i,
    composer: /composer/i,
    cria: /create|publish|story/i,
    feedGrupo: /Group.*Feed|Feed.*Pagination|GroupsCometFeedRegular|CometGroupDiscussion|Timeline.*Group/i,
    pular: /Query|Tooltip|List|Renderer|Preview/i,
    like: /(FeedbackReact|UFI.*React|Reaction).*Mutation|ReactMutation/i,
    comentario: /CreateComment|Comment.*Create/i,
    entrar: /Group.*Join|Join.*Group|GroupsCometJoin|CometJoinGroup|GroupMembershipJoin/i,
    busca: /Search.*Results?|SearchCometResults|Groups?.*Search|GroupsCometSearch/i,
    typeahead: /Typeahead|Suggestion|Recent|Entity|Keyword/i,
    amigo: /FriendingComet.*(AddFriend|Send)|AddFriend|FriendRequest.*Send|SendFriendRequest/i,
    membros: /Group.*Member|Member.*(List|Pagination)|GroupsCometMembers|things_in_common/i,
    memberQ: /Members(Admins|Experts|Contributors|NearYou)?/i,
    // pipeline de vídeo e marketplace (portado do Pulso)
    videoStart: /video\/upload\/requests\/start/i,
    videoReceive: /video\/upload\/requests\/receive/i,
    rupload: /rupload[^/]*\.facebook\.com|\/fb_video\//i,
    bnzai: /\/ajax\/bnzai/i,
  };
  const ID_MARKETPLACE = "214423095669777";

  const RE_JA_AMIGO = /already_friends|already sent|j[áa] (enviou|s[ãa]o amigos)|friend_request_already|ARE_FRIENDS|"text":"Amigos"/i;
  const RE_ENVIADO = /request_sent|outgoing|pending|aguardando|enviada|CONFIRM|can_cancel_friend_request/i;

  const RE_BLOQUEIO_TEXTO =
    /you're temporarily blocked|voc[êe] est[áa] temporariamente|limitamos a frequ[êe]ncia|est[áa] bloqueado temporariamente|try again later|tente novamente mais tarde/i;
  const RE_PENDENTE =
    /pending_review|awaiting_approval|will be reviewed|ser[áa] analisad|aguardando aprova|once approved|is_pending":true|needs_admin_approval/i;
  const RE_PERGUNTAS = /membership_questions|requires_questions|answer.*question/i;
  const RE_JA_MEMBRO = /already.*member|j[áa].*membro|ALREADY_MEMBER/i;
  const RE_IDEMPOTENTE =
    /(idempotence|session_id|tracking|client_mutation_id|nonce|story_attachment_idempotence)/i;

  window.__SP_CAPTURAS = window.__SP_CAPTURAS || {};
  window.__fbPostando = false;

  const emitir = (tipo, dados) =>
    window.postMessage({ fonte: MARCA, direcao: "saida", tipo, dados }, location.origin);

  const novoUuid = () =>
    (crypto.randomUUID?.() ??
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (16 * Math.random()) | 0;
        return ("x" === c ? r : (3 & r) | 8).toString(16);
      }));

  const uidAtual = () => document.cookie.match(/c_user=(\d+)/)?.[1] || null;

  const pegarPrimeiro = (texto, ...regexes) => {
    for (const r of regexes) {
      const m = texto.match(r);
      if (m) return m[1];
    }
    return null;
  };

  // ---------- tokens ----------
  const dtsgDaPagina = () => {
    try {
      const req = window.require;
      if (typeof req === "function") {
        const d = req("DTSGInitialData");
        if (d?.token) return d.token;
      }
    } catch {}
    const input = document.querySelector('input[name="fb_dtsg"]');
    if (input?.value) return input.value;
    const html = document.documentElement.innerHTML;
    return (
      pegarPrimeiro(
        html,
        /"DTSGInitialData"[^}]*?"token":"([^"]+)"/,
        /"dtsg":\{"token":"([^"]+)"/,
        /name="fb_dtsg" value="([^"]+)"/
      ) || ""
    );
  };

  const jazoestDe = (dtsg) => {
    let s = 0;
    for (let i = 0; i < dtsg.length; i++) s += dtsg.charCodeAt(i);
    return "2" + s;
  };

  // ---------- conjunto completo de tokens (portado: at/lt) ----------
  const tokensDaPagina = () => {
    const dtsg = dtsgDaPagina();
    let lsd = "", spinR = "", spinB = "", spinT = "", rev = "", hsi = "";
    try {
      const req = window.require;
      if (typeof req === "function") {
        const l = req("LSD");
        if (l?.token) lsd = l.token;
        const sd = req("SiteData");
        if (sd) {
          spinR = String(sd.__spin_r ?? sd.server_revision ?? "") || spinR;
          spinB = String(sd.__spin_b ?? sd.haste_session ?? "") || spinB;
          spinT = String(sd.__spin_t ?? "") || spinT;
          rev = String(sd.client_revision ?? "") || rev;
          hsi = String(sd.hsi ?? "") || hsi;
        }
      }
    } catch {}
    const html = document.documentElement.innerHTML;
    const m = (re) => html.match(re)?.[1] ?? "";
    if (!lsd) lsd = m(/\["LSD",\[\],\{"token":"([^"]+)"/) || m(/name="lsd" value="([^"]+)"/);
    if (!spinR) spinR = m(/"__spin_r":(\d+)/);
    if (!spinB) spinB = m(/"__spin_b":"?([^",}]+)"?/);
    if (!spinT) spinT = m(/"__spin_t":(\d+)/);
    if (!rev) rev = m(/"client_revision":(\d+)/) || spinR;
    if (!hsi) hsi = m(/"hsi":"([^"]+)"/);
    return { dtsg, lsd, spinR, spinB, spinT, rev, hsi };
  };

  // substituição embutida com fronteira de dígito (evita corromper ids)
  const trocarEmbutido = (texto, de, para) =>
    de && para && texto.includes(de)
      ? texto.replace(new RegExp(`(?<!\\d)${de}(?!\\d)`, "g"), para)
      : texto;

  // renova um param capturado com valor fresco da página
  const renovarParam = (nome, valor, tokens, uid, sampleUid) => {
    switch (nome) {
      case "fb_dtsg": return tokens.dtsg || valor;
      case "jazoest": return tokens.dtsg ? jazoestDe(tokens.dtsg) : valor;
      case "__user": return uid || valor;
      case "lsd": return tokens.lsd || valor;
      case "__spin_r": return tokens.spinR || valor;
      case "__spin_b": return tokens.spinB || valor;
      case "__spin_t": return tokens.spinT || valor;
      case "__rev": return tokens.rev || valor;
      case "__hsi": return tokens.hsi || valor;
    }
    if (RE_IDEMPOTENTE.test(nome)) return novoUuid();
    return sampleUid && uid ? trocarEmbutido(valor, sampleUid, uid) : valor;
  };

  // ---------- extratores de variables ----------
  const acharIdGrupo = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/^(group_?id|groupID)$/i.test(k) && /^\d{6,}$/.test(String(v)))
        return String(v);
      if ("audience" === k && v && typeof v === "object") {
        const id = v.to_id;
        if (id && /^\d{6,}$/.test(String(id))) return String(id);
      }
      if (/group/i.test(k) && v && typeof v === "object") {
        const id = v.id;
        if (id && /^\d{6,}$/.test(String(id))) return String(id);
      }
      if (v && typeof v === "object") {
        const r = acharIdGrupo(v);
        if (r) return r;
      }
    }
    return "";
  };

  const acharFeedbackId = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/^(feedback_?id|feedbackTargetID)$/i.test(k) && String(v).length >= 6)
        return String(v);
      if (/feedback/i.test(k) && v && typeof v === "object") {
        const id = v.id;
        if (id && String(id).length >= 6) return String(id);
      }
      if (v && typeof v === "object") {
        const r = acharFeedbackId(v);
        if (r) return r;
      }
    }
    return "";
  };

  const acharReacaoId = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/^feedback_?reaction_?id$/i.test(k)) return String(v);
      if (v && typeof v === "object") {
        const r = acharReacaoId(v);
        if (r) return r;
      }
    }
    return "";
  };

  const acharTextoMsg = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const msg = obj.message;
    if (msg && typeof msg === "object" && typeof msg.text === "string")
      return msg.text;
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        const r = acharTextoMsg(v);
        if (r !== undefined) return r;
      }
    }
  };

  const definirTextoMsg = (obj, texto) => {
    if (!obj || typeof obj !== "object") return false;
    const msg = obj.message;
    if (msg && typeof msg === "object" && typeof msg.text === "string")
      return ((msg.text = texto), true);
    for (const v of Object.values(obj))
      if (v && typeof v === "object" && definirTextoMsg(v, texto)) return true;
    return false;
  };

  const definirTextoComposto = (obj, texto) => {
    if (!obj || typeof obj !== "object") return false;
    const ct = obj.composed_text;
    if (ct && typeof ct === "object" && Array.isArray(ct.blocks)) {
      const linhas = texto.split("\n");
      Object.assign(ct, {
        blocks: linhas,
        block_data: linhas.map(() => "{}"),
        block_depths: linhas.map(() => 0),
        block_types: linhas.map(() => 0),
        entities: linhas.map(() => "[]"),
        inline_styles: linhas.map(() => "[]"),
        entity_map: "{}",
      });
      return true;
    }
    for (const v of Object.values(obj))
      if (v && typeof v === "object" && definirTextoComposto(v, texto)) return true;
    return false;
  };

  const acharIdMidia = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/(photo|attachment|media)_?id/i.test(k) && /^\d{6,}$/.test(String(v)))
        return String(v);
      if (/(photo|attachment|media)/i.test(k)) {
        if (Array.isArray(v))
          for (const item of v) {
            if (/^\d{6,}$/.test(String(item))) return String(item);
            const r = acharIdMidia(item);
            if (r) return r;
          }
        else if (v && typeof v === "object") {
          const id = v.id ?? v.fbid;
          if (id && /^\d{6,}$/.test(String(id))) return String(id);
          const r = acharIdMidia(v);
          if (r) return r;
        }
      } else if (v && typeof v === "object") {
        const r = acharIdMidia(v);
        if (r) return r;
      }
    }
    return "";
  };

  const acharQuery = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj))
      if (/^(text|query|q|search_?text)$/i.test(k) && typeof v === "string" && v.trim())
        return v;
    for (const v of Object.values(obj))
      if (v && typeof v === "object") {
        const r = acharQuery(v);
        if (r) return r;
      }
    return "";
  };

  // id de vídeo nos variables (portado: E)
  const acharIdVideo = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/video/i.test(k)) {
        if (/^\d{6,}$/.test(String(v))) return String(v);
        if (v && typeof v === "object") {
          const id = v.id ?? v.video_id;
          if (id && /^\d{6,}$/.test(String(id))) return String(id);
        }
      }
      if (v && typeof v === "object") {
        const r = acharIdVideo(v);
        if (r) return r;
      }
    }
    return "";
  };

  // todos os photo.id dos variables (portado: z)
  const acharIdsFotos = (obj, acc = []) => {
    if (!obj || typeof obj !== "object") return acc;
    for (const [k, v] of Object.entries(obj)) {
      if (/^photo$/i.test(k) && v && typeof v === "object") {
        const id = v.id;
        if (id && /^\d{6,}$/.test(String(id)) && !acc.includes(String(id)))
          acc.push(String(id));
      }
      if (v && typeof v === "object") acharIdsFotos(v, acc);
    }
    return acc;
  };

  // nó product_item de listing do Marketplace (portado: L)
  const acharProductItem = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    for (const [k, v] of Object.entries(obj)) {
      if (/product_item/i.test(k) && v && typeof v === "object" && !Array.isArray(v))
        return v;
      if (v && typeof v === "object") {
        const r = acharProductItem(v);
        if (r) return r;
      }
    }
    return null;
  };

  // to_id do audience (marketplace/grupo alvo do listing)
  const acharToId = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/^to_id$/i.test(k) && /^\d{6,}$/.test(String(v))) return String(v);
      if (v && typeof v === "object") {
        const r = acharToId(v);
        if (r) return r;
      }
    }
    return "";
  };

  const acharIdAmigo = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (/^(friend_requestee_ids?|requestee_id|friending_channel_requestee|friend_request_ids?|user_id|profile_id|target_id|friendRequesteeID)$/i.test(k)) {
        if (Array.isArray(v) && v.length && /^\d{5,}$/.test(String(v[0])))
          return String(v[0]);
        if (/^\d{5,}$/.test(String(v))) return String(v);
      }
      if (v && typeof v === "object") {
        const r = acharIdAmigo(v);
        if (r) return r;
      }
    }
    return "";
  };

  const acharIdAutor = (obj, prof = 0) => {
    if (!obj || typeof obj !== "object" || prof > 6) return;
    for (const [k, v] of Object.entries(obj)) {
      if (/^(actor|owner|author|owning_profile)$/i.test(k) && v && typeof v === "object") {
        const id = v.id;
        if (id && /^\d{4,}$/.test(String(id))) return String(id);
      }
    }
    for (const v of Object.values(obj))
      if (v && typeof v === "object") {
        const r = acharIdAutor(v, prof + 1);
        if (r) return r;
      }
  };

  // ---------- transformadores de variables ----------
  const substituirProfundo = (vars, de, para) => {
    if (Array.isArray(vars)) return vars.map((v) => substituirProfundo(v, de, para));
    if (vars && typeof vars === "object") {
      const r = {};
      for (const [k, v] of Object.entries(vars))
        r[k] =
          typeof v === "string" && RE_IDEMPOTENTE.test(k) && !/composer_session/i.test(k)
            ? novoUuid()
            : substituirProfundo(v, de, para);
      return r;
    }
    if (typeof vars === "string") return de && vars === de ? para : vars;
    if (typeof vars === "number" && de && String(vars) === de && /^\d+$/.test(para))
      return Number(para);
    return vars;
  };

  const substituirEmbutido = (vars, de, para) =>
    JSON.parse(JSON.stringify(vars).split(de).join(para));

  const renovarSessaoComposer = (vars) => {
    if (Array.isArray(vars)) return vars.map(renovarSessaoComposer);
    if (vars && typeof vars === "object") {
      const r = {};
      for (const [k, v] of Object.entries(vars))
        r[k] = typeof v === "string" && /composer_session/i.test(k) ? novoUuid() : renovarSessaoComposer(v);
      return r;
    }
    return vars;
  };

  const definirCursor = (vars, cursor) => {
    if (Array.isArray(vars)) return vars.map((v) => definirCursor(v, cursor));
    if (vars && typeof vars === "object") {
      const r = {};
      for (const [k, v] of Object.entries(vars))
        r[k] = /^(cursor|after)$/i.test(k) ? cursor : definirCursor(v, cursor);
      return r;
    }
    return vars;
  };

  const corrigirReacaoLike = (vars) => {
    if (Array.isArray(vars)) return vars.map(corrigirReacaoLike);
    if (vars && typeof vars === "object") {
      const r = {};
      for (const [k, v] of Object.entries(vars))
        r[k] =
          /^feedback_?reaction_?id$/i.test(k) && "0" === String(v)
            ? ID_REACAO_LIKE
            : corrigirReacaoLike(v);
      return r;
    }
    return vars;
  };

  // ---------- montador de requisição (replay) ----------
  const montarRequisicao = (cal, { trocas = [], cursor, variaveisBase, texto }) => {
    const tokens = tokensDaPagina();
    const dtsg = tokens.dtsg;
    if (!dtsg) throw new Error("fb_dtsg não encontrado — recarregue a página do Facebook");
    const uid = uidAtual();

    let vars = JSON.parse(JSON.stringify(variaveisBase ?? cal.variaveis));
    if (cal.sampleUid && uid && cal.sampleUid !== uid)
      vars = substituirProfundo(vars, cal.sampleUid, uid);
    for (const t of trocas) {
      if (!t.de || !t.para || t.de === t.para) continue;
      vars = t.embutido
        ? substituirEmbutido(vars, String(t.de), String(t.para))
        : substituirProfundo(vars, String(t.de), String(t.para));
    }
    let textoDefinido = false;
    if (texto != null) {
      textoDefinido = definirTextoMsg(vars, texto) || definirTextoComposto(vars, texto);
    }
    if (cursor !== undefined) vars = definirCursor(vars, cursor);
    vars = renovarSessaoComposer(vars);

    // remove chaves internas do Relay (proveedores de dados do FB)
    vars = JSON.parse(
      JSON.stringify(vars).replace(
        /"__relay_internal__pv__[^"]*":(?:false|true|\d+|"[^"]*"),?/g,
        (m) => (m.endsWith(",") ? "" : m)
      )
    );

    // calibração podre: o texto da amostra não foi substituído em lugar nenhum
    if (texto != null && cal.sampleText && !textoDefinido) {
      const amostra = JSON.stringify(cal.sampleText).slice(1, -1);
      if (!JSON.stringify(vars).includes(amostra))
        throw new Error("calibracao_divergente — molde não aceita texto; recalibre postando manualmente");
    }

    const corpo = new URLSearchParams();
    for (const [k, v] of Object.entries(cal.params)) {
      if (["fb_dtsg", "jazoest", "__user", "variables", "doc_id", "fb_api_req_friendly_name"].includes(k))
        continue;
      corpo.set(k, renovarParam(k, v, tokens, uid, cal.sampleUid));
    }
    corpo.set("fb_dtsg", dtsg);
    corpo.set("jazoest", jazoestDe(dtsg));
    corpo.set("__a", "1");
    if (uid) corpo.set("__user", uid);
    corpo.set("fb_api_caller_class", cal.params.fb_api_caller_class || "RelayModern");
    corpo.set("fb_api_req_friendly_name", cal.nomeAmigavel);
    corpo.set("variables", JSON.stringify(vars));
    corpo.set("doc_id", cal.docId);
    return corpo;
  };

  const executarGraphql = async (corpo) => {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo.toString(),
    });
    // sessão morreu no meio da automação (redirect p/ login/checkpoint)
    if (/\/(login|checkpoint)\b/.test(res.url || ""))
      emitir("sessaoInvalidada", { motivo: "redirect_login" });
    return { status: res.status, texto: await res.text() };
  };

  // ---------- classificador de resposta ----------
  const linhasJson = (bruto) => {
    const saida = [];
    for (const l of bruto.split("\n")) {
      const t = l.trim();
      if (!t || "<" === t[0]) continue;
      try { saida.push(JSON.parse(t)); } catch {}
    }
    return saida;
  };

  const classificarResposta = (status, bruto) => {
    const t = bruto.trim();
    if (!t || "<" === t[0])
      return { resultado: "bloqueado", erro: `resposta não-JSON (checkpoint/WAF), http ${status}` };
    const objs = linhasJson(bruto);
    if (!objs.length)
      return { resultado: "bloqueado", erro: `resposta inválida, http ${status}` };

    const erro = objs
      .flatMap((o) => (Array.isArray(o.errors) ? o.errors : o.error ? [o.error] : []))
      .filter(Boolean)[0];
    if (erro) {
      const codigo = erro.code ?? erro.api_error_code;
      const msg = erro.summary || erro.message || "erro GraphQL";
      if (CODIGOS_BLOQUEIO.has(codigo) || erro.requires_reauth || erro.severity === "CRITICAL")
        return { resultado: "bloqueado", erro: `${msg} (código ${codigo ?? "?"})` };
      return { resultado: "erro", erro: `${msg} (código ${codigo ?? "?"})` };
    }
    if (RE_BLOQUEIO_TEXTO.test(bruto))
      return { resultado: "bloqueado", erro: "texto de bloqueio detectado" };
    const pendente =
      /"__typename":"(?:GroupPendingStory|GroupPendingPost|PendingParticipationPost)"/.test(bruto) ||
      /"(?:pending_state|approval_status|moderation_state)":"?(?:PENDING|AWAITING[A-Z_]*|UNAPPROVED)"?/i.test(bruto) ||
      /"if_viewer_can_learn_more_about_pending_post":\s*(?!null|false)\S/.test(bruto) ||
      RE_PENDENTE.test(bruto);
    if (pendente) {
      const postId = acharPostId(objs);
      return { resultado: "ok", situacao: "pendente", postId };
    }
    const postId = acharPostId(objs);
    return { resultado: "ok", situacao: "publicado", postId };
  };

  const acharPostId = (objs) => {
    for (const o of objs) {
      const s = JSON.stringify(o);
      const id = pegarPrimeiro(
        s,
        /"post_id":"?(\d{6,})/,
        /"legacy_story_hideable_id":"?(\d{6,})/,
        /"story":{"id":"(\d{6,})/,
        /"creation_story":[^}]*"id":"(\d{6,})/
      );
      if (id) return id;
    }
  };

  // ---------- captura ----------
  const registrarCaptura = (tipo, cal) => {
    window.__SP_CAPTURAS[tipo] = cal;
    emitir("capturado", {
      tipo,
      nomeAmigavel: cal.nomeAmigavel,
      docId: cal.docId,
      capturadoEm: cal.capturadoEm,
    });
  };

  let uploadFotoCapturado = null;   // {url, metodo, campos, campoArquivo}
  let videoInicio = null;           // {url, metodo, campos} — /video/upload/requests/start
  let videoUpload = null;           // {url, metodo, headers} — rupload binário
  let videoFim = null;              // {url, metodo, campos} — /video/upload/requests/receive
  let respostaInicioVideo = "";     // amostra da resposta do start

  const paramsDeBody = (body) => {
    const saida = {};
    if (typeof body === "string") new URLSearchParams(body).forEach((v, k) => (saida[k] = v));
    else if (body instanceof URLSearchParams) body.forEach((v, k) => (saida[k] = v));
    else if (body instanceof FormData)
      body.forEach((v, k) => { if (typeof v === "string") saida[k] = v; });
    else return null;
    return saida;
  };

  const capturarUpload = (url, metodo, formData) => {
    const campos = {};
    let campoArquivo = null, tipoArquivo = "";
    formData.forEach((v, k) => {
      if (typeof v === "string") campos[k] = v;
      else { campoArquivo = k; tipoArquivo = `${v.type || ""} ${v.name || ""} ${v.size ?? ""}`; }
    });
    if (campoArquivo && (/image\//i.test(tipoArquivo) || /\.(jpe?g|png|gif|webp)\b/i.test(tipoArquivo)))
      uploadFotoCapturado = { url, metodo: metodo || "POST", campos, campoArquivo };
  };

  const ehBinario = (body) =>
    body instanceof ArrayBuffer || ArrayBuffer.isView(body) ||
    ("undefined" != typeof Blob && body instanceof Blob);

  // estágios do upload de vídeo (portado do sniffer deles)
  const capturarFluxoVideo = (url, metodo, headers, body) => {
    if (RE.rupload.test(url) && ehBinario(body)) {
      videoUpload = { url, metodo: metodo || "POST", headers };
      return true;
    }
    if (RE.videoStart.test(url) && !ehBinario(body)) {
      const campos = paramsDeBody(body);
      if (campos) videoInicio = { url, metodo: metodo || "POST", campos };
      return true;
    }
    if (RE.videoReceive.test(url) && !ehBinario(body)) {
      const campos = paramsDeBody(body);
      if (campos) videoFim = { url, metodo: metodo || "POST", campos };
      return true;
    }
    return false;
  };

  // resposta do video start (amostra p/ reconhecer session_id/upload_url)
  const guardarRespostaVideo = (url, texto) => {
    if (window.__fbPostando) return;
    if (RE.videoStart.test(url)) respostaInicioVideo = texto.slice(0, 4000);
  };

  // campo do FB pode ser string, número ou {text: "..."} (portado: F)
  const textoDoCampo = (v) =>
    ("string" == typeof v || "number" == typeof v)
      ? String(v)
      : v && typeof v === "object" && "string" == typeof v.text
        ? v.text
        : "";

  const idGrupoDaUrl = () =>
    location.pathname.match(/\/groups\/(\d+)/)?.[1] ?? "";

  const inspecionarGraphql = (params) => {
    if (window.__fbPostando) return;
    const nome = params.get("fb_api_req_friendly_name") || "";
    const docId = params.get("doc_id");
    const varsRaw = params.get("variables");
    if (!docId || !varsRaw || !nome) return;
    let vars;
    try { vars = JSON.parse(varsRaw); } catch { return; }

    const paramsLimpos = Object.fromEntries(params.entries());
    ["fb_dtsg", "jazoest", "variables", "__user"].forEach((k) => delete paramsLimpos[k]);

    const base = {
      nomeAmigavel: nome,
      docId,
      params: paramsLimpos,
      variaveis: vars,
      sampleUid: uidAtual(),
      capturadoEm: Date.now(),
    };

    try {
      // listing do Marketplace (portado: __spListingCal)
      if (RE.marketplace.test(nome)) {
        const item = acharProductItem(vars);
        if (!item) return;
        const alvo = acharToId(vars) || acharIdGrupo(vars) || idGrupoDaUrl();
        if (!alvo) return;
        const xpost = Array.isArray(item.xpost_target_ids)
          ? item.xpost_target_ids.map(String).filter((x) => /^\d{6,}$/.test(x))
          : [];
        registrarCaptura("listing", {
          ...base,
          sampleGroupId: alvo,
          sampleTitulo: textoDoCampo(item.title),
          sampleDescricao: textoDoCampo(item.description),
          samplePreco: textoDoCampo(item.item_price?.price),
          sampleMoeda: textoDoCampo(item.item_price?.currency),
          samplePhotoIds: acharIdsFotos(vars),
          sampleXpostIds: xpost,
          vaiMarketplace: xpost.includes(ID_MARKETPLACE),
          upload: uploadFotoCapturado ?? undefined,
        });
        return;
      }

      // post em grupo (texto / foto / vídeo / misto)
      if (
        RE.composer.test(nome) && RE.cria.test(nome) && !RE.marketplace.test(nome)
      ) {
        const gid = acharIdGrupo(vars) || idGrupoDaUrl();
        const texto = acharTextoMsg(vars);
        const idMidia = acharIdMidia(vars);
        const idVideo = acharIdVideo(vars);
        if (!gid || (!texto && !idMidia && !idVideo)) return;
        const cal = { ...base, sampleGroupId: gid, sampleText: texto };
        // foto+vídeo juntos (portado: __spMixedCal)
        if (idVideo && videoUpload && idMidia && uploadFotoCapturado) {
          registrarCaptura("postMisto", {
            composer: { ...cal, samplePhotoId: idMidia, sampleVideoId: idVideo },
            photoUpload: uploadFotoCapturado,
            videoUpload: {
              startUrl: videoInicio?.url, startMetodo: videoInicio?.metodo,
              startCampos: videoInicio?.campos,
              uploadUrl: videoUpload.url, uploadMetodo: videoUpload.metodo,
              uploadHeaders: videoUpload.headers,
              receiveUrl: videoFim?.url, receiveMetodo: videoFim?.metodo,
              receiveCampos: videoFim?.campos,
              startRespostaAmostra: respostaInicioVideo || undefined,
              sampleVideoId: idVideo,
            },
            capturadoEm: Date.now(),
          });
          return;
        }
        // só vídeo (portado: __spVideoCal)
        if (idVideo && videoUpload) {
          registrarCaptura("postVideo", {
            composer: { ...cal, sampleVideoId: idVideo },
            upload: {
              startUrl: videoInicio?.url, startMetodo: videoInicio?.metodo,
              startCampos: videoInicio?.campos,
              uploadUrl: videoUpload.url, uploadMetodo: videoUpload.metodo,
              uploadHeaders: videoUpload.headers,
              receiveUrl: videoFim?.url, receiveMetodo: videoFim?.metodo,
              receiveCampos: videoFim?.campos,
              startRespostaAmostra: respostaInicioVideo || undefined,
              sampleVideoId: idVideo,
            },
            capturadoEm: Date.now(),
          });
          return;
        }
        if (idMidia && uploadFotoCapturado) {
          registrarCaptura("postFoto", {
            composer: { ...cal, samplePhotoId: idMidia },
            upload: uploadFotoCapturado,
            capturadoEm: Date.now(),
          });
          return;
        }
        registrarCaptura("post", cal);
        return;
      }

      // feed do grupo
      if (RE.feedGrupo.test(nome)) {
        const gid = acharIdGrupo(vars);
        if (gid) registrarCaptura("feed", { ...base, sampleGroupId: gid });
        return;
      }

      // comentário
      if (RE.comentario.test(nome) && !RE.pular.test(nome)) {
        const fid = acharFeedbackId(vars);
        if (!fid) return;
        const texto = acharTextoMsg(vars);
        const idMidia = acharIdMidia(vars);
        if (idMidia && uploadFotoCapturado) {
          registrarCaptura("comentarioFoto", {
            ...base,
            sampleFeedbackId: fid,
            sampleText: texto,
            samplePhotoId: idMidia,
            upload: uploadFotoCapturado,
          });
          return;
        }
        if (texto)
          registrarCaptura("comentario", { ...base, sampleFeedbackId: fid, sampleText: texto });
        return;
      }

      // curtida
      if (RE.like.test(nome) && !RE.pular.test(nome)) {
        const fid = acharFeedbackId(vars);
        if (!fid) return;
        const reacao = acharReacaoId(vars);
        if ("0" === reacao) return;
        registrarCaptura("like", { ...base, sampleFeedbackId: fid, sampleReacaoId: reacao });
        return;
      }

      // entrar em grupo
      if (RE.entrar.test(nome) && !RE.typeahead.test(nome)) {
        const gid = acharIdGrupo(vars);
        if (gid) registrarCaptura("entrar", { ...base, sampleGroupId: gid });
        return;
      }

      // busca de grupos
      if (RE.busca.test(nome) && !RE.typeahead.test(nome)) {
        const callsite = vars?.args?.callsite ?? "";
        const query = acharQuery(vars) ||
          new URL(location.href).searchParams.get("q") || "";
        if (!/groups_search|groups/i.test(callsite) && !query) return;
        if (!query) return;
        registrarCaptura("busca", { ...base, sampleQuery: query });
        return;
      }

      // pedido de amizade
      if (RE.amigo.test(nome)) {
        registrarCaptura("amigo", { ...base, sampleUserId: acharIdAmigo(vars) });
        return;
      }

      // lista de membros de grupo (por tipo de rota)
      if (RE.membros.test(nome)) {
        const gid = acharIdGrupo(vars);
        if (gid) {
          const rota = location.pathname.match(
            /\/members\/(admins|experts|contributors|near_you)/
          )?.[1];
          registrarCaptura(rota ? `membros_${rota}` : "membros",
            { ...base, sampleGroupId: gid });
        }
        return;
      }
    } catch {}
  };

  // rota Comet atual (param __crn da URL da req) — usada p/ membros por tipo
  let rotaAtual = "";
  const emRotaMembros = () =>
    /\/groups\/\d+\/members\/(admins|experts|contributors|near_you)/.test(location.pathname) ||
    /Members(Admins|Experts|Contributors|NearYou)?Route/i.test(rotaAtual);

  // minera pares friendlyName/doc_id de um texto e registra (portado: ge/we)
  const minerarPares = (texto) => {
    window.__SP_DOCIDS = window.__SP_DOCIDS || new Map();
    const mapa = window.__SP_DOCIDS;
    const pares = [];
    let m;
    const r1 = /"fb_api_req_friendly_name"\s*:\s*"([^"]+)"[\s\S]{0,1200}?"doc_id"\s*:\s*"?(\d{8,})"?/g;
    for (; (m = r1.exec(texto)); ) pares.push([m[1], m[2]]);
    const r2 = /"doc_id"\s*:\s*"?(\d{8,})"?[\s\S]{0,1200}?"fb_api_req_friendly_name"\s*:\s*"([^"]+)"/g;
    for (; (m = r2.exec(texto)); ) pares.push([m[2], m[1]]);
    const gid = idGrupoDaUrl();
    for (const [nome2, docId] of pares) {
      mapa.set(nome2, docId);
      // queries de membros viram calibração mínima pronta p/ replay
      if (gid && RE.membros.test(nome2)) {
        const rota = location.pathname.match(
          /\/members\/(admins|experts|contributors|near_you)/
        )?.[1];
        registrarCaptura(rota ? `membros_${rota}` : "membros", {
          nomeAmigavel: nome2,
          docId,
          params: {},
          variaveis: { groupID: gid },
          sampleGroupId: gid,
          sampleUid: uidAtual(),
          capturadoEm: Date.now(),
        });
      }
    }
    return pares.length;
  };

  const minerarRespostaBnzai = (url, texto) => {
    rotaAtual = decodeURIComponent(url.match(/__crn=([^&]+)/)?.[1] ?? "");
    try {
      const limpo = String(texto || "").replace(/^\s*for\s*\(;;\)\s*;/, "");
      if (limpo.length < 20) return;
      minerarPares(limpo);
      if (emRotaMembros()) minerarDocIds();
    } finally {
      rotaAtual = "";
    }
  };

  // bnzai com FormData: blobs podem conter queries comprimidas (portado: Ae/Ce)
  const minerarBnzaiFormData = (url, formData) => {
    rotaAtual = decodeURIComponent(url.match(/__crn=([^&]+)/)?.[1] ?? "");
    try {
      const campos = {}, blobs = [];
      formData.forEach((v, k) => {
        if (typeof v === "string") campos[k] = v;
        else blobs.push(v);
      });
      if (campos.q?.includes("doc_id")) return void minerarPares(campos.q);
      for (const blob of blobs.filter((b) => b.size > 200)) {
        blob.arrayBuffer().then(async (buf) => {
          const bytes = new Uint8Array(buf);
          // tenta gzip/deflate primeiro; senão extrai strings ASCII
          if ("undefined" != typeof DecompressionStream)
            for (const fmt of ["gzip", "deflate", "deflate-raw"]) {
              try {
                const txt = await new Response(
                  new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt))
                ).text();
                if (/doc_id|fb_api_req_friendly_name/i.test(txt)) {
                  minerarPares(txt);
                  return;
                }
              } catch {}
            }
          let ascii = "", cur = "";
          for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] >= 32 && bytes[i] <= 126) cur += String.fromCharCode(bytes[i]);
            else { if (cur.length >= 8) ascii += cur + " "; cur = ""; }
            if (ascii.length > 5e5) break;
          }
          if (cur.length >= 8) ascii += cur;
          if (/doc_id|fb_api_req_friendly_name/i.test(ascii)) minerarPares(ascii);
        }).catch(() => {});
      }
      if (emRotaMembros()) minerarDocIds();
    } finally {
      rotaAtual = "";
    }
  };

  const inspecionarBody = (url, body) => {
    try {
      if (RE.bnzai.test(url)) {
        if (body instanceof FormData) minerarBnzaiFormData(url, body);
        else {
          const campos = paramsDeBody(body);
          if (campos?.q?.includes("doc_id")) minerarPares(campos.q);
        }
        return;
      }
      if (!url.includes("/api/graphql/")) return;
      let params = null;
      if (typeof body === "string" && body.includes("doc_id"))
        params = new URLSearchParams(body);
      else if (body instanceof URLSearchParams) params = body;
      else if (body instanceof FormData) {
        params = new URLSearchParams();
        body.forEach((v, k) => { if (typeof v === "string") params.set(k, v); });
        if (!params.get("doc_id")) return;
      }
      if (params) inspecionarGraphql(params);
    } catch {}
  };

  // ---------- hooks de rede ----------
  const _fetch = window.fetch;
  window.fetch = function (...args) {
    const promessa = _fetch.apply(this, args);
    try {
      const [url, opts] = args;
      const u = typeof url === "string" ? url : url?.url || "";
      const metodo = opts?.method || "POST";
      let body = opts?.body;
      const inspecionar = (b) => {
        try {
          if (u.includes("/api/graphql/") || RE.bnzai.test(u)) inspecionarBody(u, b);
          else if (!capturarFluxoVideo(u, metodo, headersDe(opts?.headers), b)) {
            if (b instanceof FormData) capturarUpload(u, metodo, b);
          }
        } catch {}
      };
      if (null == body && url instanceof Request) {
        try {
          const req = url.clone();
          const ct = (req.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("multipart/form-data") || RE.bnzai.test(u))
            req.formData().then(inspecionar).catch(() => {});
          else if (ct.includes("application/x-www-form-urlencoded") || u.includes("/api/graphql/"))
            req.text().then(inspecionar).catch(() => {});
        } catch {}
      } else inspecionar(body);

      // respostas: bnzai → minera doc_ids; video start/receive → amostra
      promessa.then((res) => {
        try {
          if (RE.bnzai.test(u))
            res.clone().text().then((t) => minerarRespostaBnzai(u, t)).catch(() => {});
          else if (RE.videoStart.test(u) || RE.videoReceive.test(u))
            res.clone().text().then((t) => guardarRespostaVideo(u, t)).catch(() => {});
        } catch {}
      }).catch(() => {});
    } catch {}
    return promessa;
  };

  const headersDe = (h) => {
    const saida = {};
    if (!h) return saida;
    if ("undefined" != typeof Headers && h instanceof Headers)
      h.forEach((v, k) => (saida[k] = v));
    else if (Array.isArray(h)) for (const [k, v] of h) saida[k] = String(v);
    else for (const [k, v] of Object.entries(h)) saida[k] = String(v);
    return saida;
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__spUrl = url;
    this.__spMetodo = metodo;
    this.__spHeaders = {};
    return _open.call(this, metodo, url, ...resto);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (nome, valor) {
    if (this.__spHeaders) this.__spHeaders[nome] = valor;
    return _setHeader.call(this, nome, valor);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      const u = this.__spUrl || "";
      if (u.includes("/api/graphql/") || RE.bnzai.test(u)) inspecionarBody(u, body);
      else if (!capturarFluxoVideo(u, this.__spMetodo, this.__spHeaders ?? {}, body)) {
        if (body instanceof FormData) capturarUpload(u, this.__spMetodo, body);
      }
      if (u && (RE.bnzai.test(u) || RE.videoStart.test(u) || RE.videoReceive.test(u)))
        this.addEventListener("load", () => {
          try {
            const t = "string" == typeof this.responseText ? this.responseText : "";
            if (RE.bnzai.test(u)) minerarRespostaBnzai(u, t);
            else guardarRespostaVideo(u, t);
          } catch {}
        });
    } catch {}
    return _send.call(this, body);
  };

  // ---------- resolver slug → id de grupo ----------
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

  // ---------- upload de foto ----------
  async function subirFoto(upload, dataUrl, extras = {}) {
    const dtsg = dtsgDaPagina();
    const uid = uidAtual();
    let url = upload.url;
    for (const [padrao, valor] of [
      [/feedback_id=[^&]*/i, `feedback_id=${encodeURIComponent(extras.feedbackId ?? "")}`],
      [/([?&])av=[^&]*/i, `$1av=${uid}`],
      [/profile_id=[^&]*/i, `profile_id=${uid}`],
      [/([?&])__user=[^&]*/i, `$1__user=${uid}`],
      [/target_id=[^&]*/i, `target_id=${uid}`],
      [/fb_dtsg=[^&]*/i, `fb_dtsg=${encodeURIComponent(dtsg)}`],
      [/jazoest=[^&]*/i, `jazoest=${jazoestDe(dtsg)}`],
    ]) url = url.replace(padrao, valor);

    const blob = await (await fetch(dataUrl)).blob();
    const ext = /png/i.test(blob.type) ? "png" : /webp/i.test(blob.type) ? "webp" : /gif/i.test(blob.type) ? "gif" : "jpg";
    const form = new FormData();
    for (const [k, v] of Object.entries(upload.campos || {})) form.append(k, v);
    form.append(upload.campoArquivo || "farr", blob, `image.${ext}`);

    const res = await fetch(url, { method: upload.metodo || "POST", credentials: "include", body: form });
    const bruto = await res.text();
    const limpo = bruto.replace(/^\s*for\s*\(;;\)\s*;/, "");
    const id = pegarPrimeiro(limpo, /"(?:photoID|photo_id|fbid|id)"\s*:\s*"?(\d{6,})/i);
    if (!id) throw new Error("upload de foto falhou (sem id)");
    return id;
  }

  // ---------- upload de vídeo (portado: mt/ht/dt) ----------
  const extVideo = (mime) =>
    /quicktime|mov/i.test(mime) ? "mov"
      : /webm/i.test(mime) ? "webm"
      : /matroska|mkv/i.test(mime) ? "mkv" : "mp4";

  const normalizarCamposVideo = (campos, tamanho, mime, chunk = "") => {
    const ext = extVideo(mime), out = {};
    for (const [k, v] of Object.entries(campos ?? {})) {
      const kl = k.toLowerCase();
      if (/^(partition_start_offset|start_offset)$/.test(kl)) out[k] = "0";
      else if (/^(file_?size|partition_end_offset|end_offset)$/.test(kl) ||
               (/file_?size|length|size/i.test(k) && /^\d+$/.test(String(v))))
        out[k] = String(tamanho);
      else if (/file_?extension/i.test(k)) out[k] = ext;
      else if (/file_chunk/i.test(k)) out[k] = chunk || v;
      else out[k] = v;
    }
    return out;
  };

  const extrairIdVideo = (texto) =>
    pegarPrimeiro(texto.replace(/^for\s*\(;;\);/, "").trim(),
      /"video_id":"?(\d{6,})"?/, /"videoID":"?(\d{6,})"?/, /"id":"?(\d{8,})"?/) ?? "";

  const extrairSessaoVideo = (texto) =>
    pegarPrimeiro(texto.replace(/^for\s*\(;;\);/, ""),
      /fb_video\\?\/([a-f0-9]{16,})/i,
      /"(?:upload_session_id|session_id|stream_id|video_file_chunk_id)":"([a-f0-9]{16,})"/i) ?? "";

  const extrairUrlUpload = (texto) => {
    const m = pegarPrimeiro(texto.replace(/^for\s*\(;;\);/, ""),
      /"(https:\\?\/\\?\/rupload[^"]*?fb_video[^"]*?)"/,
      /"(https:\\?\/\\?\/[^"]*?\/fb_video\/[^"]*?)"/,
      /"upload_url":"([^"]+)"/,
      /"endpoint":"([^"]+)"/);
    return m ? m.replace(/\\\//g, "/") : "";
  };

  async function subirVideo(videoUp, blob, composerVars, uid) {
    const tokens = tokensDaPagina();
    if (!videoUp?.startUrl || !videoUp?.uploadUrl)
      throw new Error("calibração de vídeo incompleta — poste um vídeo NOVO manualmente");
    const tamanho = blob.size, mime = blob.type || "video/mp4";
    const nome = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extVideo(mime)}`;

    // ids de sessão reaproveitados entre start/receive/headers
    const procurarSessao = (re) => {
      for (const campos of [videoUp.startCampos, videoUp.receiveCampos])
        for (const [k, v] of Object.entries(campos ?? {}))
          if (re.test(k)) return v;
      return JSON.stringify(composerVars ?? {})
        .match(new RegExp('"[a-z_]*' + re.source + '[a-z_]*":"([^"]+)"', "i"))?.[1] ?? "";
    };
    const sessoes = [];
    for (const re of [/composer_session/i, /waterfall/i]) {
      const v = procurarSessao(re);
      if (v) sessoes.push({ de: v, para: novoUuid() });
    }
    const renovarCampos = (campos) => {
      const out = {};
      for (const [k, v] of Object.entries(campos ?? {})) {
        const s = sessoes.find((x) => x.de === v);
        out[k] = s ? s.para : renovarParam(k, v, tokens, uid, videoUp.sampleUid);
      }
      return out;
    };

    // 1) start
    const camposStart = normalizarCamposVideo(
      renovarCampos(videoUp.startCampos), tamanho, mime);
    const resStart = await fetch(videoUp.startUrl, {
      method: videoUp.startMetodo || "POST", credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(camposStart).toString(),
    });
    const txtStart = await resStart.text();
    let idVideo = extrairIdVideo(txtStart);
    const sessao = extrairSessaoVideo(txtStart);
    const urlExtraida = extrairUrlUpload(txtStart);

    // 2) bytes pro rupload
    const trocaIdVideo = (s) =>
      idVideo && videoUp.sampleVideoId
        ? s.split(videoUp.sampleVideoId).join(idVideo) : s;
    let urlUpload = urlExtraida || videoUp.uploadUrl;
    if (sessao)
      urlUpload = urlUpload.replace(
        /(fb_video\/)[a-f0-9]+(?:-\d+-\d+)?/i, `$1${sessao}-0-${tamanho}`);
    urlUpload = urlUpload
      .replace(/([?&]fb_dtsg=)[^&]*/i, `$1${encodeURIComponent(tokens.dtsg)}`)
      .replace(/([?&]jazoest=)[^&]*/i, `$1${jazoestDe(tokens.dtsg)}`)
      .replace(/([?&]__user=)[^&]*/i, `$1${uid}`);
    for (const s of sessoes) urlUpload = urlUpload.split(s.de).join(s.para);

    const headers = {};
    for (const [k, v] of Object.entries(videoUp.uploadHeaders ?? {})) {
      const kl = k.toLowerCase();
      if (kl === "fb_dtsg") headers[k] = tokens.dtsg;
      else if (kl === "jazoest") headers[k] = jazoestDe(tokens.dtsg);
      else if (kl === "content-length" || kl === "offset" || kl.startsWith("x-entity")) continue;
      else if (kl === "x-total-asset-size" || kl === "end_offset") headers[k] = String(tamanho);
      else if (kl === "start_offset") headers[k] = "0";
      else if (kl === "id" && sessao) headers[k] = sessao;
      else if (/composer_session/i.test(kl)) {
        const s = sessoes.find((x) => x.de === v);
        headers[k] = s ? s.para : v;
      } else headers[k] = trocaIdVideo(v);
    }
    headers["Offset"] = "0";
    headers["X-Entity-Length"] = String(tamanho);
    headers["X-Entity-Name"] = nome;
    headers["X-Entity-Type"] = mime;

    const resBytes = await fetch(urlUpload, {
      method: videoUp.uploadMetodo || "POST", credentials: "include",
      headers, body: blob,
    });
    const txtBytes = await resBytes.text();
    if (!idVideo) idVideo = extrairIdVideo(txtBytes);
    const chunk = txtBytes.match(/"h"\s*:\s*"([^"]+)"/)?.[1] ?? "";

    // 3) receive/finalize
    if (videoUp.receiveUrl) {
      const camposFim = normalizarCamposVideo(
        renovarCampos(videoUp.receiveCampos), tamanho, mime, chunk);
      const fin = {};
      for (const [k, v] of Object.entries(camposFim)) fin[k] = trocaIdVideo(v);
      const resFim = await fetch(trocaIdVideo(videoUp.receiveUrl), {
        method: videoUp.receiveMetodo || "POST", credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fin).toString(),
      });
      const txtFim = await resFim.text();
      if (!idVideo) idVideo = extrairIdVideo(txtFim);
      if (!resFim.ok)
        throw new Error(`finalização do vídeo falhou (http ${resFim.status})`);
    }
    if (!idVideo) throw new Error("upload de vídeo falhou (sem id)");
    return { idVideo, sessoes };
  }

  const blobDeDataUrl = async (dataUrl) => (await fetch(dataUrl)).blob();

  // ---------- ações ----------
  async function postarNoGrupo({ idGrupo, texto, fotoDataUrl, videoDataUrl }) {
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      // foto + vídeo juntos (postMisto)
      if (fotoDataUrl && videoDataUrl && window.__SP_CAPTURAS.postMisto) {
        const cal = window.__SP_CAPTURAS.postMisto;
        const uid = uidAtual();
        const { idVideo, sessoes } = await subirVideo(
          cal.videoUpload, await blobDeDataUrl(videoDataUrl), cal.composer.variaveis, uid);
        const idFoto = await subirFoto(cal.photoUpload, fotoDataUrl);
        const trocas = [
          { de: cal.composer.sampleGroupId, para: idGrupo, embutido: true },
          { de: cal.composer.sampleVideoId, para: idVideo, embutido: true },
          { de: cal.composer.samplePhotoId, para: idFoto, embutido: true },
          ...sessoes.map((s) => ({ de: s.de, para: s.para, embutido: true })),
        ].filter((t) => t.de && t.para);
        const corpo = montarRequisicao(cal.composer, { trocas, texto });
        const { status, texto: bruto } = await executarGraphql(corpo);
        return classificarResposta(status, bruto);
      }
      // só vídeo
      if (videoDataUrl && window.__SP_CAPTURAS.postVideo) {
        const cal = window.__SP_CAPTURAS.postVideo;
        const { idVideo, sessoes } = await subirVideo(
          cal.upload, await blobDeDataUrl(videoDataUrl),
          cal.composer.variaveis, uidAtual());
        const trocas = [
          { de: cal.composer.sampleGroupId, para: idGrupo, embutido: true },
          { de: cal.composer.sampleVideoId, para: idVideo, embutido: true },
          ...sessoes.map((s) => ({ de: s.de, para: s.para, embutido: true })),
        ].filter((t) => t.de && t.para);
        const corpo = montarRequisicao(cal.composer, { trocas, texto });
        const { status, texto: bruto } = await executarGraphql(corpo);
        return classificarResposta(status, bruto);
      }
      if (fotoDataUrl && window.__SP_CAPTURAS.postFoto) {
        const cal = window.__SP_CAPTURAS.postFoto;
        const idFoto = await subirFoto(cal.upload, fotoDataUrl);
        const trocas = [{ de: cal.composer.sampleGroupId, para: idGrupo, embutido: true }];
        if (cal.composer.samplePhotoId)
          trocas.push({ de: cal.composer.samplePhotoId, para: idFoto, embutido: true });
        const corpo = montarRequisicao(cal.composer, { trocas, texto });
        const { status, texto: bruto } = await executarGraphql(corpo);
        return classificarResposta(status, bruto);
      }
      const cal = window.__SP_CAPTURAS.post;
      if (!cal) return { resultado: "erro", erro: "sem calibração de post — poste manualmente num grupo" };
      const trocas = [];
      if (cal.sampleGroupId) trocas.push({ de: cal.sampleGroupId, para: idGrupo, embutido: true });
      const corpo = montarRequisicao(cal, { trocas, texto });
      const { status, texto: bruto } = await executarGraphql(corpo);
      return classificarResposta(status, bruto);
    } catch (e) {
      return { resultado: "erro", erro: e.message || "fetch falhou" };
    } finally {
      window.__fbPostando = postando;
    }
  }

  async function curtirPost({ feedbackId }) {
    const cal = window.__SP_CAPTURAS.like;
    if (!cal) return { resultado: "erro", erro: "sem calibração de like — curta algo manualmente" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const variaveisBase = corrigirReacaoLike(JSON.parse(JSON.stringify(cal.variaveis)));
      const trocas = cal.sampleFeedbackId
        ? [{ de: cal.sampleFeedbackId, para: feedbackId, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas, variaveisBase });
      const { status, texto: bruto } = await executarGraphql(corpo);
      return classificarResposta(status, bruto);
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  async function comentarPost({ feedbackId, texto, fotoDataUrl }) {
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      if (fotoDataUrl && window.__SP_CAPTURAS.comentarioFoto) {
        const cal = window.__SP_CAPTURAS.comentarioFoto;
        const idFoto = await subirFoto(cal.upload, fotoDataUrl, { feedbackId });
        const trocas = [
          { de: cal.samplePhotoId, para: idFoto, embutido: true },
          { de: cal.sampleFeedbackId, para: feedbackId, embutido: true },
        ];
        const corpo = montarRequisicao(cal, { trocas, texto });
        const { status, texto: bruto } = await executarGraphql(corpo);
        return classificarResposta(status, bruto);
      }
      const cal = window.__SP_CAPTURAS.comentario;
      if (!cal) return { resultado: "erro", erro: "sem calibração de comentário — comente manualmente" };
      const trocas = cal.sampleFeedbackId
        ? [{ de: cal.sampleFeedbackId, para: feedbackId, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas, texto });
      const { status, texto: bruto } = await executarGraphql(corpo);
      return classificarResposta(status, bruto);
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  const preencherRespostas = (vars) => {
    if (Array.isArray(vars)) return vars.map(preencherRespostas);
    if (vars && typeof vars === "object") {
      const r = {};
      for (const [k, v] of Object.entries(vars))
        r[k] =
          /^(answer|answer_text|response|text)$/i.test(k) && typeof v === "string"
            ? "ok"
            : preencherRespostas(v);
      return r;
    }
    return vars;
  };

  async function entrarNoGrupo({ idGrupo, responderPerguntas }) {
    const cal = window.__SP_CAPTURAS.entrar;
    if (!cal) return { resultado: "erro", erro: "sem calibração de entrar — entre num grupo manualmente" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const variaveisBase = responderPerguntas
        ? preencherRespostas(JSON.parse(JSON.stringify(cal.variaveis)))
        : undefined;
      const trocas = cal.sampleGroupId
        ? [{ de: cal.sampleGroupId, para: idGrupo, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas, variaveisBase });
      const { status, texto: bruto } = await executarGraphql(corpo);
      const cls = classificarResposta(status, bruto);
      if (cls.resultado === "bloqueado" || cls.resultado === "erro")
        return { resultado: cls.resultado === "bloqueado" ? "bloqueado" : "falhou", erro: cls.erro };
      if (RE_PERGUNTAS.test(bruto)) return { resultado: "perguntas", erro: "grupo pede respostas" };
      if (RE_JA_MEMBRO.test(bruto)) return { resultado: "ja_membro" };
      const estado = pegarPrimeiro(
        bruto,
        /"(?:join_state|group_join_state|viewer_join_state)"\s*:\s*"([^"]+)"/i
      )?.toUpperCase();
      if (["MEMBER", "JOINED", "ACTIVE"].includes(estado)) return { resultado: "entrou" };
      if (["REQUESTED", "AWAITING_APPROVAL", "PENDING"].includes(estado))
        return { resultado: "pendente" };
      if (RE_PENDENTE.test(bruto)) return { resultado: "pendente" };
      return { resultado: "entrou" };
    } catch (e) {
      return { resultado: "falhou", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  // extrai dados ricos por grupo — foto, privacidade, posts/dia,
  // has_membership_questions, viewer_join_state (portado: ln deles)
  const extrairGrupos = (objs, mapa) => {
    let cursor;
    const visitar = (o, prof = 0) => {
      if (!o || typeof o !== "object" || prof > 25) return;
      const pi = o.page_info;
      if (pi?.end_cursor && pi.has_next_page && !cursor) cursor = pi.end_cursor;
      const tipo = o.__typename;
      if (tipo === "Group" || /group/i.test(String(tipo || ""))) {
        const id = o.id;
        const nome = o.name ?? o.title?.text;
        if (id && /^\d{4,}$/.test(String(id)) && nome && !mapa.has(String(id))) {
          const s = JSON.stringify(o);
          const textoDe = (...chaves) => {
            for (const c of chaves) {
              const m = s.match(new RegExp(`"${c}"\\s*:\\s*\\{[^}]*?"text"\\s*:\\s*"([^"]+)"`));
              if (m) return m[1];
            }
          };
          const membros =
            textoDe("group_member_count", "member_count", "member_count_text")?.match(/[\d.,]+/)?.[0] ??
            o.group_member_count?.text?.match(/[\d.,]+/)?.[0] ??
            o.member_count?.text?.match(/[\d.,]+/)?.[0] ??
            o.visibility_sentence?.text?.match(/[\d.,]+/)?.[0];
          const foto = s.match(/"profile_picture[^"]*"\s*:\s*\{[^}]*?"uri"\s*:\s*"([^"]+)"/)?.[1];
          const postsDia = s.match(/"text"\s*:\s*"([^"]*(?:posts?|publica[çc][õo]es)\s+por\s+dia[^"]*)"/i)?.[1];
          const amigosComum = s.match(/"text"\s*:\s*"([^"]*(?:amigos?|friends?)\s+(?:em\s+comum|in\s+common)[^"]*)"/i)?.[1];
          const privacidade = s.match(/"privacy"\s*:\s*"?(PUBLIC|PRIVATE|CLOSED|SECRET|Visibilidade[^",}]*)"?/i)?.[1] ??
            s.match(/"group_visibility"\s*:\s*"([^"]+)"/i)?.[1];
          const perguntas = /"has_membership_questions"\s*:\s*true/.test(s) ||
            /"requires_questions"\s*:\s*true/.test(s);
          const estado = s.match(/"viewer_join_state"\s*:\s*"([A-Z_]+)"/i)?.[1] ??
            s.match(/"join_state"\s*:\s*"([A-Z_]+)"/i)?.[1];
          mapa.set(String(id), {
            id: String(id), nome, membros, foto, postsDia,
            amigosComum, privacidade, perguntas, estado,
          });
        }
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
    };
    objs.forEach(visitar);
    return cursor;
  };

  async function buscarGrupos({ termo, limite = 60 }) {
    const cal = window.__SP_CAPTURAS.busca;
    if (!cal) return { resultado: "erro", erro: "sem calibração de busca — pesquise 'grupos' no Facebook manualmente" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      let vars = JSON.parse(JSON.stringify(cal.variaveis));
      const bsid = vars?.args?.context?.bsid;
      if (bsid) vars.args.context.bsid = novoUuid();

      const trocas = cal.sampleQuery ? [{ de: cal.sampleQuery, para: termo }] : [];
      const mapa = new Map();
      let cursor, vazias = 0;
      // até 90 páginas como eles; para em 2 páginas vazias seguidas
      for (let pagina = 0; pagina < 90; pagina++) {
        const antes = mapa.size;
        const corpo = montarRequisicao(cal, {
          trocas,
          variaveisBase: vars,
          cursor: pagina === 0 ? undefined : cursor ?? undefined,
        });
        const { status, texto: bruto } = await executarGraphql(corpo);
        if (status !== 200) return { resultado: "erro", erro: `http ${status}` };
        const cls = classificarResposta(status, bruto);
        if (cls.resultado === "bloqueado") return { resultado: "bloqueado", erro: cls.erro };
        cursor = extrairGrupos(linhasJson(bruto), mapa);
        vazias = mapa.size === antes ? vazias + 1 : 0;
        if (vazias >= 2 || mapa.size >= limite || !cursor) break;
      }
      return { resultado: "ok", grupos: [...mapa.values()].slice(0, limite) };
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  const extrairPostsFeed = (objs) => {
    const mapa = new Map();
    let cursor;
    const coletar = (node) => {
      if (!node || typeof node !== "object") return;
      let feedbackId, postId, autorId;
      const visitar = (o, prof = 0) => {
        if (!o || typeof o !== "object" || prof > 8) return;
        if (!feedbackId && /feedback/i.test("") ) {}
        if (!feedbackId) {
          const f = o.feedback;
          if (f && typeof f === "object" && f.id) feedbackId = String(f.id);
        }
        if (!postId && o.post_id) postId = String(o.post_id);
        if (!postId && o.id && /^\d{6,}$/.test(String(o.id))) postId = String(o.id);
        if (!autorId) autorId = acharIdAutor(o);
        for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
      };
      visitar(node);
      if (feedbackId) mapa.set(feedbackId, { feedbackId, postId, autorId });
    };
    const visitar = (o, prof = 0) => {
      if (!o || typeof o !== "object" || prof > 25) return;
      const pi = o.page_info;
      if (pi?.end_cursor && pi.has_next_page && !cursor) cursor = pi.end_cursor;
      if (Array.isArray(o.edges)) for (const e of o.edges) coletar(e?.node ?? e);
      for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
    };
    objs.forEach(visitar);
    return { posts: [...mapa.values()], cursor };
  };

  async function feedDoGrupo({ idGrupo, cursor }) {
    const cal = window.__SP_CAPTURAS.feed;
    if (!cal) return { resultado: "erro", erro: "sem calibração de feed — abra um grupo no Facebook" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const trocas = cal.sampleGroupId
        ? [{ de: cal.sampleGroupId, para: idGrupo, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas, cursor: cursor ?? null });
      const { status, texto: bruto } = await executarGraphql(corpo);
      const cls = classificarResposta(status, bruto);
      if (cls.resultado === "bloqueado") return cls;
      const { posts, cursor: proximo } = extrairPostsFeed(linhasJson(bruto));
      return { resultado: "ok", posts, cursor: proximo };
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  // ---------- perfil / membros / amizade ----------
  async function resolverPerfil(bruto) {
    bruto = String(bruto || "").trim();
    const mId = bruto.match(/profile\.php\?id=(\d+)/) || bruto.match(/^\d{5,}$/);
    if (mId) return { idUsuario: mId[1] || mId[0] };
    const slug = (bruto.match(/facebook\.com\/([^\/?\s&#]+)/) || [])[1] || bruto;
    const res = await fetch(`https://www.facebook.com/${encodeURIComponent(slug)}`,
      { credentials: "same-origin" });
    const html = await res.text();
    const id = pegarPrimeiro(
      html,
      /"userID":"?(\d{5,})/,
      /"user_id":"?(\d{5,})/,
      /"entity_id":"?(\d{5,})"[^}]{0,120}"entity_type":"?(?:USER|PROFILE)/i,
      /profile\.php\?id=(\d+)/
    );
    if (!id) throw new Error(`não achei o ID do perfil: ${slug}`);
    return { idUsuario: id };
  }

  const extrairUsuarios = (objs, mapa) => {
    let cursor;
    const visitar = (o, prof = 0) => {
      if (!o || typeof o !== "object" || prof > 25) return;
      const pi = o.page_info;
      if (pi?.end_cursor && pi.has_next_page && !cursor) cursor = pi.end_cursor;
      const ehUsuario = o.__typename === "User" || o.__isActor === "User";
      const id = o.id;
      if (ehUsuario && id && /^\d{5,}$/.test(String(id))) {
        let status = o.friendship_status ?? o.friendshipStatus;
        if (!status) {
          const titulo = o.profile_action?.title?.text ?? "";
          if (/cancelar pedido/i.test(titulo)) status = "OUTGOING_REQUEST";
          else if (/^amigos$/i.test(titulo)) status = "ARE_FRIENDS";
          else if (/adicionar|add friend/i.test(titulo)) status = "CAN_REQUEST";
        }
        const nome = o.name ?? o.title?.text;
        mapa.set(String(id), { id: String(id), nome, status });
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
    };
    objs.forEach(visitar);
    return cursor;
  };

  async function membrosDoGrupo({ idGrupo, cursor, tipo }) {
    const cal = window.__SP_CAPTURAS[tipo || "membros"] ?? window.__SP_CAPTURAS.membros;
    if (!cal) return { resultado: "erro", erro: "sem calibração de membros — abra a aba Membros de um grupo" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const trocas = cal.sampleGroupId
        ? [{ de: cal.sampleGroupId, para: idGrupo, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas, cursor: cursor ?? null });
      const { status, texto: bruto } = await executarGraphql(corpo);
      const cls = classificarResposta(status, bruto);
      if (cls.resultado === "bloqueado") return cls;
      const mapa = new Map();
      const proximo = extrairUsuarios(linhasJson(bruto), mapa);
      return { resultado: "ok", usuarios: [...mapa.values()], cursor: proximo };
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  async function pedirAmizade({ idUsuario }) {
    const cal = window.__SP_CAPTURAS.amigo;
    if (!cal) return { resultado: "erro", erro: "sem calibração de amizade — envie um pedido manualmente" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const trocas = cal.sampleUserId
        ? [{ de: cal.sampleUserId, para: idUsuario, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas });
      const { status, texto: bruto } = await executarGraphql(corpo);
      const cls = classificarResposta(status, bruto);
      if (cls.resultado === "bloqueado") return { resultado: "bloqueado", erro: cls.erro };

      const statusAmizade = pegarPrimeiro(bruto, /"friendship_status"\s*:\s*"([^"]+)"/);
      if (/ARE_FRIENDS|FRIENDS|INCOMING_REQUEST/.test(statusAmizade || "") || RE_JA_AMIGO.test(bruto))
        return { resultado: "ja_amigo" };
      if ("CAN_REQUEST" === statusAmizade)
        return { resultado: "falhou", erro: "pedido não registrado" };
      if ("OUTGOING_REQUEST" === statusAmizade || RE_ENVIADO.test(bruto))
        return { resultado: "enviado" };
      if (cls.resultado === "erro") return { resultado: "falhou", erro: cls.erro };
      return { resultado: "enviado" };
    } catch (e) {
      return { resultado: "falhou", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  // ---------- listing do Marketplace ----------
  const definirCampo = (node, chave, valor) => {
    if (!node || typeof node !== "object") return;
    const v = node[chave];
    if (typeof v === "string" || typeof v === "number") node[chave] = valor;
    else if (v && typeof v === "object" && "text" in v) v.text = valor;
    else node[chave] = valor;
  };

  async function criarListing({ titulo, descricao, preco, moeda, fotosDataUrl = [], idsGrupos = [], paraMarketplace }) {
    const cal = window.__SP_CAPTURAS.listing;
    if (!cal) return { resultado: "erro", erro: "sem calibração de listing — publique um anúncio no Marketplace manualmente" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const vars = JSON.parse(JSON.stringify(cal.variaveis));
      const item = acharProductItem(vars);
      if (!item) return { resultado: "erro", erro: "molde sem product_item — recalibre" };

      // fotos novas (se houver upload calibrado)
      const idsNovos = [];
      if (cal.upload && fotosDataUrl.length)
        for (const d of fotosDataUrl) idsNovos.push(await subirFoto(cal.upload, d));

      // substitui photo ids antigos pelos novos (embutido p/ attachments)
      let varsStr = JSON.stringify(vars);
      const antigos = cal.samplePhotoIds ?? [];
      for (let i = 0; i < Math.min(antigos.length, idsNovos.length); i++)
        varsStr = varsStr.split(antigos[i]).join(idsNovos[i]);
      const vars2 = JSON.parse(varsStr);
      const item2 = acharProductItem(vars2) ?? item;

      if (titulo) definirCampo(item2, "title", titulo);
      if (descricao) definirCampo(item2, "description", descricao);
      if (preco && item2.item_price) {
        definirCampo(item2.item_price, "price", String(preco));
        if (moeda) definirCampo(item2.item_price, "currency", moeda);
      }
      const alvos = paraMarketplace
        ? [ID_MARKETPLACE, ...idsGrupos]
        : idsGrupos;
      if (alvos.length && "xpost_target_ids" in item2)
        item2.xpost_target_ids = alvos;

      const trocas = [];
      if (cal.sampleGroupId && alvos[0] && cal.sampleGroupId !== alvos[0])
        trocas.push({ de: cal.sampleGroupId, para: alvos[0], embutido: true });
      const corpo = montarRequisicao(cal, { trocas, variaveisBase: vars2 });
      const { status, texto: bruto } = await executarGraphql(corpo);
      return classificarResposta(status, bruto);
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  // ---------- lista de grupos via Graph API (portado: __accessToken → me/groups) ----------
  const tokenDeHtml = (html) =>
    html.match(/"apiAccessToken"\s*:\s*"([^"\\]+)"/)?.[1] ??
    html.match(/\\"apiAccessToken\\"\s*:\s*\\"([^"\\]+)\\"/)?.[1] ??
    html.match(/__accessToken["']?\s*[:=]\s*["']([^"']+)["']/)?.[1] ??
    html.match(/\\"__accessToken\\"\s*:\s*\\"([^"\\]+)\\"/)?.[1] ??
    "";

  // cadeia de fontes do token (portado: Aa deles — headless ads/bm → aba)
  async function tokenApiFb() {
    const daPagina = tokenDeHtml(document.documentElement.innerHTML);
    if (daPagina) return { token: daPagina, fonte: "pagina" };
    for (const fonte of [
      ["ads", "https://adsmanager.facebook.com/adsmanager/manage/campaigns"],
      ["bm", "https://business.facebook.com/"],
    ]) {
      try {
        const res = await fetch(fonte[1], { credentials: "include" });
        if (/\/(login|checkpoint)\b/.test(res.url || "")) break;
        const html = await res.text();
        const t = tokenDeHtml(html) ||
          html.match(/"accessToken"\s*:\s*"(EAA[^"\\]+)"/)?.[1] ||
          html.match(/\\"accessToken\\"\s*:\s*\\"(EAA[^"\\]+)\\"/)?.[1] ||
          "";
        if (t) return { token: t, fonte: `headless-${fonte[0]}` };
      } catch {}
    }
    return null;
  }

  async function meusGrupos() {
    const tk = await tokenApiFb();
    if (!tk)
      return { resultado: "erro", erro: "access token do FB não encontrado — recarregue a página" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const url =
        "https://graph.facebook.com/me/groups?fields=id,name,member_count,administrator" +
        `&limit=200&access_token=${encodeURIComponent(tk.token)}`;
      const res = await fetch(url);
      const j = await res.json().catch(() => null);
      if (!j?.data)
        return { resultado: "erro", erro: j?.error?.message ?? `graph api falhou (http ${res.status})` };
      return {
        resultado: "ok",
        fonte: tk.fonte,
        grupos: j.data.map((g) => ({
          id: String(g.id),
          nome: g.name,
          membros: g.member_count,
          admin: !!g.administrator,
        })),
      };
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  // ---------- ponte de mensagens ----------
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.fonte !== MARCA || d.direcao !== "entrada") return;
    const { id, acao, dados } = d;
    (async () => {
      try {
        let resultado;
        if (acao === "postar") resultado = await postarNoGrupo(dados);
        else if (acao === "resolver") resultado = await resolverIdGrupo(dados.bruto);
        else if (acao === "curtir") resultado = await curtirPost(dados);
        else if (acao === "comentar") resultado = await comentarPost(dados);
        else if (acao === "entrar") resultado = await entrarNoGrupo(dados);
        else if (acao === "buscar") resultado = await buscarGrupos(dados);
        else if (acao === "feed") resultado = await feedDoGrupo(dados);
        else if (acao === "membros") resultado = await membrosDoGrupo(dados);
        else if (acao === "amizade") resultado = await pedirAmizade(dados);
        else if (acao === "perfil") resultado = await resolverPerfil(dados.bruto);
        else if (acao === "listing") resultado = await criarListing(dados);
        else if (acao === "meusGrupos") resultado = await meusGrupos();
        else if (acao === "ping")
          resultado = {
            ok: true,
            calibracoes: Object.keys(window.__SP_CAPTURAS),
            docIds: window.__SP_DOCIDS ? window.__SP_DOCIDS.size : 0,
            sessao: !!(uidAtual() && dtsgDaPagina()),
            video: { inicio: !!videoInicio, upload: !!videoUpload, fim: !!videoFim },
          };
        else resultado = { resultado: "erro", erro: "ação desconhecida" };
        emitir("resposta", { id, resultado });
      } catch (e) {
        emitir("resposta", { id, resultado: { resultado: "erro", erro: e.message } });
      }
    })();
  });

  // ---------- mineração de doc_ids do HTML ----------
  function minerarDocIds() {
    window.__SP_DOCIDS = window.__SP_DOCIDS || new Map();
    const mapa = window.__SP_DOCIDS;
    const fontes = [];
    document
      .querySelectorAll('script[type="application/json"]')
      .forEach((s) => {
        const t = s.textContent?.trim();
        if (t && t.length < 4e6) fontes.push(t);
      });
    fontes.push(document.documentElement.innerHTML.slice(0, 4e6));
    const antes = mapa.size;
    const r1 = /"fb_api_req_friendly_name"\s*:\s*"([^"]+)"[\s\S]{0,1200}?"doc_id"\s*:\s*"?(\d{8,})"?/g;
    const r2 = /"doc_id"\s*:\s*"?(\d{8,})"?[\s\S]{0,1200}?"fb_api_req_friendly_name"\s*:\s*"([^"]+)"/g;
    for (const fonte of fontes) {
      let m;
      for (; (m = r1.exec(fonte)); ) mapa.set(m[1], m[2]);
      for (; (m = r2.exec(fonte)); ) mapa.set(m[2], m[1]);
    }
    if (mapa.size !== antes)
      emitir("stats", { docIds: mapa.size, novos: mapa.size - antes });
  }

  // ---------- SPA: minerar de novo ao trocar de rota (portado deles) ----------
  const aoMudarRota = () => {
    if (emRotaMembros()) {
      minerarDocIds();
      setTimeout(minerarDocIds, 2000);
    }
  };
  window.addEventListener("popstate", aoMudarRota);
  for (const met of ["pushState", "replaceState"]) {
    const orig = history[met];
    history[met] = function (...a) {
      const r = orig.apply(this, a);
      aoMudarRota();
      return r;
    };
  }
  try {
    new PerformanceObserver((entries) => {
      for (const e of entries.getEntries())
        if (RE.bnzai.test(e.name) && emRotaMembros()) minerarDocIds();
    }).observe({ type: "resource", buffered: true });
  } catch {}

  // watchdog de sessão (portado: sessionInvalidated deles) — se c_user ou
  // dtsg sumirem durante automação, avisa o painel pra parar TODOS os jobs
  let sessaoViva = true;
  setInterval(() => {
    const viva = !!(uidAtual() && dtsgDaPagina());
    if (sessaoViva && !viva) emitir("sessaoInvalidada", { motivo: "cookie/dtsg sumiram" });
    sessaoViva = viva;
  }, 15000);

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => {
      minerarDocIds();
      setTimeout(aoMudarRota, 2500);
      setInterval(minerarDocIds, 60000);
    });
  else {
    minerarDocIds();
    setTimeout(aoMudarRota, 2500);
    setInterval(minerarDocIds, 60000);
  }
})();
