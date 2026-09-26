# Changelog

## 0.1.0

- Primeira versão. Facade `base_conhecimento` com ações `consultar`
  (POST /query do LightRAG, modo padrão `mix`, referências opcionais),
  `saude` (GET /health) e `indexacao` (GET /documents/pipeline_status).
- Config por tenant: `baseUrl` + `apiKey` (X-API-Key; SecretRef
  recomendado) + `timeoutMs` opcional.
- Erros sem vazamento de credencial; timeout com AbortController;
  mensagem dedicada para SecretRef não resolvido.
