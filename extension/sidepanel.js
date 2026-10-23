const $ = (id) => document.getElementById(id);
const logEl = $("log");
let rodando = false, parar = false, pausado = false;
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

// engageReports deles: histórico persistente de ações no IndexedDB —
// runId correlaciona todas as ações da mesma rodada (batchN deles)
let runId = null;
const rel = (acao, alvo, resultado, detalhe) => {
  Biblioteca?.relatorios?.adicionar(acao, alvo, resultado, detalhe, runId);
  // profileObservations/restUntil deles: sinal de moderação → perfil
  // descansa 24h; gateSessao barra jobs novos até lá
  if (resultado === "bloqueado")
    chrome.storage.local.set({ descansoAte: Date.now() + 864e5 });
};

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

// gate de sessão antes de cada job (checkSession deles): motor vivo + logado
// + restUntil deles: bloqueio/pendente marcado → perfil descansa até descansoAte
const gateSessao = async () => {
  const { descansoAte } = await chrome.storage.local.get("descansoAte");
  if (descansoAte && Date.now() < descansoAte) {
    registrar(`DESCANSO ATIVO até ${new Date(descansoAte).toLocaleString("pt-BR")} — ` +
      "perfil marcado por moderação. Esperar antes de retomar.", "l-err");
    return false;
  }
  const p = await comando("ping").catch(() => null);
  if (!p?.ok) {
    registrar("Motor não respondeu — recarregue a aba do Facebook", "l-err");
    return false;
  }
  if (!p.sessao) {
    registrar("SESSÃO INVÁLIDA — faça login no Facebook", "l-err");
    return false;
  }
  return true;
};

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

// PAUSE/RESUME dos jobs deles: segura o fluxo sem perder posição
const esperarPausa = async () => {
  while (pausado && !parar) {
    $("progresso").textContent = "pausado — clique Retomar pra continuar";
    await dormir(300);
  }
};

// delay com progresso a cada ~250ms e interrompível (portado deles)
async function esperar(totalSeg, prefixo = "") {
  const totalMs = totalSeg * 1000;
  const inicio = Date.now();
  while (Date.now() - inicio < totalMs && !parar) {
    await esperarPausa();
    if (parar) break;
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

// ---------- biblioteca (IndexedDB — engageMedia/engageVariables deles) ----------
// mídias escolhidas por campo: {foto:[{id,nome,dataUrl}], video:[], engFoto:[], mkFotos:[]}
const libSel = { foto: [], video: [], engFoto: [], mkFotos: [] };
const renderSel = (alvo) => {
  const el = $("sel-" + alvo);
  if (!el) return;
  el.innerHTML = libSel[alvo]
    .map((m, i) => `<span class="chip" data-i="${i}">${m.nome}</span>`)
    .join("");
  for (const chip of el.querySelectorAll(".chip"))
    chip.addEventListener("click", () => {
      libSel[alvo].splice(+chip.dataset.i, 1);
      renderSel(alvo);
    });
};

async function abrirBiblioteca(tipo, alvo) {
  const drawer = $("libDrawer");
  drawer.style.display = "block";
  drawer.innerHTML = `<h3>Biblioteca — ${tipo.split(":")[0]}</h3><div class="hint">carregando...</div>`;
  try {
    let itens;
    if (tipo === "textos") itens = await Biblioteca.textos.listar();
    else if (tipo === "variaveis") itens = await Biblioteca.variaveis.listar();
    else {
      const sub = tipo.split(":")[1];
      // engageMedia.active deles: inativas não entram na seleção
      itens = (await Biblioteca.midias.listar())
        .filter((m) => m.ativo !== false && (!sub || m.tipo === sub));
    }
    if (!itens.length) {
      drawer.innerHTML = `<h3>Biblioteca</h3><div class="hint">vazia — gerencie no Studio (botão no topo)</div>
        <button class="sec" id="libFechar">Fechar</button>`;
    } else {
      drawer.innerHTML = `<h3>Biblioteca</h3>` + itens
        .map((it) => `<div class="lib-item" data-id="${it.id ?? it.nome}">
            <span>${it.nome}</span><small>${it.pasta ? it.pasta + " · " : ""}${it.tipo ?? it.mime ?? ""}</small></div>`)
        .join("") + `<button class="sec" id="libFechar">Fechar</button>`;
      for (const el of drawer.querySelectorAll(".lib-item"))
        el.addEventListener("click", async () => {
          const it = itens.find((x) => String(x.id ?? x.nome) === el.dataset.id);
          if (!it) return;
          if (tipo === "textos") {
            const ta = $(alvo);
            ta.value = ta.value.trim() ? ta.value.trimEnd() + "\n" + it.conteudo : it.conteudo;
          } else if (tipo === "variaveis") {
            const ta = $(alvo);
            const linha = `${it.nome}=${(it.valores ?? []).join("|")}`;
            ta.value = ta.value.trim() ? ta.value.trimEnd() + "\n" + linha : linha;
          } else {
            libSel[alvo] = libSel[alvo] || [];
            if (alvo === "engFoto") libSel[alvo] = [];
            libSel[alvo].push({ nome: it.nome, dataUrl: await Biblioteca.dataUrlDe(it.blob) });
            renderSel(alvo);
          }
          drawer.style.display = "none";
          registrar(`Biblioteca → ${alvo}: ${it.nome}`, "l-info");
        });
    }
    $("libFechar").addEventListener("click", () => (drawer.style.display = "none"));
  } catch (e) {
    drawer.innerHTML = `<h3>Biblioteca</h3><div class="hint">${e.message}</div>
      <button class="sec" id="libFechar">Fechar</button>`;
    $("libFechar").addEventListener("click", () => (drawer.style.display = "none"));
  }
}
for (const b of document.querySelectorAll(".lib-btn"))
  b.addEventListener("click", () => abrirBiblioteca(b.dataset.lib, b.dataset.alvo));

const resolver = async (bruto) => {
  const r = await comando("resolver", { bruto });
  if (r.erro) throw new Error(r.erro);
  return r.idGrupo;
};

function controle(estado) {
  rodando = estado;
  parar = false;
  pausado = false;
  if (estado) runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  $("btnPausar").textContent = "Pausar";
  for (const b of ["btnPostar", "btnEngajar", "btnEntrar", "btnAmizade", "btnAquecer", "btnListing"])
    $(b).disabled = estado;
  $("btnParar").style.display = estado ? "block" : "none";
  $("btnPausar").style.display = estado ? "block" : "none";
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
  const repetir = estadoInicial?.repetir ?? Math.max(0, +$("postRepetir")?.value || 0);
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
  // (arquivos escolhidos + itens da biblioteca)
  const fotosUrl = estadoInicial?.fotos ??
    [...await Promise.all(fotos.map(paraDataUrl)), ...libSel.foto.map((m) => m.dataUrl)];
  const videosUrl = estadoInicial?.videos ??
    [...await Promise.all(videos.map(async (v) => {
      if (v.size > 30 * 1024 * 1024)
        throw new Error(`Vídeo ${v.name} muito grande (máx ~30MB)`);
      return paraDataUrl(v);
    })), ...libSel.video.map((m) => m.dataUrl)];

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
      await esperarPausa();
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const g = grupos[i];
      $("progresso").textContent = `${i + 1}/${grupos.length} — ${g}`;
      const m = pegarMidia(i);
      const msg = m.texto ? aplicarSpintax(m.texto, vars) : "";
      try {
        if (!cache[g]) cache[g] = await resolver(g);
        // erro transitório (is_transient deles) → até 2 retentativas espaçadas
        let res, tentou = 0;
        while (true) {
          res = await comando("postar", {
            idGrupo: cache[g], texto: msg,
            fotoDataUrl: m.foto, videoDataUrl: m.video,
          });
          tentou++;
          if (!(res.resultado === "erro" && res.transiente && tentou < 3 && !parar)) break;
          registrar(`${g}: erro transitório — retentando (${tentou}/3)`, "l-info");
          await esperar(aleatorio(15, 30), `${i + 1}/${grupos.length} — `);
        }
        feitos = i + 1;
        if (res.resultado === "ok") {
          algumSucesso = true; repetidos = 0; ultimoCodigo = "";
          registrar(`${g}: ${res.situacao || "publicado"}${res.postId ? " (id " + res.postId + ")" : ""}`, "l-ok");
          rel("postar", g, res.situacao || "publicado", res.postId);
          // delay só após sucesso (como eles — cooldown não roda em falha)
          if (i < fim - 1 && !parar)
            await esperar(aleatorio(dmin, dmax), `${i + 1}/${grupos.length} — `);
        } else if (res.resultado === "bloqueado") {
          registrar(`${g}: BLOQUEIO — ${res.erro}. Parando tudo.`, "l-err");
          rel("postar", g, "bloqueado", res.erro);
          await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, repetir, inicio: feitos, fotos: fotosUrl, videos: videosUrl });
          break;
        } else {
          registrar(`${g}: erro — ${res.erro}`, "l-warn");
          rel("postar", g, "erro", res.erro);
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
      await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, repetir, inicio: feitos, fotos: fotosUrl, videos: videosUrl });
      await chrome.alarms.create("retomar_fila", { delayInMinutes: horas * 60 });
      registrar(`PACOTE: ${feitos}/${grupos.length} feitos — retomando em ~${horas.toFixed(1)}h`, "l-warn");
    } else if (repetir > 0) {
      // postCampaigns.nextRunAt deles: campanha recorrente — fila cheia
      // volta pro início e o alarme dispara de novo daqui a N horas
      await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, repetir, inicio: 0, fotos: fotosUrl, videos: videosUrl });
      await chrome.alarms.create("retomar_fila", { delayInMinutes: repetir * 60 });
      registrar(`RECORRENTE: fila concluída — repete em ~${repetir}h`, "l-info");
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

// ---------- agendamento (autopost.due deles) ----------
// salva a fila inteira e dispara o alarme na hora marcada — o alarme
// abre o painel e postar(fila) roda sozinho
async function agendar() {
  const quando = $("agendarPara").value
    ? new Date($("agendarPara").value).getTime() : null;
  if (!quando || quando < Date.now() + 60000)
    return registrar("Escolha data/hora futura (mín 1 min)", "l-err");
  const grupos = $("grupos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const mensagens = lerMensagens();
  if (!grupos.length) return registrar("Lista de grupos vazia", "l-err");
  const paraDataUrl = (a) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(a);
  });
  const fotosUrl = [
    ...await Promise.all([...$("foto").files].map(paraDataUrl)),
    ...libSel.foto.map((m) => m.dataUrl),
  ];
  const videosUrl = [
    ...await Promise.all([...$("video").files].map(async (v) => {
      if (v.size > 30 * 1024 * 1024)
        throw new Error(`Vídeo ${v.name} muito grande (máx ~30MB)`);
      return paraDataUrl(v);
    })),
    ...libSel.video.map((m) => m.dataUrl),
  ];
  if (!mensagens.length && !fotosUrl.length && !videosUrl.length)
    return registrar("Fila vazia — nada pra postar", "l-err");
  await salvarFila({
    grupos, mensagens, vars: lerVars(), modo: $("modo").value,
    limiteRodada: Math.max(0, +$("limiteRodada").value || 0),
    repetir: Math.max(0, +$("postRepetir")?.value || 0),
    inicio: 0, fotos: fotosUrl, videos: videosUrl,
  });
  await chrome.alarms.create("retomar_fila", { when: quando });
  registrar(`Fila agendada pra ${new Date(quando).toLocaleString("pt-BR")} — roda sozinha`, "l-ok");
}

// ---------- buscar ----------
const renderResultados = (grupos) => {
  const badge = (g) => [
    g.membrosTexto || (g.membros && `${g.membros} membros`),
    g.postsDia,
    g.privacidade,
    g.perguntas && "perguntas",
    g.amigosComum,
    ["MEMBER", "JOINED", "ACTIVE"].includes(g.estado) && "membro",
    ["REQUESTED", "AWAITING_APPROVAL", "PENDING"].includes(g.estado) && "pendente",
    g.admin && "admin",
  ].filter(Boolean).join(" · ");
  $("resultados").innerHTML = grupos
    .map(
      (g) => `<div class="grupo-item">
        <input type="checkbox" data-gid="${g.id}" data-gnome="${g.nome}"
               data-estado="${g.estado || ""}" data-perguntas="${g.perguntas ? 1 : ""}" checked>
        <span>${g.nome}</span><small>${badge(g)}</small></div>`
    )
    .join("");
};

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
    // groupWarmSearches deles: busca persistida — reabrir o painel
    // restaura a lista sem gastar nova query
    chrome.storage.local.set({ buscaRecente: { termo, grupos: res.grupos, quando: Date.now() } });
    renderResultados(res.grupos);
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
    perguntas: c.dataset.perguntas === "1",
  }));
}

// ---------- entrar ----------
async function entrar(estadoInicial) {
  const lista = estadoInicial?.lista ?? selecionados();
  const inicio = estadoInicial?.inicio ?? 0;
  const lote = estadoInicial?.lote ?? Math.max(0, +$("joinLote")?.value || 0);
  const respPerguntas = estadoInicial?.responderPerguntas ?? $("joinPerguntas").checked;
  if (!lista.length) return registrar("Nenhum grupo selecionado", "l-err");
  // profileGroupIds (GROUP_WARM deles): grupos onde já é membro via Graph API —
  // pula sem gastar request mesmo se a busca não trouxe o estado
  let meus = new Set();
  try {
    // connectedGroups deles: cache dos meus grupos (6h) — evita bater
    // a Graph API toda vez que a fila roda
    const { meusGruposCache, gruposEntrados } =
      await chrome.storage.local.get(["meusGruposCache", "gruposEntrados"]);
    // joinedGroupIds deles: grupos que JÁ entramos antes — dedup permanente
    // mesmo que a busca nova não marque o estado de membro
    for (const id of gruposEntrados ?? []) meus.add(String(id));
    if (meusGruposCache?.ate > Date.now()) {
      for (const id of meusGruposCache.ids) meus.add(String(id));
    } else {
      const m = await comando("meusGrupos");
      if (m.resultado === "ok") {
        for (const g of m.grupos ?? []) meus.add(String(g.id));
        chrome.storage.local.set({
          meusGruposCache: { ids: [...meus], ate: Date.now() + 6 * 3600e3 },
        });
      }
    }
  } catch {}
  if (meus.size) registrar(`${meus.size} grupos seus carregados — já-membros serão pulados`, "l-info");
  if (!(await gateSessao())) return;
  controle(true);
  try {
    let rodados = 0;
    for (let i = inicio; i < lista.length; i++) {
      await esperarPausa();
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const g = lista[i];
      // já é membro/pedido pendente segundo a busca ou o Graph — pula sem gastar request
      if (meus.has(String(g.id)) || ["MEMBER", "JOINED", "ACTIVE"].includes(g.estado || "")) {
        registrar(`${g.nome}: já é membro — pulando`, "l-info");
        continue;
      }
      if (["REQUESTED", "AWAITING_APPROVAL", "PENDING"].includes(g.estado || "")) {
        registrar(`${g.nome}: pedido já pendente — pulando`, "l-info");
        continue;
      }
      // needs_questions pré-detectado pela busca — pula sem gastar request
      // (GROUP_WARM deles detecta antes de chamar o join)
      if (g.perguntas && !respPerguntas) {
        registrar(`${g.nome}: pede perguntas (marque a opção p/ responder) — pulando`, "l-warn");
        continue;
      }
      $("progresso").textContent = `Entrando ${i + 1}/${lista.length} — ${g.nome}`;
      const res = await comando("entrar", { idGrupo: g.id, responderPerguntas: respPerguntas });
      rel("entrar", g.nome, res.resultado, res.erro);
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
      if (["entrou", "pendente"].includes(res.resultado)) {
        rodados++;
        meus.add(String(g.id));
        chrome.storage.local.get("gruposEntrados").then(({ gruposEntrados }) => {
          const s = new Set(gruposEntrados ?? []);
          s.add(String(g.id));
          chrome.storage.local.set({ gruposEntrados: [...s] });
        });
        // lote: a cada N entradas pausa 2-6h e retoma (batchSize deles)
        if (lote > 0 && rodados >= lote && i < lista.length - 1) {
          const horas = 2 + Math.random() * 4;
          await chrome.storage.local.set({ filaEntrar: { lista, inicio: i + 1, lote, responderPerguntas: respPerguntas } });
          await chrome.alarms.create("retomar_fila", { delayInMinutes: horas * 60 });
          registrar(`LOTE: ${lote} entradas — retomando em ~${horas.toFixed(1)}h`, "l-warn");
          return;
        }
        if (i < lista.length - 1 && !parar)
          await esperar(aleatorio(30, 90));
      }
    }
    await chrome.storage.local.remove("filaEntrar");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- engajar (portado: GROUP_PRO — multi-grupo, gaps, commentMode) ----------
// listas separadas por "---": groupGap entre grupos da mesma lista,
// listGap (300-600s) entre listas distintas — como o GROUP_PRO deles
const lerListas = (valor) => {
  const listas = [[]];
  for (const linha of valor.split("\n")) {
    if (/^\s*---\s*$/.test(linha)) {
      if (listas[listas.length - 1].length) listas.push([]);
      continue;
    }
    const s = linha.trim();
    if (s) listas[listas.length - 1].push(s);
  }
  return listas.filter((l) => l.length);
};

// espera o fim do job DOM na aba (domFim chega via content → runtime)
let domResolver = null;
const esperarDomFim = () =>
  new Promise((resolve) => {
    let feito = false;
    const encerrar = (dados) => {
      if (feito) return;
      feito = true;
      clearInterval(iv);
      domResolver = null;
      resolve(dados);
    };
    domResolver = encerrar;
    const iv = setInterval(() => {
      if (parar) comando("domParar").catch(() => {});
    }, 500);
  });

async function engajar(estadoInicial) {
  const listas = estadoInicial?.listas ?? lerListas($("engGrupo").value);
  const limite = estadoInicial?.limite ?? Math.max(1, +$("engLimite").value || 10);
  const dmin = estadoInicial?.dmin ?? Math.max(5, +$("engDelayMin").value || 60);
  const dmax = estadoInicial?.dmax ?? Math.max(dmin, +$("engDelayMax").value || 120);
  const gapMin = estadoInicial?.gapMin ?? Math.max(5, +$("engGapMin").value || 120);
  const gapMax = estadoInicial?.gapMax ?? Math.max(gapMin, +$("engGapMax").value || 240);
  const listaMin = estadoInicial?.listaMin ?? Math.max(5, +$("engListaMin")?.value || 300);
  const listaMax = estadoInicial?.listaMax ?? Math.max(listaMin, +$("engListaMax")?.value || 600);
  const lote = estadoInicial?.lote ?? Math.max(0, +$("engLote")?.value || 0);
  const modoDom = estadoInicial ? false : $("engDom")?.checked;
  const querLike = estadoInicial?.querLike ?? $("engLike").checked;
  const querComentario = estadoInicial?.querComentario ?? $("engComentar").checked;
  const soDiferentes = estadoInicial?.soDiferentes ?? $("engSoDiferentes").checked;
  const dedup = estadoInicial?.dedup ?? $("engDedup").checked;
  const modo = estadoInicial?.modo ?? $("engModo").value; // texto | imagem | ambos | aleatorio
  const textos = estadoInicial?.textos ??
    $("engTextos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const foto = $("engFoto").files[0];
  const vars = estadoInicial?.vars ?? lerVars();
  // dedup persistido POR grupo (portado: interactedByGroup)
  const { interagidosGrupo = {}, autores = {} } =
    await chrome.storage.local.get(["interagidosGrupo", "autores"]);

  if (!listas.length && !modoDom) return registrar("Informe ao menos um grupo", "l-err");
  if (!querLike && !querComentario) return registrar("Marque curtir e/ou comentar", "l-err");
  const querFoto = ["imagem", "ambos", "aleatorio"].includes(modo) && (foto || libSel.engFoto.length);
  const querTexto = ["texto", "ambos", "aleatorio"].includes(modo) || (modo === "imagem" && !querFoto);
  if (querComentario && querTexto && !textos.length)
    return registrar("Sem textos de comentário", "l-err");
  if (querComentario && ["imagem", "ambos"].includes(modo) && !querFoto)
    return registrar("Modo com imagem precisa de uma foto de comentário", "l-err");
  if (!(await gateSessao())) return;

  let fotoComentario = estadoInicial?.fotoComentario ?? libSel.engFoto[0]?.dataUrl ?? null;
  if (!estadoInicial && foto) {
    const r = new FileReader();
    fotoComentario = await new Promise((res, rej) => {
      r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(foto);
    });
  }

  // modo DOM: o loop roda dentro da aba do grupo (GROUP_ENGAGE deles —
  // fallback pra quando não há calibração GraphQL de feed/like/comentário)
  if (modoDom) {
    controle(true);
    try {
      const r = await comando("engajarDom", {
        limite,
        acoes: [querLike && "like", querComentario && "comment"].filter(Boolean),
        textos, vars, fotoDataUrl: fotoComentario,
        commentMode: { texto: "texto", imagem: "imagem", ambos: "ambos", aleatorio: "aleatorio" }[modo],
        delayMin: dmin, delayMax: dmax,
        skipMin: 0, skipMax: 2, acoesMin: 3, acoesMax: 6,
        soDiferentes,
      });
      if (r.resultado !== "ok") return registrar(r.erro || "falhou ao iniciar", "l-err");
      registrar("Engajamento DOM rodando na aba do grupo — deixe ela aberta e visível", "l-info");
      const fim = await esperarDomFim();
      rel("engajarDom", "-", fim?.status ?? "fim", `${fim?.feitos ?? 0}/${limite} posts`);
      // restUntil: selo de pendente ou modal de bloqueio → 24h de descanso
      if (["bloqueio_pendente", "bloqueado"].includes(fim?.status))
        chrome.storage.local.set({ descansoAte: Date.now() + 864e5 });
      registrar(`DOM: ${fim?.status ?? "fim"} (${fim?.feitos ?? 0}/${limite} posts)` +
        (["bloqueio_pendente", "bloqueado"].includes(fim?.status)
          ? " — descanso de 24h ativado" : ""),
        fim?.status === "concluido" ? "l-ok" : "l-warn");
    } catch (e) {
      registrar(e.message, "l-err");
    } finally {
      controle(false);
    }
    return;
  }

  controle(true);
  try {
    const iniL = estadoInicial?.lidx ?? 0;
    const iniG = estadoInicial?.gidx ?? 0;
    let rodados = 0;
    const salvarLote = (lidx, gidx) =>
      chrome.storage.local.set({ filaEngajar: {
        listas, limite, dmin, dmax, gapMin, gapMax, listaMin, listaMax, lote,
        querLike, querComentario, soDiferentes, dedup, modo, textos, vars,
        fotoComentario, lidx, gidx,
      }});
    for (let lidx = iniL; lidx < listas.length; lidx++) {
      const grupos = listas[lidx];
      if (listas.length > 1)
        registrar(`Lista ${lidx + 1}/${listas.length} — ${grupos.length} grupos`, "l-info");
      for (let gidx = lidx === iniL ? iniG : 0; gidx < grupos.length; gidx++) {
        await esperarPausa();
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
            // skipLiked/skipCommented separados (deles): pula o post só
            // quando TODAS as ações pedidas já foram feitas nele
            const marcado = interagidos[p.feedbackId] ?? {};
            const faltaAlgo = (querLike && !marcado.like) ||
              (querComentario && !marcado.comentario);
            if (dedup && !faltaAlgo) continue;
            const autorChave = p.autorId || p.autorNome; // uid/nome (deles)
            if (soDiferentes && autorChave && autores[autorChave]) continue;
            $("progresso").textContent = `Post ${feitos + 1}/${limite}`;
            let agiu = false;
            if (querLike && !(dedup && marcado.like)) {
              const r = await comando("curtir", { feedbackId: p.feedbackId });
              if (r.resultado === "bloqueado") {
                registrar(`BLOQUEIO no like — ${r.erro}. Parando.`, "l-err");
                return;
              }
              if (r.resultado === "ok") {
                agiu = true;
                marcado.like = Date.now();
                rel("curtir", `${gid}/${p.feedbackId.slice(0, 18)}`, "ok");
                registrar(`like em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
              } else registrar(`like falhou: ${r.erro}`, "l-warn");
              await esperar(aleatorio(3, 8));
            }
            if (querComentario && !(dedup && marcado.comentario) && !parar) {
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
                marcado.comentario = Date.now();
                rel("comentar", `${gid}/${p.feedbackId.slice(0, 18)}`, r.situacao);
                registrar(`comentou (${r.situacao}${usarFoto ? ", foto" : ""}) em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
              } else registrar(`comentário falhou: ${r.erro}`, "l-warn");
            }
            if (agiu) interagidos[p.feedbackId] = marcado;
            if (soDiferentes && autorChave && agiu) autores[autorChave] = Date.now();
            feitos++;
            await chrome.storage.local.set({ interagidosGrupo, autores });
            if (!parar) await esperar(aleatorio(dmin, dmax));
          }
          if (!cursor) break;
        }
        registrar(`Grupo ${gid}: ${feitos} posts engajados`, "l-ok");
        rodados++;
        // lote: a cada N grupos pausa 2-6h e retoma (batchSize deles)
        if (lote > 0 && rodados >= lote &&
            (gidx < grupos.length - 1 || lidx < listas.length - 1)) {
          const horas = 2 + Math.random() * 4;
          await salvarLote(lidx, gidx + 1);
          await chrome.alarms.create("retomar_fila", { delayInMinutes: horas * 60 });
          registrar(`LOTE: ${lote} grupos — retomando em ~${horas.toFixed(1)}h`, "l-warn");
          return;
        }
        // gap entre grupos da mesma lista (portado: groupDelay 120-240s)
        if (gidx < grupos.length - 1 && !parar)
          await esperar(aleatorio(gapMin, gapMax), `próximo grupo em `);
      }
      if (parar) break;
      // gap maior entre listas distintas (portado: listGap 300-600s)
      if (lidx < listas.length - 1 && !parar)
        await esperar(aleatorio(listaMin, listaMax), `próxima lista em `);
    }
    await chrome.storage.local.remove("filaEngajar");
    registrar("Engajamento concluído", "l-ok");
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- agendar engajar (engagepro.due deles) ----------
// mesmo esquema do postar: salva filaEngajar completa + alarme when →
// o painel abre na hora e engajar(filaEngajar) roda do início
async function agendarEngajar() {
  const quando = $("engAgendarPara").value
    ? new Date($("engAgendarPara").value).getTime() : null;
  if (!quando || quando < Date.now() + 60000)
    return registrar("Escolha data/hora futura (mín 1 min)", "l-err");
  const listas = lerListas($("engGrupo").value);
  if (!listas.length) return registrar("Informe ao menos um grupo", "l-err");
  let fotoComentario = libSel.engFoto[0]?.dataUrl ?? null;
  const foto = $("engFoto").files[0];
  if (foto) {
    const r = new FileReader();
    fotoComentario = await new Promise((res, rej) => {
      r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(foto);
    });
  }
  await chrome.storage.local.set({ filaEngajar: {
    listas, lidx: 0, gidx: 0,
    limite: Math.max(1, +$("engLimite").value || 10),
    dmin: Math.max(5, +$("engDelayMin").value || 60),
    dmax: Math.max(+$("engDelayMin").value || 60, +$("engDelayMax").value || 120),
    gapMin: Math.max(5, +$("engGapMin").value || 120),
    gapMax: Math.max(+$("engGapMin").value || 120, +$("engGapMax").value || 240),
    listaMin: Math.max(5, +$("engListaMin")?.value || 300),
    listaMax: Math.max(+$("engListaMin")?.value || 300, +$("engListaMax")?.value || 600),
    lote: Math.max(0, +$("engLote")?.value || 0),
    querLike: $("engLike").checked,
    querComentario: $("engComentar").checked,
    soDiferentes: $("engSoDiferentes").checked,
    dedup: $("engDedup").checked,
    modo: $("engModo").value,
    textos: $("engTextos").value.split("\n").map((s) => s.trim()).filter(Boolean),
    vars: lerVars(), fotoComentario,
  }});
  await chrome.alarms.create("retomar_fila", { when: quando });
  registrar(`Engajamento agendado pra ${new Date(quando).toLocaleString("pt-BR")}`, "l-ok");
}

// ---------- agendar entrar (groupwarm.scheduleAlarm deles) ----------
async function agendarEntrar() {
  const quando = $("joinAgendarPara").value
    ? new Date($("joinAgendarPara").value).getTime() : null;
  if (!quando || quando < Date.now() + 60000)
    return registrar("Escolha data/hora futura (mín 1 min)", "l-err");
  const lista = selecionados();
  if (!lista.length) return registrar("Nenhum grupo selecionado", "l-err");
  await chrome.storage.local.set({ filaEntrar: {
    lista, inicio: 0,
    lote: Math.max(0, +$("joinLote")?.value || 0),
    responderPerguntas: $("joinPerguntas").checked,
  }});
  await chrome.alarms.create("retomar_fila", { when: quando });
  registrar(`Entradas agendadas pra ${new Date(quando).toLocaleString("pt-BR")} (${lista.length} grupos)`, "l-ok");
}

// ---------- agendar aquecer (profilewarm.scheduleAlarm deles) ----------
async function agendarAquecer() {
  const quando = $("warmAgendarPara").value
    ? new Date($("warmAgendarPara").value).getTime() : null;
  if (!quando || quando < Date.now() + 60000)
    return registrar("Escolha data/hora futura (mín 1 min)", "l-err");
  const grupos = $("warmGrupo").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const tipos = [...document.querySelectorAll("#warmTipos input:checked")].map((c) => c.value);
  if (!grupos.length) return registrar("Informe ao menos um grupo", "l-err");
  if (!tipos.length) return registrar("Marque ao menos um tipo de membro", "l-err");
  await chrome.storage.local.set({ filaAquecer: {
    grupos, tipos,
    limite: Math.max(1, +$("warmLimite").value || 10),
    delay: Math.max(15, +$("warmDelay").value || 60),
  }});
  await chrome.alarms.create("retomar_fila", { when: quando });
  registrar(`Aquecimento agendado pra ${new Date(quando).toLocaleString("pt-BR")}`, "l-ok");
}

// ---------- amizade ----------
async function amizade() {
  const perfis = $("perfis").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const dmin = Math.max(10, +$("amDelayMin").value || 45);
  const dmax = Math.max(dmin, +$("amDelayMax").value || 120);
  if (!perfis.length) return registrar("Lista de perfis vazia", "l-err");
  if (!(await gateSessao())) return;
  // dedup persistente (engageProfiles deles): não repede pedido em <30 dias
  const TRINTA_DIAS = 30 * 24 * 3600 * 1000;
  const { amizadeTentados = {} } = await chrome.storage.local.get("amizadeTentados");
  controle(true);
  try {
    for (let i = 0; i < perfis.length; i++) {
      await esperarPausa();
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const p = perfis[i];
      $("progresso").textContent = `Perfil ${i + 1}/${perfis.length}`;
      try {
        const r = await comando("perfil", { bruto: p });
        if (r.erro) throw new Error(r.erro);
        if (amizadeTentados[r.idUsuario] > Date.now() - TRINTA_DIAS) {
          registrar(`${p}: pedido já enviado <30d — pulando`, "l-info");
          continue;
        }
        const res = await comando("amizade", { idUsuario: r.idUsuario });
        if (["enviado", "ja_amigo"].includes(res.resultado)) {
          amizadeTentados[r.idUsuario] = Date.now();
          await chrome.storage.local.set({ amizadeTentados });
        }
        rel("amizade", p, res.resultado, r.idUsuario);
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

// ---------- aquecer (PROFILE_WARM deles: multi-grupo + multi-tipo) ----------
async function aquecer(estadoInicial) {
  const grupos = estadoInicial?.grupos ??
    $("warmGrupo").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const tipos = estadoInicial?.tipos ??
    [...document.querySelectorAll("#warmTipos input:checked")].map((c) => c.value);
  const limite = estadoInicial?.limite ?? Math.max(1, +$("warmLimite").value || 10);
  const delay = estadoInicial?.delay ?? Math.max(15, +$("warmDelay").value || 60);
  if (!grupos.length) return registrar("Informe ao menos um grupo", "l-err");
  if (!tipos.length) return registrar("Marque ao menos um tipo de membro", "l-err");
  if (!(await gateSessao())) return;
  // dedup persistente de pedidos <30d (engageProfiles deles)
  const TRINTA_DIAS = 30 * 24 * 3600 * 1000;
  const { amizadeTentados = {} } = await chrome.storage.local.get("amizadeTentados");
  const vistos = new Set(); // mesmo usuário em 2 tipos do mesmo grupo
  controle(true);
  try {
    // cota por grupo: D() deles — floor + resto pros primeiros ([4,3,3] p/ 10/3)
    const divisao = (() => {
      const base = Math.floor(limite / grupos.length), resto = limite % grupos.length;
      return grupos.map((_, i) => Math.max(1, base + (i < resto ? 1 : 0)));
    })();
    // stopIfExceedsAvailability: >max(40,4×alvo) fetches de membros → para tudo
    const maxFetches = Math.max(40, limite * 4);
    let enviados = 0, jaAmigos = 0, fetches = 0, gIdx = 0;
    outer: for (const g of grupos) {
      const cotaGrupo = divisao[gIdx++];
      if (parar || enviados >= limite || fetches > maxFetches) break;
      const gid = await resolver(g);
      registrar(`Grupo ${gid}: cota de ${cotaGrupo} pedidos (${tipos.length} tipos)`, "l-info");
      let feitosGrupo = 0;
      for (const tipo of tipos) {
        if (parar || enviados >= limite || fetches > maxFetches) break;
        if (feitosGrupo >= cotaGrupo) break;
        let cursor, vazias = 0;
        while (feitosGrupo < cotaGrupo && enviados < limite && fetches <= maxFetches) {
          if (parar) { registrar("Interrompido", "l-warn"); break outer; }
          fetches++;
          const res = await comando("membros", { idGrupo: gid, cursor, tipo });
          if (res.resultado === "bloqueado") {
            registrar(`BLOQUEIO — ${res.erro}. Parando tudo.`, "l-err");
            break outer;
          }
          if (res.resultado !== "ok") { registrar(res.erro || "membros falhou", "l-warn"); break; }
          if (!res.usuarios.length) {
            // 2 páginas vazias seguidas → tipo esgotado (como eles)
            if (++vazias >= 2 || !res.cursor) break;
            cursor = res.cursor;
            continue;
          }
          vazias = 0;
          cursor = res.cursor;
          for (const u of res.usuarios) {
            await esperarPausa();
            if (parar || enviados >= limite || feitosGrupo >= cotaGrupo) continue;
            if (vistos.has(u.id)) continue;
            vistos.add(u.id);
            if (u.status && u.status !== "CAN_REQUEST") { jaAmigos++; continue; }
            if (amizadeTentados[u.id] > Date.now() - TRINTA_DIAS) { jaAmigos++; continue; }
            $("progresso").textContent = `Pedidos ${enviados}/${limite} — ${u.nome || u.id}`;
            const r = await comando("amizade", { idUsuario: u.id });
            if (["enviado", "ja_amigo"].includes(r.resultado)) {
              amizadeTentados[u.id] = Date.now();
              await chrome.storage.local.set({ amizadeTentados });
            }
            rel("amizade", u.nome || u.id, r.resultado, u.id);
            if (r.resultado === "enviado") {
              enviados++; feitosGrupo++;
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
          if (parar) break outer;
          if (!cursor) break;
        }
      }
    }
    if (fetches > maxFetches)
      registrar(`Disponibilidade estourada (${fetches} fetches) — parando`, "l-warn");
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
    chrome.storage.local.set({ buscaRecente: { termo: "(meus grupos)", grupos: res.grupos, quando: Date.now() } });
    renderResultados(res.grupos.map((g) => ({
      ...g,
      membrosTexto: g.membros ? `${g.membros} membros` : undefined,
    })));
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
    for (const m of libSel.mkFotos.slice(0, Math.max(0, 10 - fotosDataUrl.length)))
      fotosDataUrl.push(m.dataUrl);
    const idsGrupos = [];
    for (const g of gruposBrutos) {
      try { idsGrupos.push(await resolver(g)); }
      catch (e) { registrar(`${g}: ${e.message}`, "l-warn"); }
    }
    registrar(`Publicando anúncio (${fotosDataUrl.length} fotos, ${idsGrupos.length} grupos, marketplace=${paraMarketplace})...`);
    const res = await comando("listing", {
      titulo, descricao, preco, fotosDataUrl, idsGrupos, paraMarketplace,
    });
    rel("listing", titulo || "(sem título)", res.resultado, res.erro);
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
$("btnAgendar")?.addEventListener("click", () => { if (!rodando) agendar(); });
$("btnMeusGrupos").addEventListener("click", () => { if (!rodando) meusGrupos(); });
$("btnLimparLista").addEventListener("click", () => { $("grupos").value = ""; salvarRascunho(); });
$("btnListing").addEventListener("click", () => { if (!rodando) publicarListing(); });
$("btnBuscar").addEventListener("click", () => { if (!rodando) buscar(); });
$("btnEntrar").addEventListener("click", () => { if (!rodando) entrar(); });
$("btnEngajar").addEventListener("click", () => { if (!rodando) engajar(); });
$("btnAgendarEngajar")?.addEventListener("click", () => { if (!rodando) agendarEngajar(); });
$("btnAgendarEntrar")?.addEventListener("click", () => { if (!rodando) agendarEntrar(); });
$("btnAgendarAquecer")?.addEventListener("click", () => { if (!rodando) agendarAquecer(); });
$("btnAmizade").addEventListener("click", () => { if (!rodando) amizade(); });
$("btnAquecer").addEventListener("click", () => { if (!rodando) aquecer(); });
$("btnParar").addEventListener("click", () => { parar = true; pausado = false; });
// clearJoinedIds/clearAlarm deles: zera os conjuntos de dedup e o descanso
$("btnLimparDedup")?.addEventListener("click", async () => {
  if (!confirm("Zerar dedups (grupos entrados, amizades, posts/autores interagidos) e o descanso de 24h?")) return;
  await chrome.storage.local.remove([
    "gruposEntrados", "amizadeTentados", "interagidosGrupo", "autores", "descansoAte",
  ]);
  registrar("Dedups e descanso zerados", "l-ok");
});
// PAUSE/RESUME (portado das máquinas de job deles)
$("btnPausar").addEventListener("click", () => {
  pausado = !pausado;
  $("btnPausar").textContent = pausado ? "Retomar" : "Pausar";
  // job DOM roda dentro da aba — pausa vai por comando (domPausar)
  comando("domPausar").catch(() => {});
  registrar(pausado ? "Pausado — posição preservada" : "Retomado", "l-info");
});
// engageReports: exporta histórico do IndexedDB
$("btnRelatorio")?.addEventListener("click", async () => {
  try {
    const itens = await Biblioteca.relatorios.listar();
    if (!itens.length) return registrar("Sem relatórios salvos", "l-info");
    const blob = new Blob([JSON.stringify(itens, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fbap-relatorios-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    registrar(`${itens.length} registros exportados`, "l-ok");
  } catch (e) {
    registrar(e.message, "l-err");
  }
});
$("btnStudio")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") });
});

// ---------- listingProbe (portado: arma gravação de shapes p/ mapear fluxo) ----------
let probeGravando = false;
$("btnProbe")?.addEventListener("click", async () => {
  try {
    if (!probeGravando) {
      const r = await comando("probeIniciar");
      if (r.resultado !== "ok") return registrar(r.erro || "falhou", "l-err");
      probeGravando = true;
      $("btnProbe").textContent = "■ Parar";
      registrar("Probe gravando — execute o fluxo no Facebook manualmente", "l-info");
    } else {
      const r = await comando("probeParar");
      probeGravando = false;
      $("btnProbe").textContent = "● Gravar";
      const passos = r.passos ?? [];
      registrar(`Probe parado: ${passos.length} passos gravados`, "l-ok");
      if (passos.length) {
        const blob = new Blob([JSON.stringify(passos, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `fbap-probe-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }
  } catch (e) {
    registrar(e.message, "l-err");
  }
});
$("btnAddLista").addEventListener("click", () => {
  const lista = selecionados();
  if (!lista.length) return registrar("Nenhum grupo selecionado", "l-err");
  const atual = $("grupos").value.trim();
  const urls = lista.map((g) => `https://www.facebook.com/groups/${g.id}`);
  $("grupos").value = atual ? atual + "\n" + urls.join("\n") : urls.join("\n");
  salvarRascunho();
  registrar(`${lista.length} grupos adicionados à lista de postagem`, "l-ok");
});

// ---------- listas nomeadas de grupos (groupLists deles) ----------
// salva a seleção da busca com nome; o select no Postar insere a lista no campo
const listasGrupos = {
  async todas() {
    return (await chrome.storage.local.get("listasGrupos")).listasGrupos ?? {};
  },
  async salvar(nome, urls) {
    const todas = await this.todas();
    todas[nome] = [...new Set([...(todas[nome] ?? []), ...urls])];
    await chrome.storage.local.set({ listasGrupos: todas });
  },
  async render() {
    const sel = $("listasSalvas");
    if (!sel) return;
    const nomes = Object.keys(await this.todas());
    sel.innerHTML =
      `<option value="">— listas salvas —</option>` +
      nomes.map((n) => `<option>${n}</option>`).join("");
  },
};
$("btnSalvarLista")?.addEventListener("click", async () => {
  const lista = selecionados();
  if (!lista.length) return registrar("Nenhum grupo selecionado", "l-err");
  const nome = prompt("Nome da lista:", "lista 1")?.trim();
  if (!nome) return;
  await listasGrupos.salvar(nome, lista.map((g) => `https://www.facebook.com/groups/${g.id}`));
  await listasGrupos.render();
  registrar(`Lista "${nome}" salva (${lista.length} grupos)`, "l-ok");
});
$("btnInserirLista")?.addEventListener("click", async () => {
  const nome = $("listasSalvas").value;
  if (!nome) return registrar("Escolha uma lista salva", "l-err");
  const urls = (await listasGrupos.todas())[nome] ?? [];
  if (!urls.length) return registrar("Lista vazia", "l-err");
  const atual = $("grupos").value.trim();
  $("grupos").value = atual ? atual + "\n" + urls.join("\n") : urls.join("\n");
  salvarRascunho();
  registrar(`Lista "${nome}" inserida (${urls.length} grupos)`, "l-ok");
});
$("btnExcluirLista")?.addEventListener("click", async () => {
  const nome = $("listasSalvas").value;
  if (!nome) return;
  const todas = await listasGrupos.todas();
  delete todas[nome];
  await chrome.storage.local.set({ listasGrupos: todas });
  await listasGrupos.render();
});
listasGrupos.render();

// ---------- listas nomeadas de perfis (engageProfiles deles) ----------
const listasPerfis = {
  async todas() {
    return (await chrome.storage.local.get("listasPerfis")).listasPerfis ?? {};
  },
  async render() {
    const sel = $("listasPerfis");
    if (!sel) return;
    const nomes = Object.keys(await this.todas());
    sel.innerHTML =
      `<option value="">— listas de perfis —</option>` +
      nomes.map((n) => `<option>${n}</option>`).join("");
  },
};
$("btnSalvarPerfis")?.addEventListener("click", async () => {
  const urls = $("perfis").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!urls.length) return registrar("Campo de perfis vazio", "l-err");
  const nome = prompt("Nome da lista de perfis:", "perfis 1")?.trim();
  if (!nome) return;
  const todas = await listasPerfis.todas();
  todas[nome] = [...new Set([...(todas[nome] ?? []), ...urls])];
  await chrome.storage.local.set({ listasPerfis: todas });
  await listasPerfis.render();
  registrar(`Lista de perfis "${nome}" salva (${urls.length})`, "l-ok");
});
$("btnInserirPerfis")?.addEventListener("click", async () => {
  const nome = $("listasPerfis").value;
  if (!nome) return registrar("Escolha uma lista salva", "l-err");
  const urls = (await listasPerfis.todas())[nome] ?? [];
  const atual = $("perfis").value.trim();
  $("perfis").value = atual ? atual + "\n" + urls.join("\n") : urls.join("\n");
  salvarRascunho();
  registrar(`Lista "${nome}" inserida (${urls.length} perfis)`, "l-ok");
});
$("btnExcluirPerfis")?.addEventListener("click", async () => {
  const nome = $("listasPerfis").value;
  if (!nome) return;
  const todas = await listasPerfis.todas();
  delete todas[nome];
  await chrome.storage.local.set({ listasPerfis: todas });
  await listasPerfis.render();
});
listasPerfis.render();

// restaura a última busca (groupWarmSearches) — resultados sobrevivem
// ao painel fechar/reabrir
chrome.storage.local.get("buscaRecente", ({ buscaRecente }) => {
  if (!buscaRecente?.grupos?.length) return;
  gruposEncontrados = buscaRecente.grupos;
  renderResultados(buscaRecente.grupos);
  registrar(`Busca restaurada: "${buscaRecente.termo}" (${buscaRecente.grupos.length} grupos)`, "l-info");
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
  // job DOM na aba: progresso + fim (GROUP_ENGAGE_PROGRESS/DONE deles)
  if (m.tipo === "domProgresso") {
    const d = m.dados ?? {};
    $("progresso").textContent = d.aguardando
      ? `DOM ${d.feitos}/${d.limite} — aguardando ${d.aguardando}/${d.total}s`
      : `DOM ${d.feitos}/${d.limite} posts`;
  }
  if (m.tipo === "domFim") domResolver?.(m.dados);
  // kill-switch (portado: sessionInvalidated) — para TODOS os jobs
  if (m.tipo === "sessaoInvalidada") {
    parar = true;
    registrar(`SESSÃO PERDIDA (${m.dados?.motivo || "?"}) — tudo parado. Faça login de novo.`, "l-err");
  }
  // photo_session_stale deles: sessão de upload expirou → recalibrar postando foto
  if (m.tipo === "photoSessionStale")
    registrar("Sessão de upload de foto expirada — poste uma foto manualmente pra recalibrar", "l-warn");
});

// ---------- rascunho do formulário (autopost.draft/engagepro.settings deles) ----------
// a config dos campos sobrevive fechar/reabrir o painel — nada se perde
const RASCUNHO_IDS = [
  "grupos", "mensagem", "vars", "modo", "limiteRodada", "retMin", "retMax",
  "dmin", "dmax", "postRepetir",
  "termo", "joinPerguntas", "joinLote",
  "engGrupo", "engLimite", "engDelayMin", "engDelayMax", "engGapMin",
  "engGapMax", "engListaMin", "engListaMax", "engLote", "engDom", "engLike",
  "engComentar", "engSoDiferentes", "engDedup", "engModo", "engTextos",
  "perfis", "amDelayMin", "amDelayMax",
  "warmGrupo", "warmLimite", "warmDelay",
  "mkTitulo", "mkPreco", "mkDescricao", "mkGrupos", "mkMarketplace",
];
let rascunhoTimer;
function salvarRascunho() {
  clearTimeout(rascunhoTimer);
  rascunhoTimer = setTimeout(() => {
    const r = {};
    for (const id of RASCUNHO_IDS) {
      const el = $(id);
      if (el) r[id] = el.type === "checkbox" ? el.checked : el.value;
    }
    chrome.storage.local.set({ rascunho: r });
  }, 500);
}
const rascunhoPronto = (async () => {
  const { rascunho } = await chrome.storage.local.get("rascunho");
  if (!rascunho) return;
  for (const [id, v] of Object.entries(rascunho)) {
    const el = $(id);
    if (el) el.type === "checkbox" ? (el.checked = !!v) : (el.value = v);
  }
})();
for (const id of RASCUNHO_IDS) {
  $(id)?.addEventListener("input", salvarRascunho);
  $(id)?.addEventListener("change", salvarRascunho);
}

// ---------- ação rápida do botão flutuante ----------
// FAB no grupo → storage acaoPendente → painel abre, troca de aba e
// pré-enche o campo com a URL do grupo
(async () => {
  await rascunhoPronto; // não sobrescrever o rascunho restaurado
  const { acaoPendente } = await chrome.storage.local.get("acaoPendente");
  if (!acaoPendente?.acao) return;
  await chrome.storage.local.remove("acaoPendente");
  const { acao, grupo } = acaoPendente;
  const tab = { postar: "postar", engajar: "engajar", aquecer: "amigos" }[acao];
  const alvo = { postar: "grupos", engajar: "engGrupo", aquecer: "warmGrupo" }[acao];
  if (tab) document.querySelector(`.tab[data-tab="${tab}"]`)?.click();
  if (alvo && grupo && $(alvo)) {
    const el = $(alvo);
    const linhas = el.value.split("\n").filter((s) => s.trim());
    if (!linhas.includes(grupo)) el.value = linhas.concat(grupo).join("\n");
    salvarRascunho();
  }
  registrar(`Ação rápida: ${acao} em ${grupo ?? "?"}`, "l-info");
})();

// ---------- retomada de lote ----------
(async () => {
  const { retomarPendente, fila, filaEngajar, filaEntrar, filaAquecer } =
    await chrome.storage.local.get(["retomarPendente", "fila", "filaEngajar", "filaEntrar", "filaAquecer"]);
  if (!retomarPendente) return;
  await chrome.storage.local.remove("retomarPendente");
  if (filaAquecer?.grupos?.length) {
    registrar(`Retomando aquecimento agendado (${filaAquecer.grupos.length} grupos)`, "l-info");
    await chrome.storage.local.remove("filaAquecer");
    aquecer(filaAquecer);
  } else if (filaEngajar?.listas?.length) {
    registrar(`Retomando engajamento: lista ${filaEngajar.lidx + 1}, grupo ${filaEngajar.gidx + 1}`, "l-info");
    engajar(filaEngajar);
  } else if (filaEntrar?.lista?.length) {
    registrar(`Retomando entradas: ${filaEntrar.inicio}/${filaEntrar.lista.length} já feitas`, "l-info");
    entrar(filaEntrar);
  } else if (fila?.grupos?.length) {
    registrar(`Retomando lote: ${fila.inicio}/${fila.grupos.length} já feitos`, "l-info");
    postar(fila);
  }
})();
