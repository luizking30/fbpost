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
  };

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
    const dtsg = dtsgDaPagina();
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
    if (texto != null) {
      if (!definirTextoMsg(vars, texto)) definirTextoComposto(vars, texto);
    }
    if (cursor !== undefined) vars = definirCursor(vars, cursor);
    vars = renovarSessaoComposer(vars);

    const corpo = new URLSearchParams();
    for (const [k, v] of Object.entries(cal.params)) {
      if (["fb_dtsg", "jazoest", "__user", "variables", "doc_id", "fb_api_req_friendly_name", "lsd"].includes(k))
        continue;
      corpo.set(k, cal.sampleUid && uid && v === cal.sampleUid ? uid : v);
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
    if (RE_PENDENTE.test(bruto)) return { resultado: "ok", situacao: "pendente" };
    return { resultado: "ok", situacao: "publicado" };
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

  let uploadFotoCapturado = null; // {url, method, fields, fileField}

  const capturarUpload = (url, metodo, formData) => {
    const campos = {};
    let campoArquivo = null, tipoArquivo = "";
    formData.forEach((v, k) => {
      if (typeof v === "string") campos[k] = v;
      else { campoArquivo = k; tipoArquivo = `${v.type || ""} ${v.name || ""}`; }
    });
    if (campoArquivo && /image\/|\.(jpe?g|png|gif|webp)\b/i.test(tipoArquivo))
      uploadFotoCapturado = { url, metodo: metodo || "POST", campos, campoArquivo };
  };

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
      // post em grupo (texto / foto)
      if (
        RE.composer.test(nome) && RE.cria.test(nome) && !RE.marketplace.test(nome)
      ) {
        const gid = acharIdGrupo(vars);
        const texto = acharTextoMsg(vars);
        if (!gid || !texto) return;
        const cal = { ...base, sampleGroupId: gid, sampleText: texto };
        const idMidia = acharIdMidia(vars);
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

      // lista de membros de grupo
      if (RE.membros.test(nome)) {
        const gid = acharIdGrupo(vars);
        if (gid) registrarCaptura("membros", { ...base, sampleGroupId: gid });
        return;
      }
    } catch {}
  };

  const inspecionarBody = (url, body) => {
    try {
      if (!url.includes("/api/graphql/")) return;
      if (typeof body !== "string" || !body.includes("doc_id")) return;
      inspecionarGraphql(new URLSearchParams(body));
    } catch {}
  };

  const _fetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const [url, opts] = args;
      const u = typeof url === "string" ? url : url?.url || "";
      const metodo = opts?.method || "POST";
      const body = opts?.body;
      if (u.includes("/api/graphql/") && typeof body === "string")
        inspecionarBody(u, body);
      else if (body instanceof FormData && !u.includes("/api/graphql/"))
        capturarUpload(u, metodo, body);
    } catch {}
    return _fetch.apply(this, args);
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__spUrl = url;
    this.__spMetodo = metodo;
    return _open.call(this, metodo, url, ...resto);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__spUrl?.includes("/api/graphql/") && typeof body === "string")
        inspecionarBody(this.__spUrl, body);
      else if (body instanceof FormData && !this.__spUrl?.includes("/api/graphql/"))
        capturarUpload(this.__spUrl, this.__spMetodo, body);
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

  // ---------- ações ----------
  async function postarNoGrupo({ idGrupo, texto, fotoDataUrl }) {
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
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
        if (id && /^\d{4,}$/.test(String(id)) && nome) {
          const membros =
            o.group_member_count?.text?.match(/[\d.,]+/)?.[0] ??
            o.member_count?.text?.match(/[\d.,]+/)?.[0] ??
            o.visibility_sentence?.text?.match(/[\d.,]+/)?.[0];
          mapa.set(String(id), { id: String(id), nome, membros });
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
      let cursor;
      for (let pagina = 0; pagina < 15; pagina++) {
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
        if (mapa.size === antes || mapa.size >= limite || !cursor) break;
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

  async function membrosDoGrupo({ idGrupo, cursor }) {
    const cal = window.__SP_CAPTURAS.membros;
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
        else if (acao === "ping")
          resultado = { ok: true, calibracoes: Object.keys(window.__SP_CAPTURAS) };
        else resultado = { resultado: "erro", erro: "ação desconhecida" };
        emitir("resposta", { id, resultado });
      } catch (e) {
        emitir("resposta", { id, resultado: { resultado: "erro", erro: e.message } });
      }
    })();
  });
})();
