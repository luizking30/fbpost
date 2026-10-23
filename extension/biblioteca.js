// Biblioteca de conteúdo (portado: Dexie/IndexedDB deles — engageMedia,
// engageVariables, engageReports). Banco na origem da extensão:
// sidepanel e studio compartilham os mesmos stores.
const Biblioteca = (() => {
  "use strict";
  const NOME_DB = "fb-autopost";
  const VERSAO = 2;
  let dbP = null;

  const abrir = () =>
    (dbP ??= new Promise((res, rej) => {
      const r = indexedDB.open(NOME_DB, VERSAO);
      r.onupgradeneeded = () => {
        const db = r.result;
        // migrações versionadas (como eles): v1 = 3 stores, v2 = relatorios
        if (!db.objectStoreNames.contains("textos"))
          db.createObjectStore("textos", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("variaveis"))
          db.createObjectStore("variaveis", { keyPath: "nome" });
        if (!db.objectStoreNames.contains("midias"))
          db.createObjectStore("midias", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("relatorios"))
          db.createObjectStore("relatorios", { keyPath: "id", autoIncrement: true });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));

  const reqP = (req) =>
    new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  const loja = async (nome, modo = "readonly") =>
    (await abrir()).transaction(nome, modo).objectStore(nome);

  const listar = async (nome) => reqP((await loja(nome)).getAll());
  const adicionar = async (nome, item) =>
    reqP((await loja(nome, "readwrite")).add(item));
  const salvar = async (nome, item) =>
    reqP((await loja(nome, "readwrite")).put(item));
  const remover = async (nome, id) =>
    reqP((await loja(nome, "readwrite")).delete(id));

  // blob → dataURL (pra mandar pro motor na página)
  const dataUrlDe = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

  // API por store
  return {
    textos: {
      listar: () => listar("textos"),
      adicionar: (nome, conteudo) =>
        adicionar("textos", { nome, conteudo, criadoEm: Date.now() }),
      remover: (id) => remover("textos", id),
    },
    variaveis: {
      listar: () => listar("variaveis"),
      salvar: (nome, valores) =>
        salvar("variaveis", { nome: nome.toLowerCase(), valores }),
      remover: (nome) => remover("variaveis", nome),
    },
    midias: {
      listar: () => listar("midias"),
      // engageMedia.active deles: item pode ficar inativo sem ser
      // apagado — some das listas de seleção do painel
      // mediaFolders deles: pasta opcional agrupa mídias na lista
      adicionar: (nome, tipo, arquivo, pasta = "") =>
        adicionar("midias", {
          nome, tipo, mime: arquivo.type, blob: arquivo,
          pasta: pasta || "", ativo: true, criadoEm: Date.now(),
        }),
      alternar: async (id) => {
        const item = await reqP((await loja("midias")).get(id));
        if (!item) return;
        item.ativo = item.ativo === false;
        await salvar("midias", item);
      },
      remover: (id) => remover("midias", id),
    },
    // engageReports deles: histórico de ações (like/comment/post/join...)
    // runId correlaciona ações da mesma rodada (Idempotency-Key deles)
    relatorios: {
      listar: () => listar("relatorios"),
      adicionar: (acao, alvo, resultado, detalhe, runId) =>
        adicionar("relatorios", {
          acao, alvo, resultado, detalhe, runId, em: Date.now(),
        }).catch(() => {}),
      limpar: async () => {
        const lojaR = await loja("relatorios", "readwrite");
        return reqP(lojaR.clear());
      },
    },
    dataUrlDe,
  };
})();
