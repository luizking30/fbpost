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
9. [ ] Vídeo (pipeline start→upload→receive→finalize) e foto+vídeo misto
10. [ ] Marketplace listings (título/preço/xpost)
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
