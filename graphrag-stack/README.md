# GraphRAG corporativo — LightRAG + Neo4j + Qdrant

Base de conhecimento central (documentação, treinamentos, manuais, POPs)
das 3 empresas, pesquisável por grafo de conhecimento + busca vetorial.
Cada empresa tem seu compartimento isolado; os OpenClaws consultam só o
da sua empresa, e o Claude/Codex podem consultar os três.

```
                         ┌─────────────────────────────────┐
 OpenClaw empresa 1 ──►  │  LightRAG e1 (WORKSPACE=empresa1)│──┐
 OpenClaw empresa 2 ──►  │  LightRAG e2 (WORKSPACE=empresa2)│──┼─► Neo4j (grafo)
 OpenClaw empresa 3 ──►  │  LightRAG e3 (WORKSPACE=empresa3)│──┼─► Qdrant (vetores)
 Claude / Codex ────►    │  (chaves das 3 instâncias)       │──┴─► Postgres (KV/status)
                         └─────────────────────────────────┘
```

- **Isolamento por credencial**: cada instância LightRAG tem `X-API-Key` e
  login de WebUI próprios; o workspace separa os dados dentro dos bancos
  compartilhados (label no Neo4j, payload no Qdrant, coluna no Postgres).
- **LLM**: MiniMax via endpoint compatível com OpenAI, usando a chave
  sk-cp do Token Plan de cada empresa (a mesma conta do OpenClaw dela).
  `MiniMax-M3` é multimodal — cobre extração de entidades e as imagens
  dos manuais.
- **Embeddings**: OpenAI `text-embedding-3-small` (~US$ 0,02 por milhão
  de tokens — irrelevante no custo total).

## Alvos de deploy

| Pasta | Cenário | Exposição |
|---|---|---|
| [`hostinger/`](hostinger/) | VPS Hostinger, Traefik, TLS Let's Encrypt, um subdomínio com `/empresa1..3` | Internet, com HTTPS + API key + rate limit |
| [`umbrel/`](umbrel/) | Dell R720 interno (Umbrel), portas 9621-9623 na LAN | Somente rede interna / VPN (Tailscale) |

Integração com OpenClaw, Claude/Codex e o roteiro do piloto MiniMax:
[`docs/INTEGRACAO.md`](docs/INTEGRACAO.md).

## Primeiro uso (qualquer alvo)

1. Suba o stack (README da pasta escolhida).
2. Rode o **piloto** do `docs/INTEGRACAO.md` — ele valida a chave sk-cp,
   confere no painel MiniMax se o consumo saiu do plano, e indexa um
   manual pequeno para inspecionar o grafo na WebUI.
3. Só depois faça a carga completa de documentos, de madrugada.
