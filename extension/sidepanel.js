const $ = (id) => document.getElementById(id);
const logEl = $("log");
let rodando = false, parar = false;
let gruposEncontrados = [];

// ---------- abas ----------
for (const t of document.querySelectorAll(".tab"))
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("ativo"));
    document.querySelectorAll(".pane").forEach((x) => x.classList.remove("ativo"));
    t.classList.add("ativo");
    $("tab-" + t.dataset.tab)?.classList.add("ativo");
  });

const TIPOS = {
  post: "Post", postFoto: "Post+foto", postVideo: "Post+vídeo",
  postMisto: "Post misto", listing: "Marketplace", comentario: "Comentário",
  comentarioFoto: "Coment+foto", like: "Like", entrar: "Entrar",
  busca: "Busca", feed: "Feed", membros: "Membros", amigo: "Amizade",
  membros_admins: "Admins", membros_experts: "Experts",
  membros_contributors: "Contrib.", membros_near_you: "Perto",
};

function registrar(msg, cls = "l-info") {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  const linha = document.createElement("div");
  linha.className = cls;
  linha.textContent = `[${hora}] ${msg}`;
  logEl.appendChild(linha);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderCalibs(cals = {}) {
  $("calibs").innerHTML = Object.entries(TIPOS)
    .map(([k, nome]) => {
      const ok = cals[k];
      return `<span class="chip${ok ? " ok" : ""}" title="${ok ? ok.nomeAmigavel : "não aprendido"}">
        <span class="dot"></span>${nome}</span>`;
    })
    .join("");
}

async function abaFb() {
  const abas = await chrome.tabs.query({ url: "https://www.facebook.com/*" });
  if (!abas.length) throw new Error("Nenhuma aba do facebook.com aberta");
  return abas.find((t) => t.active) || abas[0];
}

async function comando(acao, dados) {
  const aba = await abaFb();
  return chrome.tabs.sendMessage(aba.id, { tipo: "comando", acao, dados });
}

// ---------- dot de sessão no topo ----------
async function checarSessao() {
  const dot = $("sessaoDot");
  if (!dot) return;
  try {
    const p = await comando("ping");
    dot.className = "dot" + (p?.sessao ? " ok" : " warn");
    dot.title = p?.sessao ? "Sessão ativa no Facebook" : "Sem sessão — faça login";
  } catch {
    dot.className = "dot warn";
    dot.title = "Sem aba do Facebook aberta";
  }
}
checarSessao();
setInterval(checarSessao, 30000);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

// delay com progresso a cada ~250ms e interrompível (portado deles)
async function esperar(totalSeg, prefixo = "") {
  const totalMs = totalSeg * 1000;
  const inicio = Date.now();
  while (Date.now() - inicio < totalMs && !parar) {
    const restante = Math.ceil((totalMs - (Date.now() - inicio)) / 1000);
    $("progresso").textContent = `${prefixo}aguardando ${restante}/${totalSeg}s`;
    await dormir(Math.min(250, totalMs - (Date.now() - inicio)));
  }
  return !parar;
}

// spintax: {a|b} inline + {{nome}} com listas nomeadas (giro persistente)
const contadoresSpin = new Map();
const aplicarSpintax = (texto, vars) => {
  let saida = texto.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, nome) => {
    const v = vars?.[nome.trim().toLowerCase()];
    if (!v || !v.length) return m;
    if (v.length === 1) return v[0];
    const i = contadoresSpin.get(nome) ?? 0;
    contadoresSpin.set(nome, (i + 1) % v.length);
    return v[i];
  });
  return saida.replace(/\{([^{}]+)\}/g, (_, opcoes) => {
    const partes = opcoes.split("|").map((s) => s.trim()).filter(Boolean);
    return partes.length ? partes[Math.floor(Math.random() * partes.length)] : "";
  });
};

const lerVars = () => {
  const vars = {};
  for (const linha of $("vars").value.split("\n")) {
    const m = linha.match(/^\s*([\w]+)\s*=\s*(.+)$/);
    if (!m) continue;
    vars[m[1].toLowerCase()] = m[2].split("|").map((s) => s.trim()).filter(Boolean);
  }
  return vars;
};

const lerMensagens = () =>
  $("mensagem").value.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);

const salvarFila = (fila) => chrome.storage.local.set({ fila });
const limparFila = () => chrome.storage.local.remove(["fila", "retomarPendente"]);

const resolver = async (bruto) => {
  const r = await comando("resolver", { bruto });
  if (r.erro) throw new Error(r.erro);
  return r.idGrupo;
};

function controle(estado) {
  rodando = estado;
  parar = false;
  for (const b of ["btnPostar", "btnEngajar", "btnEntrar", "btnAmizade", "btnAquecer", "btnListing"])
    $(b).disabled = estado;
  $("btnParar").style.display = estado ? "block" : "none";
  if (!estado) $("progresso").textContent = "";
}

// ---------- postar ----------
async function postar(estadoInicial) {
  const grupos = estadoInicial?.grupos ??
    $("grupos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const mensagens = estadoInicial?.mensagens ?? lerMensagens();
  const vars = estadoInicial?.vars ?? lerVars();
  const modo = estadoInicial?.modo ?? $("modo").value;
  const limiteRodada = estadoInicial?.limiteRodada ?? Math.max(0, +$("limiteRodada").value || 0);
  const inicio = estadoInicial?.inicio ?? 0;
  const dmin = Math.max(5, +$("dmin").value || 60);
  const dmax = Math.max(dmin, +$("dmax").value || 180);
  const fotos = [...$("foto").files];
  const videos = [...$("video").files];

  if (!grupos.length) return registrar("Lista de grupos vazia", "l-err");
  if (!mensagens.length && !fotos.length && !videos.length &&
      !estadoInicial?.fotos?.length && !estadoInicial?.videos?.length)
    return registrar("Mensagem vazia", "l-err");

  const paraDataUrl = (arquivo) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(arquivo);
  });

  // mediaList (portado): variações {texto, foto, video} giradas por grupo
  const fotosUrl = estadoInicial?.fotos ??
    await Promise.all(fotos.map(paraDataUrl));
  const videosUrl = estadoInicial?.videos ??
    await Promise.all(videos.map(async (v) => {
      if (v.size > 30 * 1024 * 1024)
        throw new Error(`Vídeo ${v.name} muito grande (máx ~30MB)`);
      return paraDataUrl(v);
    }));

  // monta entradas de mídia: zíper das 3 listas (modo them: 1 item = texto+mídia)
  const nEntradas = Math.max(mensagens.length, fotosUrl.length, videosUrl.length);
  const mediaList = Array.from({ length: nEntradas }, (_, i) => ({
    texto: mensagens.length ? mensagens[i % mensagens.length] : "",
    foto: fotosUrl.length ? fotosUrl[i % fotosUrl.length] : null,
    video: videosUrl.length ? videosUrl[i % videosUrl.length] : null,
  }));
  const pegarMidia = (i) =>
    modo === "aleatorio"
      ? mediaList[Math.floor(Math.random() * mediaList.length)]
      : mediaList[i % mediaList.length];

  controle(true);
  try {
    const ping = await comando("ping").catch(() => null);
    if (!ping?.ok) {
      registrar("Motor não respondeu — recarregue a aba do Facebook", "l-err");
      return;
    }
    if (!ping.sessao)
      registrar("SESSÃO INVÁLIDA — faça login no Facebook", "l-err");
    registrar(`Motor ok — calibrações: ${ping.calibracoes.join(", ") || "nenhuma"} | doc_ids minerados: ${ping.docIds}`);
    if (!ping.calibracoes.includes("post"))
      registrar("Sem calibração de post: poste manualmente num grupo", "l-warn");

    const fim = limiteRodada > 0 ? Math.min(grupos.length, inicio + limiteRodada) : grupos.length;
    const cache = {};
    let algumSucesso = false, ultimoCodigo = "", repetidos = 0, feitos = inicio;

    for (let i = inicio; i < fim; i++) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const g = grupos[i];
      $("progresso").textContent = `${i + 1}/${grupos.length} — ${g}`;
      const m = pegarMidia(i);
      const msg = m.texto ? aplicarSpintax(m.texto, vars) : "";
      try {
        if (!cache[g]) cache[g] = await resolver(g);
        const res = await comando("postar", {
          idGrupo: cache[g], texto: msg,
          fotoDataUrl: m.foto, videoDataUrl: m.video,
        });
        feitos = i + 1;
        if (res.resultado === "ok") {
          algumSucesso = true; repetidos = 0; ultimoCodigo = "";
          registrar(`${g}: ${res.situacao || "publicado"}${res.postId ? " (id " + res.postId + ")" : ""}`, "l-ok");
          // delay só após sucesso (como eles — cooldown não roda em falha)
          if (i < fim - 1 && !parar)
            await esperar(aleatorio(dmin, dmax), `${i + 1}/${grupos.length} — `);
        } else if (res.resultado === "bloqueado") {
          registrar(`${g}: BLOQUEIO — ${res.erro}. Parando tudo.`, "l-err");
          await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, inicio: feitos, fotos: fotosUrl, videos: videosUrl });
          break;
        } else {
          registrar(`${g}: erro — ${res.erro}`, "l-warn");
          const codigo = res.erro?.match(/code\s+(\d+)|código\s+(\d+)/i)?.[1] ?? "";
          if (codigo && codigo === ultimoCodigo) repetidos++;
          else { ultimoCodigo = codigo; repetidos = 1; }
          if (!algumSucesso && repetidos >= 5) {
            registrar(`5 erros iguais seguidos (código ${codigo}) — calibração provavelmente podre. Parando.`, "l-err");
            break;
          }
        }
      } catch (e) {
        registrar(`${g}: ${e.message}`, "l-warn");
      }
    }

    // pacote: sobrou fila → agenda retomada
    if (feitos < grupos.length && !parar) {
      const rMin = Math.max(0, +$("retMin").value || 2);
      const rMax = Math.max(rMin, +$("retMax").value || 6);
      const horas = rMin + Math.random() * (rMax - rMin);
      await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, inicio: feitos, fotos: fotosUrl, videos: videosUrl });
      await chrome.alarms.create("retomar_fila", { delayInMinutes: horas * 60 });
      registrar(`PACOTE: ${feitos}/${grupos.length} feitos — retomando em ~${horas.toFixed(1)}h`, "l-warn");
    } else {
      await limparFila();
      await chrome.alarms.clear("retomar_fila");
    }
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
    registrar("Fim da fila", "l-info");
  }
}

// ---------- buscar ----------
async function buscar() {
  const termo = $("termo").value.trim();
  if (!termo) return registrar("Digite um termo de busca", "l-err");
  $("btnBuscar").disabled = true;
  try {
    registrar(`Buscando grupos: "${termo}"...`);
    const res = await comando("buscar", { termo, limite: 60 });
    if (res.resultado === "bloqueado")
      return registrar(`BLOQUEIO — ${res.erro}`, "l-err");
    if (res.resultado !== "ok")
      return registrar(res.erro || "busca falhou", "l-err");
    gruposEncontrados = res.grupos;
    const badge = (g) => [
      g.membros && `${g.membros} membros`,
      g.postsDia,
      g.privacidade,
      g.perguntas && "perguntas",
      g.amigosComum,
      ["MEMBER", "JOINED", "ACTIVE"].includes(g.estado) && "membro",
      ["REQUESTED", "AWAITING_APPROVAL", "PENDING"].includes(g.estado) && "pendente",
    ].filter(Boolean).join(" · ");
    $("resultados").innerHTML = res.grupos
      .map(
        (g) => `<div class="grupo-item">
          <input type="checkbox" data-gid="${g.id}" data-gnome="${g.nome}"
                 data-estado="${g.estado || ""}" checked>
          <span>${g.nome}</span><small>${badge(g)}</small></div>`
      )
      .join("");
    registrar(`${res.grupos.length} grupos encontrados`, "l-ok");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    $("btnBuscar").disabled = false;
  }
}

function selecionados() {
  return [...$("resultados").querySelectorAll("input:checked")].map((c) => ({
    id: c.dataset.gid,
    nome: c.dataset.gnome,
    estado: c.dataset.estado || "",
  }));
}

// ---------- entrar ----------
async function entrar() {
  const lista = selecionados();
  if (!lista.length) return registrar("Nenhum grupo selecionado", "l-err");
  controle(true);
  try {
    for (let i = 0; i < lista.length; i++) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const g = lista[i];
      // já é membro/pedido pendente segundo a busca — pula sem gastar request
      if (["MEMBER", "JOINED", "ACTIVE"].includes(g.estado || "")) {
        registrar(`${g.nome}: já é membro — pulando`, "l-info");
        continue;
      }
      if (["REQUESTED", "AWAITING_APPROVAL", "PENDING"].includes(g.estado || "")) {
        registrar(`${g.nome}: pedido já pendente — pulando`, "l-info");
        continue;
      }
      $("progresso").textContent = `Entrando ${i + 1}/${lista.length} — ${g.nome}`;
      const res = await comando("entrar", { idGrupo: g.id, responderPerguntas: $("joinPerguntas").checked });
      if (res.resultado === "entrou") registrar(`${g.nome}: entrou`, "l-ok");
      else if (res.resultado === "pendente") registrar(`${g.nome}: pedido pendente`, "l-warn");
      else if (res.resultado === "ja_membro") registrar(`${g.nome}: já é membro`, "l-info");
      else if (res.resultado === "perguntas") registrar(`${g.nome}: pede perguntas (pular)`, "l-warn");
      else if (res.resultado === "bloqueado") {
        registrar(`${g.nome}: BLOQUEIO — ${res.erro}. Parando.`, "l-err");
        break;
      } else {
        registrar(`${g.nome}: ${res.erro || "falhou"}`, "l-warn");
        continue;
      }
      // cooldown só após entrou/pendente — falha/skip não gasta (como eles)
      if (["entrou", "pendente"].includes(res.resultado) &&
          i < lista.length - 1 && !parar)
        await esperar(aleatorio(30, 90));
    }
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- engajar (portado: GROUP_PRO — multi-grupo, gaps, commentMode) ----------
async function engajar() {
  const grupos = $("engGrupo").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const limite = Math.max(1, +$("engLimite").value || 10);
  const dmin = Math.max(5, +$("engDelayMin").value || 60);
  const dmax = Math.max(dmin, +$("engDelayMax").value || 120);
  const gapMin = Math.max(5, +$("engGapMin").value || 120);
  const gapMax = Math.max(gapMin, +$("engGapMax").value || 240);
  const querLike = $("engLike").checked;
  const querComentario = $("engComentar").checked;
  const soDiferentes = $("engSoDiferentes").checked;
  const dedup = $("engDedup").checked;
  const modo = $("engModo").value; // texto | imagem | ambos | aleatorio
  const textos = $("engTextos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const foto = $("engFoto").files[0];
  const vars = lerVars();
  // dedup persistido POR grupo (portado: interactedByGroup)
  const { interagidosGrupo = {}, autores = {} } =
    await chrome.storage.local.get(["interagidosGrupo", "autores"]);

  if (!grupos.length) return registrar("Informe ao menos um grupo", "l-err");
  if (!querLike && !querComentario) return registrar("Marque curtir e/ou comentar", "l-err");
  const querFoto = ["imagem", "ambos", "aleatorio"].includes(modo) && foto;
  const querTexto = ["texto", "ambos", "aleatorio"].includes(modo) || (modo === "imagem" && !foto);
  if (querComentario && querTexto && !textos.length)
    return registrar("Sem textos de comentário", "l-err");
  if (querComentario && ["imagem", "ambos"].includes(modo) && !foto)
    return registrar("Modo com imagem precisa de uma foto de comentário", "l-err");

  let fotoComentario = null;
  if (foto) {
    const r = new FileReader();
    fotoComentario = await new Promise((res, rej) => {
      r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(foto);
    });
  }

  controle(true);
  try {
    for (let gidx = 0; gidx < grupos.length; gidx++) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const gid = await resolver(grupos[gidx]);
      registrar(`Grupo ${gidx + 1}/${grupos.length} (${gid}) — engajando até ${limite} posts`);
      interagidosGrupo[gid] = interagidosGrupo[gid] || {};
      const interagidos = interagidosGrupo[gid];
      let feitos = 0, cursor, paginas = 0, vazias = 0, idxTexto = 0;
      const maxPaginas = Math.max(60, limite * 4); // teto de varredura (como eles)
      outer: while (feitos < limite && paginas < maxPaginas) {
        if (parar) { registrar("Interrompido", "l-warn"); break; }
        paginas++;
        const feed = await comando("feed", { idGrupo: gid, cursor });
        if (feed.resultado === "bloqueado") {
          registrar(`BLOQUEIO no feed — ${feed.erro}`, "l-err");
          return;
        }
        if (feed.resultado !== "ok") {
          registrar(feed.erro || "feed falhou", "l-err");
          break;
        }
        if (!feed.posts.length) {
          if (++vazias >= 2) { registrar("Feed esgotado", "l-info"); break; }
          cursor = feed.cursor;
          continue;
        }
        vazias = 0;
        cursor = feed.cursor;
        for (const p of feed.posts) {
          if (parar) break outer;
          if (feitos >= limite) break outer;
          if (dedup && interagidos[p.feedbackId]) continue;
          if (soDiferentes && p.autorId && autores[p.autorId]) continue;
          $("progresso").textContent = `Post ${feitos + 1}/${limite}`;
          let agiu = false;
          if (querLike) {
            const r = await comando("curtir", { feedbackId: p.feedbackId });
            if (r.resultado === "bloqueado") {
              registrar(`BLOQUEIO no like — ${r.erro}. Parando.`, "l-err");
              return;
            }
            if (r.resultado === "ok") {
              agiu = true;
              registrar(`like em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
            } else registrar(`like falhou: ${r.erro}`, "l-warn");
            await esperar(aleatorio(3, 8));
          }
          if (querComentario && !parar) {
            // commentMode: text | image | both | aleatorio (portado deles)
            const usarFoto = modo === "imagem" || modo === "ambos" ||
              (modo === "aleatorio" && fotoComentario && Math.random() < 0.5);
            const usarTexto = modo === "texto" || modo === "ambos" ||
              (modo === "aleatorio" && !usarFoto) || (usarFoto && !fotoComentario);
            const r = await comando("comentar", {
              feedbackId: p.feedbackId,
              texto: usarTexto ? aplicarSpintax(textos[idxTexto++ % textos.length], vars) : null,
              fotoDataUrl: usarFoto ? fotoComentario : null,
            });
            if (r.resultado === "bloqueado") {
              registrar(`BLOQUEIO no comentário — ${r.erro}. Parando.`, "l-err");
              return;
            }
            if (r.resultado === "ok") {
              agiu = true;
              registrar(`comentou (${r.situacao}${usarFoto ? ", foto" : ""}) em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
            } else registrar(`comentário falhou: ${r.erro}`, "l-warn");
          }
          if (agiu) interagidos[p.feedbackId] = Date.now();
          if (soDiferentes && p.autorId) autores[p.autorId] = Date.now();
          feitos++;
          await chrome.storage.local.set({ interagidosGrupo, autores });
          if (!parar) await esperar(aleatorio(dmin, dmax));
        }
        if (!cursor) break;
      }
      registrar(`Grupo ${gid}: ${feitos} posts engajados`, "l-ok");
      // gap entre grupos da mesma lista (portado: groupDelay 120-240s)
      if (gidx < grupos.length - 1 && !parar)
        await esperar(aleatorio(gapMin, gapMax), `próximo grupo em `);
    }
    registrar("Engajamento concluído", "l-ok");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- amizade ----------
async function amizade() {
  const perfis = $("perfis").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const dmin = Math.max(10, +$("amDelayMin").value || 45);
  const dmax = Math.max(dmin, +$("amDelayMax").value || 120);
  if (!perfis.length) return registrar("Lista de perfis vazia", "l-err");
  controle(true);
  try {
    for (let i = 0; i < perfis.length; i++) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const p = perfis[i];
      $("progresso").textContent = `Perfil ${i + 1}/${perfis.length}`;
      try {
        const r = await comando("perfil", { bruto: p });
        if (r.erro) throw new Error(r.erro);
        const res = await comando("amizade", { idUsuario: r.idUsuario });
        if (res.resultado === "enviado") {
          registrar(`${p}: pedido enviado`, "l-ok");
          // cooldown só após pedido efetivado (como eles)
          if (i < perfis.length - 1 && !parar)
            await esperar(aleatorio(dmin, dmax));
        } else if (res.resultado === "ja_amigo") registrar(`${p}: já é amigo/pendente`, "l-info");
        else if (res.resultado === "bloqueado") {
          registrar(`${p}: BLOQUEIO — ${res.erro}. Parando.`, "l-err");
          break;
        } else registrar(`${p}: ${res.erro || "falhou"}`, "l-warn");
      } catch (e) {
        registrar(`${p}: ${e.message}`, "l-warn");
      }
    }
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
    registrar("Fim da fila de amizade", "l-info");
  }
}

// ---------- aquecer ----------
async function aquecer() {
  const grupo = $("warmGrupo").value.trim();
  const tipo = $("warmTipo").value;
  const limite = Math.max(1, +$("warmLimite").value || 10);
  const delay = Math.max(15, +$("warmDelay").value || 60);
  if (!grupo) return registrar("Informe o grupo", "l-err");
  controle(true);
  try {
    const gid = await resolver(grupo);
    registrar(`Aquecendo com membros do grupo ${gid} (limite ${limite})`);
    let enviados = 0, cursor, paginas = 0, jaAmigos = 0;
    outer: while (enviados < limite && paginas < 20) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      paginas++;
      const res = await comando("membros", { idGrupo: gid, cursor, tipo });
      if (res.resultado === "bloqueado") {
        registrar(`BLOQUEIO — ${res.erro}`, "l-err");
        break;
      }
      if (res.resultado !== "ok") { registrar(res.erro || "membros falhou", "l-err"); break; }
      if (!res.usuarios.length) { registrar("Lista de membros vazia", "l-warn"); break; }
      cursor = res.cursor;
      for (const u of res.usuarios) {
        if (parar) break outer;
        if (enviados >= limite) break outer;
        if (u.status && u.status !== "CAN_REQUEST") { jaAmigos++; continue; }
        $("progresso").textContent = `Pedidos ${enviados}/${limite} — ${u.nome || u.id}`;
        const r = await comando("amizade", { idUsuario: u.id });
        if (r.resultado === "enviado") {
          enviados++;
          registrar(`pedido → ${u.nome || u.id}`, "l-ok");
          await esperar(delay); // cooldown só após warmed (como eles)
        } else if (r.resultado === "ja_amigo") {
          jaAmigos++;
          registrar(`${u.nome || u.id}: já é amigo`, "l-info");
        } else if (r.resultado === "bloqueado") {
          registrar(`BLOQUEIO — ${r.erro}. Parando.`, "l-err");
          break outer;
        } else registrar(`${u.nome || u.id}: ${r.erro || "falhou"}`, "l-warn");
      }
      if (!cursor) break;
    }
    registrar(`Aquecer concluído: ${enviados} pedidos (${jaAmigos} já amigos)`, "l-ok");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- meus grupos (Graph API) + marketplace ----------
async function meusGrupos() {
  $("btnMeusGrupos").disabled = true;
  try {
    registrar("Carregando seus grupos via Graph API...");
    const res = await comando("meusGrupos");
    if (res.resultado !== "ok")
      return registrar(res.erro || "falhou", "l-err");
    registrar(`Token obtido via ${res.fonte || "?"}`, "l-info");
    gruposEncontrados = res.grupos;
    $("resultados").innerHTML = res.grupos
      .map((g) => `<div class="grupo-item">
          <input type="checkbox" data-gid="${g.id}" data-gnome="${g.nome}" checked>
          <span>${g.nome}</span><small>${g.membros ?? ""}${g.admin ? " · admin" : ""}</small></div>`)
      .join("");
    registrar(`${res.grupos.length} grupos seus — marque e use "Selecionados → lista"`, "l-ok");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    $("btnMeusGrupos").disabled = false;
  }
}

async function publicarListing() {
  const titulo = $("mkTitulo").value.trim();
  const preco = $("mkPreco").value.trim();
  const descricao = $("mkDescricao").value.trim();
  const gruposBrutos = $("mkGrupos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const paraMarketplace = $("mkMarketplace").checked;
  const arquivos = [...$("mkFotos").files];
  if (!titulo && !descricao) return registrar("Preencha título ou descrição", "l-err");
  if (!paraMarketplace && !gruposBrutos.length)
    return registrar("Sem destino: marque Marketplace ou liste grupos", "l-err");
  controle(true);
  try {
    const fotosDataUrl = [];
    for (const f of arquivos.slice(0, 10))
      fotosDataUrl.push(await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
      }));
    const idsGrupos = [];
    for (const g of gruposBrutos) {
      try { idsGrupos.push(await resolver(g)); }
      catch (e) { registrar(`${g}: ${e.message}`, "l-warn"); }
    }
    registrar(`Publicando anúncio (${fotosDataUrl.length} fotos, ${idsGrupos.length} grupos, marketplace=${paraMarketplace})...`);
    const res = await comando("listing", {
      titulo, descricao, preco, fotosDataUrl, idsGrupos, paraMarketplace,
    });
    if (res.resultado === "ok")
      registrar(`Anúncio ${res.situacao || "publicado"}${res.postId ? " (id " + res.postId + ")" : ""}`, "l-ok");
    else if (res.resultado === "bloqueado")
      registrar(`BLOQUEIO — ${res.erro}`, "l-err");
    else registrar(res.erro || "falhou", "l-err");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- listeners ----------
$("btnPostar").addEventListener("click", () => { if (!rodando) postar(); });
$("btnMeusGrupos").addEventListener("click", () => { if (!rodando) meusGrupos(); });
$("btnLimparLista").addEventListener("click", () => { $("grupos").value = ""; });
$("btnListing").addEventListener("click", () => { if (!rodando) publicarListing(); });
$("btnBuscar").addEventListener("click", () => { if (!rodando) buscar(); });
$("btnEntrar").addEventListener("click", () => { if (!rodando) entrar(); });
$("btnEngajar").addEventListener("click", () => { if (!rodando) engajar(); });
$("btnAmizade").addEventListener("click", () => { if (!rodando) amizade(); });
$("btnAquecer").addEventListener("click", () => { if (!rodando) aquecer(); });
$("btnParar").addEventListener("click", () => { parar = true; });
$("btnStudio")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") });
});
$("btnAddLista").addEventListener("click", () => {
  const lista = selecionados();
  if (!lista.length) return registrar("Nenhum grupo selecionado", "l-err");
  const atual = $("grupos").value.trim();
  const urls = lista.map((g) => `https://www.facebook.com/groups/${g.id}`);
  $("grupos").value = atual ? atual + "\n" + urls.join("\n") : urls.join("\n");
  registrar(`${lista.length} grupos adicionados à lista de postagem`, "l-ok");
});

chrome.storage.local.get("calibracoes", ({ calibracoes }) => renderCalibs(calibracoes));
chrome.storage.onChanged.addListener((c) => {
  if (c.calibracoes) renderCalibs(c.calibracoes.newValue);
});
chrome.runtime.onMessage.addListener((m) => {
  if (m.tipo === "capturado")
    registrar(`Aprendido: ${TIPOS[m.dados.tipo] || m.dados.tipo} (${m.dados.nomeAmigavel})`, "l-info");
  if (m.tipo === "stats" && m.dados.docIds)
    registrar(`${m.dados.docIds} doc_ids minerados da página`, "l-info");
  // kill-switch (portado: sessionInvalidated) — para TODOS os jobs
  if (m.tipo === "sessaoInvalidada") {
    parar = true;
    registrar(`SESSÃO PERDIDA (${m.dados?.motivo || "?"}) — tudo parado. Faça login de novo.`, "l-err");
  }
});

// ---------- retomada de lote ----------
(async () => {
  const { retomarPendente, fila } = await chrome.storage.local.get(["retomarPendente", "fila"]);
  if (retomarPendente && fila?.grupos?.length) {
    registrar(`Retomando lote: ${fila.inicio}/${fila.grupos.length} já feitos`, "l-info");
    await chrome.storage.local.remove("retomarPendente");
    postar(fila);
  }
})();
