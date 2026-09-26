---
name: base-conhecimento
description: Consultar a base de conhecimento corporativa (documentação, manuais, treinamentos, POPs) antes de responder dúvida sobre procedimento, produto, equipamento ou norma interna.
---

# Base de conhecimento corporativa

A tool `base_conhecimento` consulta a base central de documentação da
empresa (grafo de conhecimento + busca vetorial sobre manuais, POPs e
treinamentos indexados).

## Quando usar

Antes de responder qualquer pergunta sobre procedimento interno, produto,
equipamento, plano, prazo ou norma da empresa, consulte a base:

```
base_conhecimento acao=consultar pergunta="<a dúvida em linguagem natural>"
```

- A resposta vem no campo `resposta`. Se precisar citar a fonte, repita a
  chamada com `com_referencias=true` e use o campo `referencias`.
- O modo padrão (`mix`) serve para quase tudo. Use `modo="naive"` apenas
  para busca literal simples de um trecho.

## Regras

- Se a base retornar resposta vazia ou sem relação com a pergunta, diga ao
  usuário que a informação não está na documentação indexada — não invente
  a resposta a partir de conhecimento geral.
- Em erro de conexão ou HTTP, use `acao=saude` uma vez para distinguir
  "serviço fora do ar" de "pergunta sem resultado" e relate o que
  encontrou.
- `acao=indexacao` mostra se há documentos ainda em processamento — útil
  quando o usuário acabou de enviar um manual e a resposta ainda não
  aparece.
- Não use a base para dados que mudam em tempo real (fatura de cliente,
  status de conexão): ela contém documentação, não sistemas transacionais.
