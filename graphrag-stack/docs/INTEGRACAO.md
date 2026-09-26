# Integração e piloto

`BASE` abaixo é o endpoint da instância da empresa:

- Hostinger: `https://SEU_DOMINIO/empresa1`
- Umbrel: `http://IP_DO_SERVIDOR:9621`

Toda chamada de API leva o header `X-API-Key` com a chave daquela
instância (`LIGHTRAG_API_KEY_EMPRESA*` do `.env`).

## Endpoints que importam

```bash
# Saúde
curl -s $BASE/health -H "X-API-Key: $KEY"

# Consulta (mode: mix = grafo + vetores, o recomendado)
curl -s -X POST $BASE/query \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"query": "Qual o procedimento de ativação de cliente?", "mode": "mix"}'

# Upload de documento (PDF, DOCX, TXT, MD...)
curl -s -X POST $BASE/documents/upload \
  -H "X-API-Key: $KEY" -F "file=@manual.pdf"

# Status do processamento
curl -s $BASE/documents -H "X-API-Key: $KEY"
```

A WebUI (`$BASE/webui`, login do `AUTH_ACCOUNTS_*`) faz upload, mostra o
pipeline de indexação e desenha o grafo — é onde se inspeciona a
qualidade da extração.

## OpenClaw (uma tool por empresa)

Cada OpenClaw recebe **só** a URL e a chave da sua empresa. Tool mínima
(plugin no padrão da casa): um `rag_query(pergunta)` que faz o `POST
/query` acima e devolve `response`. Regra de uso no prompt do agente:
consultar o RAG antes de responder dúvida sobre procedimento, produto ou
norma interna. A chave entra como SecretRef na config do plugin, nunca
hardcoded.

## Claude (aqui) e Codex

Recebem as três `(URL, chave)`. Em projeto aqui, basta pedir — a consulta
é um `curl` como o de cima. Para virar tool nativa no Codex/outros
clientes, um MCP server fino na frente da API resolve (ferramenta
`query_empresa(n, pergunta)`); fica como passo 2, não bloqueia nada.

## Piloto (antes da carga completa)

1. **Chave e endpoint** — valida que a sk-cp funciona no endpoint
   compatível com OpenAI:

   ```bash
   curl -s https://api.minimax.io/v1/chat/completions \
     -H "Authorization: Bearer $SK_CP" -H "Content-Type: application/json" \
     -d '{"model": "MiniMax-M3", "messages": [{"role": "user", "content": "responda: ok"}]}'
   ```

   Se recusar (401), trocar no `.env`: `LLM_BINDING=anthropic` e
   `LLM_BINDING_HOST=https://api.minimax.io/anthropic` (a sk-cp foi
   desenhada para o endpoint Anthropic-compatível) e subir de novo.

2. **Cota** — logo depois do teste, conferir no console MiniMax
   (Assinatura → Planejar Uso) se o consumo saiu da **cota do plano** e
   não virou cobrança avulsa. Se aparecer como pay-as-you-go, parar e
   revisar a chave usada.

3. **Indexação de amostra** — subir UM manual real (ideal: com diagramas)
   pela WebUI e acompanhar o pipeline. Ao final, abrir o grafo e checar:
   entidades fazem sentido? Relações ligam os procedimentos certos? As
   figuras geraram entidades úteis?

4. **Consulta de prova** — 5 perguntas que um atendente faria de verdade,
   em `mode: mix`. Comparar com o manual aberto do lado.

5. **(Opcional) M2.7 fast na extração** — repetir o passo 3 com
   `LLM_MODEL` no id do M2.7 fast (confirmar o id exato no console) e
   comparar custo × qualidade do grafo. Se mantiver qualidade, adotar
   para indexação e deixar o M3 nas consultas.

6. **Carga completa** — só após 1-5, e de madrugada (cron no README da
   Hostinger), porque a cota das janelas de 5 h é compartilhada com o
   OpenClaw da empresa.

## Custo de referência

| Item | Valor |
|---|---|
| VPS Hostinger 8 GB | ~US$ 15-30/mês |
| LLM (indexação + consultas) | dentro do Token Plan MiniMax de cada empresa |
| Embeddings (indexar 2.000 páginas) | ~US$ 0,02 |
| Embeddings (consulta) | fração de centavo |
