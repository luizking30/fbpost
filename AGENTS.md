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

## Conhecimento extraído do Pulso Social (PORTADO pro nosso motor)

Estudado em `pulso-social-src/*.pretty.js` (beautified via prettier).
Estas técnicas já estão implementadas no nosso `inject.js`:

- **Tokens**: `fb_dtsg` via `window.require("DTSGInitialData").token` →
  fallback input/regex. `jazoest = "2" + soma dos charCodes do dtsg`.
- **Replay** (função `Rt` deles → `montarRequisicao`): troca `sampleUid`→uid
  atual; `et()` substituição profunda regenerando UUIDs de chaves
  idempotentes (`idempotence|session_id|tracking|client_mutation_id|nonce`);
  `tt()` renova `composer_session`; substituição `embedded` =
  `JSON.stringify→split(de).join(para)→parse` pra IDs embutidos em strings;
  `wt()` zera `cursor`/`after` pra paginação.
- **Texto do post**: `message.text` (`He`) + `composed_text` em blocos
  Draft.js (`Ze` — blocks/block_data/entities/entity_map).
- **Like**: `feedback_reaction_id:"0"` no template → trocar por
  `"1635855486666999"` (ID da reação like, hardcoded deles).
- **Busca**: regenera `args.context.bsid` (UUID de sessão de busca) por
  consulta; pagina até 15-90 páginas com `end_cursor`.
- **Join**: resposta classificada por `join_state` (MEMBER/JOINED/ACTIVE =
  entrou; REQUESTED/PENDING = pendente); grupos com perguntas → eles
  respondem "ok" em todos os campos answer/text.
- **Upload de foto**: captura FormData com imagem → `{url, fields,
  fileField}`; replay reescreve feedback_id/av/__user/fb_dtsg/jazoest na
  URL e extrai `photoID` da resposta.
- **Detecção bilíngue de bloqueio** no TEXTO da resposta (além do JSON):
  "temporarily blocked", "limitamos a frequência", "tente novamente mais
  tarde". Pendente: `pending_review|awaiting_approval|será analisad|...`.
- **`window.__spPosting`** deles → nosso `window.__fbPostando`: impede
  recapturar os próprios replays.
- Taxonomia de captura (regexes dos friendlyNames) portada: composer,
  feed, CreateComment, ReactMutation, GroupJoin, SearchResults, friend.

## Estado atual

`extension/` — motor completo portado (v2):

- `inject.js`: sniffer multi-tipo + engine de replay.
  Calibrações: `post`, `postFoto`, `comentario`, `comentarioFoto`,
  `like`, `entrar`, `busca`, `feed`, `membros`, `amigo`.
  Ações via ponte: `postar`, `resolver`, `curtir`, `comentar`,
  `entrar`, `buscar`, `feed`, `membros`, `amizade`, `perfil`, `ping`.
  Join suporta `responderPerguntas` (preenche campos answer/text com "ok").
- `content.js`: ponte + persiste `calibracoes` por tipo no storage.
- `sidepanel.*`: 4 módulos UI — Postar (com foto), Buscar+Entrar
  (resultados clicáveis + auto-resposta a perguntas), Engajar
  (feed→like+comentário com spintax `{a|b}`), Amizade/Aquecer
  (pedidos por lista de perfis ou membros de grupo, filtra CAN_REQUEST).

v4 adicionou (paridade com Pulso):
- **Rotação de mensagens**: várias por `---`, modo sequencial/aleatório
- **Spintax**: `{{nome}}` com listas `nome=v1|v2` (giro persistente) + `{a|b}` inline
- **Lotes**: limite por rodada → salva fila no storage → `chrome.alarms`
  retoma em 2-6h → `sidePanel.open()` + autoresume
- **Anti-spam**: 5 erros com mesmo código seguidos sem sucesso → para
- **Dedup persistente**: `interagidos` (feedbackId) + `autores` em storage;
  opção "só autores diferentes" no Engajar
- **Session check**: `ping` retorna `sessao` (cookie+dtsg) — painel avisa
- **Doc_id mining**: regex no HTML/scripts JSON da página a cada 60s
  (`__SP_DOCIDS`, contagem no ping)
- **Membros por tipo**: `membros_admins/experts/contributors/near_you`
  pela rota `/members/<tipo>` — aquecer pode mirar só admins
- **Pending probes**: `GroupPendingPost`, `pending_state`,
  `if_viewer_can_learn_more_about_pending_post` + extração de `postId`

**Pendente de validação real**: heurísticas de extração de `variables`
podem precisar ajuste fino (estruturas variam entre mutations do FB).

v5 portou do Pulso (motor + features):
- **Tokens completos**: `tokensDaPagina()` coleta dtsg+lsd+spin_r/b/t+
  rev+hsi (require("LSD")/"SiteData" + fallback regex); `renovarParam`
  renova por request.
- **`calibracao_divergente`**: postar aborta se `sampleText` não foi
  substituído no molde. Strip de `__relay_internal__pv__*`.
- **Embutido com fronteira de dígito** (`trocarEmbutido` =
  `(?<!\d)de(?!\d)`) — não corrompe ids com prefixo comum.
- **Vídeo**: calibrações `postVideo`/`postMisto`; pipeline
  start→rupload→receive em `subirVideo` (sessões composer/waterfall
  reaproveitadas, headers Offset/X-Entity-* reescritos).
- **Marketplace**: calibração `listing` (product_item, xpost ids,
  `ID_MARKETPLACE=214423095669777`) + ação `listing` (criarListing).
  OBS: o Pulso também só tem a captura — o replay é nosso.
- **Meus grupos**: `tokenApiFb()` extrai `apiAccessToken`/`__accessToken`
  da página → `graph.facebook.com/me/groups` (id, name, member_count,
  administrator). Ação `meusGrupos` + botão no painel.
- **bnzai mining**: `/ajax/bnzai` — `q` param do request + resposta;
  FormData com blobs → DecompressionStream (gzip/deflate) + strings
  ASCII. `__crn` da URL identifica rota Comet.
- **SPA**: pushState/replaceState/popstate + PerformanceObserver →
  re-minera doc_ids ao entrar em rotas `/members/<tipo>`; queries
  `GroupsCometMembers*` mineradas viram calibração mínima automática.
- UI: chips `postVideo`/`postMisto`/`listing`, input de vídeo (máx
  ~30MB), botões "Meus grupos"/"Limpar lista", seção Marketplace.

Não portado ainda: probes ranqueados de postId/pending (adaptive),
DOM fallback (execCommand/ClipboardEvent), IndexedDB (engageMedia/
Variables/Profiles), multi-tab leader election, listingProbe.

**Re-extraído em 23/10/2026**: `pulso-social-src/` = v5.107.0,
beautified via prettier in-place. Estudo completo abaixo.

### Mapa do Pulso (5 content scripts + 3 UIs)

- `splash.js`: overlay animado com Shadow DOM enquanto o FB carrega
  (cosmético, esconde a splash do próprio FB).
- `inject.js` (MAIN, document_start): sniffer fetch+XHR — ver abaixo.
- `index.js` (ISOLATED, document_end): ponte `ext-bridge` + **React app
  overlay injetado na página** (`#app-grupos-painel`, bottom-right, só
  em /groups/* e home). Detecta context-invalidated → prompt "Recarregue".
- `facebook-functions.js` (MAIN, document_end): **o motor** — replay
  GraphQL + DOM fallback + jobs + Dexie/IndexedDB.
- `studio-bridge.js` (document_idle): executa comandos vindos da página
  Studio (`studio.profilewarm.exec`, `studio.groupwarm.exec/search`,
  `studio.repo.exec`).
- UIs: sidepanel (React/Radix) + `studio.html` = página própria
  "Studio" = **biblioteca de conteúdo** (textos/imagens/vídeos/
  variáveis/pastas) que alimenta as campanhas.

### Ponte deles vs nossa

Canal `ext-bridge` v1 validado: `{channel,version,direction:
ISOLATED_TO_MAIN,type,requestId(8-64),timestamp(±15s),detail}` — dedup
de requestId, rate-limit 10/seg por tipo. Nossa ponte `fb-autopost` é
mais simples (só fonte/direção) — endurecer se virar SaaS.

### Sniffer deles (inject.js) — o que falta no nosso

- **Candidates**: por tipo guarda array `__sp*CalCandidates` com até 4
  moldes ranqueados por nº de params — nosso guarda só 1 por tipo.
- **Calibração por rota**: usa `__crn` da URL (CometRouteName) +
  pathname p/ distinguir members admins/experts/contributors/near_you.
- **Mineração extra**: `/ajax/bnzai` (param `q` agrega queries;
  resposta pode ser FormData c/ blobs → DecompressionStream
  gzip/deflate + extração de strings ASCII) e JSON responses de
  graphql quando na rota de membros. PerformanceObserver vigia
  recursos bnzai. Hooks em pushState/replaceState/popstate (SPA).
- **Video upload**: 3 templates — `video/upload/requests/start` (P,
  fields), `rupload.facebook.com|/fb_video/` + body binário (G, headers),
  `video/upload/requests/receive` (k); `T()` guarda amostra da resposta
  do start.
- **Listing/Marketplace**: `J` regex composer de marketplace; extrai
  nó `product_item` (title/description/item_price.price+currency),
  `z()` todos photo ids, `xpost_target_ids`. ID `214423095669777` =
  o próprio Marketplace (xpost pra lá = vai pro MP).
- **listingProbe**: ferramenta DELES de pesquisa — arma via ext-bridge,
  grava até 300 steps (kind graphql/upload, shape da request c/
  redação de campos sensíveis, responseShape, erros) e emite
  `listingProbeSession`. É assim que mapeiam fluxos novos. Replicar.

### Motor (facebook-functions.js) — diferenças vs nosso `nt`

- **Tokens**: renova por request `lsd`, `__spin_r/b/t`, `__rev`,
  `__hsi` via `at()`+`lt()` (LSD via `require("LSD")` ou regex
  `\["LSD",\[\],\{"token":"..."`). Nós só regeneramos dtsg+jazoest.
- **`Ze`**: reconstrói `composed_text` Draft.js completo por linha
  (blocks/block_data/block_depths/block_types/entities/inline_styles/
  entity_map).
- **Strip `__relay_internal__pv__*`** do variables serializado.
- **Validação `calibration_text_mismatch`**: se `sampleText` não foi
  substituído no resultado → throw (detecta calibração podre cedo).
- **Probes ranqueados** (`Ue`/`Be`/`Ke`): várias estratégias p/ extrair
  postId e detectar pending; acerto incrementa score → adaptativo.
  Nós usamos regex fixo — portar a ideia.
- Erro rico: code/api_error_code/severity/is_transient/is_silent/
  requires_reauth/`sentry_block_user_info`(→bloqueio conta)/
  help_center_id.
- Foto (`ct`): reescreve fields (tokens + caption embedded inclusive
  em string JSON escapada), nome por mime (image.png/.webp/.gif/.jpg),
  av/__user na URL; 1357004 sem id → `sessionStale` → evento
  `photo_session_stale` = recalibrar.
- Vídeo (`mt`/`ht`): start c/ fields reescritos (offsets→0, file_size
  real, ext por mime mov/webm/mkv/mp4, file_chunk=session) → PUT/POST
  binário pro rupload → receive/finalize; substitui sampleVideoId.
- **DOM fallback** (`Qs`~L7490+): seletores nomeados p/ like/comment/
  composer; digita via `document.execCommand("insertText")` (fallback:
  KeyboardEvent+InputEvent por char); imagem via `ClipboardEvent
  ("paste")` c/ DataTransfer+File (fallback `input.files=`); Enter
  submete. Resolve item 11 do roadmap.
- Jobs: máquinas START/STOP/PAUSE/RESUME/PROGRESS — AUTO_POST,
  GROUP_PRO (engage feed→like/comment c/ mídia texto/imagem/ambos),
  PROFILE_WARM, GROUP_WARM, GROUP_SEARCH. Delays c/ countdown progress
  a cada 250ms.
- Dexie/IndexedDB: `engageReports`, `engageMedia` (biblioteca!),
  `engageVariables` (spintax persistido), `engageProfiles` — migrações
  versionadas.
- Telemetria: extrai app_version, cohort, IS_FACEBOOK_WORK_ACCOUNT,
  IS_INSTAGRAM/WABA_BUSINESS_PERSON da página.

### Backend deles (api.pulsosocial.app) — modelo pro nosso SaaS

- Auth completa: `/session/sign-in|sign-out|refresh|revoke/:id|email|
  forget-password|confirm-code|change-password`, `/user`, `/user/edit`.
- **Créditos** (não assinatura simples!): `POST /credits/authorize`
  {action,quantity,runId,batchN,nonce,app,feature} → lease `{jti}`;
  depois `POST /credits/leases/{jti}/consume {executed}`.
  `Idempotency-Key = runId:batchN:nonce`. Modo `on|shadow|off` (rollout
  gradual); 402 = insufficient/frozen. Ações: `warmer.browser_action`,
  `warmer.profile_action`, `warmer.group_action`, `profile.connect`.
- Trial: `/free-tier/finish`, `trialStatus` TRIAL_ACTIVE/EXPIRED.
- **Heartbeat** a cada 5min: POST `/extension/heartbeat` {state,
  telemetry(fb snapshot, connect, tabs)} — resposta carrega comandos.
- `/extension/messages` = mensagens remotas p/ usuário.
- Extraem `__accessToken`/`apiAccessToken` da página FB → chamam
  `graph.facebook.com/me` (perfil) e `/me/groups?fields=...,member_count,
  administrator` — **lista oficial de grupos do usuário, sem buscar**.
- Warmer roda orquestrado do background (`warmer.*` messages).

### Fluxos operacionais deles (estudado em 23/10)

**Orquestração**: cada automação é uma máquina START/STOP/PAUSE/RESUME/
PROGRESS escutando o canal `ext-bridge`. Antes de começar: `checkSession`
→ index pergunta ao background → resposta `{logged, permissions}` →
gates por feature (`SOCIALPULSE`, `HOTPROFILE`, `HOTGROUPS`). Sessão
inválida → `sessionInvalidated` → TODOS os jobs param. `autopost.due`/
`engagepro.due` = agendamentos vindos do background (alarms).

**Créditos** (mesmo pré-SaaS vale estudar): antes de CADA ação
`Ka(kind, runId, seq)` emite `warmerReserveReq` → background reserva
crédito (`/credits/authorize`) → responde `warmerReserveRes{allowed}`.
12s de timeout → assume permitido. Depois `qa(token, sucesso)` →
`/leases/{jti}/consume`. Ou seja: cota **por ação**, não por execução.

**Busca de grupos**: regera `args.context.bsid` (UUID) por consulta;
pagina até **90 páginas** com `end_cursor` (nosso: 15); extrai por
grupo: id, nome, foto, memberCount(+texto), postsPerDay, privacy,
`has_membership_questions`, `viewer_join_state` — UI sabe se você já
é membro e se o grupo tem perguntas ANTES de entrar.

**GROUP_WARM** (entrar em grupos): fila de ids → pula já-membro
(`profileGroupIds` = seus grupos via Graph API) e skipGroupIds →
reserva crédito → `un()` replay join (`needs_questions` detectado
antes; se `answerQuestions`, preenche "ok" em campos
answer/answer_text/response/text) → cooldown só após joined/pending
(`Ja` = delayMin~30-90s) → status joined/pending/already/
needs_questions/blocked.

**AUTO_POST**: mediaList (vários textos+imagens+vídeos, modo
random/sequencial), checa calibração por tipo de mídia usada
(text/photo/video/mixed), approvedQuantity=créditos, limitCount=
batch → "pacote" p/ retomada; erro `photo_session_stale` ou bloqueio
→ para; 5 erros mesmo código sem sucesso → para. Delays com
progresso a cada 250ms.

**GROUP_PRO** (engajar): por grupo — `Tt` feed → por post: like `Dt`,
comment `Nt`/`Ut` (imagem via ClipboardEvent se DOM). Dedup
`skipLiked`/`skipCommented` + `interactedByGroup` (persistido por
grupo) + `onlyDifferentUsers` (1x por autor). Multi-grupo:
groupGap 120-240s (mesma lista), listGap 300-600s (listas distintas),
batchSize 5 → pausa 2-6h. Limite de páginas = max(60, 4×alvo); 2
páginas vazias seguidas → fim. Média de mídia: comentários podem ser
texto OU imagem (commentMode text/image/both).

**GROUP_ENGAGE** (fallback DOM do engage): scroll suave, percorre
posts do feed visível; **humanização**: `skipInitial` 0-2 posts
iniciais ignorados, `sendBeforeSkip` 3-6 ações antes de pular.
Delays 30-90s.

**PROFILE_WARM** (amizades): só por membros de grupos — tipos
habilitáveis (members/things_in_common/experts/contributors/near_you;
**admins excluídos por padrão**). Distribui cota igualmente entre
grupos (`D()`), exclui por tipo. Usa `*CalCandidates` (até 4 moldes
por tipo!). `stopIfExceedsAvailability`: rota de membros esgotada
(2 páginas vazias ou >max(40,4×alvo) fetches) → para tudo.
Cooldown só após "warmed".

**Token do Graph**: `Aa()` cadeia — headless fetch em
adsmanager.facebook.com → business.facebook.com →
`chrome.scripting.executeScript` MAIN numa aba aberta → repete.
Extrai `__accessToken`/`apiAccessToken` + `__accessTokenExpirySeconds
Remaining`. Se aba em /login|checkpoint → pula (sessão comprometida).

### Portado em 23/10 (fase 2 — fluxos operacionais)

Já implementado no nosso código:

- **Busca rica**: `extrairGrupos` agora puxa foto, posts/dia, privacidade,
  `has_membership_questions`→`perguntas`, `viewer_join_state`→`estado`,
  amigos em comum. UI mostra badges por grupo. Paginação: até 90 páginas,
  para em 2 vazias seguidas.
- **Join esperto**: pula grupos cujo `estado` da busca já diz
  MEMBER/JOINED/ACTIVE ou REQUESTED/PENDING (zero request). Cooldown
  30-90s só após entrou/pendente — falha não gasta delay.
- **mediaList no Postar**: inputs de foto/vídeo aceitam vários arquivos;
  zíper texto[i]+foto[i]+video[i] monta variações giradas
  sequencial/aleatório. Fila salva `fotos`/`videos` (arrays).
- **Engajar multi-grupo**: campo virou lista de grupos. Por grupo: feed
  → like/comment com dedup persistido por grupo (`interagidosGrupo[gid]`),
  `onlyDifferentUsers`, commentMode texto/imagem/ambos/aleatório
  (comentário com foto via `comentarioFoto`), delay 60-120s entre posts,
  **gap 120-240s entre grupos**, teto de varredura max(60, 4×alvo) com
  2 páginas vazias seguidas → fim. Bloqueio para TUDO (return).
- **Delays com progresso**: `esperar()` emite `aguardando X/Ys` a cada
  250ms e é interrompível por `parar`. Cooldowns só após sucesso em
  TODOS os fluxos (postar/entrar/engajar/amizade/aquecer).
- **Kill-switch de sessão**: watchdog a cada 15s no inject checa
  c_user+dtsg; `executarGraphql` detecta redirect p/ login/checkpoint →
  emite `sessaoInvalidada` → content repassa → painel seta `parar=true`
  (mata todos os jobs, igual sessionInvalidated deles).
- **Token Graph em cadeia** (`Aa` deles): página → fetch headless
  adsmanager.facebook.com → business.facebook.com → EAA*. `meusGrupos`
  loga a fonte usada.

### Lacunas nossas priorizadas

1. ~~Renovar lsd/spin/rev/hsi por request~~ feito
2. ~~`calibration_text_mismatch`~~ feito (`calibracao_divergente`)
3. Candidates top-4 por tipo de calibração
4. Probes ranqueados p/ postId/pending
5. ~~`me/groups` via token~~ feito + cadeia headless ads/bm
6. DOM fallback: execCommand+ClipboardEvent (item 11)
7. ~~Vídeo/misto/Marketplace moldes~~ feito
8. IndexedDB p/ biblioteca de mídia + variáveis (pré-SaaS)
9. Lotes entre LISTAS de grupos (listGap 300-600s) — hoje só groupGap

## Roadmap

1. [ ] Validar post em grupos com calibração real (conta descartável existe)
2. [x] Upload de imagem nos posts e comentários (motor pronto — precisa de
       calibração real postando/comentando com foto 1x)
3. [x] Comentários em massa (módulo Engajar: feed→comentar)
4. [x] Curtidas/reações automáticas (módulo Engajar: feed→curtir)
5. [x] Busca de grupos por palavra-chave + pedido de entrada (UI pronta)
6. [x] Responder perguntas de grupo automaticamente ("ok" em todos campos)
7. [x] Pedidos de amizade em massa (lista de perfis + membros de grupo)
8. [x] Aquecedor de perfil (= pedidos de amizade a membros, como o Pulso)
9. [x] Vídeo (pipeline start→upload→receive→finalize) e foto+vídeo misto
10. [x] Marketplace listings (título/preço/xpost) — captura+replay prontos,
        falta validar com anúncio real
11. [ ] Motor DOM fallback (clicar quando sem calibração GraphQL)
12. [ ] Multi-conta (perfis Chrome separados; depois proxies)
13. [ ] SaaS: backend de licença/assinatura (modelo do Pulso como referência)

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
