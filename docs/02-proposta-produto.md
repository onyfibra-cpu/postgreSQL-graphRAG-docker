# Proposta de produto — plataforma corporativa de conhecimento e agentes sobre PostgreSQL

Data: 2026-09-16. Base: análise em `docs/01-analise-tecnica-e-seguranca.md`.
Nome de trabalho usado aqui: **Plataforma** (nome comercial a definir; não usar marcas Microsoft).

## 1. Tese

O acelerador prova três coisas úteis: dá para rodar grafo (AGE), vetor (pgvector) e GraphRAG sobre um único Postgres; MCP é uma interface adequada para expor isso a agentes; e empresas querem o conhecimento dentro do banco que já operam, não em mais um SaaS de vetores. O que ele não resolve é tudo que torna isso um produto: isolamento por cliente, autenticação, custo por uso, operação, e um caminho de conhecimento para ação (agentes que executam trabalho com esse conhecimento).

A proposta é um produto em duas fases com a mesma base de dados:

- **Fase 1 — Memória corporativa em Postgres.** Ingestão, GraphRAG, grafo consultável e MCP multi-tenant, vendido por assinatura, instalável via compose (self-hosted) ou operado por nós (managed).
- **Fase 2 — Orquestração de agentes.** Agentes "gerentes" da empresa que recebem demandas, decompõem e delegam a agentes executores de vários provedores (OpenClaw, Hermes, OpenAI, Anthropic, APIs próprias) usando a memória da Fase 1, com credenciais por conta e trilha de auditoria.

## 2. Cliente e problema

**ICP inicial:** empresas de 50 a 2.000 funcionários no Brasil que já usam PostgreSQL e têm conhecimento operacional disperso (chamados, contratos, procedimentos, base de atendimento). Os plugins já existentes no seu ecossistema (atendimento, cobrança, NOC, financeiro para provedores de internet) indicam um primeiro nicho concreto: **ISPs e operações de serviço regionais**, onde há SGP, OLTs, tickets e procedimentos que ninguém acha na hora.

**Problema pago:** "meu time gasta horas procurando quem sabe o quê e como se resolve X; o chatbot genérico alucina porque não conhece nossa operação; e não posso mandar nossos dados para um SaaS americano sem controle." LGPD e residência de dados são argumento de venda, não obstáculo.

**Alternativas atuais:** Notion AI / Confluence AI (sem grafo, sem MCP, dados fora), Azure AI Search + Copilot Studio (caro, lock-in), montar RAG próprio (sem manutenção), vector DBs dedicados (mais um sistema).

**Diferencial defensável:** um Postgres, três capacidades (relacional, grafo, vetor), extensões em C para isolamento e criptografia no próprio banco, e a ponte para agentes que executam.

## 3. Fase 1 — produto de memória corporativa

### 3.1 Capacidades

1. Ingestão por tenant: upload, conectores (Postgres externo, SQL Server, S3/MinIO, Google Drive, e-mail, ticketing) e API.
2. Indexação GraphRAG com orçamento: estimativa de custo antes de rodar, indexação incremental (`graphrag update`), filas com prioridade.
3. Consulta: local, global, drift e basic search; busca vetorial direta; Cypher read-only; NL2Cypher com parser.
4. MCP multi-tenant com autenticação, escopos por tool e quotas.
5. BYOK de LLM por tenant (Azure OpenAI, OpenAI, Anthropic, endpoints compatíveis com OpenAI para modelos abertos) ou uso da chave da Plataforma com margem.
6. Console: tenants, usuários, uso, custos, auditoria, chaves.

### 3.2 Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│  Gateway (Go): TLS, OIDC/JWT, tenant routing, quotas, MCP    │
│  (streamable-http) + REST + WebSocket                        │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
   ┌────────────▼────────────┐    ┌────────────▼──────────────┐
   │ Query service (Python)  │    │ Index workers (Python)     │
   │ graphrag search, cache  │    │ graphrag index/update, fila │
   │ de frames por tenant    │    │ FOR UPDATE SKIP LOCKED      │
   └────────────┬────────────┘    └────────────┬──────────────┘
                │                              │
   ┌────────────▼──────────────────────────────▼──────────────┐
   │ PostgreSQL 16/17 + AGE + pgvector + pgsodium/pgcrypto     │
   │ + extensões próprias em C (tenant_guard, cypher_policy,   │
   │   audit_hook). Um schema por tenant; RLS em tudo.         │
   └───────────────────────────────────────────────────────────┘
   Cofre de segredos (SOPS+age no self-hosted; Vault/KMS no managed)
   Object storage (MinIO/S3) para documentos brutos, criptografado
```

**Decisões que saem direto da análise:**

- **GraphRAG lendo do Postgres, não de parquet.** Implementar `PgVectorStore` (interface `BaseVectorStore` do graphrag) e `PgPipelineStorage` (interface `PipelineStorage`). Tabelas `text_units`, `entities`, `relationships`, `communities`, `community_reports` por schema de tenant, com `vector(1536)` e índice HNSW. Isso elimina LanceDB, elimina o volume compartilhado e torna o tenant uma unidade de banco, não de disco.
- **Grafo AGE por tenant.** `create_graph('t_<tenant>')`; AGE cria um schema por grafo, então o isolamento vem de graça no nível de schema.
- **Isolamento em camadas.** (a) role Postgres por tenant, sem superuser; (b) RLS com `current_setting('app.tenant_id')`; (c) extensão C `tenant_guard` que rejeita qualquer statement que toque schema de outro tenant, como segunda linha de defesa caso a aplicação erre; (d) plano Enterprise com banco dedicado.
- **Cypher seguro.** Extensão C `cypher_policy` usando libcypher-parser (Apache-2.0): aceita só `MATCH/OPTIONAL MATCH/WHERE/WITH/RETURN/ORDER BY/LIMIT/UNWIND`, injeta `LIMIT` e `statement_timeout`, rejeita escrita. NL2Cypher passa por ela sempre.
- **Criptografia.** TLS em tudo; disco cifrado; colunas sensíveis (texto bruto, cache de LLM) com `pgsodium` (chave por tenant, rotacionável); segredos de LLM nunca no banco, só no cofre, injetados em memória no worker.
- **Cache do LLM** por tenant, com TTL e opção de desligar (o acelerador grava prompts e respostas em texto plano; aqui é opt-in e cifrado).
- **Fila de indexação em Postgres** (`FOR UPDATE SKIP LOCKED`), sem Redis na versão self-hosted; Redis opcional no managed.

### 3.3 Entrega e instalação

- **Self-hosted (compose):** `docker compose up` com 4 serviços (postgres, gateway, query, worker) e MinIO opcional. Imagem do Postgres separada da imagem Python (o acelerador mistura as duas; isso dobra a superfície e o tamanho). Instalador gera segredos, certificado e primeiro tenant.
- **Managed:** mesma imagem em Kubernetes, um cluster Postgres por região, tenants Starter/Team compartilhando cluster com RLS, Enterprise em banco dedicado.
- **Licenciamento técnico:** chave assinada (Ed25519) com limites do plano, verificada offline pelo gateway; telemetria de uso opcional e agregada.

### 3.4 Planos e preço (hipótese inicial, validar com 5 clientes)

| Plano | Público | Inclui | Preço de referência |
|---|---|---|---|
| Starter | equipes até 25 usuários | 1 tenant, 50 MB indexados/mês, MCP, BYOK | R$ 1.200/mês |
| Team | até 200 usuários | 3 tenants, 500 MB/mês, conectores, SSO | R$ 4.500/mês |
| Enterprise | sem limite | banco dedicado, self-hosted ou managed, extensões C, SLA, auditoria exportável | R$ 15.000/mês + implantação |
| Uso de LLM da Plataforma | qualquer plano | custo de tokens + 30% | variável |

Ponto de atenção de custo: a indexação GraphRAG é cara (extração de entidades e community reports chamam o LLM para cada chunk e comunidade). Não medi isso nesta sessão; relatos públicos de usuários do graphrag variam de poucos dólares a dezenas de dólares por MB de texto com modelos da classe GPT-4o, e caem cerca de dez vezes com modelos pequenos ou abertos. O número real para o seu corpus precisa ser medido no M0 antes de fixar preço. O plano deve cobrar por MB indexado, não só por assento, ou a margem some no primeiro cliente com 5 GB de PDFs. Indexação incremental e modelo barato na extração (com modelo forte só nos reports) são a alavanca de margem.

### 3.5 Roadmap Fase 1 (equipe de 3 a 4 pessoas)

| Marco | Escopo | Prazo estimado |
|---|---|---|
| M0 | Repositório privado, correções da seção 7 da análise, compose portátil, CI com build e testes | 3 semanas |
| M1 | `PgVectorStore` + `PgPipelineStorage`, tenant por schema, RLS, roles sem superuser | 6 semanas |
| M2 | Gateway Go com OIDC, MCP autenticado, quotas, console mínimo, BYOK e cofre | 6 semanas |
| M3 | Extensões C `tenant_guard` e `cypher_policy`, pgsodium, auditoria | 6 semanas |
| M4 | Conectores (Postgres externo, S3, Drive, ticketing), indexação incremental, estimativa de custo | 6 semanas |
| Piloto | 3 clientes do nicho ISP em produção | paralelo a M3-M4 |

Total até produto vendável: cerca de 6 meses. As estimativas assumem que a interface do graphrag 3.x fique estável; o pin em 3.0.5 deve subir para a 3.1.x no M0 para não acumular dívida.

## 4. Fase 2 — plataforma de orquestração de agentes

### 4.1 Conceito

Um **Agente Gerente** por área (atendimento, NOC, financeiro, RH) que recebe demandas (chat, e-mail, ticket, webhook), consulta a memória da Fase 1, planeja, delega tarefas a **Agentes Executores** e presta contas. Executores podem ser:

- agentes internos (Python/Go rodando na Plataforma);
- OpenClaw (os plugins e skills já existentes no seu ecossistema entram aqui como executores nativos);
- Hermes (agentes sobre modelos abertos, hospedados por nós ou pelo cliente);
- OpenAI e Anthropic via API, com chave da empresa ou da Plataforma;
- ferramentas externas via MCP.

Toda a comunicação entre gerente e executor é MCP (tools, resources, prompts) ou A2A quando o executor for um agente completo. A Plataforma é ao mesmo tempo **cliente MCP** (consome servidores dos provedores) e **servidor MCP** (expõe memória e ações aos agentes).

### 4.2 Componentes

1. **Registro de agentes e capacidades**: manifesto assinado por agente (o que faz, quais tools, custo estimado, nível de confiança), versionado.
2. **Cofre de contas**: N contas por provedor por tenant (ex.: três chaves OpenAI de departamentos diferentes, duas contas Anthropic), com política de qual conta cada gerente usa, limite de gasto por conta e rotação.
3. **Orquestrador**: máquina de estados durável em Postgres (tarefa → subtarefas → execuções), retry, timeouts, cancelamento, aprovação humana em passos marcados como sensíveis.
4. **Harness de avaliação**: cada agente tem suíte de casos (entrada, saída esperada, critério); roda em CI e antes de promover versão; mede custo, latência e taxa de acerto. Sem harness, fine-tuning e troca de modelo viram chute.
5. **Memória em três níveis**: (a) semântica = GraphRAG da Fase 1; (b) episódica = histórico de tarefas e resultados, indexado por vetor; (c) de trabalho = contexto da tarefa atual. Escrita na memória sempre passa por revisão (humana ou por agente auditor) para evitar envenenamento.
6. **Fine-tuning**: só para modelos abertos (Hermes/Llama/Qwen), com LoRA sobre dados extraídos do harness e da memória episódica aprovada; pipeline de dados → treino → avaliação no harness → promoção. Para OpenAI/Anthropic, o produto usa "fine-tuning por contexto" (prompts, exemplos, ferramentas) e, onde o provedor oferecer, a API oficial de fine-tuning com a chave do cliente.
7. **Auditoria**: cada ação de agente gera evento imutável (quem, o quê, com qual conta, custo, saída, hash da entrada), exportável para SIEM.

### 4.3 Segurança específica de agentes

- **Prompt injection** é o risco número um numa plataforma que lê tickets, e-mails e documentos e depois executa ações. Mitigações: separação estrita entre canal de instrução e canal de dados; tools de escrita exigem confirmação por política; conteúdo indexado marcado como não confiável; testes de injeção no harness.
- **Menor privilégio por executor**: cada agente recebe token MCP com escopo mínimo e prazo curto; nada de chave mestra.
- **Sandbox** para executores que rodam código (gVisor/Firecracker no managed; container sem rede por padrão no self-hosted).
- **Egress controlado**: lista de destinos por tenant; um agente não fala com a internet livremente.
- **Segredos de clientes nunca entram no contexto do LLM**: o orquestrador injeta credenciais na chamada da tool, não no prompt.

### 4.4 Risco contratual que precisa ser dito

"OpenAI por assinatura" e "Claude por assinatura" (planos ChatGPT Plus/Team e Claude Pro/Max) não licenciam uso automatizado por plataforma de terceiros; os termos desses planos são para uso pessoal ou da equipe assinante pela interface oficial, e o uso via automação tende a violar os termos e derrubar a conta do cliente. O caminho seguro é **API com chave da empresa** (OpenAI Platform, Anthropic API, Azure OpenAI, Bedrock, Vertex) ou integrações oficiais para agentes (por exemplo, o Claude Agent SDK e MCP da Anthropic) com as credenciais que o próprio provedor emite para isso. A Plataforma deve suportar "traga sua conta" apenas por essas vias. Recomendo não construir nada que dependa de automatizar sessões de assinatura de consumidor; além do risco jurídico, quebra a cada mudança de interface. Isto é uma leitura dos termos correntes e deve ser confirmada com jurídico antes do lançamento.

### 4.5 Roadmap Fase 2

| Marco | Escopo | Prazo |
|---|---|---|
| F2-M1 | Registro de agentes, cofre multi-conta, orquestrador durável, um gerente e executores OpenAI/Anthropic API | 8 semanas |
| F2-M2 | Executores OpenClaw (reuso dos plugins existentes) e Hermes; harness v1 | 6 semanas |
| F2-M3 | Memória episódica com revisão, aprovação humana, auditoria exportável | 6 semanas |
| F2-M4 | Fine-tuning LoRA para modelos abertos integrado ao harness | 8 semanas |

Cerca de 7 meses após a Fase 1, com equipe de 4 a 5. Planos: Agentes como add-on por gerente ativo (R$ 2.500/mês por gerente + consumo), Enterprise negociado.

## 5. Stack recomendada (resumo)

| Área | Escolha | Justificativa curta |
|---|---|---|
| Banco | PostgreSQL 16 agora, 17 quando AGE 1.7 estabilizar | AGE tem branch `release/PG17/1.7.0`; migrar após validar |
| Extensões | AGE, pgvector 0.8.x, pgsodium, pg_stat_statements, extensões próprias em C | tudo dentro do banco, auditável |
| Pipeline IA | Python 3.12, graphrag 3.1.x, workers próprios | acompanha upstream |
| Gateway / control plane | Go | TLS, MCP, binário único, memória segura |
| Extensões próprias | C (PGXS), com fuzzing e ASan em CI | única camada onde C vale o custo |
| Front console | qualquer SPA leve; não é diferencial | |
| Segredos | SOPS+age (self-hosted) / Vault ou KMS (managed) | |
| Observabilidade | OpenTelemetry, Prometheus, logs estruturados sem PII | |
| Testes | pytest + testcontainers para Postgres; harness de agentes próprio | |

## 6. Riscos e como tratá-los

| Risco | Impacto | Mitigação |
|---|---|---|
| Custo de indexação GraphRAG estoura margem | alto | cobrar por MB, modelo barato na extração, incremental, cache |
| graphrag muda interface entre versões | médio | camada de adaptação própria; pin por release com testes |
| AGE tem comunidade pequena e bugs em Cypher avançado | médio | limitar Cypher exposto ao subconjunto testado; fallback SQL |
| Termos dos provedores para uso por assinatura | alto | só API oficial; validar com jurídico |
| Prompt injection levando a ação indevida | alto | política de tools, aprovação humana, harness de injeção |
| Equipe pequena para duas fases | alto | não iniciar Fase 2 antes de 3 pilotos pagantes na Fase 1 |
| Dependência de um único nicho (ISP) | médio | segundo vertical após 10 clientes |

## 7. Próximos passos concretos

1. Decidir nome e criar organização + repositório privado (posso executar com sua confirmação).
2. Aplicar as 7 correções da seção 7 da análise no fork (M0). Posso começar pela reescrita segura de `age_cypher_query` e `build-graph.py` e por um `Dockerfile` separado para o pipeline.
3. Entrevistar 5 clientes potenciais do nicho ISP com a proposta de valor da Fase 1 e o preço da seção 3.4.
4. Prototipar `PgVectorStore` para graphrag 3.1.x e medir custo de indexação com um corpus real de 100 MB, para calibrar preço.
