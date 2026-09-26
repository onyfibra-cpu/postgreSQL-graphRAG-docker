# conector-graphrag

Plugin OpenClaw (2026.9.4+) que dá ao agente acesso à base de conhecimento
central em LightRAG (GraphRAG: grafo + vetores). White-label: o mesmo
pacote é instalado em qualquer tenant; o que muda é a config (`baseUrl` +
`apiKey` da instância daquela empresa) — nenhum dado de empresa viaja no
pacote.

## Tool

Uma única facade, `base_conhecimento`:

| `acao` | O que faz | Endpoint LightRAG |
|---|---|---|
| `consultar` | Responde `pergunta` via grafo + vetores (`modo` padrão `mix`; `com_referencias` inclui fontes) | `POST /query` |
| `saude` | Verifica se o serviço está no ar (resposta em `{saude: ...}`) | `GET /health` |
| `indexacao` | Status do processamento de documentos (resposta em `{indexacao: ...}`) | `GET /documents/pipeline_status` |

As respostas cruas do LightRAG vêm embrulhadas porque `status` no topo do
`details` é nome reservado na avaliação de resultado do OpenClaw.

A skill embutida (`skills/conector-graphrag`) instrui o agente a consultar
a base antes de responder dúvida de procedimento/produto/norma e a não
inventar quando a base não tiver a resposta.

## Instalação (por tenant)

```bash
# No checkout deste diretório
npm install
npm run build
openclaw plugins build --entry ./dist/index.js   # regenera metadados do manifesto
openclaw plugins validate --entry ./dist/index.js
npm test

# Instalar no host
npm pack
openclaw plugins install npm-pack:./openclaw-plugin-conector-graphrag-0.1.1.tgz
```

> `openclaw plugins build` deve rodar num host com OpenClaw instalado.
> Fora do host, `npm test` cobre o comportamento com o SDK stubado.

## Configuração

1. Grave a chave da instância como segredo (nunca cole no chat):

   ```bash
   openclaw secrets store GRAPHRAG_API_KEY
   ```

2. Configure o tenant (ex. em `plugins.entries`):

   ```json5
   {
     plugins: {
       entries: {
         "conector-graphrag": {
           enabled: true,
           config: {
             // Instância LightRAG DESTA empresa:
             //  - Hostinger: https://SEU_DOMINIO/empresa1
             //  - Umbrel/LAN: http://IP_INTERNO:9621
             baseUrl: "https://SEU_DOMINIO/empresa1",
             apiKey: { source: "store", provider: "default", id: "GRAPHRAG_API_KEY" },
             // timeoutMs: 60000,
           },
         },
       },
     },
   }
   ```

   `apiKey` também aceita a string direta, mas o SecretRef mantém a chave
   fora de config legível e do transcript.

3. Cada tenant aponta para a sua instância. O isolamento entre empresas é
   por credencial: a chave da empresa 1 não abre o workspace da empresa 2.

## Segurança

- A chave nunca aparece em mensagens de erro (corpo de erro truncado, sem
  header ecoado) nem no resultado da tool.
- `baseUrl` só aceita `http(s)://`; barra final é normalizada.
- Timeout de 60 s por chamada (AbortController) — o turno do agente não
  fica pendurado se a instância cair.
- SecretRef que o host não resolveu vira erro claro, em vez de enviar
  `[object Object]` como credencial.

## Testes

`npm test` (Vitest, SDK stubado via alias): contrato tools×manifesto,
paridade de versão, corpo/headers do `POST /query`, erro HTTP sem vazar
chave, validação de `baseUrl`/`apiKey`, mapeamento das 3 ações.
