const $ = (id) => document.getElementById(id);
const logEl = $("log");
let rodando = false, parar = false;
let gruposEncontrados = [];

const TIPOS = {
  post: "Post", postFoto: "Post+foto", comentario: "Comentário",
  comentarioFoto: "Coment+foto", like: "Like", entrar: "Entrar",
  busca: "Busca", feed: "Feed",
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
const variar = (texto) =>
  texto.replace(/\{([^{}]+)\}/g, (_, opcoes) => {
    const partes = opcoes.split("|").map((s) => s.trim()).filter(Boolean);
    return partes.length ? partes[Math.floor(Math.random() * partes.length)] : "";
  });

const resolver = async (bruto) => {
  const r = await comando("resolver", { bruto });
  if (r.erro) throw new Error(r.erro);
  return r.idGrupo;
};

function controle(estado) {
  rodando = estado;
  parar = false;
  for (const b of ["btnPostar", "btnEngajar", "btnEntrar"])
    $(b).disabled = estado;
  $("btnParar").style.display = estado ? "block" : "none";
  if (!estado) $("progresso").textContent = "";
}

// ---------- postar ----------
async function postar() {
  const grupos = $("grupos").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const texto = $("mensagem").value.trim();
  const dmin = Math.max(5, +$("dmin").value || 60);
  const dmax = Math.max(dmin, +$("dmax").value || 180);
  const foto = $("foto").files[0];

  if (!grupos.length) return registrar("Lista de grupos vazia", "l-err");
  if (!texto && !foto) return registrar("Mensagem vazia", "l-err");

  let fotoDataUrl;
  if (foto) {
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
    registrar(`Motor ok — calibrações: ${ping.calibracoes.join(", ") || "nenhuma"}`);
    if (!ping.calibracoes.includes("post"))
      registrar("Sem calibração de post: poste manualmente num grupo", "l-warn");

    const cache = {};
    for (let i = 0; i < grupos.length; i++) {
      if (parar) { registrar("Interrompido", "l-warn"); break; }
      const g = grupos[i];
      $("progresso").textContent = `${i + 1}/${grupos.length} — ${g}`;
      try {
        if (!cache[g]) cache[g] = await resolver(g);
        const res = await comando("postar", {
          idGrupo: cache[g], texto, fotoDataUrl,
        });
        if (res.resultado === "ok") {
          registrar(`${g}: ${res.situacao || "publicado"}`, "l-ok");
        } else if (res.resultado === "bloqueado") {
          registrar(`${g}: BLOQUEIO — ${res.erro}. Parando tudo.`, "l-err");
          break;
        } else {
          registrar(`${g}: erro — ${res.erro}`, "l-warn");
        }
      } catch (e) {
        registrar(`${g}: ${e.message}`, "l-warn");
      }
      if (i < grupos.length - 1 && !parar) {
        const espera = aleatorio(dmin, dmax);
        $("progresso").textContent = `${i + 1}/${grupos.length} — aguardando ${espera}s`;
        for (let s = 0; s < espera && !parar; s++) await dormir(1000);
      }
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
      const res = await comando("entrar", { idGrupo: g.id });
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
  const textos = $("engTextos").value.split("\n").map((s) => s.trim()).filter(Boolean);

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
        $("progresso").textContent = `Post ${feitos + 1}/${limite}`;
        if (querLike) {
          const r = await comando("curtir", { feedbackId: p.feedbackId });
          if (r.resultado === "bloqueado") {
            registrar(`BLOQUEIO no like — ${r.erro}. Parando.`, "l-err");
            break outer;
          }
          if (r.resultado === "ok") registrar(`like em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
          else registrar(`like falhou: ${r.erro}`, "l-warn");
          await dormir(aleatorio(3, 8) * 1000);
        }
        if (querComentario) {
          const texto = variar(textos[idxTexto++ % textos.length]);
          const r = await comando("comentar", { feedbackId: p.feedbackId, texto });
          if (r.resultado === "bloqueado") {
            registrar(`BLOQUEIO no comentário — ${r.erro}. Parando.`, "l-err");
            break outer;
          }
          if (r.resultado === "ok")
            registrar(`comentou (${r.situacao}) em ${p.feedbackId.slice(0, 18)}…`, "l-ok");
          else registrar(`comentário falhou: ${r.erro}`, "l-warn");
        }
        feitos++;
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

// ---------- listeners ----------
$("btnPostar").addEventListener("click", () => { if (!rodando) postar(); });
$("btnBuscar").addEventListener("click", () => { if (!rodando) buscar(); });
$("btnEntrar").addEventListener("click", () => { if (!rodando) entrar(); });
$("btnEngajar").addEventListener("click", () => { if (!rodando) engajar(); });
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
});
