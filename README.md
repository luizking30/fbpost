# FB AutoPost

Extensão Chrome (MV3) para postagem automatizada em grupos do Facebook.
Usa a mesma técnica do Pulso Social: chama a API GraphQL interna do FB
(`/api/graphql/`) com os tokens da sessão logada, aprendendo o formato da
requisição ao observar um post manual real (auto-calibração — não quebra
quando o Facebook muda os `doc_id`).

## Instalar

1. `chrome://extensions` → ativa "Modo do desenvolvedor"
2. "Carregar sem compactação" → seleciona a pasta `extension/`
3. Abre `facebook.com` e faz login

## Usar

1. Clica no ícone da extensão → abre o painel lateral
2. **Calibração**: posta manualmente uma vez dentro de um grupo qualquer.
   O painel mostra "Calibrado: <mutation>" quando aprende.
3. Cola a lista de grupos (URL ou slug, um por linha) + a mensagem
4. Ajusta o delay aleatório e clica "Iniciar postagens"

## Como funciona

- `inject.js` (MAIN world): intercepta fetch/XHR do Facebook, captura o
  template da mutation do composer, extrai `fb_dtsg`/`jazoest`/`lsd`/spins,
  resolve slug→ID de grupo, e executa o replay trocando `group_id` e texto.
- `content.js` (isolated): ponte window.postMessage ↔ chrome.runtime.
- `sidepanel.html/js`: fila, delays, logs, stop.
- Anti-bloqueio: resposta não-JSON (checkpoint) ou `api_error_code` de
  restrição (368, 1357004, 1404006, 1404102, 1390008) → pausa a fila.

## Riscos

Automação viola os Termos do Facebook. Use conta de teste primeiro,
delays altos, e poucos grupos por rodada. Conta bloqueada = segue o jogo.

## Próximos módulos

Comentários, curtidas, entrar em grupos, aquecedor — mesma técnica de
capturar a mutation real e fazer replay com variáveis trocadas.

## Referência

`pulso-social-src/` = código extraído do `.crx` do Pulso Social v5.107.0,
só para estudo.
