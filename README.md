# FB AutoPost

Extensão Chrome (MV3) para automação de presença no Facebook:
postagem em grupos, comentários, curtidas, busca/entrada em grupos e
pedidos de amizade — via API GraphQL interna do FB com auto-calibração.

## Como funciona

A extensão **aprende observando você usar o Facebook**: intercepta
fetch/XHR do próprio site, captura o template da requisição
(`doc_id` + `variables` + `fb_api_req_friendly_name`) quando você faz
uma ação manual, e depois repete via GraphQL trocando só os alvos.

- `inject.js` (MAIN world): sniffer multi-tipo + motor de replay +
  motor DOM fallback
- `content.js` (isolated): ponte página ↔ extensão
- `sidepanel.*`: painel de controle
- `background.js`: alarms (retomada de lotes)
- `biblioteca.js`: IndexedDB compartilhado (textos/variáveis/mídias)
- `studio.html`+`studio.js`: painel + gerenciador da biblioteca

## Instalar

1. `chrome://extensions` → "Modo do desenvolvedor"
2. "Carregar sem compactação" → pasta `extension/`
3. Login no facebook.com → clica no ícone → painel lateral abre

## Calibração (uma vez por ação)

| Chip | Como acender |
|---|---|
| Post | Poste manualmente num grupo |
| Post+foto | Poste com foto num grupo |
| Comentário | Comente num post |
| Coment+foto | Comente com foto |
| Like | Curta um post |
| Entrar | Entre num grupo manualmente |
| Busca | Pesquise "grupos" no Facebook |
| Feed | Abra/role o feed de um grupo |
| Membros | Abra a aba Membros de um grupo |
| Admins/Experts/etc | Abra a sub-aba correspondente de Membros |
| Amizade | Envie um pedido de amizade |
| Post+vídeo / misto | Poste com vídeo / foto+vídeo |
| Marketplace | Publique um anúncio no Marketplace |

> O sistema guarda até 4 moldes por ação (candidates) e usa o melhor
> automaticamente — se um `doc_id` expirar, refaça a ação manual e ele
> aprende de novo. O botão "● Gravar" no topo liga o modo diagnóstico
> que baixa um JSON com o shape das requisições (útil pra mapear fluxo
> novo).

## Módulos

- **Postar**: lista de grupos + mensagens múltiplas (`---`), rotação
  sequencial/aleatória, spintax `{{nome}}` (listas `nome=v1|v2`) e
  `{a|b}` inline, fotos/vídeos múltiplos, delays, **lotes com
  retomada** (limite por rodada → pausa 2-6h → retoma sozinho via
  alarme), **agendamento** (marca data/hora, dispara sozinho) e
  **recorrência** (repete a fila a cada N horas)
- **Buscar e entrar**: termo → lista de grupos com checkbox (mostra
  membros, posts/dia, privacidade, perguntas e se você já é membro) →
  entrar (opcional: responde perguntas com "ok"), com **lote** e
  **agendamento**; "Salvar lista" grava a seleção como lista nomeada
  que o Postar insere pelo select; última busca é restaurada ao
  reabrir o painel
- **Engajar**: grupos (várias listas com `---` = gap maior entre elas)
  → varre feed → curte/comenta N posts, dedup persistente por grupo,
  "só autores diferentes", comentário texto/imagem/ambos/aleatório,
  **lote** (pausa 2-6h a cada N grupos, retoma sozinho) e
  **agendamento** (dispara sozinho na hora marcada).
  **Modo DOM**: roda direto no feed aberto — curte e comenta clicando
  nos elementos (sem precisar de calibração, precisa da aba visível)
- **Amizade**: lista de perfis (salváveis como listas nomeadas) →
  pedidos; **Aquecer**: pedidos aos
  membros de **vários grupos** com cota dividida exata, tipos de
  membro marcáveis (todos/em comum/experts/contribuidores/perto;
  admins opcional), filtra `CAN_REQUEST`, para ao estourar
  disponibilidade e pode ser **agendado**; **Entrar** pula grupos
  onde já é membro via Graph API
- **Anúncio**: publica listing no Marketplace (+ xpost em grupos)
- **Studio** (botão no topo): painel + biblioteca de conteúdo —
  textos, variáveis spintax e mídias (com pasta e ativar/desativar)
  salvas em IndexedDB, usáveis nos campos do painel via botão
  "biblioteca"
- **Botão flutuante** "FB AutoPost" na página do Facebook: na home
  abre o painel; num grupo vira menu contextual ("Postar/Engajar/
  Aquecer neste grupo" → pré-enche o painel). Se a extensão
  recarregar, um banner com botão **Recarregar** aparece
- **Pausar/Retomar**: jobs param no próximo checkpoint sem perder a
  posição da fila; **↓ Rel.** exporta o histórico de ações (IndexedDB)

## Proteções

- Detecção de bloqueio: resposta não-JSON (checkpoint), códigos de erro
  conhecidos (368, 1357004, 1404006, 1404102, 1390008), texto bilíngue e
  `sentry_block_user_info` (bloqueio da conta) → para a fila
- Erros `is_transient` do Facebook retentam automaticamente (2x, 15-30s);
  sessão de upload de foto expirada avisa pra recalibrar
- Detecção de pendente/postId **adaptativa**: várias estratégias
  ranqueadas por acerto (scores persistem entre sessões)
- Ponte validada (versão + id + timestamp + dedup + rate-limit) —
  scripts de página não injetam comandos
- Gate de sessão: nenhum job começa sem motor vivo e login válido
- 5 erros com o mesmo código seguidos → para (calibração podre)
- Delays aleatórios; `__fbPostando` evita recapturar os próprios replays
- Mineração de `doc_id` do HTML a cada 60s (aprende queries navegando)
- Watchdog de sessão: cookie/dtsg sumiram → para TODOS os jobs
- Dedup de pedidos de amizade: perfil com pedido <30d não repete;
  aquecer não duplica usuário entre tipos de membro
- Lock multi-aba: duas abas do FB não executam ação ao mesmo tempo
- Modo DOM: watchdog de comentário "Pendente" (só para se o selo for
  do nosso próprio comentário) e modal de bloqueio
- Classificação conservadora: join/amizade sem sinal de sucesso na
  resposta conta como falha, não como sucesso
- Feed ignora posts removidos/ocultos (tombstone); falha de rede
  aparece como `rede_inacessivel` (não confunde com bloqueio)
- Uploads renovam tokens/uuid/`__user` dentro dos campos do FormData
  (não só na URL) — calibração velha não estraga o upload; start de
  vídeo retenta 1x em falha de rede
- **Descanso de 24h**: bloqueio ou comentário "Pendente" marca o
  perfil — nenhum job novo inicia até o descanso acabar
- "Só autores diferentes" no DOM só marca o autor se a ação funcionar;
  Pausar também congela o job DOM (countdown do delay)
- Grupos já entrados ficam num conjunto persistente — a fila nunca
  retenta grupo que já teve `entrou`/`pendente`
- **Rascunho automático**: todos os campos do formulário são salvos
  (debounce 500ms) e restaurados ao reabrir o painel
- **Kill-switch por cookie**: `c_user` removido/expirado é detectado
  pelo service worker (sem aba aberta) e invalida a sessão
- **Limpar dedup**: botão zera todos os conjuntos de dedup e o
  descanso de 24h

## Riscos

Automação viola os Termos do Facebook — a conta pode ser bloqueada.
Use conta descartável, delays altos e poucas ações por rodada.

## Referência

`pulso-social-src/` = código extraído do `.crx` do Pulso Social, apenas
para estudo (não versionado).
