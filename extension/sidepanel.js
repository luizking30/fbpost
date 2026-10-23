const $ = (id) => document.getElementById(id);
const logEl = $("log");
let rodando = false, parar = false;
let gruposEncontrados = [];

const TIPOS = {
  post: "Post", postFoto: "Post+foto", comentario: "Comentário",
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

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

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
  for (const b of ["btnPostar", "btnEngajar", "btnEntrar", "btnAmizade", "btnAquecer"])
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
  const foto = $("foto").files[0];

  if (!grupos.length) return registrar("Lista de grupos vazia", "l-err");
  if (!mensagens.length && !foto && !estadoInicial?.fotoDataUrl)
    return registrar("Mensagem vazia", "l-err");

  let fotoDataUrl = estadoInicial?.fotoDataUrl;
  if (foto && !fotoDataUrl) {
    fotoDataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(foto);
    });
  }

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
      const msg = mensagens.length
        ? aplicarSpintax(
            modo === "aleatorio"
              ? mensagens[Math.floor(Math.random() * mensagens.length)]
              : mensagens[i % mensagens.length],
            vars)
        : "";
      try {
        if (!cache[g]) cache[g] = await resolver(g);
        const res = await comando("postar", {
          idGrupo: cache[g], texto: msg, fotoDataUrl,
        });
        feitos = i + 1;
        if (res.resultado === "ok") {
          algumSucesso = true; repetidos = 0; ultimoCodigo = "";
          registrar(`${g}: ${res.situacao || "publicado"}${res.postId ? " (id " + res.postId + ")" : ""}`, "l-ok");
        } else if (res.resultado === "bloqueado") {
          registrar(`${g}: BLOQUEIO — ${res.erro}. Parando tudo.`, "l-err");
          await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, inicio: feitos, fotoDataUrl });
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
      if (i < fim - 1 && !parar) {
        const espera = aleatorio(dmin, dmax);
        $("progresso").textContent = `${i + 1}/${grupos.length} — aguardando ${espera}s`;
        for (let s = 0; s < espera && !parar; s++) await dormir(1000);
      }
    }

    // pacote: sobrou fila → agenda retomada
    if (feitos < grupos.length && !parar) {
      const rMin = Math.max(0, +$("retMin").value || 2);
      const rMax = Math.max(rMin, +$("retMax").value || 6);
      const horas = rMin + Math.random() * (rMax - rMin);
      await salvarFila({ grupos, mensagens, vars, modo, limiteRodada, inicio: feitos, fotoDataUrl });
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
    $("resultados").innerHTML = res.grupos
      .map(
        (g, i) => `<div class="grupo-item">
          <input type="checkbox" data-gid="${g.id}" data-gnome="${g.nome}" checked>
          <span>${g.nome}</span><small>${g.membros || ""}</small></div>`
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
      $("progresso").textContent = `Entrando ${i + 1}/${lista.length} — ${g.nome}`;
      const res = await comando("entrar", { idGrupo: g.id, responderPerguntas: $("joinPerguntas").checked });
      if (res.resultado === "entrou") registrar(`${g.nome}: entrou`, "l-ok");
      else if (res.resultado === "pendente") registrar(`${g.nome}: pedido pendente`, "l-warn");
      else if (res.resultado === "ja_membro") registrar(`${g.nome}: já é membro`, "l-info");
      else if (res.resultado === "perguntas") registrar(`${g.nome}: pede perguntas (pular)`, "l-warn");
      else if (res.resultado === "bloqueado") {
        registrar(`${g.nome}: BLOQUEIO — ${res.erro}. Parando.`, "l-err");
        break;
      } else registrar(`${g.nome}: ${res.erro || "falhou"}`, "l-warn");
      if (i < lista.length - 1 && !parar) await dormir(aleatorio(20, 60) * 1000);
    }
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    controle(false);
  }
}

// ---------- engajar ----------
async function engajar() {
  const grupo = $("engGrupo").value.trim();
  const limite = Math.max(1, +$("engLimite").value || 10);
  const delay = Math.max(5, +$("engDelay").value || 30);
  const querLike = $("engLike").checked;
  const querComentario = $("engComentar").checked;
  const soDiferentes = $("engSoDiferentes").checked;
  const dedup = $("engDedup").checked;
  const textos = $("engTextos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const vars = lerVars();
  const { interagidos = {}, autores = {} } = await chrome.storage.local.get(["interagidos", "autores"]);

  if (!grupo) return registrar("Informe o grupo", "l-err");
  if (!querLike && !querComentario) return registrar("Marque curtir e/ou comentar", "l-err");
  if (querComentario && !textos.length) return registrar("Sem textos de comentário", "l-err");

  controle(true);
  try {
    const gid = await resolver(grupo);
    registrar(`Grupo ${gid} — engajando até ${limite} posts`);
    let feitos = 0, cursor, paginas = 0, idxTexto = 0;
    outer: while (feitos < limite && paginas < 10) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      paginas++;
      const feed = await comando("feed", { idGrupo: gid, cursor });
      if (feed.resultado === "bloqueado") {
        registrar(`BLOQUEIO no feed — ${feed.erro}`, "l-err");
        break;
      }
      if (feed.resultado !== "ok") {
        registrar(feed.erro || "feed falhou", "l-err");
        break;
      }
      if (!feed.posts.length) { registrar("Feed vazio", "l-warn"); break; }
      cursor = feed.cursor;
      for (const p of feed.posts) {
        if (parar) break outer;
        if (feitos >= limite) break outer;
        if (dedup && interagidos[p.feedbackId]) continue;
        if (soDiferentes && p.autorId && autores[p.autorId]) continue;
        $("progresso").textContent = `Post ${feitos + 1}/${limite}`;
        if (querLike) {
          const r = await comando("curtir", { feedbackId: p.feedbackId });
          if (r.resultado === "bloqueado") {
            registrar(`BLOQUEIO no like — ${r.erro}. Parando.`, "l-err");
            break outer;
          }
          if (r.resultado === "ok") {
            interagidos[p.feedbackId] = Date.now();
            registrar(`like em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
          } else registrar(`like falhou: ${r.erro}`, "l-warn");
          await dormir(aleatorio(3, 8) * 1000);
        }
        if (querComentario) {
          const texto = aplicarSpintax(textos[idxTexto++ % textos.length], vars);
          const r = await comando("comentar", { feedbackId: p.feedbackId, texto });
          if (r.resultado === "bloqueado") {
            registrar(`BLOQUEIO no comentário — ${r.erro}. Parando.`, "l-err");
            break outer;
          }
          if (r.resultado === "ok") {
            interagidos[p.feedbackId] = Date.now();
            registrar(`comentou (${r.situacao}) em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
          } else registrar(`comentário falhou: ${r.erro}`, "l-warn");
        }
        if (soDiferentes && p.autorId) autores[p.autorId] = Date.now();
        feitos++;
        await chrome.storage.local.set({ interagidos, autores });
        await dormir(delay * 1000);
      }
      if (!cursor) break;
    }
    registrar(`Engajamento concluído: ${feitos} posts`, "l-ok");
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
        if (res.resultado === "enviado") registrar(`${p}: pedido enviado`, "l-ok");
        else if (res.resultado === "ja_amigo") registrar(`${p}: já é amigo/pendente`, "l-info");
        else if (res.resultado === "bloqueado") {
          registrar(`${p}: BLOQUEIO — ${res.erro}. Parando.`, "l-err");
          break;
        } else registrar(`${p}: ${res.erro || "falhou"}`, "l-warn");
      } catch (e) {
        registrar(`${p}: ${e.message}`, "l-warn");
      }
      if (i < perfis.length - 1 && !parar)
        await dormir(aleatorio(dmin, dmax) * 1000);
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
        } else if (r.resultado === "ja_amigo") {
          jaAmigos++;
          registrar(`${u.nome || u.id}: já é amigo`, "l-info");
        } else if (r.resultado === "bloqueado") {
          registrar(`BLOQUEIO — ${r.erro}. Parando.`, "l-err");
          break outer;
        } else registrar(`${u.nome || u.id}: ${r.erro || "falhou"}`, "l-warn");
        await dormir(delay * 1000);
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

// ---------- listeners ----------
$("btnPostar").addEventListener("click", () => { if (!rodando) postar(); });
$("btnBuscar").addEventListener("click", () => { if (!rodando) buscar(); });
$("btnEntrar").addEventListener("click", () => { if (!rodando) entrar(); });
$("btnEngajar").addEventListener("click", () => { if (!rodando) engajar(); });
$("btnAmizade").addEventListener("click", () => { if (!rodando) amizade(); });
$("btnAquecer").addEventListener("click", () => { if (!rodando) aquecer(); });
$("btnParar").addEventListener("click", () => { parar = true; });
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
