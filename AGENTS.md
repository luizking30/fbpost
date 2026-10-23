# FB AutoPost — Contexto do Projeto

> Documento pra qualquer IA/dev que entrar no projeto. Atualizar quando decisões mudarem.
> Última atualização: 23/10/2026.

## Objetivo

Automação de presença no Facebook: **postar em grupos, comentar em massa,
buscar/entrar em grupos, curtir, aquecer perfil e ganhar seguidores** —
inspirado na extensão "Pulso Social" (Chrome Web Store, ~3K usuários,
R$99-299/mês).

**Fase atual**: uso próprio, 1 conta. **Depois de validar**: transformar em
SaaS por assinatura com múltiplas contas — o Pulso é a prova de mercado.

## Decisões tomadas

- **Idioma**: TUDO em português (código, nomes de variáveis, UI, docs).
  Exceção: nomes de campos/parâmetros que o próprio Facebook exige
  (`fb_dtsg`, `variables`, `doc_id`, `groupID`...).
- **Stack**: extensão Chrome Manifest V3 (mesma abordagem do Pulso). Nada de
  Selenium/Playwright — a extensão roda na sessão real do browser, sem login
  automatizado e com menos superfície de detecção.
- **Mídia essencial**: posts precisam suportar imagem/foto (anúncio sem
  imagem não performa) — prioridade alta no roadmap.
- **Técnica central**: NÃO clicar no DOM. Chamar a API GraphQL interna do FB
  (`POST https://www.facebook.com/api/graphql/`) com os tokens da página.
- **Auto-calibração**: os `doc_id`/`friendly_name` das mutations mudam sempre.
  Em vez de hardcodar, a extensão **intercepta o fetch/XHR do próprio FB** e
  aprende o template da requisição quando o usuário posta manualmente. Depois
  faz replay trocando só `group_id` e texto.
- **Código do Pulso é só referência**: extraímos o `.crx` pra
  `pulso-social-src/` (v5.107.0, minificado, não ofuscado). Estudar a técnica,
  NÃO copiar verbatim — é código proprietário e depende do backend deles
  (`api.pulsosocial.app`, valida `accessToken`/`planName`/`trialStatus`).

## Conhecimento extraído do Pulso Social

- Tokens: `fb_dtsg` e `jazoest` (de `DTSGInitialData`/regex do HTML),
  `lsd`, `__spin_r/b/t`, `__rev`, `__hsi`, `__user` = cookie `c_user`.
- Body GraphQL = `URLSearchParams`: `variables` (JSON) + `doc_id` +
  `fb_api_req_friendly_name` + `fb_api_caller_class=RelayModern` + `__a=1`.
- Resposta = JSON por linha (só a 1ª linha importa). HTML de volta =
  checkpoint/WAF → pausar tudo.
- Códigos de bloqueio conhecidos (api_error_code): `368`, `1357004`,
  `1404006`, `1404102`, `1390008`.
- Eles têm sistema de "probes" com score pra parsear respostas (resistência
  a mudança de formato) e "calibração" que persiste o que funcionou.
- Módulos deles (nomes de mensagens internas): `AUTO_POST_*`,
  `GROUP_ENGAGE_*`, `GROUP_SEARCH_*`, `GROUP_PRO_*`, `GROUP_WARM_*`,
  `PROFILE_WARM_*`, `HOTGROUPS`, `HOTPROFILE`, pedidos de amizade
  (`CAN_REQUEST`, `INCOMING/OUTGOING_REQUEST`). Storage via Dexie/IndexedDB
  (`Sender2GroupsDB`).

## Estado atual (MVP)

`extension/` — postagem em grupos funciona assim:

- `inject.js` (MAIN world, document_start): hooks em fetch+XHR → captura
  template do composer → extrai tokens → resolve slug→ID de grupo → replay.
- `content.js` (isolated): ponte postMessage ↔ chrome.runtime.
  Protocolo interno: `{fonte:"fb-autopost", direcao, tipo, dados}`,
  ações `postar`/`resolver`/`ping`, resultados `ok`/`erro`/`bloqueado`.
- `sidepanel.html/js`: UI (lista de grupos, mensagem, delay min/max,
  start/stop, log). Abre ao clicar no ícone.
- Anti-bloqueio MVP: resposta não-JSON ou error_code de restrição → para fila.

**Pendente de validação**: os heurísticos `textPaths`/`groupPaths` podem
precisar de ajuste na 1ª calibração real — a estrutura de `variables` varia
entre as mutations de composer do FB. Ver log do painel ao testar.

## Roadmap

1. [ ] Validar post em grupos com calibração real (conta descartável existe)
2. [ ] **Upload de imagem nos posts** (essencial — anúncio sem imagem não
       performa; o Pulso tem `photo upload`/`upload_url` pra estudar)
3. [ ] Comentários em massa (mesma técnica, outra mutation)
4. [ ] Curtidas/reações automáticas
5. [ ] Busca de grupos por palavra-chave + pedido de entrada
6. [ ] Aquecedor de perfil (navegação simulada)
7. [ ] Multi-conta (perfis Chrome separados; depois proxies)
8. [ ] SaaS: backend de licença/assinatura (modelo do Pulso como referência)

## Como testar

1. `chrome://extensions` → modo dev → "Carregar sem compactação" → `extension/`
2. Login no facebook.com → clica no ícone → painel lateral abre
3. Posta manualmente num grupo → painel mostra "Calibrado"
4. Lista de grupos + mensagem → Iniciar

## Riscos conhecidos

- Automação viola os Termos do Facebook → conta pode ser bloqueada/banida.
  O usuário TEM conta descartável pra testes — usar ela sempre.
  Delays altos (60-180s+), poucos grupos por rodada.
- Se virar SaaS: não copiar assets/código do Pulso; nome/marca próprios.

## Versionamento

- Git inicializado localmente. `pulso-social.crx`, `pulso-social.zip` e
  `pulso-social-src/` estão no `.gitignore` — material de referência não
  vai pro histórico (é código proprietário de terceiros).

## Estrutura do repo

```
fb bot/
  AGENTS.md            ← este arquivo
  README.md            instalação/uso rápido
  extension/           nossa extensão (código limpo, nosso)
  pulso-social-src/    código extraído do Pulso — SÓ REFERÊNCIA
  pulso-social.crx     pacote original baixado da loja
```
