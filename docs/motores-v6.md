# Motores v6 — guia de manutenção

> Detalhes dos sistemas portados do Pulso Social na v6 (23/10/2026).
> Visão geral no `AGENTS.md`. Tudo em `extension/inject.js` salvo quando indicado.

## 1. Probes ranqueados (adaptativo)

Extração de `postId` e detecção de `pendente` NÃO usam regex fixo: cada
resposta passa por uma **lista de probes ordenada por score**.

- `PROBES_POST_ID` (10): `json_deep_numeric` (varre o JSON até 12 níveis
  por `post_id|id|legacy_story_hideable_id`), regexes cruas
  (`raw_post_id`, `raw_story_url`, `raw_story_fbid`...), e dois que
  decodam base64 (`b64_story_id` exige prefixo `S:_`,
  `b64_logging_token` procura `feed_fbids|post_ids|story_ids`).
- `PROBES_PENDENTE` (10): flags JSON (`is_pending`, `approval`,
  `pending_state`, `__typename` de pending), `texto_pendente`
  (RE_PENDENTE bilíngue) e 4 probes de **escopo**.
- **Escopo** (`montarEscopo`): serializa o nó da mutation
  (`story_create` → `*_create` → `story*` com ids) + até 10 linhas JSONL
  seguintes, máx 8KB, ignorando `to|leaders_engagement_logging_settings|
  comet_surface_mappings`. Os probes `scope_*` buscam palavras de
  pendente nesse escopo — pega pendente declarado fora do nó principal.
- **Score**: `window.__SP_PROBES[tipo][chave][probeId]`, +1 por acerto,
  teto 500. `chave` = tipo do fluxo (post/postFoto/like/feed/...).
  Ordenação: score desc, índice original como desempate.
- **Persistência**: flag `probesSujos` → `emitir("probesStats")`
  (debounce 2s) → `content.js` grava `chrome.storage.local.probes`.
  Na carga, content devolve via ação `probesStats` e o inject sana
  ids removidos (`IDS_PROBES` — equivalente ao `Me` deles).
- **Adicionar probe**: empurre `{id, run(bruto, extra)}` na lista certa;
  extra = `objs` (postId) ou `escopo` (pendente). Não precisa migrar
  scores: ids desconhecidos são descartados na carga.

## 2. Candidates top-4 nas leituras

Cada captura entra em `window.__SP_CANDIDATOS[tipo]` (até 4 moldes,
dedup por `docId`, ordenados por nº de params — `registrarCandidato`).

- `buscarGrupos`: a 1ª página testa cada candidato até um responder ok;
  o vencedor pagina o resto (até 90 páginas, 2 vazias seguidas = fim).
- `feedDoGrupo`/`membrosDoGrupo`: por request, itera os candidatos.
  Membros mistura `candidatosDe(tipo)` + `candidatosDe("membros")`,
  dedup por docId (equivalente ao `Ma` deles).
- Mutations (post/like/comentar/entrar/amigo/listing) seguem no molde
  único — igual ao Pulso (candidates só cobrem queries de leitura).

## 3. Motor DOM fallback (`engajarDom`)

Item 11 do roadmap. Job que roda **dentro da aba do grupo aberta**
(GROUP_ENGAGE deles) — não precisa de calibração GraphQL.

- **Seletores** (`SELETORES`, portado do mapa `J` deles): nomeados por
  função — `feed`, `post`, `likeBtn`, `commentBtn`, `commentComposer`,
  `postAuthor`, `pendingComment`, `blockModal`, `composerImage`,
  `fileInput`, `composerParagraph`. `acharEl`/`acharEls` consultam na
  ordem da lista; o Pulso atualiza os dele via backend (`X.selectors`)
  — **se o FB mudar o markup, atualize `SELETORES` aqui**.
- **Digitação** (`digitarDom`): `execCommand("insertText")`; fallback =
  keydown/keypress + append no `composerParagraph` + `InputEvent` +
  keyup por caractere.
- **Imagem** (`colarImagemDom`): `ClipboardEvent("paste")` com
  `DataTransfer`+`File` no composer → espera thumbnail (15×200ms) →
  fallback `input[type=file].files = dt.files` + evento `change`.
- **Submit**: eventos blur/focus/input/change + `keydown Enter` + blur.
- **Loop** (`passoDom`/`agendarDom`): pega próximo artigo não marcado
  (`data-fbap-idx`), scrollIntoView suave (ou `scrollBy` 0.8vh); pula
  posts "conteúdo indisponível"; **humanização** — ignora 0-2 posts
  iniciais e re-pula a cada 3-6 ações; dedup de autor por uid/slug/nome
  (`soDiferentes`); 15 passos sem agir → `concluido`.
- **Watchdogs**: últimos 4 comentários guardados
  (`{ordinal, texto}`) — se o selo "Pendente/Pending..." aparecer num
  deles (`pendenteComentarioDom`, confiança ≥0.7) → `bloqueio_pendente`;
  modal com texto de bloqueio → `bloqueado`; sessão cai → `parar`.
- **Ponte**: sidepanel manda `engajarDom` (cfg: limite/acoes/textos/
  vars/fotoDataUrl/commentMode/delays/soDiferentes), espera `domFim`;
  `domProgresso` alimenta a barra de progresso. Checkbox "Modo DOM" na
  aba Engajar.
- **Limite**: DOM precisa do feed visível na aba — não roda em aba de
  fundo/minimizada (scroll não acontece).

## 4. listingProbe (pesquisa de fluxo)

Botão **"● Gravar"** no header → `probeIniciar`. Enquanto armado, o
sniffer grava até 300 passos em `probeRec.passos`:

- `kind: "graphql"` — friendlyName, docId, `paramsShape` (estrutura do
  corpo com `variables|fb_dtsg|jazoest|__user` fora),
  `varsShape` (árvore de tipos dos variables, campos
  `token|password|email|cookie|lsd|dtsg` redigidos).
- `kind: "upload"` — url + nomes dos campos do FormData.
- `kind: "resposta"` — shape do 1º JSONL da resposta graphql.

"■ Parar" → `probeParar` devolve os passos e o painel baixa
`fbap-probe-<ts>.json`. **Uso**: quando um fluxo para de capturar (ex:
FB mudou o composer), arme o probe, execute o fluxo manualmente e
inspecione os friendlyNames/shapes no JSON — é assim que o Pulso mapeia
fluxos novos sem codar seletores novos.

## 5. Biblioteca (IndexedDB)

`biblioteca.js` — db `fb-autopost` v1 (migrações versionadas como o
Dexie deles), origem da extensão = **compartilhado entre sidepanel e
studio**:

- `textos` {id, nome, conteudo} — botão "biblioteca" anexa ao textarea.
- `variaveis` {nome (key), valores[]} — anexa linha `nome=v1|v2`.
- `midias` {id, nome, tipo, mime, blob} — vira chip com dataUrl no
  campo (`libSel[alvo]`); chips clicáveis removem. Fotos de post
  (várias), vídeos, foto de comentário (1) e fotos de listing aceitam.

Studio (`studio.html`+`studio.js`): painel embutido + barra lateral com
abas Textos/Variáveis/Mídias — CRUD completo (salvar/listar/remover).

## 6. listGap e lock multi-aba

- Engajar: `---` separa **listas** de grupos. Entre grupos da mesma
  lista = `engGapMin/Max` (120-240s); entre listas =
  `engListaMin/Max` (300-600s) — portado do GROUP_PRO deles.
- `navigator.locks("fb-autopost-job", ifAvailable)` — se outra aba do
  FB já executa ação, a segunda recebe erro imediato em vez de correr
  concorrente. Ações de leitura/ping/probe não travam.

## 7. Segunda camada de paridade (v7)

### Ponte v1 (endurecida)

`content.js` emite `{fonte:"fb-autopost", direcao:"entrada", versao:1,
id(8-64 chars), ts, acao, dados}`; `inject.js` valida em
`validarEntrada`: versão, `ts` dentro de ±15s, dedup de `id` (set de
500), rate-limit 10 mensagens/seg por ação. Scripts de página não
conseguem injetar comandos nem floodar — mesmo modelo do `ext-bridge`
v1 deles.

### Erro rico + retentativa transitória

`classificarResposta` agora retorna:

- `bloqueioConta` quando `sentry_block_user_info` presente — bloqueio da
  conta inteira, não só da ação;
- `transiente` quando `is_transient: true` — `postar` retenta até 2x
  com 15-30s entre tentativas;
- extras `severity`/`help_center_id` concatenados na mensagem.

`subirFoto` sem `photoID` + `1357004`/`"error"` no corpo → emite
`photoSessionStale` → painel orienta recalibrar postando foto manual.

### Mineração e tipos de membros

- Resposta de `/api/graphql/` quando `emRotaMembros()` → `minerarPares`
  (doc_ids extras além de bnzai/HTML/scripts).
- `things_in_common`: rota `/members/things_in_common` → calibração
  `membros_things_in_common`; `membrosDoGrupo` cai no fallback
  `membros` se não houver molde específico.

### PROFILE_WARM completo

`aquecer()` aceita **vários grupos** (1 por linha) e **vários tipos**
(checkboxes: todos/em comum/experts/contribuidores/perto; **admins
desmarcado por padrão**, como eles). Cota `ceil(limite/grupos)` por
grupo; dentro do grupo itera tipos até cumprir a cota — 2 páginas
vazias seguidas esgotam o tipo. `stopIfExceedsAvailability`: mais de
`max(40, 4×limite)` fetches de membros no total → para tudo.

### GROUP_WARM com profileGroupIds

`entrar()` chama `meusGrupos` (Graph API) antes da fila — ids onde já é
membro são pulados mesmo que a busca não tenha trazido `estado`, sem
gastar request de join.

### Lote no Engajar

`engLote` (0=off): a cada N grupos salva `filaEngajar` (listas, posição
lidx/gidx, config completa, fotoDataUrl) e agenda `retomar_fila` em
2-6h. No boot, o painel autodetecta `filaEngajar` (engajar) vs `fila`
(postar) e retoma do ponto correto.

### Miscelânea

- `gateSessao()` (checkSession deles) antes de entrar/engajar/amizade/
  aquecer — recusa começar sem motor e sem sessão.
- `window.__SP_SELETORES = {nome:[...]}` — seletores extras consultados
  antes dos defaults do DOM fallback (X.selectors deles).
- `uidAtual` com fallbacks: cookie → `profile.php?id=` → meta
  `al:android:url` (he deles).
- `engajarDom` exige sessão (uid+dtsg) além de feed visível.

## 8. UX e confiabilidade (v8)

### Botão flutuante + contexto invalidado

`content.js` injeta `#fbap-fab` (equivale ao `#app-grupos-painel`
deles): botão fixed bottom-right visível em `/` e `/groups/*` —
recriado a cada 2s conforme a rota SPA. O clique manda
`{tipo:"abrirPainel"}` → `background.js` chama `sidePanel.open`
(o user gesture atravessa o sendMessage).

Se a extensão for recarregada/atualizada, `chrome.runtime?.id` some e
`sendMessage` lança — `enviar()` detecta, mostra banner fixo
"recarregue a página" e remove o FAB (mesmo comportamento do
index.js deles).

### PAUSE/RESUME

Flag `pausado` + botão no rodapé. `esperarPausa()` segura o fluxo
dentro de `esperar()` e no início de cada iteração dos jobs — a fila
fica parada sem perder posição, e Retomar continua do ponto exato.
Parar cancela a pausa junto.

### Relatórios (`engageReports`)

Store `relatorios` no IndexedDB (`fb-autopost` v2 — migração cria o
store sem tocar os existentes). `rel(acao, alvo, resultado, detalhe)`
grava os resultados de postar/curtir/comentar/entrar/amizade/listing/
engajarDom. Botão "↓ Rel." no header baixa tudo em JSON.

### Dedup de amizade (`engageProfiles`)

`amizadeTentados` em `chrome.storage.local` (uid→timestamp): pedido
enviado ou `ja_amigo` marca o perfil por **30 dias** — `amizade` e
`aquecer` pulam sem gastar request. `aquecer` também deduplica o
mesmo usuário entre tipos de membro da mesma rodada.

### Telemetria no ping

`telemetriaPagina()` extrai 1x do HTML: `app_version`,
`IS_FACEBOOK_WORK_ACCOUNT`, `IS_INSTAGRAM/WABA_BUSINESS_PERSON`,
`cohort` — vai no `ping` como `telemetria` pra diagnóstico.

## 9. Detalhes finais (v9)

- **`sentry_block_user_info`**: quando o erro de bloqueio traz o objeto,
  `title`/`body`/`block_duration` entram na mensagem — o log mostra o
  motivo e o prazo do bloqueio da conta.
- **`meusGrupos` paginado**: `paging.next` da Graph API até 10 páginas
  (limite 100/página); erro só na 1ª página aborta, depois retorna o
  parcial.
- **Agendamento (`autopost.due`)**: campo `datetime-local` + "Agendar
  fila" no Postar. Salva a fila completa (grupos, mensagens, vars,
  modo, limiteRodada, mídias em dataUrl) e cria `retomar_fila` com
  `when` absoluto — o alarme abre o painel e roda sozinho.
- **Menu contextual do FAB**: em `/groups/<slug>` o clique abre um
  menu (Abrir painel / Postar / Engajar / Aquecer neste grupo). A ação
  grava `acaoPendente` no storage; o painel consome no boot — troca de
  aba e anexa a URL do grupo no campo certo sem duplicar.

## 10. Refinamentos (v10)

- **`needs_questions` sem request**: `data-perguntas` vem da busca —
  `entrar()` pula grupos com perguntas quando a opção de responder está
  desmarcada, sem enviar o join (o GROUP_WARM deles detecta antes).
- **Pill `#fbap-status`**: o content script renderiza o progresso do
  job DOM direto no feed (`feitos/limite`, countdown do delay) — some
  8s depois do `domFim`.
- **`engagepro.due`**: botão "Agendar engajamento" com `datetime-local`
  — grava `filaEngajar` (mesmo formato do lote) e o alarme
  `retomar_fila` dispara a retomada no boot do painel.
- **`expiraEm` do token**: `tokenApiFb` extrai
  `__accessTokenExpirySecondsRemaining` da página/headless — útil pra
  saber se o token Graph ainda vale antes de chamar `me/groups`.
- **`runId`**: `controle(true)` gera um id por rodada; `rel()` grava
  junto — relatórios exportados podem ser agrupados por execução.

## 11. Audit na fonte (v11)

Leitura direta do `un()`/`GROUP_WARM`/`GROUP_PRO` deles trouxe
correções pequenas mas reais:

- `preencherRespostas` preenche `answer|answer_text|response|text`
  quando o valor é string **ou `null`** — antes, pergunta com campo
  `null` ia sem resposta e o join caía.
- Dedup do Engajar é por **ação**: `interagidos[fbid]` virou
  `{like:ts, comentario:ts}` (`skipLiked`/`skipCommented` separados deles)
  — post já curtido continua elegível pra comentário e vice-versa.
- `extrairPostsFeed` coleta `autorNome` (owners/actors/author) — dedup
  "só autores diferentes" funciona mesmo sem `autorId`.
- `joinLote` no Buscar/Entrar — a cada N entradas efetivas pausa 2-6h
  via `filaEntrar` (terceiro tipo de retomada no boot, junto de
  `fila` e `filaEngajar`).

## 12. Segundo audit na fonte (v12)

Nova passada função-a-função (`nt`/`tn`/`en`/`un`/`Jt`/`Tt`/`Pt`/`Vt`/`xe`)
achou correções finas — nenhuma estrutural, todas de precisão:

### Substituição embutida segura

`substituirEmbutido` usava `split(de).join(para)` puro: trocar `123` por
`456` dentro de `variables` também corrompia `123456` → `456456`. Agora
vai por `trocarEmbutido`, que aplica fronteira `(?<!\d)…(?!\d)` apenas
quando `de` é numérico e escapa metacaracteres de regex.

### Erros

- Fetch com TypeError/"failed to fetch" → `rede_inacessivel (...)`
  (o `We` deles) — o log distingue queda de rede de bloqueio do FB.
- Mensagem de erro agora junta `description`/`description_raw` ao
  `summary`, e os extras carregam `is_silent`, `path` (`campo=a.b`)
  e `debug_info` truncado — paridade com o `$e` deles.

### Join (`un` deles)

Cadeia de classificação reordenada pra bater com a deles:
`join_state` → texto (`RE_PERGUNTAS`/`RE_JA_MEMBRO`/`RE_JOIN_PENDENTE`)
→ `http≠200` → `entrou`. Antes o texto era testado primeiro — uma
resposta de sucesso ecoando `membership_questions` marcava "perguntas"
indevidamente. As três regexes foram alargadas pros padrões exatos
(`Zt`/`Ht`/`Xt`).

### Amizade (`Jt` deles)

- `errors[0].message` com texto "already sent/ já são amigos" →
  `ja_amigo` (antes ia como `falhou`).
- Default virou **conservador**: resposta sem `friendship_status` de
  envio nem texto de pedido → `falhou: resposta_desconhecida` (antes
  assumia `enviado`, gerando falso positivo silencioso).

### Feed / membros

- Filtro `Et`: nó com tombstone/`is_hidden`/`is_deleted`/
  `can_viewer_see_content:false`/`hidden_story` é descartado do feed —
  o Engajar não perde ação em post removido.
- `acharIdAutor` também lê `actors[0].id` (`kt` deles).
- `extrairUsuarios` aceita `edges[].node` com id ≥5 dígitos sem exigir
  `__typename:"User"` (`Vt` deles); o próprio uid é removido da fila
  (`n.delete(t)` deles) — sem pedido de amizade pra si mesmo.
- `definirCursor` casa `cursor|after` em qualquer parte da chave,
  apenas quando o valor é string ou `null` (`en` deles).

### DOM

- `pendenteComentarioDom` (watchdog `xe`): agora sobe até 12 níveis do
  selo procurando `[role="article"]` (+0.1) e `a[href*="<uid>"]` (+0.2)
  — o selo de "Pendente" só para o job se estiver no NÓSSO comentário.
- Seletores novos: `div[role="textbox"]` em `commentBtn`, lista
  `commentBox` (variante estrita, consultada antes do composer
  genérico) e ids internos do diálogo de bloqueio em `blockModal`.

### O que foi confirmado idêntico

- `yt`/`bt`/`qt`/`Ft`/`zs` (regexes de bloqueio/pendente/já-amigo/
  enviado/descurtir) — portadas palavra-por-palavra.
- `Ze` (composed_text Draft.js por linha), `Mt` (`corrigirReacaoLike`),
  `et` (substituição profunda com `Number()` preservado), `tt`
  (`renovarSessaoComposer`), `Ye` (regex de chaves idempotentes).
- Probes `Se` (10) e `Te` (9+1 nosso `texto_pendente`), score teto 500,
  ordenação por score/índice (`Be`), incremento por acerto (`Ke`).
- Watchdog `xe`, scroll `Zs`, guards `max(60,4×alvo)` do feed e
  `max(40,4×alvo)` dos membros.

## 13. Terceiro audit (v13) — uploads, params, busca, DOM

Passada em `mt`/`ht`/`dt`/`pt`/`ot`/`at`/`ln`/`on`/`pe`/`ra` + loop DOM
deles (`ea`, L7680+). Achados:

### Upload de foto (`ct`/`pt`/`m`)

- **Bug real**: `subirFoto` mandava `campos` do FormData capturado
  **verbatim** — `fb_dtsg`/uuids/sampleUid velhos dentro dos campos
  (a URL era reescrita, os campos não). Agora `pt` portado: tokens
  frescos, uuid novo em `RE_IDEMPOTENTE`, `sampleUid`→uid embutido.
  `uploadFotoCapturado` grava `sampleUid` na captura.
- photoId: 2 passes JSON (`photoID|photo_id|photoFbid` → `id` genérico)
  em vez de regex plana — um `"id"` de nó errado não passa mais.

### montarRequisicao (`nt`)

Params top-level também recebem troca exata (`group_id` fora do
`variables` atualiza junto). `at()`/`lt()` confirmados idênticos ao
`tokensDaPagina`/`renovarParam`.

### Busca (`ln`/`on`)

`membros` agora é número real com multiplicador (`mil`→×1e3,
`milhões|mi`→×1e6); `membrosTexto` preserva o original pra UI. Antes
"1,2 mil" reportava `1,2`.

### DOM (`ea`/`pe`/`ra`)

- **`de.add` só após sucesso**: autor de post cuja ação falhou não
  entra no dedup `soDiferentes` — pode ser tentado no próximo post
  dele (antes queimava o autor mesmo falhando).
- **`domPausar`**: pausa congela o countdown do delay a cada 250ms
  (PAUSE/RESUME das máquinas deles); Pausar do painel chama o comando
  junto do flag local. `ping.dom` → `true|"pausado"|false`.
- Confirmado: `pe()` (filtro de artigo aninhado), `Zs` (scrollIntoView
  ou 0.8 viewport), `le`/`ae` (attrs `data-sp-commented`/`data-index-attr`
  = nossos `data-fbap-*`), watchdog `xe` com score do próprio uid.

## 14. Quarto audit (v14) — sniffer, overlay, background

Sniffer `inject.js` deles (`je`/`Ae`/`Ce`/`xe`) revisto por completo:
fetch+XHR, `/ajax/bnzai`, `__crn`, FormData com blobs comprimidos
(gzip/deflate/deflate-raw via DecompressionStream, ASCII de 8+ chars
como fallback), padrões específicos `GroupsCometMembers*`, `queryID`
próximo e extração de objetos JSON/batch com `variables` reais —
tudo consolidado em `minerarPares` (que `minerarDocIds` e
`minerarRespostaBnzai` reutilizam). Gate `__spPosting` = `__fbPostando`.

### Contexto invalidado (index.js)

Regex ampla `RE_CTX_MORTO` (port de `Zn`): "message port closed",
"Receiving end does not exist", property-read em chrome/storage.
`error` + `unhandledrejection` na página com cara de contexto morto
também disparam o banner — que agora tem botão **Recarregar**
(`sp-reload-prompt` deles).

### Agendamento de entrar/aquecer (background.js)

`groupwarm.scheduleAlarm`/`profilewarm.scheduleAlarm` deles portados:
`agendarEntrar`/`agendarAquecer` com `datetime-local` → `filaEntrar`
(com `responderPerguntas` persistido) e `filaAquecer` + alarme
`retomar_fila` → o boot retoma o tipo certo de fila. `entrar`/
`aquecer` aceitam `estadoInicial` completo.

### Cota D() com resto

`D(e,t)` deles: floor + resto distribuído nos primeiros — 10 pedidos
em 3 grupos = `[4,3,3]` (exato). Antes `Math.ceil` dava `[4,4,4]`
podendo estourar o limite declarado.

### Listas nomeadas de grupos (groupLists)

Store `listasGrupos` (chrome.storage): "Salvar lista" no Buscar grava
a seleção com nome; select no Postar insere/exclui listas salvas.
Equivalente ao `groupLists` (IndexedDB deles, por uid) — versão local.

Não portado: `videoBytes` (blob de vídeo chunked no IndexedDB —
coberto pela permissão `unlimitedStorage`), `autoconnect.schedule`
(agendamento por uid — caso raro), orquestração de warmers no
service worker (fase SaaS, já documentada).

## 15. Quinto audit (v15) — IndexedDB deles, campanhas, cache

Audit do schema Dexie deles (`Sender2GroupsDB` v1→17) e das
máquinas de estado do background.

### profileObservations → descansoAte

Deles: detectado selo "Pendente" no comentário DOM → grava
`profileObservations {uid, restUntil: now+24h}`. Nosso equivalente:
`rel()` (todo resultado de ação) e `domFim` com
`bloqueio_pendente`/`bloqueado` gravam `descansoAte = now+24h` no
storage. `gateSessao()` barra QUALQUER job novo até o horário —
mensagem mostra até quando. Cobre todas as rotas (não só DOM).

### postCampaigns.nextRunAt → repetir

Campanhas deles têm `nextRunAt` (recorrência). Input `postRepetir`
(horas, 0=off) no Postar: fila concluída re-salva com `inicio:0` +
`repetir` e re-arma `retomar_fila` — roda de novo indefinidamente
até o usuário limpar. O campo `repetir` viaja na fila (mid-batch
salva o flag junto).

### connectedGroups → meusGruposCache

Deles cacheiam `[uid+id, member_count]` dos grupos do usuário.
`entrar()` agora usa `meusGruposCache` (6h) — filas grandes não
bate a Graph API toda vez.

### groupWarmSearches → buscaRecente

Deles persistem resultados de busca (`groupWarmSearches`). Agora
`buscar`/`meusGrupos` gravam `buscaRecente {termo,grupos,quando}` e
o boot restaura — fechar e reabrir o painel não perde a seleção.
Renderização unificada em `renderResultados` (mesmo badge pra
busca e meus grupos, incl. "admin").

### engageProfiles → listasPerfis

Deles guardam listas nomeadas de perfis (`engageProfiles`). Porto
simétrico ao `groupLists`: select `listasPerfis` no card Amizade
com Salvar/Inserir/Excluir.

### We/Ve → retry no start de vídeo

`We()` deles normaliza erro de rede como "network unreachable" e o
video **start retenta 1x** (1200ms) — portado em `subirVideo` com
`fetchStart` embrulhado no mesmo teste TypeError/network.

## 16. Sexto audit (v16) — biblioteca, seletores, últimos detalhes

### engageMedia.active → midias.ativo

Deles guardam `active` por mídia — desativar sem apagar. Portado:
`Biblioteca.midias.alternar(id)` inverte `ativo` (default true);
Studio mostra ●/○ por item + "inativa" no detalhe; o drawer do
painel só lista `ativo !== false`.

### mediaFolders → midias.pasta

`pasta` opcional no cadastro de mídia (Studio) — agrupa itens e
aparece como prefixo no detalhe (Studio e drawer do painel).
Versão simples do `mediaFolders`/`folderId` deles.

### Verificações finais

- Seletores `J` completos 1:1 (incl. `submitButton` — declarado mas
  sem uso no código deles também; não portamos).
- `digitarDom`/`colarImagemDom`/Enter-submit idênticos às funções
  deles (execCommand → fallback por char com keypress +
  composerParagraph `p`).
- Like GraphQL: sem check de `viewer_reaction` em ambos — paridade.
- `connectedProfiles`/`connectedGroups` no schema = dados do
  backend deles (sincronização multi-conta) — não aplicável.
- `We`/`nn` credentials e headers confirmados (same-origin,
  urlencoded); retry de start de vídeo já portado na v15.

## 17. Sétimo audit (v17) — protocolo completo + rascunho

### Mapeamento do protocolo ext-bridge deles

Listamos todas as ações `autopost.*`, `engagepro.*`, `groupwarm.*`,
`profilewarm.*`, `warmer.*`, `studio.*`, `autoconnect.*` usadas no
código deles e comparamos com a nossa cobertura. Dois gaps achados:

### gruposEntrados (groupwarm.joinedGroupIds / clearJoinedIds)

Deles mantêm conjunto PERSISTENTE de ids de grupos já entrados —
a fila nunca retenta um grupo que já teve sucesso, mesmo que uma
busca nova não marque o estado de membro. Portado: `gruposEntrados`
no storage, mesclado com `meusGruposCache` no início do `entrar()`,
atualizado em todo resultado `entrou`/`pendente`.

### Rascunho do formulário (autopost.draft / engagepro.settings)

Deles persistem a config da campanha (draft). O nosso painel perdia
todos os inputs ao fechar. Portado: `rascunho` no storage cobre
~40 campos (grupos, mensagem, vars, delays, lotes, checkboxes,
agendamentos, marketplace); restaura no boot, salva com debounce
de 500ms em input/change + nas escritas programáticas (listas,
ação rápida do FAB, limpar).

### Confirmado

- Busca pagina até 90 páginas (igual a eles); feed/membros usam
  o mesmo guard `max(60|40, 4×limite)`.
- `autoconnect.schedule`/`cancel` = reagendamento de reconexão de
  "connected profiles" (perfis multi-conta com `tokenExpiresAt`
  do backend deles) — escopo SaaS, não aplicável.
- `studio.*` = execução remota a partir da página Studio deles —
  escopo SaaS (documentado).
- `warmer.*`/`*.packet`/`*runPacket` = jobs orquestrados do service
  worker — diferença arquitetural já documentada.

## 18. Oitavo audit (v18) — manifest, service worker, reset de dedup

### Permissões e scripts (manifest deles vs nosso)

Deles: `cookies`, `scripting`, `activeTab`, `optional_host_permissions
<all_urls>` (SaaS multi-domínio); 5 content scripts (splash, inject
MAIN start, index ISOLATED end, facebook-functions MAIN end,
studio-bridge idle). Nosso cobre inject MAIN start + content
ISOLATED start — equivalente funcional. `scripting`/`activeTab`/
`optional` não são usados por nós — não adicionados.

### Kill-switch por cookie (cookies.onChanged deles)

O service worker deles vigia `c_user` — logout/expiração invalida a
sessão MESMO SEM aba do FB aberta (nosso watchdog só rodava dentro
da página). Portado no `background.js`:

- permissão `cookies` adicionada ao manifest
- `verificarSessao()` lê `c_user` — uid válido → `fbPerfilAtivo`
  persistido (prepara p/ multi-conta); cookie removido depois de
  existir → `sessaoOff` + mensagem `sessaoInvalidada` pro painel
  (que já para todos os jobs)
- `cookies.onChanged` dispara a verificação a cada mudança —
  service worker acorda sozinho no evento

### Limpar dedup (clearJoinedIds/clearAlarm deles)

Botão "Limpar dedup" no rodapé (com confirmação): zera
`gruposEntrados`, `amizadeTentados`, `interagidosGrupo`, `autores`
e `descansoAte` — começa uma campanha nova sem resíduo de dedup.

### Confirmado

- `session` alarm deles (polling 1min no SW) — substituído pelo
  `cookies.onChanged` orientado a evento (mais barato; cobre
  remoção e expiração)
- `autopost.run.<ts>`/`autoconnect.<uid>` alarms = orquestração
  deles no SW — escopo SaaS já documentado
- `splash.js` = overlay cosmético de carregamento — não portado
