# Status vigente — 2026-11-23

## Estúdio de overlays RCZ

Em **Telemetry Lab → Estúdio de overlays**, o navegador envia o arquivo à API
local, recebe a sessão canônica e permite selecionar período, canais e estilos.
O download de WebM inclui transparência a 1920 × 1080 e 30 quadros por segundo.
O CSV conserva os timestamps originais e as unidades documentadas. As sessões
desta rodada disponibilizaram posição, velocidade, altitude, rumo, precisão GPS
e indicadores de volta. O suporte cobre o layout RaceChrono v1 de uma sessão
com um relógio GPS compatível.

| Sessão | Duração declarada | Completas + parcial | Amostras GPS | Trecho no replay (s) | Velocímetro / com mapa (bytes) |
|---|---:|---:|---:|---|---:|
| Betim 09/05 | 47:05,142 | 21 + 1 | 2.819 | 538,718–541,718 | 167.120 / 219.975 |
| Ipatinga 04/07 | 34:47,820 | 23 + 1 | 2.084 | 562,571–565,571 | 167.741 / 231.997 |
| Ipatinga 15/07 | 25:19,605 | 26 + 1 | 1.519 | 241,585–244,585 | 173.952 / 231.895 |
| Ipatinga 26/07 | 31:08,935 | 21 + 1 | 1.867 | 602,443–605,443 | 171.740 / 216.546 |

Todos os oito downloads foram reabertos no Chrome. A comparação dos quadros
0, 45 e 89 verificou a prévia e a composição sobre fundo branco e cinza-escuro.
O CSV foi idêntico antes e depois da suavização em cada sessão. As durações e
as primeiras posições coincidiram com os metadados dos quatro arquivos.
Em 04/07, o resumo declara melhor volta de 46,713 s e os timestamps de passagem
da volta 19 dão 46,714 s. O indicador usa as passagens conhecidas no instante
do replay. A comparação independente com CSV/VBO exportado pelo RaceChrono
depende de receber essa referência.

Na exportação integral de 26/07, o Chrome gerou um WebM de 102.313.023 bytes
em 969,558 s. O vídeo reaberto tem 1920 × 1080 e duração de 1.868,933 s
(2 ms de diferença para o RCZ). A busca até 1.868,833 s passou. O pico
observado foi de 1.059.065.856 bytes de RSS, com amostragem a cada 0,5 s
da árvore de processos do Chrome até salvar o download. A soma de RSS inclui
páginas compartilhadas. Cancelar e reiniciar a exportação passou.

O gate `npm run check` passou com 141 testes web, 36 da API e 29 E2E.
Os dois cenários opt-in de desempenho e Spa real ficaram fora desse gate.
A verificação privada adicional passou nos quatro arquivos em Chrome,
em PT/EN, por teclado e nas larguras 390, 1024, 1200 e 1440 px.

## Entrega anterior de CSV/JSON · 20/10

- **Race Explorer:** sessão real Belgium/Spa 2025 Race, carga/cache/cancelamento,
  replay, comparação, gráficos/tabela e cena com fallback 2D. Outras sessões
  continuam explicitamente indisponíveis.
- **Telemetry Lab:** CSV/JSON reais no navegador, worker cancelável, inspeção,
  mapeamento/unidades confirmados e sessão canônica em memória. Quatro séries,
  canais, cursor, zoom, tempo relativo derivado e distância condicional. Sem
  envio, persistência, logs do conteúdo, fixture substituta ou pista inventada.
- Português/inglês nos mesmos componentes. Sem novas dependências, autenticação,
  RCZ, expansão de GPs ou deploy nesta entrega.

## Três pontos de revisão

1. **Concluído:** trabalho anterior preservado em `0342e16`; navegação, idioma,
   foco e disponibilidade corrigidos em `d618e34`. `npm run check` passou com
   85 testes web, 33 API e 20 E2E.
2. **Concluído:** importação real de D-020, reutilização dos gráficos/tabela,
   proteção contra respostas antigas e descarte. `npm run check` passou com
   **137 testes web, 33 API e 28 E2E**, incluindo os dois módulos. Contratos,
   lint, tipos e build passaram. Smoke real permanece opt-in separado.
3. **Entregue:** revisão independente de código e imagens, smoke Spa real e
   medição com 50 mil registros/500 mil células. Branch publicada e
   [PR de revisão #1](https://github.com/LucasAbrandao/cortex/pull/1), sem merge
   na principal ou deploy. A primeira
   [CI de integração passou](https://github.com/LucasAbrandao/cortex/actions/runs/39522427390);
   os checks da revisão final ficam vinculados ao PR.

## Evidências e limites

- Playwright importou CSV por seletor e JSON por arraste, conferiu valores reais,
  zero/false/ausências, milissegundos, duas voltas da mesma entidade, quatro séries,
  erros, privacidade e descarte por reset/navegação/reload.
- PT/EN e larguras 1440/1200/1024/390 passaram; teclado e redução de movimento
  foram exercitados. Capturas/artefatos permanecem ignorados pelo Git.
- Smoke de navegador real **passou em produção**: sessão `2025-belgium-r-2-6`,
  **20 pilotos/879 voltas**, `source: normalized-cache`, quatro larguras e zero
  erros de página/console. Carga até manifesto **44,09 s**; manifesto **70.324 bytes**.
- Medição em produção **passou**: inspeção **748 ms**, análise **1.182 ms** e
  cursor com mediana **50 ms** (automação + dois frames). Contexto, memória,
  bundle e limitações em `PERFORMANCE.md`; nenhuma alegação de ganho ou FPS.
- Verificação final completa: **137 testes web, 33 API e 28 E2E determinísticos**;
  os dois cenários opt-in também passaram separadamente. Contratos, lint, tipos
  e build sincronizados. A inspeção final corrigiu contraste do botão de reset.
- Avisos conhecidos: certificado Conda, depreciação TestClient/THREE.Clock e
  cores do terminal. Nenhum gate foi ignorado. Sem medição de FPS ou hardware móvel.

Detalhes: `TELEMETRY_IMPORT_REQUIREMENTS.md`, `TESTING.md`, `PERFORMANCE.md`, `DECISIONS.md` e
`DATA_CONTRACT.md`. O [status anterior](history/STATUS_2026-10-13.md) e o
[histórico até setembro](history/STATUS_2026-09-09.md) preservam a retomada.
