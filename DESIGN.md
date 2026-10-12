# Caveman Commit — interface

## Direção

Interface de ferramenta inspirada na contenção visual do ChatGPT para Windows:
coluna central, bastante espaço, ações discretas e editor com superfície neutra.
O tema acompanha o VS Code; claro, escuro e alto contraste são suportados.

## Cores

Base: `--vscode-editor-background` e `--vscode-foreground`. Superfícies e separadores
derivam desses tokens por `color-mix`. Texto secundário mantém 75% da cor de texto.
Ação primária inverte as cores de texto/fundo. Foco usa `--vscode-focusBorder`.
Erros usam `--vscode-errorForeground`. Alto contraste reforça bordas e foco.

## Tipografia

`--vscode-font-family`, com fallback para Segoe UI e system-ui. Mensagens usam
`--vscode-editor-font-family`. Escala fixa: 12, 13, 14, 18 e 24 px. Sem caixa alta
decorativa. Comprimento máximo da coluna de conteúdo: 760 px.

## Componentes

- Cabeçalho compacto: símbolo, nome e provider/modelo como texto secundário.
- Mensagem: bloco de texto preformatado, sem cartão externo.
- Editor: uma única superfície neutra, raio de 16 px, textarea com label.
- Ações: ícones de traço consistente, botões pill de 36 px ou mais.
- Repositórios: lista vertical de editores, identificação acima de cada mensagem.
- Feedback: região `aria-live`, estados de cópia pendente, sucesso e erro.

## Identidade

Símbolo de commit geométrico: círculo vazado entre dois segmentos horizontais.
SVG é a fonte única; PNGs para instalação e fonte WOFF para a barra de status
são gerados por `npm run build:icons`. Monocromático, sem gradiente ou sombra.

## Comportamento

Ctrl/Cmd+Enter aplica/copia; Escape fecha. Botões respeitam estado pendente.
Conteúdo externo é escapado antes de entrar em HTML. CSP restringe scripts e estilos
ao nonce da webview. Transições de 160 ms; desativadas em movimento reduzido.
