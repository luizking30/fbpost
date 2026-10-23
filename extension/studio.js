// Studio — gerencia a biblioteca de conteúdo (biblioteca.js/IndexedDB).
// Portado do studio.html deles: textos, variáveis e mídias que alimentam
// os campos do painel via botão "biblioteca".
const $ = (id) => document.getElementById(id);

for (const b of document.querySelectorAll("aside nav button"))
  b.addEventListener("click", () => {
    document.querySelectorAll("aside nav button").forEach((x) => x.classList.remove("ativo"));
    document.querySelectorAll(".pane").forEach((x) => x.classList.remove("ativo"));
    b.classList.add("ativo");
    $("p-" + b.dataset.pane).classList.add("ativo");
  });

const avisar = (t) => {
  $("msg").textContent = t;
  setTimeout(() => ($("msg").textContent = ""), 2500);
};

const itemHtml = (id, titulo, detalhe) =>
  `<div class="item"><div class="info"><div class="nome">${titulo}</div>
   <small>${detalhe}</small></div>
   <button class="del" data-id="${id}" title="remover">×</button></div>`;

// ---------- textos ----------
async function listarTextos() {
  const itens = await Biblioteca.textos.listar();
  $("tLista").innerHTML = itens.length
    ? itens.map((t) =>
        itemHtml(t.id, t.nome, (t.conteudo ?? "").slice(0, 80))).join("")
    : '<div class="vazio">nenhum texto salvo</div>';
  for (const b of $("tLista").querySelectorAll(".del"))
    b.addEventListener("click", async () => {
      await Biblioteca.textos.remover(+b.dataset.id);
      listarTextos();
    });
}
$("tAdd").addEventListener("click", async () => {
  const nome = $("tNome").value.trim();
  const conteudo = $("tConteudo").value.trim();
  if (!nome || !conteudo) return avisar("preencha nome e conteúdo");
  await Biblioteca.textos.adicionar(nome, conteudo);
  $("tNome").value = $("tConteudo").value = "";
  avisar("texto salvo");
  listarTextos();
});

// ---------- variáveis ----------
async function listarVars() {
  const itens = await Biblioteca.variaveis.listar();
  $("vLista").innerHTML = itens.length
    ? itens.map((v) =>
        itemHtml(v.nome, `{{${v.nome}}}`, (v.valores ?? []).join(" | "))).join("")
    : '<div class="vazio">nenhuma variável salva</div>';
  for (const b of $("vLista").querySelectorAll(".del"))
    b.addEventListener("click", async () => {
      await Biblioteca.variaveis.remover(b.dataset.id);
      listarVars();
    });
}
$("vAdd").addEventListener("click", async () => {
  const nome = $("vNome").value.trim().toLowerCase();
  const valores = $("vValores").value.split("|").map((s) => s.trim()).filter(Boolean);
  if (!nome || !valores.length) return avisar("preencha nome e valores");
  await Biblioteca.variaveis.salvar(nome, valores);
  $("vNome").value = $("vValores").value = "";
  avisar("variável salva");
  listarVars();
});

// ---------- mídias ----------
async function listarMidias() {
  const itens = await Biblioteca.midias.listar();
  $("mLista").innerHTML = itens.length
    ? itens.map((m) => {
        const ativo = m.ativo !== false;
        return `<div class="item"${ativo ? "" : ' style="opacity:.45"'}>
          <div class="info"><div class="nome">${m.nome}</div>
          <small>${m.pasta ? m.pasta + " · " : ""}${m.tipo} · ${m.mime} · ${Math.round((m.blob?.size ?? 0) / 1024)}KB${ativo ? "" : " · inativa"}</small></div>
          <button class="tog" data-id="${m.id}" title="${ativo ? "desativar" : "ativar"}">${ativo ? "●" : "○"}</button>
          <button class="del" data-id="${m.id}" title="remover">×</button></div>`;
      }).join("")
    : '<div class="vazio">nenhuma mídia salva</div>';
  for (const b of $("mLista").querySelectorAll(".del"))
    b.addEventListener("click", async () => {
      await Biblioteca.midias.remover(+b.dataset.id);
      listarMidias();
    });
  for (const b of $("mLista").querySelectorAll(".tog"))
    b.addEventListener("click", async () => {
      await Biblioteca.midias.alternar(+b.dataset.id);
      listarMidias();
    });
}
$("mAdd").addEventListener("click", async () => {
  const nome = $("mNome").value.trim() || $("mArquivo").files[0]?.name || "mídia";
  const arquivo = $("mArquivo").files[0];
  if (!arquivo) return avisar("escolha um arquivo");
  await Biblioteca.midias.adicionar(nome, $("mTipo").value, arquivo, $("mPasta").value.trim());
  $("mNome").value = $("mArquivo").value = "";
  avisar("mídia salva");
  listarMidias();
});

listarTextos();
listarVars();
listarMidias();
