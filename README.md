# FB AutoPost

Extensão Chrome (MV3) para automação de presença no Facebook:
postagem em grupos, comentários, curtidas, busca/entrada em grupos e
pedidos de amizade — via API GraphQL interna do FB com auto-calibração.

## Como funciona

A extensão **aprende observando você usar o Facebook**: intercepta
fetch/XHR do próprio site, captura o template da requisição
(`doc_id` + `variables` + `fb_api_req_friendly_name`) quando você faz
uma ação manual, e depois repete via GraphQL trocando só os alvos.

- `inject.js` (MAIN world): sniffer multi-tipo + motor de replay
- `content.js` (isolated): ponte página ↔ extensão
- `sidepanel.*`: painel de controle
- `background.js`: alarms (retomada de lotes)

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

## Módulos

- **Postar**: lista de grupos + mensagens múltiplas (`---`), rotação
  sequencial/aleatória, spintax `{{nome}}` (listas `nome=v1|v2`) e
  `{a|b}` inline, foto, delays, **lotes com retomada** (limite por
  rodada → pausa 2-6h → retoma sozinho via alarme)
- **Buscar e entrar**: termo → lista de grupos com checkbox → entrar
  (opcional: responde perguntas com "ok")
- **Engajar**: grupo → varre feed → curte/comenta N posts, com dedup
  persistente de posts e opção "só autores diferentes"
- **Amizade**: lista de perfis → pedidos; **Aquecer**: pedidos aos
  membros de um grupo (filtra `CAN_REQUEST`, pode mirar só admins)

## Proteções

- Detecção de bloqueio: resposta não-JSON (checkpoint), códigos de erro
  conhecidos (368, 1357004, 1404006, 1404102, 1390008) e texto de
  bloqueio bilíngue → para a fila
- 5 erros com o mesmo código seguidos → para (calibração podre)
- Delays aleatórios; `__fbPostando` evita recapturar os próprios replays
- Mineração de `doc_id` do HTML a cada 60s (aprende queries navegando)

## Riscos

Automação viola os Termos do Facebook — a conta pode ser bloqueada.
Use conta descartável, delays altos e poucas ações por rodada.

## Referência

`pulso-social-src/` = código extraído do `.crx` do Pulso Social, apenas
para estudo (não versionado).
