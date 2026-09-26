# Changelog

## 0.1.1

- Conformidade com a doc oficial de tool plugins: respostas cruas do
  LightRAG agora embrulhadas (`{saude: ...}`, `{indexacao: ...}`) porque
  `status` no topo do `details` é nome reservado na avaliação de
  resultado do OpenClaw e marcaria a chamada como falha.
- `execute` propaga o `context.signal` do host para o fetch
  (`AbortSignal.any` com o timeout local) e aborta antes de chamar a
  rede quando o host já cancelou.
- `package.json`: `peerDependencies.openclaw >=2026.7.1` (opcional para
  dev fora do host) e `openclaw.compat.pluginApi >=2026.7.1`.

## 0.1.0

- Primeira versão. Facade `base_conhecimento` com ações `consultar`
  (POST /query do LightRAG, modo padrão `mix`, referências opcionais),
  `saude` (GET /health) e `indexacao` (GET /documents/pipeline_status).
- Config por tenant: `baseUrl` + `apiKey` (X-API-Key; SecretRef
  recomendado) + `timeoutMs` opcional.
- Erros sem vazamento de credencial; timeout com AbortController;
  mensagem dedicada para SecretRef não resolvido.
