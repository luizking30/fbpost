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

  const RE_JA_AMIGO = /already_friends|already sent|j[áa] (enviou|s[ãa]o amigos)|request already|friend_request_already|ARE_FRIENDS|"text":"Amigos"/i;
  const RE_ENVIADO = /request_sent|outgoing|pending|aguardando|enviada|CONFIRM|can_cancel_friend_request/i;

  const RE_BLOQUEIO_TEXTO =
    /you're temporarily blocked|voc[êe] est[áa] temporariamente|limitamos a frequ[êe]ncia|est[áa] bloqueado temporariamente|try again later|tente novamente mais tarde/i;
  const RE_PENDENTE =
    /pending_review|awaiting_approval|will be reviewed|ser[áa] analisad|aguardando aprova|once approved|is_pending":true|needs_admin_approval/i;
  const RE_PERGUNTAS = /membership_question|admission_question|require.*question|responder.*pergunta|answer.*question/i;
  const RE_JA_MEMBRO = /already.?(a )?member|j[áa] (é|e|sou) membro|already_joined|already joined|MEMBER"/i;
  const RE_JOIN_PENDENTE = /requested|pending|solicita|aguardando|REQUESTED|awaiting|CANNOT_JOIN.*approval/i;
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

  // uid: cookie → link profile.php → meta al:android:url (he deles)
  const uidAtual = () =>
    document.cookie.match(/c_user=(\d+)/)?.[1] ||
    document.querySelector('a[href*="profile.php?id="]')?.href
      .match(/profile\.php\?id=(\d+)/)?.[1] ||
    document.querySelector('meta[property="al:android:url"]')?.content
      ?.match(/(\d{5,})/)?.[1] ||
    null;

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
  const trocarEmbutido = (texto, de, para) => {
    if (!de || !para || !texto.includes(de)) return texto;
    const seguro = de.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // fronteira de dígito só faz sentido p/ ids numéricos
    const re = /^\d+$/.test(de)
      ? new RegExp(`(?<!\\d)${seguro}(?!\\d)`, "g")
      : new RegExp(seguro, "g");
    return texto.replace(re, para);
  };

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
      // actors: [ {id} ] — primeira posição é o autor (kt deles)
      if ("actors" === k && Array.isArray(v) && v[0] && typeof v[0] === "object") {
        const id = v[0].id;
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
    JSON.parse(trocarEmbutido(JSON.stringify(vars), de, para));

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
        // en deles: chave contendo cursor|after, só se string ou null
        r[k] = /cursor|after/i.test(k) && (typeof v === "string" || v == null)
          ? cursor
          : definirCursor(v, cursor);
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
    for (const [k, v0] of Object.entries(cal.params)) {
      if (["fb_dtsg", "jazoest", "__user", "variables", "doc_id", "fb_api_req_friendly_name"].includes(k))
        continue;
      // nt deles: params top-level também recebem troca exata
      // (ex. group_id fora do variables)
      let v = v0;
      for (const t of trocas)
        if (t.de && String(v) === String(t.de)) { v = t.para; break; }
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
    let res;
    try {
      res = await fetch(GRAPHQL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: corpo.toString(),
      });
    } catch (e) {
      // normaliza falha de rede (We deles): TypeError/"failed to fetch"
      // vira mensagem clara, distinguível de bloqueio do FB
      if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(e?.message ?? ""))
        throw new Error(`rede_inacessivel (${e?.message ?? "fetch error"})`);
      throw e;
    }
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

  const classificarResposta = (status, bruto, chave = "geral") => {
    const t = bruto.trim();
    if (!t || "<" === t[0])
      return { resultado: "bloqueado", erro: `resposta não-JSON (checkpoint/WAF), http ${status}` };
    const objs = linhasJson(bruto);
    if (!objs.length)
      return { resultado: "bloqueado", erro: `resposta inválida, http ${status}` };

    // erro rico (portado): code/api_error_code/severity/is_transient/
    // is_silent/requires_reauth/sentry_block_user_info/help_center_id
    const erro = objs
      .flatMap((o) => (Array.isArray(o.errors) ? o.errors : o.error ? [o.error] : []))
      .filter(Boolean)[0];
    if (erro) {
      const codigo = erro.code ?? erro.api_error_code;
      const desc = erro.description?.text ?? erro.description ?? erro.description_raw?.text ?? erro.description_raw;
      const msg = [erro.summary || erro.message || "erro GraphQL", desc]
        .filter(Boolean).map(String).join(" — ");
      const extras = [
        erro.severity && `sev=${erro.severity}`,
        erro.is_transient != null && `transiente=${erro.is_transient}`,
        erro.is_silent && `silencioso`,
        erro.help_center_id && `hc=${erro.help_center_id}`,
        Array.isArray(erro.path) && `campo=${erro.path.filter((p) => typeof p === "string").join(".")}`,
        erro.debug_info && `dbg=${String(erro.debug_info).slice(0, 120)}`,
      ].filter(Boolean).join(" ");
      // sentry_block_user_info = bloqueio da CONTA (não da ação) —
      // extrai título/prazo do bloqueio quando vier (como eles)
      const sb = erro.sentry_block_user_info;
      const detalheBlock = sb
        ? [sb.title?.text ?? sb.title, sb.body?.text ?? sb.body,
           sb.block_duration ?? sb.block_end_time]
          .filter(Boolean).map(String).join(" — ")
        : "";
      if (sb != null || CODIGOS_BLOQUEIO.has(codigo) ||
          erro.requires_reauth || erro.severity === "CRITICAL")
        return {
          resultado: "bloqueado",
          erro: `${msg} (código ${codigo ?? "?"}${extras ? " " + extras : ""})${detalheBlock ? " | " + detalheBlock : ""}`,
          bloqueioConta: sb != null || undefined,
        };
      return {
        resultado: "erro",
        erro: `${msg} (código ${codigo ?? "?"}${extras ? " " + extras : ""})`,
        transiente: erro.is_transient === true || undefined,
      };
    }
    if (RE_BLOQUEIO_TEXTO.test(bruto))
      return { resultado: "bloqueado", erro: "texto de bloqueio detectado" };

    const escopo = montarEscopo(objs[0], bruto);
    const pendente = rodarProbes("pendente", chave, bruto, escopo);
    const postId = rodarProbes("postId", chave, bruto, objs) ?? undefined;
    return {
      resultado: "ok",
      situacao: pendente ? "pendente" : "publicado",
      postId,
    };
  };

  // ---------- probes ranqueados (portado: Se/Te/Ue/Be/Ke deles) ----------
  // cada probe é uma estratégia de extração; acerto soma score (teto 500) e
  // nas próximas respostas os que mais acertam rodam primeiro — adaptativo
  const b64url = (s) => {
    try { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
  };

  // deep numeric: post_id|id|legacy_story_hideable_id em qualquer nó (Ee deles)
  const postIdProfundo = (o, prof = 0) => {
    if (!o || typeof o !== "object" || prof > 12) return;
    for (const [k, v] of Object.entries(o)) {
      if (/^(post_id|id|legacy_story_hideable_id)$/.test(k) &&
          typeof v === "string" && /^\d{6,}/.test(v))
        return v;
      if (v && typeof v === "object") {
        const r = postIdProfundo(v, prof + 1);
        if (r) return r;
      }
    }
  };

  const PROBES_POST_ID = [
    { id: "json_deep_numeric", run: (b, objs) => {
        for (const o of objs ?? []) { const r = postIdProfundo(o); if (r) return r; }
      } },
    { id: "raw_post_id", run: (b) => b.match(/"post_id":"?(\d{6,})"?/)?.[1] },
    { id: "raw_legacy_story", run: (b) => b.match(/"legacy_story_hideable_id":"?(\d{6,})"?/)?.[1] },
    { id: "b64_story_id", run: (b) => {
        for (const m of b.matchAll(/"(?:story_id|id|post_id|legacy_story_hideable_id|feedback_target_id)":"([A-Za-z0-9_+\/-]{20,}={0,2})"/g)) {
          const dec = b64url(m[1]);
          if (!dec.startsWith("S:_")) continue;
          const nums = dec.split(":").filter((x) => /^\d{6,}$/.test(x));
          if (nums.length) return nums[nums.length - 1];
        }
      } },
    { id: "b64_logging_token", run: (b) => {
        for (const m of b.matchAll(/"logging_token":"([A-Za-z0-9_+\/-]{20,}={0,2})"/g)) {
          const hit = b64url(m[1]).match(/"(?:feed_fbids|post_ids|story_ids)":\["(\d{6,})"/);
          if (hit) return hit[1];
        }
      } },
    { id: "raw_story_url", run: (b) => b.match(/groups\\?\/\d+\\?\/(?:posts|permalink)\\?\/(\d{6,})/)?.[1] },
    { id: "raw_multi_permalink", run: (b) => b.match(/multi_permalinks?=(\d{6,})/)?.[1] },
    { id: "raw_story_fbid", run: (b) => b.match(/story_fbid[":=]+"?(\d{6,})"?/)?.[1] },
    { id: "raw_creation_story", run: (b) => b.match(/"creation_story":\{[^}]*?"id":"?(\d{6,})"?/)?.[1] },
    { id: "raw_any_target_id", run: (b) => b.match(/"(?:target_id|subscription_target_id|feedback_target_id)":"?(\d{8,})"?/)?.[1] },
  ];

  const PROBES_PENDENTE = [
    { id: "learn_more_value", run: (b) => /"if_viewer_can_learn_more_about_pending_post":\s*(?!null|false)\S/.test(b) },
    { id: "raw_is_pending_flag", run: (b) => /"is_pending[a-z_]*":\s*true/i.test(b) },
    { id: "raw_approval_flag", run: (b) => /"(?:requires_admin_approval|awaiting_approval|needs_approval|pending_approval)":\s*true/i.test(b) },
    { id: "raw_pending_state", run: (b) => /"(?:pending_state|approval_status|moderation_state)":"?(?:PENDING|AWAITING[A-Z_]*|UNAPPROVED)"?/i.test(b) },
    { id: "pending_typename", run: (b) => /"__typename":"(?:GroupPendingStory|GroupPendingPost|PendingParticipationPost)"/.test(b) },
    { id: "texto_pendente", run: (b) => RE_PENDENTE.test(b) },
    { id: "scope_pending_posts", run: (b, esc) => !!esc && esc.includes("pending_posts") },
    { id: "scope_pending_queue", run: (b, esc) => !!esc && (esc.includes("GroupPendingPost") || esc.includes("pending_post_queue")) },
    { id: "scope_pending_participation", run: (b, esc) => !!esc && esc.includes("PendingParticipationPost") },
    { id: "scope_pending_word", run: (b, esc) => !!esc && /"[a-z_]*pending[a-z_]*":\s*(?:true|"[A-Z])/.test(esc) },
  ];

  const IDS_PROBES = new Set([...PROBES_POST_ID, ...PROBES_PENDENTE].map((p) => p.id));
  window.__SP_PROBES = window.__SP_PROBES || {}; // {postId:{chave:{id:score}}, pendente:{...}}
  let probesSujos = false;
  const scoresDe = (tipo, chave) => {
    const t = window.__SP_PROBES[tipo] ?? (window.__SP_PROBES[tipo] = {});
    return t[chave] ?? (t[chave] = {});
  };
  const probesOrdenados = (lista, scores) =>
    lista
      .map((p, i) => ({ p, i, s: scores[p.id] ?? 0 }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.p);
  const acertou = (scores, id) => {
    scores[id] = Math.min(500, (scores[id] ?? 0) + 1);
    probesSujos = true;
  };
  let timerProbes = null;
  const emitirProbes = () => {
    if (!probesSujos) return;
    clearTimeout(timerProbes);
    timerProbes = setTimeout(() => {
      probesSujos = false;
      emitir("probesStats", window.__SP_PROBES);
    }, 2000);
  };
  // roda probes ordenados por score; primeiro hit vence e pontua (Be/Ke deles)
  const rodarProbes = (tipo, chave, bruto, extra) => {
    const scores = scoresDe(tipo, chave);
    const lista = tipo === "postId" ? PROBES_POST_ID : PROBES_PENDENTE;
    for (const p of probesOrdenados(lista, scores)) {
      let hit;
      try { hit = p.run(bruto, extra); } catch { hit = undefined; }
      if (hit) {
        acertou(scores, p.id);
        emitirProbes();
        return hit;
      }
    }
  };

  // escopo p/ probes de pendente: nó da mutation (story_create|*_create|
  // story* com ids) + linhas seguintes, até 8KB (je deles)
  const ehObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const CHAVES_ESCOPO = new Set(["to", "leaders_engagement_logging_settings", "comet_surface_mappings"]);
  const LIMITE_ESCOPO = 8000;
  const serializarEscopo = (o) =>
    JSON.stringify(o, (k, v) => (CHAVES_ESCOPO.has(k) ? undefined : v)) ?? "";
  const montarEscopo = (obj, bruto) => {
    try {
      const dados = obj?.data;
      if (!ehObj(dados)) return "";
      let alvo;
      if (ehObj(dados.story_create)) alvo = dados.story_create;
      else {
        const chaves = Object.keys(dados).filter((k) => ehObj(dados[k]));
        const achada =
          chaves.find((k) => /_create$/.test(k)) ??
          chaves.find((k) => /^story/.test(k) &&
            ("post_id" in dados[k] || "story" in dados[k] || "story_id" in dados[k]));
        alvo = achada ? dados[achada] : chaves.length === 1 ? dados[chaves[0]] : undefined;
      }
      if (!alvo) return "";
      let escopo = serializarEscopo(alvo);
      if (escopo.length > LIMITE_ESCOPO) return "";
      const i = bruto.indexOf("\n");
      if (i < 0) return escopo;
      let cont = 0;
      for (const linha of bruto.slice(i + 1).split("\n")) {
        if (cont >= 10) break;
        const t = linha.trim();
        if (!t || t.length > LIMITE_ESCOPO) continue;
        cont++;
        let n;
        try { n = JSON.parse(t); } catch { continue; }
        const s = serializarEscopo(n);
        if (!s || "null" === s || escopo.length + 1 + s.length > LIMITE_ESCOPO) continue;
        escopo += "\n" + s;
      }
      return escopo;
    } catch { return ""; }
  };

  // ---------- captura ----------
  window.__SP_CANDIDATOS = window.__SP_CANDIDATOS || {};
  const nParams = (cal) => Object.keys(cal?.params ?? {}).length;
  // até 4 moldes por tipo, dedup por doc_id, mais params primeiro (portado: m deles)
  const registrarCandidato = (tipo, cal) => {
    if (!cal?.docId) return;
    const lista = window.__SP_CANDIDATOS[tipo] ?? [];
    const i = lista.findIndex((c) => c.docId === cal.docId);
    if (i >= 0) {
      if (nParams(cal) < nParams(lista[i])) return; // amostra mais pobre não substitui
      lista[i] = cal;
    } else lista.unshift(cal);
    lista.sort((a, b) => nParams(b) - nParams(a));
    window.__SP_CANDIDATOS[tipo] = lista.slice(0, 4);
  };
  // queries de LEITURA podem tentar cada molde até um responder (portado: Ma/Qt)
  const candidatosDe = (tipo) => {
    const lista = window.__SP_CANDIDATOS[tipo];
    if (lista?.length) return lista;
    const cal = window.__SP_CAPTURAS[tipo];
    return cal?.docId ? [cal] : [];
  };
  const registrarCaptura = (tipo, cal) => {
    window.__SP_CAPTURAS[tipo] = cal;
    registrarCandidato(tipo, cal?.docId ? cal : cal?.composer);
    emitir("capturado", {
      tipo,
      nomeAmigavel: cal?.nomeAmigavel ?? cal?.composer?.nomeAmigavel,
      docId: cal?.docId ?? cal?.composer?.docId,
      capturadoEm: cal.capturadoEm,
      candidatos: (window.__SP_CANDIDATOS[tipo] ?? []).length,
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
      uploadFotoCapturado = { url, metodo: metodo || "POST", campos, campoArquivo, sampleUid: uidAtual() };
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
            /\/members\/(admins|experts|contributors|near_you|things_in_common)/
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
    /\/groups\/\d+\/members\/(admins|experts|contributors|near_you|things_in_common)/.test(location.pathname) ||
    /Members(Admins|Experts|Contributors|NearYou|ThingsInCommon)?Route/i.test(rotaAtual) ||
    /\/groups\/\d+\/members\/?$/.test(location.pathname);

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
    // friendlyNames de membros acham doc_id/queryID próximo mesmo sem
    // o par friendly_name↔doc_id colado (c/d/u deles)
    for (const re of [
      /GroupsCometMembers[A-Za-z]+(?:Section)?PaginationQuery/g,
      /(?:Groups)?Comet(?:Group)?MembersAdmins[A-Za-z]*(?:Pagination|Query|Section)?/g,
    ]) {
      for (; (m = re.exec(texto)); ) {
        const fatia = texto.slice(Math.max(0, m.index - 400), m.index + 1500);
        const doc = fatia.match(/"doc_id"\s*:\s*"?(\d{8,})"?/) ??
          fatia.match(/doc_id["'\s:=]+(\d{8,})/) ??
          fatia.match(/"queryID"\s*:\s*"?(\d{8,})"?/);
        if (doc) pares.push([m[0], doc[1]]);
      }
    }
    // objetos {friendly_name|fb_api_req_friendly_name, doc_id, variables}
    // em JSON parseado — queries|o0|batch|data (be/we deles); guarda
    // variables reais pra calibração mais fiel
    const varsPorNome = {};
    try {
      const ini = texto.search(/[\[{]/);
      if (ini >= 0) {
        const raiz = JSON.parse(texto.slice(ini));
        const desembrulhar = (e) => {
          if (!e) return [];
          if (Array.isArray(e)) return e.flatMap(desembrulhar);
          if (typeof e !== "object") return [];
          const sub = [e.queries, e.o0, e.batch, e.data].filter(Array.isArray);
          return sub.length ? sub.flatMap(desembrulhar) : [e];
        };
        for (const obj of desembrulhar(raiz)) {
          const nome = String(obj.fb_api_req_friendly_name ?? obj.friendly_name ?? "");
          const doc = String(obj.doc_id ?? "");
          if (nome && /^\d{8,}$/.test(doc)) {
            pares.push([nome, doc]);
            if (obj.variables && typeof obj.variables === "object")
              varsPorNome[`${nome}:${doc}`] = obj.variables;
          }
        }
      }
    } catch {}
    const gid = idGrupoDaUrl();
    for (const [nome2, docId] of pares) {
      mapa.set(nome2, docId);
      // queries de membros viram calibração mínima pronta p/ replay
      if (gid && RE.membros.test(nome2)) {
        const rota = location.pathname.match(
          /\/members\/(admins|experts|contributors|near_you|things_in_common)/
        )?.[1];
        // variables reais do objeto minerado > placeholder {groupID}
        const varsReais = varsPorNome[`${nome2}:${docId}`];
        registrarCaptura(rota ? `membros_${rota}` : "membros", {
          nomeAmigavel: nome2,
          docId,
          params: {},
          variaveis: varsReais ?? { groupID: gid },
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
      // listingProbe armado → grava shape de tudo que passa (pesquisa de fluxo)
      if (probeRec.ativo) {
        if (url.includes("/api/graphql/")) {
          const params = paramsDeBody(body);
          if (params?.doc_id) {
            let vars;
            try { vars = JSON.parse(params.variables); } catch {}
            gravarPasso({
              kind: "graphql",
              friendlyName: params.fb_api_req_friendly_name,
              docId: params.doc_id,
              paramsShape: shapeDe(Object.fromEntries(
                Object.entries(params).filter(
                  ([k]) => !["variables", "fb_dtsg", "jazoest", "__user"].includes(k)))),
              varsShape: vars ? shapeDe(vars) : undefined,
            });
          }
        } else if (body instanceof FormData) {
          gravarPasso({
            kind: "upload",
            url: String(url).slice(0, 200),
            campos: [...body.keys()],
          });
        }
      }
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

      // respostas: bnzai → minera doc_ids; video start/receive → amostra;
      // graphql na rota de membros → minera pares doc_id (extra deles);
      // graphql com probe armado → grava responseShape (listingProbe deles)
      promessa.then((res) => {
        try {
          if (RE.bnzai.test(u))
            res.clone().text().then((t) => minerarRespostaBnzai(u, t)).catch(() => {});
          else if (RE.videoStart.test(u) || RE.videoReceive.test(u))
            res.clone().text().then((t) => guardarRespostaVideo(u, t)).catch(() => {});
          else if (u.includes("/api/graphql/") && emRotaMembros())
            res.clone().text().then((t) => {
              const n = minerarPares(t.slice(0, 4e6));
              if (n) minerarDocIds();
            }).catch(() => {});
          if (probeRec.ativo && u.includes("/api/graphql/"))
            res.clone().text().then((t) =>
              gravarPasso({ kind: "resposta", shape: shapeDe(linhasJson(t)[0]) })
            ).catch(() => {});
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
    // reescrita de campos (pt deles): tokens frescos, uuids novos e
    // sampleUid→uid embutido nos valores
    for (const [k, v] of Object.entries(upload.campos || {})) {
      const kl = k.toLowerCase();
      let val = v;
      if (kl === "fb_dtsg") val = dtsg;
      else if (kl === "jazoest") val = jazoestDe(dtsg);
      else if (kl === "__user") val = uid;
      else if (RE_IDEMPOTENTE.test(k)) val = novoUuid();
      else if (upload.sampleUid && uid)
        val = trocarEmbutido(String(v), String(upload.sampleUid), uid);
      form.append(k, val);
    }
    form.append(upload.campoArquivo || "farr", blob, `image.${ext}`);

    const res = await fetch(url, { method: upload.metodo || "POST", credentials: "include", body: form });
    const bruto = await res.text();
    const limpo = bruto.replace(/^\s*for\s*\(;;\)\s*;/, "");
    // extração em 2 passes (m deles): primeiro chaves específicas
    // photoID/photo_id/photoFbid, depois qualquer "id" — JSON-walk é
    // mais preciso que regex plana (id pode ser de outro nó)
    const id = (() => {
      let raiz;
      try { raiz = JSON.parse(limpo); } catch {
        return limpo.match(/"(?:photoID|photo_id|photoFbid)":"?(\d{6,})"?/)?.[1] ?? "";
      }
      const andar = (o, especifico) => {
        if (!o || typeof o !== "object") return "";
        for (const [k, v] of Object.entries(o)) {
          const chave = especifico ? /^(photoID|photo_id|photoFbid)$/i.test(k) : k === "id";
          if (chave && v != null && /^\d{6,}$/.test(String(v))) return String(v);
          if (v && typeof v === "object") {
            const r = andar(v, especifico);
            if (r) return r;
          }
        }
        return "";
      };
      return andar(raiz, true) || andar(raiz, false);
    })();
    if (!id) {
      // 1357004 / sem id = sessão de upload expirada → pedir recalibração
      // (photo_session_stale deles)
      if (/1357004|"error"/i.test(limpo)) emitir("photoSessionStale", { url: upload.url.slice(0, 120) });
      throw new Error("upload de foto falhou (sem id) — recalibre: poste foto manualmente");
    }
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
    // start deles retenta 1x em erro de rede (We+Ve: 1200ms depois refaz)
    const fetchStart = () => fetch(videoUp.startUrl, {
      method: videoUp.startMetodo || "POST", credentials: "include",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(camposStart).toString(),
    });
    let resStart;
    try {
      resStart = await fetchStart();
    } catch (e) {
      if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(e?.message ?? "")) {
        await new Promise((r) => setTimeout(r, 1200));
        resStart = await fetchStart();
      } else throw e;
    }
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
        return classificarResposta(status, bruto, "postMisto");
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
        return classificarResposta(status, bruto, "postVideo");
      }
      if (fotoDataUrl && window.__SP_CAPTURAS.postFoto) {
        const cal = window.__SP_CAPTURAS.postFoto;
        const idFoto = await subirFoto(cal.upload, fotoDataUrl);
        const trocas = [{ de: cal.composer.sampleGroupId, para: idGrupo, embutido: true }];
        if (cal.composer.samplePhotoId)
          trocas.push({ de: cal.composer.samplePhotoId, para: idFoto, embutido: true });
        const corpo = montarRequisicao(cal.composer, { trocas, texto });
        const { status, texto: bruto } = await executarGraphql(corpo);
        return classificarResposta(status, bruto, "postFoto");
      }
      const cal = window.__SP_CAPTURAS.post;
      if (!cal) return { resultado: "erro", erro: "sem calibração de post — poste manualmente num grupo" };
      const trocas = [];
      if (cal.sampleGroupId) trocas.push({ de: cal.sampleGroupId, para: idGrupo, embutido: true });
      const corpo = montarRequisicao(cal, { trocas, texto });
      const { status, texto: bruto } = await executarGraphql(corpo);
      return classificarResposta(status, bruto, "post");
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
      return classificarResposta(status, bruto, "like");
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
        return classificarResposta(status, bruto, "comentarioFoto");
      }
      const cal = window.__SP_CAPTURAS.comentario;
      if (!cal) return { resultado: "erro", erro: "sem calibração de comentário — comente manualmente" };
      const trocas = cal.sampleFeedbackId
        ? [{ de: cal.sampleFeedbackId, para: feedbackId, embutido: true }]
        : [];
      const corpo = montarRequisicao(cal, { trocas, texto });
      const { status, texto: bruto } = await executarGraphql(corpo);
      return classificarResposta(status, bruto, "comentario");
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
          /^(answer|answer_text|response|text)$/i.test(k) &&
          (typeof v === "string" || v == null)
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
      const cls = classificarResposta(status, bruto, "entrar");
      if (cls.resultado === "bloqueado" || cls.resultado === "erro")
        return { resultado: cls.resultado === "bloqueado" ? "bloqueado" : "falhou", erro: cls.erro };
      // cadeia deles: join_state → texto (perguntas/já-membro/pendente)
      // → http≠200 falhou → senão entrou
      const estado = pegarPrimeiro(
        bruto,
        /"(?:join_state|group_join_state|viewer_join_state)"\s*:\s*"([^"]+)"/i
      )?.toUpperCase();
      if (["MEMBER", "JOINED", "ACTIVE"].includes(estado)) return { resultado: "entrou" };
      if (["REQUESTED", "AWAITING_APPROVAL", "PENDING"].includes(estado))
        return { resultado: "pendente" };
      if (RE_PERGUNTAS.test(bruto)) return { resultado: "perguntas", erro: "grupo pede respostas" };
      if (RE_JA_MEMBRO.test(bruto)) return { resultado: "ja_membro" };
      if (RE_PENDENTE.test(bruto) || RE_JOIN_PENDENTE.test(bruto))
        return { resultado: "pendente" };
      if (status !== 200) return { resultado: "falhou", erro: `http ${status}` };
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
          const textoMembros =
            textoDe("group_member_count", "member_count", "member_count_text") ??
            o.group_member_count?.text ?? o.member_count?.text ??
            o.visibility_sentence?.text;
          // on() deles: "1,2 mil"→1200, "3,4 milhões"→3400000
          const membros = (() => {
            const m = String(textoMembros ?? "")
              .match(/([\d.,]+)\s*(mil|milh[õo]es|mi)?\s*membros?/i);
            if (!m) return undefined;
            const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
            if (Number.isNaN(n)) return undefined;
            const r = (m[2] ?? "").toLowerCase();
            return "mil" === r ? Math.round(1e3 * n)
              : r.startsWith("mi") ? Math.round(1e6 * n)
              : Math.round(n);
          })();
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
            id: String(id), nome, membros, membrosTexto: textoMembros, foto, postsDia,
            amigosComum, privacidade, perguntas, estado,
          });
        }
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
    };
    objs.forEach(visitar);
    return cursor;
  };

  // uma página de busca com um molde específico
  const paginaBusca = async (cal, termo, cursor) => {
    const vars = JSON.parse(JSON.stringify(cal.variaveis));
    const bsid = vars?.args?.context?.bsid;
    if (bsid) vars.args.context.bsid = novoUuid();
    const trocas = cal.sampleQuery ? [{ de: cal.sampleQuery, para: termo }] : [];
    const corpo = montarRequisicao(cal, { trocas, variaveisBase: vars, cursor });
    const { status, texto: bruto } = await executarGraphql(corpo);
    if (status !== 200) return { resultado: "erro", erro: `http ${status}` };
    const cls = classificarResposta(status, bruto, "busca");
    if (cls.resultado !== "ok") return cls;
    return { resultado: "ok", objs: linhasJson(bruto) };
  };

  async function buscarGrupos({ termo, limite = 60 }) {
    const cands = candidatosDe("busca");
    if (!cands.length)
      return { resultado: "erro", erro: "sem calibração de busca — pesquise 'grupos' no Facebook manualmente" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      const mapa = new Map();
      let cal = null, cursor, vazias = 0;
      // até 90 páginas como eles; para em 2 páginas vazias seguidas
      for (let pagina = 0; pagina < 90; pagina++) {
        const antes = mapa.size;
        if (!cal) {
          // 1ª página: testa candidatos até um responder válido (Ma deles)
          let ultimo = null;
          for (const c of cands) {
            const r = await paginaBusca(c, termo, undefined);
            if (r.resultado === "bloqueado")
              return { resultado: "bloqueado", erro: r.erro };
            if (r.resultado === "ok") {
              cal = c;
              cursor = extrairGrupos(r.objs, mapa);
              break;
            }
            ultimo = r;
          }
          if (!cal) return ultimo ?? { resultado: "erro", erro: "nenhum molde de busca respondeu" };
        } else {
          const r = await paginaBusca(cal, termo, cursor ?? null);
          if (r.resultado === "bloqueado")
            return { resultado: "bloqueado", erro: r.erro };
          if (r.resultado !== "ok") return r;
          cursor = extrairGrupos(r.objs, mapa);
        }
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

  // tombstone/hidden/deleted (Et deles): post já oculto/removido não
  // deve entrar na fila de like/comment
  const RE_TUMBA =
    /"tombstone"|StoryTombstone|"is_hidden":\s*true|"hidden_by_viewer|"can_viewer_see_content":\s*false|"is_deleted":\s*true|"visibility":"HIDDEN"|hidden_story/i;

  const extrairPostsFeed = (objs) => {
    const mapa = new Map();
    let cursor;
    const coletar = (node) => {
      if (!node || typeof node !== "object") return;
      try {
        if (RE_TUMBA.test(JSON.stringify(node).slice(0, 30000))) return;
      } catch {}
      let feedbackId, postId, autorId, autorNome;
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
        // nome do autor p/ dedup por autor sem id (uid/slug/name deles)
        if (!autorNome)
          autorNome = o.owners?.[0]?.name ?? o.actors?.[0]?.name ??
            o.author?.name ?? o.owner?.name;
        for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
      };
      visitar(node);
      if (feedbackId) mapa.set(feedbackId, { feedbackId, postId, autorId, autorNome });
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
    const cands = candidatosDe("feed");
    if (!cands.length) return { resultado: "erro", erro: "sem calibração de feed — abra um grupo no Facebook" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      let ultimo = null;
      // tenta cada molde até um responder (Ma deles)
      for (const cal of cands) {
        const trocas = cal.sampleGroupId
          ? [{ de: cal.sampleGroupId, para: idGrupo, embutido: true }]
          : [];
        const corpo = montarRequisicao(cal, { trocas, cursor: cursor ?? null });
        const { status, texto: bruto } = await executarGraphql(corpo);
        const cls = classificarResposta(status, bruto, "feed");
        if (cls.resultado === "bloqueado") return cls;
        if (cls.resultado === "erro") { ultimo = cls; continue; }
        const { posts, cursor: proximo } = extrairPostsFeed(linhasJson(bruto));
        return { resultado: "ok", posts, cursor: proximo };
      }
      return ultimo ?? { resultado: "erro", erro: "nenhum molde de feed respondeu" };
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
    const registrar = (o, ehEdge) => {
      const ehUsuario = o.__typename === "User" || o.__isActor === "User" || ehEdge;
      const id = o.id;
      if (!ehUsuario || !id || !/^\d{5,}$/.test(String(id))) return;
      let status = o.friendship_status ?? o.friendshipStatus;
      if (!status) {
        const titulo = o.profile_action?.title?.text ?? "";
        if (/cancelar pedido/i.test(titulo)) status = "OUTGOING_REQUEST";
        else if (/^amigos$/i.test(titulo)) status = "ARE_FRIENDS";
        else if (/adicionar|add friend/i.test(titulo)) status = "CAN_REQUEST";
      }
      const nome = o.name ?? o.title?.text;
      const antigo = mapa.get(String(id));
      // Vt deles: só sobrescreve se vier status novo
      if (!antigo || status) mapa.set(String(id), { id: String(id), nome, status });
    };
    const visitar = (o, prof = 0) => {
      if (!o || typeof o !== "object" || prof > 25) return;
      const pi = o.page_info;
      if (pi?.end_cursor && pi.has_next_page && !cursor) cursor = pi.end_cursor;
      // edges[].node sem exigir __typename — nó de lista de membros
      if (o.node && typeof o.node === "object") registrar(o.node, true);
      registrar(o, false);
      for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v, prof + 1);
    };
    objs.forEach(visitar);
    return cursor;
  };

  async function membrosDoGrupo({ idGrupo, cursor, tipo }) {
    // candidatos do tipo pedido + fallback pro tipo geral, dedup por doc_id
    const vistos = new Set();
    const cands = [...candidatosDe(tipo || "membros"), ...candidatosDe("membros")]
      .filter((c) => c?.docId && !vistos.has(c.docId) && (vistos.add(c.docId), true));
    if (!cands.length)
      return { resultado: "erro", erro: "sem calibração de membros — abra a aba Membros de um grupo" };
    const postando = window.__fbPostando;
    window.__fbPostando = true;
    try {
      let ultimo = null;
      for (const cal of cands) {
        const trocas = cal.sampleGroupId
          ? [{ de: cal.sampleGroupId, para: idGrupo, embutido: true }]
          : [];
        const corpo = montarRequisicao(cal, { trocas, cursor: cursor ?? null });
        const { status, texto: bruto } = await executarGraphql(corpo);
        const cls = classificarResposta(status, bruto, "membros");
        if (cls.resultado === "bloqueado") return cls;
        if (cls.resultado === "erro") { ultimo = cls; continue; }
        const mapa = new Map();
        const proximo = extrairUsuarios(linhasJson(bruto), mapa);
        mapa.delete(uidAtual()); // nunca pedir amizade pra si mesmo (zt deles)
        return { resultado: "ok", usuarios: [...mapa.values()], cursor: proximo };
      }
      return ultimo ?? { resultado: "erro", erro: "nenhum molde de membros respondeu" };
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
      const cls = classificarResposta(status, bruto, "amigo");
      if (cls.resultado === "bloqueado") return { resultado: "bloqueado", erro: cls.erro };
      // erro GraphQL cujo texto diz "já são amigos/pedido já enviado" (qt deles)
      if (cls.resultado === "erro" && cls.erro && RE_JA_AMIGO.test(cls.erro))
        return { resultado: "ja_amigo" };

      // escopo friend_requestees[0] primeiro (como eles) — evita pegar
      // friendship_status de outro nó da resposta
      const statusAmizade =
        bruto.match(/"friend_requestees"\s*:\s*\[\s*\{[\s\S]{0,600}?"friendship_status"\s*:\s*"([^"]+)"/)?.[1] ??
        pegarPrimeiro(bruto, /"friendship_status"\s*:\s*"([^"]+)"/);
      // actionTitle bilíngue: "Amigos"→already, "Cancelar pedido"→enviado
      const tituloAcao = bruto.match(
        /"profile_action"\s*:\s*\{[^}]*?"title"\s*:\s*\{[^}]*?"text"\s*:\s*"([^"]+)"/
      )?.[1];
      if (/ARE_FRIENDS|FRIENDS|INCOMING_REQUEST/.test(statusAmizade || "") ||
          (tituloAcao && /^amigos$/i.test(tituloAcao)) || RE_JA_AMIGO.test(bruto))
        return { resultado: "ja_amigo" };
      if ("CAN_REQUEST" === statusAmizade)
        return { resultado: "falhou", erro: "pedido não registrado" };
      if ("OUTGOING_REQUEST" === statusAmizade ||
          (tituloAcao && /cancelar pedido|cancel request/i.test(tituloAcao)) ||
          RE_ENVIADO.test(bruto))
        return { resultado: "enviado" };
      // como eles: resposta sem sinal de envio = falhou (não assume enviado)
      if (cls.resultado === "erro") return { resultado: "falhou", erro: cls.erro };
      return {
        resultado: "falhou",
        erro: statusAmizade ? `friendship_status:${statusAmizade}` : "resposta_desconhecida",
      };
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
      return classificarResposta(status, bruto, "listing");
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
    if (daPagina)
      return {
        token: daPagina, fonte: "pagina",
        expiraEm: +document.documentElement.innerHTML
          .match(/__accessTokenExpirySecondsRemaining["']?\s*[:=]\s*"?(\d+)/)?.[1] || undefined,
      };
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
        if (t)
          return {
            token: t, fonte: `headless-${fonte[0]}`,
            expiraEm: +html.match(/__accessTokenExpirySecondsRemaining["']?\s*[:=]\s*"?(\d+)/)?.[1] || undefined,
          };
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
      let url =
        "https://graph.facebook.com/me/groups?fields=id,name,member_count,administrator" +
        `&limit=100&access_token=${encodeURIComponent(tk.token)}`;
      const grupos = [];
      // paging.next — usuários com muitos grupos precisam de páginas
      for (let pag = 0; pag < 10 && url; pag++) {
        const res = await fetch(url);
        const j = await res.json().catch(() => null);
        if (!j?.data) {
          if (!pag)
            return { resultado: "erro", erro: j?.error?.message ?? `graph api falhou (http ${res.status})` };
          break;
        }
        for (const g of j.data)
          grupos.push({
            id: String(g.id),
            nome: g.name,
            membros: g.member_count,
            admin: !!g.administrator,
          });
        url = j.paging?.next ?? null;
      }
      return { resultado: "ok", fonte: tk.fonte, grupos, expiraEm: tk.expiraEm };
    } catch (e) {
      return { resultado: "erro", erro: e.message };
    } finally {
      window.__fbPostando = postando;
    }
  }

  // ---------- DOM fallback (portado: J/Qs/ea/na/ra/oa deles) ----------
  // quando não há calibração GraphQL, age direto nos elementos da página
  const SELETORES = {
    feed: ['div[role="feed"]'],
    post: ['div[role="article"]', "div.x1n2onr6.xh8yej3.x1ja2u2z.xod5an3"],
    likeBtn: [
      'div[role="button"][tabindex="0"]:has([data-ad-rendering-role="like_button"])',
      'div[aria-label="Curtir"][role="button"]',
      'div[aria-label="Gosto"][role="button"]',
      'div[aria-label="Like"][role="button"]',
      'div[role="button"][aria-label*="Curtir" i]:not([aria-label*="curtiu" i]):not([aria-label*="curtiram" i]):not([aria-label*="curtida" i]):not([aria-label*="alterar reaç" i]), div[role="button"][aria-label*="Like" i]:not([aria-label*="liked" i]):not([aria-label*="likes" i]):not([aria-label*="change reaction" i])',
      '.x1i10hfl.xjbqb8w[role="button"]:not([aria-label*="curtiu" i]):not([aria-label*="curtiram" i]):not([aria-label*="liked" i]):not(:has(img))',
    ],
    commentBtn: [
      'div[role="button"][tabindex="0"]:has([data-ad-rendering-role="comment_button"])',
      'div[aria-label*="Comentar"][role="button"]',
      'div[aria-label*="Comment"][role="button"]',
      'div[aria-label*="omenta"][role="button"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[role="button"][aria-label*="Escreva um comentário" i]',
    ],
    commentComposer: [
      'div[aria-label="Escreva um comentário público…"][contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    // commentBox deles: variante mais estrita, usada pra achar a caixa
    // já aberta sem depender do botão
    commentBox: [
      'div[aria-label="Escreva um comentário público…"][contenteditable="true"][role="textbox"]',
    ],
    postAuthor: [
      'h2 a[role="link"][href]',
      'h3 a[role="link"][href]',
      'a[href*="/groups/"][href*="/user/"]',
      'a[href*="profile.php?id="]',
      'span a[role="link"][href]',
    ],
    pendingComment: [
      'span[dir="auto"]',
      "span",
      'div[role="article"] span',
      'a[role="link"] span',
    ],
    blockModal: [
      'div[role="dialog"][aria-modal="true"]',
      // ids internos do FB pro diálogo de bloqueio (deles usam igual)
      'div[aria-labelledby="_r_1oo_"][aria-modal="true"]',
      'div[role="dialog"] h2:has(#_r_ed_), div[role="dialog"] h2:has(#_r_ed_v)',
    ],
    composerImage: ["img"],
    fileInput: ['input[type="file"]'],
    composerParagraph: ["p"],
  };
  const TXTS_INDISPONIVEL = ["Esse conteúdo não está disponível no momento"];
  const TXTS_PENDENTE = [
    "Pendente", "Pendente de aprovação", "Aguardando aprovação",
    "Comentário pendente", "Pending", "Pending approval",
    "Waiting for approval", "Awaiting approval",
  ];
  const TXTS_BLOQUEIO_MODAL = [
    "Você está bloqueado temporariamente",
    "Você está bloqueada temporariamente",
    "You're temporarily blocked",
    "You’re temporarily blocked",
  ];
  const ATTR_IDX = "data-fbap-idx";
  const ATTR_COMENTADO = "data-fbap-comentado";
  const RE_DESLIKE = /remover|remove|unlike|descurtir|retirar|quitar|eliminar/i;
  const norm = (s) =>
    (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const pendentesNorm = TXTS_PENDENTE.map(norm);

  // override de seletores em runtime (X.selectors deles): window.__SP_SELETORES
  // = {nome: [seletores extras]} — consultados ANTES dos defaults
  const seletoresDe = (nome) => [
    ...(window.__SP_SELETORES?.[nome] ?? []),
    ...(SELETORES[nome] ?? []),
  ];
  const visivelDom = (el) => {
    if (!el || !el.isConnected) return false;
    const c = getComputedStyle(el);
    if ("none" === c.display || "hidden" === c.visibility || "0" === c.opacity)
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const qAll = (sel, escopo) => {
    try {
      return [...escopo.querySelectorAll(sel)].filter((e) => e instanceof HTMLElement);
    } catch { return []; }
  };
  const acharEl = (nome, { escopo = document, pick = "first", soVisiveis = false } = {}) => {
    for (const sel of seletoresDe(nome)) {
      let lista = qAll(sel, escopo);
      if (soVisiveis) lista = lista.filter(visivelDom);
      if (!lista.length) continue;
      return pick === "last" ? lista[lista.length - 1] : lista[0];
    }
    return null;
  };
  const acharEls = (nome, escopo = document) =>
    qAll(seletoresDe(nome).join(","), escopo);
  const acharComTexto = (sels, textos) => {
    for (const sel of sels)
      for (const el of qAll(sel, document)) {
        if (!textos.length) return el;
        const txt = el.innerText || el.textContent || "";
        if (textos.some((t) => txt.includes(t))) return el;
      }
    return null;
  };
  const dormirDom = (ms) => new Promise((r) => setTimeout(r, ms));

  // próximo post do feed ainda não processado (pe deles) — marca com ATTR_IDX
  const domJob = {
    ativo: false, parar: false, pausado: false, feitos: 0, limite: 0, semAchar: 0,
    idx: 1, ultimoIdx: 0, ultimos: [], autores: new Set(),
    pularRestantes: 0, acoesAntesPular: 0, contadorPular: 0, idxTexto: 0,
  };
  const proximoPostDom = () => {
    const feed = acharEl("feed");
    if (!feed) return null;
    const todos = acharEls("post", feed).filter((el) => {
      // só artigos de topo (post dentro de post não conta)
      const sel = SELETORES.post.join(",");
      let n = el.parentElement;
      for (; n && n !== document.body;) {
        if (n.matches?.(sel)) return false;
        n = n.parentElement;
      }
      return true;
    });
    let escolhido = null, menor = Infinity;
    for (const el of todos) {
      const a = el.getAttribute(ATTR_IDX);
      if (!a) { if (escolhido === null) escolhido = el; continue; }
      const n = parseInt(a, 10);
      if (n > domJob.ultimoIdx && n < menor) { escolhido = el; menor = n; }
    }
    return escolhido;
  };
  const rolarDom = () => {
    const el = proximoPostDom();
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    else window.scrollBy({ top: 0.8 * innerHeight, behavior: "smooth" });
  };

  // autor do post: uid numérico ou slug/normalizado (i() deles)
  const autorDoPostDom = (post) => {
    try {
      const link = acharEl("postAuthor", { escopo: post });
      if (!link) return {};
      const uid = link.href
        ? link.href.match(/\/user\/(\d+)/)?.[1] ??
          link.href.match(/profile\.php\?id=(\d+)/)?.[1] ??
          (() => {
            const s = link.href.match(/facebook\.com\/([^/?#]+)/)?.[1];
            return s && !["groups", "profile.php"].includes(s) ? s : undefined;
          })()
        : undefined;
      return { uid, nome: link.textContent?.trim() || undefined };
    } catch { return {}; }
  };

  // digita texto no composer: execCommand primeiro, fallback eventos por char
  const digitarDom = (el, texto) => {
    el.focus();
    try { document.execCommand("insertText", false, texto); return; } catch {}
    for (const ch of texto) {
      const code = ch.charCodeAt(0);
      const ev = { key: ch, code: `Key${ch.toUpperCase()}`, keyCode: code, which: code, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", ev));
      el.dispatchEvent(new KeyboardEvent("keypress", ev));
      const p = qAll(SELETORES.composerParagraph.join(","), el)[0];
      if (p) p.textContent += ch; else el.textContent += ch;
      el.dispatchEvent(new InputEvent("input", { data: ch, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", ev));
    }
  };

  // cola imagem no composer: ClipboardEvent paste + espera preview;
  // fallback: injeta File no input[type=file] (ct/Qs deles)
  const colarImagemDom = async (el, dataUrl) => {
    try {
      const [head, b64] = dataUrl.split(",");
      const mime = head.match(/:(.*?);/)?.[1] ?? "image/png";
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const arquivo = new File([new Blob([bytes], { type: mime })], "image.png", { type: mime });
      const dt = new DataTransfer();
      dt.items.add(arquivo);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      // espera thumbnail aparecer (até ~3s)
      for (let i = 0; i < 15; i++) {
        if (qAll(SELETORES.composerImage.join(","), el)[0]) break;
        await dormirDom(200);
      }
      // fallback: alguns composers só aceitam via input file
      const input = qAll(SELETORES.fileInput.join(","), document)[0];
      if (input instanceof HTMLInputElement) {
        const dt2 = new DataTransfer();
        dt2.items.add(arquivo);
        input.files = dt2.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch {}
  };

  // comenta num post via DOM: abre caixa, digita/cola, Enter envia (Qs deles)
  const comentarNoPostDom = async (post, { texto, fotoDataUrl }) => {
    try {
      const artigo = post.closest('[role="article"]') || post;
      // composer já dentro do post? sobe até 6 níveis procurando
      let caixa = (() => {
        const sel = SELETORES.commentComposer.join(",");
        let n = post, i = 0;
        for (; n && i < 6;) {
          const c = qAll(sel, n)[0];
          if (c) {
            const art = c.closest('[role="article"]');
            if (!art || art === post) return c;
          }
          n = n.parentElement; i++;
        }
        return null;
      })();
      if (caixa) { caixa.click(); caixa.focus(); await dormirDom(300); }
      else {
        const btn = acharEl("commentBtn", { escopo: artigo });
        if (!btn) return null;
        btn.click();
        await dormirDom(800 + 700 * Math.random());
        // commentBox (variante estrita) antes do composer genérico
        caixa = acharEl("commentBox", { escopo: artigo }) ??
                acharEl("commentComposer", { escopo: artigo }) ??
                acharEl("commentBox", { pick: "last" }) ??
                acharEl("commentComposer", { pick: "last" });
        if (!caixa) return null;
        caixa.click(); caixa.focus(); await dormirDom(300);
      }
      let digitado = "";
      if (texto) {
        digitado = texto;
        digitarDom(caixa, texto);
        await dormirDom(400);
      }
      if (fotoDataUrl) {
        await colarImagemDom(caixa, fotoDataUrl);
        await dormirDom(600);
      }
      for (const ev of ["blur", "focus", "input", "change"])
        try { caixa.dispatchEvent(new Event(ev, { bubbles: true, cancelable: true })); } catch {}
      await dormirDom(200);
      caixa.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
      await dormirDom(500);
      caixa.blur();
      await dormirDom(200);
      return digitado;
    } catch { return null; }
  };

  // like via DOM: clica se ainda não está "remover/descurtir" (parte de ea deles)
  const curtirNoPostDom = async (post) => {
    try {
      const btn = acharEl("likeBtn", { escopo: post });
      if (!btn) return false;
      const label = btn.getAttribute("aria-label") || "";
      if (RE_DESLIKE.test(label)) return true; // já curtido
      btn.click();
      await dormirDom(300);
      return true;
    } catch { return false; }
  };

  // comentário caiu na fila de moderação? procura selo "Pendente" perto (xe deles)
  const pendenteComentarioDom = (post, textoEnviado = "") => {
    try {
      const trecho = norm(textoEnviado).slice(0, 60);
      const areas = [post];
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog && dialog !== post && !post.contains(dialog)) areas.push(dialog);
      let melhor = 0;
      const uid = uidAtual();
      for (const area of areas) {
        const mesmoTexto = trecho.length >= 4 &&
          norm(area.innerText || area.textContent || "").includes(trecho);
        for (const el of acharEls("pendingComment", area)) {
          const txt = norm(el.innerText || el.textContent || "");
          if (!txt) continue;
          if (!pendentesNorm.some((m) => txt.includes(m))) continue;
          let score = 0.45, achouAutor = false, achouArtigo = false, n = el;
          // sobe até 12 níveis procurando o article e link do nosso
          // próprio perfil — selo só conta se for do NOSSO comentário
          for (let i = 0; n && i < 12 && !(achouAutor && achouArtigo); i++, n = n.parentElement) {
            if (!achouArtigo && n.matches?.('[role="article"]')) achouArtigo = true;
            if (!achouAutor && uid && n.querySelector?.(`a[href*="${uid}"]`)) achouAutor = true;
          }
          if (visivelDom(el)) score += 0.1;
          if (mesmoTexto) score += 0.35;
          if (achouAutor) score += 0.2;
          if (achouArtigo) score += 0.1;
          melhor = Math.max(melhor, Math.min(1, score));
        }
      }
      return melhor >= 0.7;
    } catch { return false; }
  };

  // verifica os últimos posts comentados p/ selo de pendente (na deles)
  const vigiarPendentesDom = () => {
    for (const u of domJob.ultimos) {
      const post = document.querySelector(`[${ATTR_IDX}="${u.ordinal}"]`);
      if (post && pendenteComentarioDom(post, u.texto)) return true;
    }
    return false;
  };

  const progressoDom = (extra = {}) =>
    emitir("domProgresso", {
      feitos: domJob.feitos, limite: domJob.limite, ...extra,
    });
  const fimDom = (status, extra = {}) => {
    domJob.ativo = false;
    emitir("domFim", { status, feitos: domJob.feitos, limite: domJob.limite, ...extra });
  };

  // um passo do loop: pega próximo post, like/comenta, agenda o seguinte (ea deles)
  const passoDom = async (cfg) => {
    if (!domJob.ativo || domJob.parar) return fimDom("parado");
    if (domJob.feitos >= cfg.limite) return fimDom("concluido");
    if (vigiarPendentesDom()) return fimDom("bloqueio_pendente");
    if (acharComTexto(SELETORES.blockModal, TXTS_BLOQUEIO_MODAL)) return fimDom("bloqueado");

    const post = proximoPostDom();
    if (!post) {
      if (++domJob.semAchar >= 15) return fimDom("concluido");
      rolarDom();
      return agendarDom(cfg, true);
    }
    post.setAttribute(ATTR_IDX, String(domJob.idx));
    domJob.ultimoIdx = domJob.idx++;
    domJob.semAchar = 0;
    if (TXTS_INDISPONIVEL.some((t) => (post.innerText || "").includes(t))) {
      rolarDom();
      return agendarDom(cfg, true);
    }
    // humanização: pula N posts a cada M ações (skipInitial/sendBeforeSkip deles)
    if (domJob.pularRestantes > 0) {
      domJob.pularRestantes--;
      rolarDom();
      return agendarDom(cfg, true);
    }
    // só autores diferentes (dedup por uid/slug/nome)
    let chaveAutor = "";
    if (cfg.soDiferentes) {
      const { uid, nome } = autorDoPostDom(post);
      chaveAutor = uid || (nome ? norm(nome).replace(/\s+/g, " ") : "");
      if (chaveAutor && domJob.autores.has(chaveAutor)) {
        rolarDom();
        return agendarDom(cfg, true);
      }
      // de.add() deles só roda APÓS ação bem-sucedida — autor de ação
      // falha não queima o dedup
    }

    const querLike = cfg.acoes.includes("like");
    const querComentario = cfg.acoes.includes("comment") &&
      (cfg.textos?.length || (cfg.commentMode !== "texto" && cfg.fotoDataUrl));
    const precisaLike = querLike &&
      !RE_DESLIKE.test(acharEl("likeBtn", { escopo: post })?.getAttribute("aria-label") || "");
    const precisaComentario = querComentario && post.getAttribute(ATTR_COMENTADO) !== "1";
    if (!precisaLike && !precisaComentario) {
      rolarDom();
      return agendarDom(cfg, true);
    }

    let agiu = false, textoEnviado = "";
    if (precisaLike) agiu = await curtirNoPostDom(post) || agiu;
    if (precisaComentario && !domJob.parar) {
      const base = cfg.textos?.length
        ? cfg.textos[domJob.idxTexto++ % cfg.textos.length]
        : "";
      const texto = spintaxDom(base, cfg.vars);
      const foto = cfg.fotoDataUrl &&
        (cfg.commentMode === "ambos" || cfg.commentMode === "imagem" ||
         (cfg.commentMode === "aleatorio" && Math.random() < 0.5))
          ? cfg.fotoDataUrl : null;
      const enviado = await comentarNoPostDom(post, {
        texto: cfg.commentMode === "imagem" ? null : texto,
        fotoDataUrl: foto,
      });
      if (enviado !== null) {
        agiu = true;
        textoEnviado = enviado;
        post.setAttribute(ATTR_COMENTADO, "1");
      }
    }
    if (agiu) {
      if (chaveAutor) domJob.autores.add(chaveAutor);
      domJob.feitos++;
      domJob.ultimos.unshift({ ordinal: domJob.ultimoIdx, texto: textoEnviado, em: Date.now() });
      if (domJob.ultimos.length > 4) domJob.ultimos.length = 4;
      if (++domJob.contadorPular >= domJob.acoesAntesPular) {
        domJob.pularRestantes = aleatorioDom(cfg.skipMin, cfg.skipMax);
        domJob.contadorPular = 0;
        domJob.acoesAntesPular = aleatorioDom(cfg.acoesMin, cfg.acoesMax);
      }
      progressoDom();
      rolarDom();
      return agendarDom(cfg);
    }
    domJob.semAchar++;
    rolarDom();
    agendarDom(cfg, true);
  };

  const aleatorioDom = (min, max) => Math.round(min + Math.random() * (max - min));
  // delay entre ações com progresso (ra deles — skip usa 1-3s)
  const agendarDom = (cfg, rapido = false) => {
    if (!domJob.ativo) return;
    const ms = rapido
      ? 1000 * (1 + Math.random() * 2)
      : 1000 * (cfg.delayMin + Math.random() * (cfg.delayMax - cfg.delayMin));
    let inicio = Date.now();
    const timer = setInterval(() => {
      // pausa congela o countdown (PAUSE/RESUME deles)
      if (domJob.pausado) { inicio = Date.now(); progressoDom({ pausado: true }); return; }
      const resto = Math.max(0, ms - (Date.now() - inicio));
      progressoDom({ aguardando: Math.ceil(resto / 1000), total: Math.ceil(ms / 1000) });
      if (resto <= 0 || !domJob.ativo || domJob.parar) {
        clearInterval(timer);
        if (domJob.parar || !domJob.ativo) return fimDom("parado");
        passoDom(cfg);
      }
    }, 250);
  };

  // spintax no motor DOM ({{nome}} com listas + {a|b} inline)
  const contadoresSpinDom = new Map();
  const spintaxDom = (texto, vars) => {
    if (!texto) return texto;
    let s = texto.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, nome) => {
      const v = vars?.[nome.trim().toLowerCase()];
      if (!v?.length) return m;
      if (v.length === 1) return v[0];
      const i = contadoresSpinDom.get(nome) ?? 0;
      contadoresSpinDom.set(nome, (i + 1) % v.length);
      return v[i];
    });
    return s.replace(/\{([^{}]+)\}/g, (_, op) => {
      const partes = op.split("|").map((x) => x.trim()).filter(Boolean);
      return partes.length ? partes[Math.floor(Math.random() * partes.length)] : "";
    });
  };

  async function engajarDomIniciar(cfg) {
    if (domJob.ativo) return { resultado: "erro", erro: "engajamento DOM já rodando" };
    if (!(uidAtual() && dtsgDaPagina()))
      return { resultado: "erro", erro: "sessão inválida — faça login no Facebook" };
    if (!acharEl("feed"))
      return { resultado: "erro", erro: "feed não visível — abra a página do grupo no Facebook" };
    Object.assign(domJob, {
      ativo: true, parar: false, pausado: false, feitos: 0, limite: cfg.limite ?? 10,
      semAchar: 0, idx: 1, ultimoIdx: 0, ultimos: [], autores: new Set(),
      pularRestantes: aleatorioDom(cfg.skipMin ?? 0, cfg.skipMax ?? 2),
      acoesAntesPular: aleatorioDom(cfg.acoesMin ?? 3, cfg.acoesMax ?? 6),
      contadorPular: 0, idxTexto: 0,
    });
    passoDom(cfg);
    return { resultado: "ok", status: "iniciado" };
  }

  // ---------- listingProbe (portado: arma e grava shapes p/ mapear fluxos) ----------
  const probeRec = { ativo: false, passos: [], seq: 0 };
  const RE_SENSIVEL = /fb_dtsg|jazoest|lsd|__user|token|password|email|cookie/i;
  const shapeDe = (v, prof = 0) => {
    if (v == null || prof > 6) return typeof v;
    if (Array.isArray(v)) return [shapeDe(v[0], prof + 1)];
    if (typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v))
        o[k] = RE_SENSIVEL.test(k) ? "[redigido]" : shapeDe(x, prof + 1);
      return o;
    }
    return typeof v === "string" ? `str(${v.length})` : typeof v;
  };
  const gravarPasso = (passo) => {
    if (!probeRec.ativo || probeRec.passos.length >= 300) return;
    probeRec.passos.push({ seq: ++probeRec.seq, em: Date.now(), ...passo });
  };

  // ---------- ponte de mensagens ----------
  // envelope v1 validado (t deles): fonte+direcao+versao+id 8-64+ts ±15s,
  // dedup de id e rate-limit 10/seg por ação — bloqueia scripts de página
  const __idsVistos = new Set();
  const __janelas = new Map();
  const validarEntrada = (d) => {
    if (!d || d.fonte !== MARCA || d.direcao !== "entrada" || !d.acao) return false;
    if (d.versao !== 1) return false;
    const agora = Date.now();
    if (typeof d.ts !== "number" || Math.abs(agora - d.ts) > 15000) return false;
    if (d.id != null) {
      if (typeof d.id !== "string" || d.id.length < 8 || d.id.length > 64) return false;
      if (__idsVistos.has(d.id)) return false;
      __idsVistos.add(d.id);
      if (__idsVistos.size > 500)
        __idsVistos.delete(__idsVistos.values().next().value);
    }
    const j = (__janelas.get(d.acao) ?? []).filter((t) => agora - t < 1000);
    if (j.length >= 10) return false;
    j.push(agora);
    __janelas.set(d.acao, j);
    return true;
  };

  // leader election light (portado): navigator.locks garante que só UMA aba
  // do FB executa ação por vez — duas abas não correm a mesma automação
  const ACOES_COM_LOCK = new Set([
    "postar", "curtir", "comentar", "entrar", "buscar",
    "feed", "membros", "amizade", "listing", "engajarDom",
  ]);
  const comLock = async (acao, fn) => {
    if (!ACOES_COM_LOCK.has(acao) || !navigator.locks?.request) return fn();
    let rodou = false, res = null;
    try {
      await navigator.locks.request("fb-autopost-job", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          res = { resultado: "erro", erro: "outra aba do Facebook já está executando uma ação" };
          return;
        }
        rodou = true;
        res = await fn();
      });
      return res;
    } catch (e) {
      // falha da API de locks antes de rodar → segue sem lock;
      // erro do fn → propaga (retentar repetiria a ação — postaria 2x)
      if (rodou) throw e;
      return fn();
    }
  };

  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!validarEntrada(d)) return;
    const { id, acao, dados } = d;
    (async () => {
      try {
        let resultado;
        resultado = await comLock(acao, async () => {
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
        else if (acao === "engajarDom") resultado = await engajarDomIniciar(dados ?? {});
        else if (acao === "domParar") {
          domJob.parar = true;
          if (!domJob.ativo) resultado = { resultado: "ok", status: "parado" };
          else resultado = { resultado: "ok", status: "parando" };
        } else if (acao === "domPausar") {
          domJob.pausado = !domJob.pausado;
          resultado = { resultado: "ok", pausado: domJob.pausado };
        } else if (acao === "probeIniciar") {
          probeRec.ativo = true;
          probeRec.passos = [];
          probeRec.seq = 0;
          resultado = { resultado: "ok", status: "gravando" };
        } else if (acao === "probeParar") {
          probeRec.ativo = false;
          resultado = { resultado: "ok", passos: probeRec.passos };
        } else if (acao === "probesStats") {
          // restaura scores persistidos (sanitiza ids removidos — Me deles)
          const salvo = dados;
          if (salvo && typeof salvo === "object")
            for (const tipo of Object.keys(salvo)) {
              const balde = window.__SP_PROBES[tipo] ?? (window.__SP_PROBES[tipo] = {});
              for (const [chave, mapa] of Object.entries(salvo[tipo] ?? {})) {
                const dest = balde[chave] ?? (balde[chave] = {});
                for (const [id2, sc] of Object.entries(mapa ?? {}))
                  if (IDS_PROBES.has(id2) && typeof sc === "number") dest[id2] = sc;
              }
            }
          resultado = { ok: true };
        } else if (acao === "ping")
          resultado = {
            ok: true,
            calibracoes: Object.keys(window.__SP_CAPTURAS),
            docIds: window.__SP_DOCIDS ? window.__SP_DOCIDS.size : 0,
            sessao: !!(uidAtual() && dtsgDaPagina()),
            video: { inicio: !!videoInicio, upload: !!videoUpload, fim: !!videoFim },
            dom: domJob.ativo ? (domJob.pausado ? "pausado" : true) : false,
            probeRec: probeRec.ativo ? probeRec.passos.length : false,
            probes: Object.values(window.__SP_PROBES).reduce(
              (n, b) => n + Object.values(b).reduce((m, s) => m + Object.keys(s).length, 0), 0),
            telemetria: telemetriaPagina(), // app_version/work account deles
          };
        else resultado = { resultado: "erro", erro: "ação desconhecida" };
        return resultado;
        });
        emitir("resposta", { id, resultado });
      } catch (e) {
        emitir("resposta", { id, resultado: { resultado: "erro", erro: e.message } });
      }
    })();
  });

  // telemetria da página (snapshot deles): versão do app, conta work,
  // IG business — cacheado, serve pra diagnóstico no painel
  let __telemetria;
  const telemetriaPagina = () => {
    if (__telemetria) return __telemetria;
    const fonte = document.documentElement.innerHTML.slice(0, 2e6);
    __telemetria = {
      appVersion: fonte.match(/"app_version"\s*:\s*"([^"]+)"/)?.[1] ??
        fonte.match(/"APP_VERSION"\s*:\s*"([^"]+)"/)?.[1],
      contaWork: /"IS_FACEBOOK_WORK_ACCOUNT"\s*:\s*true/i.test(fonte) || undefined,
      igBusiness: /"IS_(INSTAGRAM|WABA)_BUSINESS_PERSON"\s*:\s*true/i.test(fonte) || undefined,
      cohort: fonte.match(/"cohort"\s*:\s*"([^"]+)"/)?.[1],
    };
    return __telemetria;
  };

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
    // delega pro minerarPares (genérico + membros + objetos JSON)
    for (const fonte of fontes) minerarPares(fonte);
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
    if (sessaoViva && !viva) {
      emitir("sessaoInvalidada", { motivo: "cookie/dtsg sumiram" });
      if (domJob.ativo) domJob.parar = true; // para o job DOM também (sessionInvalidated deles)
    }
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
