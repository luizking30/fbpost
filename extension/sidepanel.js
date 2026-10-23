const $ = (id) => document.getElementById(id);
const logEl = $("log");
let rodando = false, parar = false;

function registrar(msg, cls = "l-info") {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  const linha = document.createElement("div");
  linha.className = cls;
  linha.textContent = `[${hora}] ${msg}`;
  logEl.appendChild(linha);
  logEl.scrollTop = logEl.scrollHeight;
}

function definirCalib(t) {
  const ponto = $("calibDot"), txt = $("calibText");
  if (t && t.ok) {
    ponto.className = "dot ok";
    txt.textContent = `Calibrado: ${t.nomeAmigavel} (doc ${t.docId})`;
  } else if (t) {
    ponto.className = "dot no";
    txt.textContent = `Capturado ${t.nomeAmigavel || "?"} mas incompleto — poste dentro de um grupo`;
  } else {
    ponto.className = "dot no";
    txt.textContent = "Sem calibração";
  }
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

async function executar() {
  const grupos = $("groups").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const texto = $("message").value.trim();
  const dmin = Math.max(5, +$("dmin").value || 60);
  const dmax = Math.max(dmin, +$("dmax").value || 180);

  if (!grupos.length) return registrar("Lista de grupos vazia", "l-err");
  if (!texto) return registrar("Mensagem vazia", "l-err");

  rodando = true; parar = false;
  $("start").disabled = true; $("stop").style.display = "block";

  try {
    const ping = await comando("ping").catch(() => null);
    if (!ping?.ok) {
      registrar("Motor não respondeu — recarregue a aba do Facebook", "l-err");
      return;
    }
    registrar(`Motor ok (${ping.capturados} template(s) em memória)`);

    const cache = {};
    for (let i = 0; i < grupos.length; i++) {
      if (parar) { registrar("Interrompido pelo usuário", "l-warn"); break; }
      const g = grupos[i];
      $("progress").textContent = `${i + 1}/${grupos.length} — ${g}`;
      try {
        if (!cache[g]) {
          const r = await comando("resolver", { bruto: g });
          if (r.erro) throw new Error(r.erro);
          cache[g] = r.idGrupo;
        }
        const gid = cache[g];
        const res = await comando("postar", { idGrupo: gid, texto });
        if (res.resultado === "ok") {
          registrar(`${g}: ${res.situacao || "publicado"} (id ${gid})`, "l-ok");
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
        $("progress").textContent = `${i + 1}/${grupos.length} — aguardando ${espera}s`;
        for (let s = 0; s < espera && !parar; s++) await dormir(1000);
      }
    }
  } catch (e) {
    registrar(e.message, "l-err");
  } finally {
    rodando = false;
    $("start").disabled = false; $("stop").style.display = "none";
    $("progress").textContent = "";
    registrar("Fim da fila", "l-info");
  }
}

$("start").addEventListener("click", () => { if (!rodando) executar(); });
$("stop").addEventListener("click", () => { parar = true; });

chrome.storage.local.get("modeloCapturado", ({ modeloCapturado }) => definirCalib(modeloCapturado));
chrome.storage.onChanged.addListener((c) => {
  if (c.modeloCapturado) definirCalib(c.modeloCapturado.newValue);
});
chrome.runtime.onMessage.addListener((m) => {
  if (m.tipo === "capturado") registrar(`Aprendido: ${m.dados.nomeAmigavel}`, "l-info");
});
