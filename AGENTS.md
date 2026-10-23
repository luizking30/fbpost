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

- `inject.js`: sniffer multi-tipo + engine de replay + motor DOM.
  Calibrações: `post`, `postFoto`, `postVideo`, `postMisto`,
  `comentario`, `comentarioFoto`, `like`, `entrar`, `busca`, `feed`,
  `membros`(+`membros_admins/experts/contributors/near_you`), `amigo`,
  `listing`. Candidatos: até 4 moldes/tipo em `__SP_CANDIDATOS`.
  Ações via ponte: `postar`, `resolver`, `curtir`, `comentar`,
  `entrar`, `buscar`, `feed`, `membros`, `amizade`, `perfil`,
  `listing`, `meusGrupos`, `engajarDom`, `domParar`, `probeIniciar`,
  `probeParar`, `probesStats`, `ping`.
  Join suporta `responderPerguntas` (preenche campos answer/text com "ok").
- `content.js`: ponte + persiste `calibracoes` e `probes` (scores)
  no storage; repassa `domProgresso`/`domFim`/`stats`/`sessaoInvalidada`.
- `sidepanel.*`: 5 abas — Postar (textos/fotos/vídeos múltiplos +
  biblioteca), Buscar+Entrar, Engajar (GraphQL ou Modo DOM, listas
  `---` com listGap), Amigos (amizade+aquecer), Anúncio (Marketplace).
  Header: dot de sessão, "● Gravar" (listingProbe), "Studio".
- `biblioteca.js`: IndexedDB `fb-autopost` (stores textos/variaveis/
  midias) compartilhado entre sidepanel e studio.
- `studio.html`+`studio.js`: painel embutido + gerenciador da biblioteca.

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

Não portado ainda: nada crítico — sobram só itens de backend/SaaS
(créditos, auth, heartbeat, studio-bridge remoto). A ponte já foi
endurecida na v7 abaixo.

v6 portou do Pulso (motor + features):
- **Probes ranqueados** (`Se`/`Te`/`Ue`/`Be`/`Ke` deles): 10 estratégias de
  extração de postId + 10 de detecção de pendente; acerto soma score
  (teto 500) → próximas respostas tentam primeiro o que mais acerta.
  Scores por tipo de fluxo (post/like/feed/...) em `window.__SP_PROBES`,
  persistidos via `probesStats` → storage e semeados na carga.
- **Escopo p/ pending probes** (`je`/`Pe` deles): serializa o nó da
  mutation (`story_create`|`*_create`|`story*` com ids) + até 10 linhas
  JSONL seguintes, limite 8KB, ignora chaves grandes (`to`,
  `leaders_engagement_logging_settings`, `comet_surface_mappings`).
- **postId profundo** (`Ee`): `post_id|id|legacy_story_hideable_id` em
  qualquer nó até 12 níveis — 1º probe (`json_deep_numeric`).
- **Candidates em queries de leitura**: `buscar`/`feed`/`membros` tentam
  os moldes de `__SP_CANDIDATOS` até um responder (busca testa na 1ª
  página e fixa o molde vencedor; feed/membros por request). Membros
  mistura candidatos do tipo pedido + geral, dedup por doc_id.
- **DOM fallback** (`J`/`Qs`/`ea`/`na`/`ra`/`oa` deles — item 11):
  SELETORES nomeados (feed/post/likeBtn/commentBtn/commentComposer/
  postAuthor/pendingComment/blockModal/composerImage/fileInput);
  `digitarDom` = execCommand("insertText") + fallback KeyboardEvent/
  InputEvent por char; `colarImagemDom` = ClipboardEvent("paste") c/
  DataTransfer+File + espera thumbnail + fallback `input.files=`;
  Enter submete. Job `engajarDom` roda no feed aberto: pega próximo
  artigo não processado (attr `data-fbap-idx`), like+comentário,
  humanização (pula 0-2 posts iniciais, re-pula a cada 3-6 ações),
  só-autores-diferentes por uid/slug/nome, watchdog de comentário
  pendente (selo "Pendente/Pending" perto do post → bloqueio_pendente),
  modal de bloqueio → para. Ações: `engajarDom`, `domParar`; eventos
  `domProgresso`/`domFim` → sidepanel.
- **listingProbe** (ferramenta de pesquisa deles): botão "● Gravar" no
  painel → grava até 300 passos (kind graphql/upload/resposta, shape da
  request com campos sensíveis redigidos, responseShape) → "■ Parar"
  baixa JSON. É assim que se mapeia fluxo novo quando a captura quebra.
- **IndexedDB biblioteca** (`engageMedia`/`engageVariables` deles):
  `biblioteca.js` — db `fb-autopost` v1, stores `textos`/`variaveis`/
  `midias` (blob). `studio.html`+`studio.js` = página de gerenciamento;
  sidepanel tem botões "biblioteca" nos campos (textos/vars anexam,
  mídias viram chips com dataUrl). Origem da extensão = compartilhado
  entre sidepanel e studio.
- **listGap 300-600s**: Engajar aceita várias listas separadas por
  `---`; gap normal entre grupos da mesma lista, gap de lista entre
  listas distintas.
- **Multi-tab lock**: `navigator.locks.request("fb-autopost-job",
  {ifAvailable:true})` — duas abas do FB não correm ação ao mesmo tempo.

v7 portou do Pulso (segunda camada de paridade):
- **Ponte v1 endurecida** (`t` deles — canal `ext-bridge`): envelope
  `{fonte,direcao,versao:1,id(8-64),ts(±15s),acao,dados}` — dedup de id,
  rate-limit 10/seg por ação, mensagens fora do formato ignoradas.
  `content.js` emite o envelope; `inject.js` valida em `validarEntrada`.
- **Erro rico**: `classificarResposta` extrai `api_error_code`, `severity`,
  `is_transient` (→ campo `transiente` no resultado — postar retenta até
  2x com 15-30s), `help_center_id` e `sentry_block_user_info` (= bloqueio
  da CONTA, não da ação → resultado `bloqueado` com `bloqueioConta`).
- **`photo_session_stale`**: `subirFoto` sem id + 1357004/"error" na
  resposta → emite `photoSessionStale` → painel avisa pra recalibrar
  postando foto manualmente.
- **Mineração de resposta graphql na rota de membros**: fetch de
  `/api/graphql/` quando `emRotaMembros()` → `minerarPares` no corpo da
  resposta (fonte extra de doc_ids, além de bnzai/HTML).
- **`things_in_common`**: rota `/members/things_in_common` vira
  calibração `membros_things_in_common`; `membrosDoGrupo` aceita o tipo
  e cai no fallback `membros` (como o F[] deles que mapeia pro membersCal).
- **`profileGroupIds` no GROUP_WARM**: `entrar()` chama `meusGrupos`
  antes da fila e pula ids onde já é membro mesmo sem estado na busca.
- **PROFILE_WARM completo**: `aquecer()` aceita vários grupos (1/linha)
  e vários tipos de membro (checkboxes; admins excluído por padrão);
  cota dividida igualmente entre grupos (D deles); 2 páginas vazias no
  tipo → próximo tipo; `stopIfExceedsAvailability` — >max(40,4×limite)
  fetches de membros → para tudo.
- **Lote no Engajar**: input `engLote` — a cada N grupos salva
  `filaEngajar` (listas+posição+config+fotoDataUrl) e agenda
  `retomar_fila` em 2-6h (batchSize deles). Retomada autodetecta
  `filaEngajar` vs `fila` (postar) no boot do painel.
- **Gate de sessão** (`checkSession` deles): `gateSessao()` — ping
  motor+sessão antes de entrar/engajar/amizade/aquecer (postar já tinha).
- **Seletores overridáveis** (`X.selectors` deles): `window.__SP_SELETORES
  = {nome:[...]}` consultado antes dos defaults do DOM fallback.
- **`uidAtual` robusto** (`he` deles): cookie `c_user` → link
  `profile.php?id=` → meta `al:android:url`.
- **`engajarDom` exige sessão** (uid+dtsg) além de feed visível.

v8 portou do Pulso (UX + confiabilidade):
- **Botão flutuante na página** (`#app-grupos-painel` deles): `content.js`
  injeta `#fbap-fab` (fixed, bottom-right) em `/` e `/groups/*` —
  clique abre o side panel (`abrirPainel` → background →
  `sidePanel.open`; o gesto propaga via sendMessage). Some/aparece com
  a rota SPA.
- **Contexto invalidado** (index.js deles): `chrome.runtime?.id`
  ausente ou `sendMessage` lançando → banner fixo "recarregue a
  página" + remove o FAB.
- **PAUSE/RESUME** (máquinas START/STOP/PAUSE/RESUME deles): flag
  `pausado` + `esperarPausa()` segurando delays e início de iterações
  — posição preservada, retoma de onde parou.
- **`engageReports`**: store `relatorios` no IndexedDB (banco v2,
  migração como o Dexie deles) — grava postar/curtir/comentar/entrar/
  amizade/listing/engajarDom com resultado; botão "↓ Rel." exporta JSON.
- **Dedup de amizade persistido** (`engageProfiles` deles):
  `amizadeTentados` (uid→ts) — perfil com pedido <30d é pulado em
  `amizade` e `aquecer`; `aquecer` também deduplica usuários entre
  tipos de membro dentro da mesma rodada.
- **Telemetria no ping** (snapshot deles): `appVersion`, `contaWork`,
  `igBusiness`, `cohort` extraídos 1x do HTML — diagnóstico.

v9 portou do Pulso (detalhes finais):
- **`sentry_block_user_info` com detalhe**: erro de bloqueio extrai
  title/body/duração do objeto quando presente na mensagem.
- **`meusGrupos` paginado**: segue `paging.next` da Graph API até 10
  páginas (usuário com >100 grupos recebe a lista completa).
- **`autopost.due` (agendamento)**: input `datetime-local` + botão
  "Agendar fila" — salva `fila` completa (mídias como dataUrl) e cria
  `retomar_fila` com `when` absoluto; ao disparar, o background abre
  o painel e `postar(fila)` executa sozinho.
- **Menu contextual do FAB**: em `/groups/<slug>` o botão vira menu —
  "Postar/Engajar/Aquecer neste grupo" grava `acaoPendente` e abre o
  painel, que troca de aba e pré-enche o campo com a URL do grupo.

v10 portou do Pulso (refinamentos):
- **`needs_questions` sem request**: a busca já traz
  `has_membership_questions` → `entrar()` pula grupos com perguntas
  quando "responder perguntas" está desmarcado (zero request gasto).
- **Pill de status na página**: `domProgresso`/`domFim` também renderizam
  `#fbap-status` no feed — progresso do job DOM visível sem abrir o
  painel (overlay de progresso deles).
- **`engagepro.due`**: "Agendar engajamento" — salva `filaEngajar`
  completa + alarme `when`; retomada já existente roda do início.
- **Expiração do token Graph**: `tokenApiFb` extrai
  `__accessTokenExpirySecondsRemaining` → `meusGrupos` retorna
  `expiraEm` (segundos) pro painel logar.
- **`runId` nos relatórios**: cada rodada gera um id — ações no
  IndexedDB ficam correlacionadas (mesmo papel do `runId`/`batchN`
  do lease de créditos deles).

v11 — audit direto na fonte (achados e correções):
- **Resposta `null` vira "ok"**: `preencherRespostas` deles substitui
  campos `answer|answer_text|response|text` quando string **ou null**
  — nosso só cobria string (pergunta vazia ficava sem resposta).
- **`skipLiked`/`skipCommented` separados**: dedup por post agora é
  `{like:ts, comentario:ts}` — post curtido antes ainda pode receber
  comentário depois (antes marcava o post inteiro).
- **Autor por uid/nome**: `extrairPostsFeed` extrai `autorNome`
  (owners/actors/author) → `soDiferentes` usa `autorId || autorNome`
  (deles deduplicam por uid/slug/name).
- **`joinLote`**: Entrar tem lote como os outros — a cada N entradas
  (entrou/pendente) pausa 2-6h salvando `filaEntrar` e retoma.
- **Crédito só em sucesso**: confirmado — `qa()` deles consome crédito
  só quando outcome é `joined`; nosso cooldown já só roda após
  entrou/pendente.

v12 — segundo audit na fonte (correções finas):

- **`trocarEmbutido` robusto**: `substituirEmbutido` agora usa
  fronteira de dígito `(?<!\d)de(?!\d)` só p/ ids numéricos e escapa
  regex chars em `de` — antes era split/join puro (corrompia ids com
  prefixo comum, ex. `123` dentro de `123456`).
- **Erro de rede normalizado** (`We` deles): TypeError/"failed to
  fetch" no graphql vira `rede_inacessivel (...)` — distinguível de
  bloqueio no log.
- **Erro rico completo**: `description`/`description_raw` somam na
  mensagem; `is_silent`, `path` (`campo=`) e `debug_info` (`dbg=`) nos
  extras — mesmo nível do `$e` deles.
- **Join com cadeia completa** (`un` deles): `join_state` primeiro,
  depois texto — `RE_PERGUNTAS` alargada (`membership_question|
  admission_question|require.*question|responder.*pergunta`),
  `RE_JA_MEMBRO` com `MEMBER"`/`already_joined`, nova
  `RE_JOIN_PENDENTE` (`requested|solicita|CANNOT_JOIN.*approval`),
  http≠200 → falhou. Ordem anterior testava texto antes do
  `join_state` (falso "perguntas" possível).
- **Amizade conservadora** (`Jt` deles): erro GraphQL com texto
  "already sent" → `ja_amigo`; resposta sem sinal de envio →
  `falhou` (não assume `enviado` — evita falso positivo e conta
  retentativa correta). `RE_JA_AMIGO` ganhou `request already`.
- **Feed sem tombstone** (`Et`/`It` deles): nó com
  `tombstone|is_hidden|can_viewer_see_content:false|is_deleted|
  HIDDEN|hidden_story` é pulado — não tenta curtir/comentar post
  removido. `acharIdAutor` lê `actors[0].id` também (`kt` deles).
- **Membros sem `__typename`** (`Vt` deles): `edges[].node` com id
  ≥5 dígitos entra mesmo sem `__typename:"User"`; merge preserva
  status existente; `mapa.delete(uidAtual)` remove a si mesmo da
  fila de pedidos.
- **Cursor amplo** (`en` deles): `definirCursor` casa `cursor|after`
  em qualquer parte da chave (`end_cursor`, `page_after`), só se o
  valor for string ou null.
- **Watchdog de comentário pendente** (`xe` deles): sobe 12 níveis
  do selo procurando `[role="article"]` (+0.1) e link do próprio uid
  (+0.2) — selo só conta se for do NOSSO comentário, não de outro.
- **Seletores DOM**: `commentBtn` ganha `div[role="textbox"]
  [contenteditable]`; nova lista `commentBox` (variante estrita do
  composer, consultada primeiro); `blockModal` ganha os ids internos
  do diálogo de bloqueio (`_r_1oo_`, `_r_ed_`/`_r_ed_v`).

v13 — terceiro audit (uploads, params, busca, DOM):

- **Campos do upload de foto reescritos** (`pt` deles): `subirFoto`
  renova `fb_dtsg`/`jazoest`/`__user`, gera uuid novo em chaves
  `RE_IDEMPOTENTE` e troca `sampleUid`→uid embutido nos valores do
  FormData — antes ia o FormData cru capturado (tokens/uuid velhos).
  `uploadFotoCapturado` agora grava `sampleUid`.
- **photoId por JSON-walk em 2 passes** (`m` deles):
  `photoID|photo_id|photoFbid` primeiro, qualquer `id`≥6 dígitos depois
  — regex plana podia pegar `id` de outro nó.
- **Params top-level recebem troca** (`nt` deles): valor de param
  exatamente igual a um `de` da troca vira `para` (ex. `group_id`
  fora do `variables`).
- **`membros` numérico com multiplicador** (`on` deles): "1,2 mil"→1200,
  "3,4 milhões"→3400000 — antes ia o `[\d.,]+` cru ("1,2"). Grupo
  também guarda `membrosTexto` pra exibir o original.
- **Dedup de autor só após sucesso** (`de.add` deles): autor de ação
  DOM que falhou não queima o "só autores diferentes" — antes era
  marcado antes de agir.
- **Pausa no job DOM**: `domPausar` congela o countdown do delay
  (como PAUSE/RESUME deles); botão Pausar do painel dispara o comando
  junto do flag local. `ping.dom` reporta `"pausado"`.

v14 — quarto audit (sniffer, overlay, background):

- **Sniffer revisto completo**: `minerarPares` agora cobre os padrões
  específicos deles — `GroupsCometMembers*` + variantes de rota
  (admins/experts/contributors/near_you), `queryID` próximo quando
  não há `doc_id` associado, e extração de objetos JSON/batch com
  `friendly_name`+`doc_id`+`variables` reais. `minerarDocIds` e
  `minerarRespostaBnzai` reutilizam (bnzai: param `q`, FormData com
  blobs → DecompressionStream gzip/deflate/deflate-raw, ASCII 8+
  como fallback, `__crn` p/ contexto de rota).
- **Contexto invalidado endurecido** (`Zn` deles): regex
  `RE_CTX_MORTO` cobre "message port closed"/"Receiving end does not
  exist"; listeners de `error`/`unhandledrejection` na página também
  disparam o banner — que ganhou botão **Recarregar**
  (`sp-reload-prompt` deles).
- **Agendar Entrar/Aquecer** (`groupwarm.scheduleAlarm`/
  `profilewarm.scheduleAlarm`): `datetime-local` + botão nos dois
  cards — `filaEntrar` (com `responderPerguntas`) e `filaAquecer`
  gravadas + alarme `when`; o boot retoma o tipo certo.
- **Cota D() com resto**: aquecer divide o limite por grupo como
  `D()` deles — floor+resto (`[4,3,3]` p/ 10/3) em vez de `Math.ceil`
  que superalocava.
- **Listas nomeadas de grupos** (`groupLists` deles): "Salvar lista"
  no Buscar persiste a seleção com nome em `listasGrupos`; select no
  Postar insere/exclui.
- Não portado (fora de escopo): `videoBytes` chunked (coberto por
  `unlimitedStorage`), `autoconnect.schedule`, orquestração de
  warmers no service worker (fase SaaS).

v15 — quinto audit (IndexedDB deles, campanhas, cache):

- **`descansoAte` (restUntil deles)**: `rel()` em `bloqueado` e
  `domFim` `bloqueio_pendente`/`bloqueado` gravam `now+24h`;
  `gateSessao()` barra qualquer job novo até lá — descanso global do
  perfil após sinal de moderação.
- **Campanha recorrente** (`postCampaigns.nextRunAt`): input
  `postRepetir` (horas) — fila concluída re-arma o alarme com
  `inicio:0` e repete. Flag viaja na fila salva.
- **`meusGruposCache` (connectedGroups)**: `entrar()` usa cache de
  6h dos ids dos meus grupos em vez de chamar a Graph API toda vez.
- **`buscaRecente` (groupWarmSearches)**: busca e "meus grupos"
  persistem o resultado; boot restaura a lista de seleção.
- **`listasPerfis` (engageProfiles)**: listas nomeadas de perfis no
  card Amizade (Salvar/Inserir/Excluir) — simétrico a `listasGrupos`.
- **Retry no start de vídeo** (`We`+`Ve`): falha de rede no
  `/video/upload/requests/start` retenta 1x após 1200ms.

v16 — sexto audit (biblioteca e últimos detalhes):

- **`midias.ativo`** (`engageMedia.active`): toggle ●/○ no Studio
  desativa mídia sem apagar; drawer do painel só lista ativas.
- **`midias.pasta`** (`mediaFolders`/`folderId`): campo opcional no
  Studio agrupa mídias e vira prefixo no detalhe (Studio + drawer).
- Confirmado: seletores `J` 1:1, `digitarDom`/`colarImagemDom`/
  Enter-submit, headers/credentials dos requests, `We`/`nn`.

v17 — sétimo audit (protocolo ext-bridge completo):

- **`gruposEntrados`** (`groupwarm.joinedGroupIds`): conjunto
  persistente de ids já entrados — mescla com `meusGruposCache` e
  atualiza em `entrou`/`pendente`. Grupo que já teve sucesso nunca
  retenta, mesmo sem flag de membro na busca nova.
- **`rascunho`** (`autopost.draft`/`engagepro.settings`): ~40 campos
  do formulário persistem (debounce 500ms + escritas programáticas)
  e restauram no boot — fechar o painel não perde a config.
- Mapeadas todas as ações do protocolo deles: `autopost.*`,
  `engagepro.*`, `groupwarm.*`, `profilewarm.*`, `warmer.*`,
  `studio.*`, `autoconnect.*` — o que falta é orquestração no
  service worker (`*.packet`/`warmer.*`) e perfis conectados do
  backend (`autoconnect`), ambos escopo SaaS.

v18 — oitavo audit (manifest + service worker):

- **Kill-switch por cookie**: permissão `cookies` + `onChanged`
  vigiando `c_user` no `background.js` — logout/expiração dispara
  `sessaoInvalidada` pro painel mesmo sem aba do FB (nosso
  watchdog era só in-page). `fbPerfilAtivo` persiste o uid ativo.
- **Limpar dedup** (`clearJoinedIds`/`clearAlarm` deles): botão no
  rodapé zera `gruposEntrados`, `amizadeTentados`,
  `interagidosGrupo`, `autores`, `descansoAte` (com confirmação).
- Manifest comparado: `scripting`/`activeTab`/`optional <all_urls>`
  deles não são usados por nós; 5 content scripts deles ↔ nossos 2
  cobrem os mesmos mundos/timings.

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

### Lacunas nossas priorizadas — todas fechadas em v6

1. ~~Renovar lsd/spin/rev/hsi por request~~ feito
2. ~~`calibration_text_mismatch`~~ feito (`calibracao_divergente`)
3. ~~Candidates top-4 por tipo de calibração~~ feito (leitura tenta moldes)
4. ~~Probes ranqueados p/ postId/pending~~ feito (adaptativo + persistido)
5. ~~`me/groups` via token~~ feito + cadeia headless ads/bm
6. ~~DOM fallback: execCommand+ClipboardEvent~~ feito (item 11)
7. ~~Vídeo/misto/Marketplace moldes~~ feito
8. ~~IndexedDB p/ biblioteca~~ feito (biblioteca.js + studio)
9. ~~listGap 300-600s entre listas~~ feito (listas separadas por `---`)

Próximas frentes (não são paridade — são evolução): validação real em
conta descartável, multi-conta, backend SaaS (modelo de créditos deles).

Diferença arquitetural restante: deles, o warmer roda **orquestrado do
service worker** (`warmer.*` messages) — sobrevive ao painel fechar.
Nossos jobs moram no sidepanel (morrem se fechar) menos o `engajarDom`
(mora na página) e as retomadas por alarme. Migrar loops pro background
é refatoração grande — fazer junto com a fase SaaS, quando o backend
passar a existir.

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
11. [x] Motor DOM fallback (clicar quando sem calibração GraphQL) —
        Engajar → "Modo DOM" roda no feed aberto (seletores portados)
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
