# Análise técnica e de segurança — postgreSQL-graphRAG-docker

Data da análise: 2026-09-16
Objeto: fork de `Azure-Samples/postgreSQL-graphRAG-docker` (commit `9481377`), 48 arquivos, ~1.000 linhas de Python.

## 1. O que o repositório é

Um *solution accelerator* da Microsoft, não um produto. Ele empacota em uma única imagem Docker:

| Componente | Versão pinada | Situação em set/2026 |
|---|---|---|
| PostgreSQL | 16 (bookworm) | ok, suportado até 2028 |
| Apache AGE (Cypher sobre Postgres) | `release/PG16/1.5.0` | há releases mais novas; migrar para PG17 exige trocar o branch |
| pgvector | v0.7.4 | 0.8.x disponível; 0.7.4 funciona |
| Python | 3.12 | ok |
| graphrag (Microsoft) | 3.0.5 | PyPI está em 3.1.2 |
| agent-framework | 1.0.0rc2 | PyPI está em 1.18.0; o pin em release candidate é frágil |
| fastmcp / mcp | sem pin | fastmcp 4.x; o código usa `mcp.server.fastmcp`, não o pacote `fastmcp` |
| msodbcsql18 + pyodbc | — | só necessário para Azure SQL como fonte |
| Jupyter | sem pin | roda como root, sem token |

Fluxo real (compose): `load-data` lê `graphrag_inputs` de um banco externo e grava `.txt` → `graphrag index` gera parquet + LanceDB em volume → `write-to-db` serializa output/cache/prompts/logs para uma tabela `graphrag_outputs` → `build-graph` recria o grafo AGE a partir dos parquet → `mcp-agent` sobe um servidor MCP (streamable-http, porta 8000) com 5 tools + Jupyter.

Ponto importante para o produto: **a consulta GraphRAG não lê do Postgres**. `mcp_server.py` carrega os parquet do disco (`load_frames`, linhas 67-85) e o LanceDB local. O Postgres guarda uma cópia serializada (JSON dentro de `TEXT`) e o grafo AGE. Ou seja, "GraphRAG em Postgres" hoje é armazenamento de cópia, não motor de consulta. Isso muda a arquitetura multi-tenant (seção 5).

## 2. Licenciamento e viabilidade de repositório privado

- Código: MIT (Microsoft). Uso comercial, modificação e fechamento do fork são permitidos. Obrigação: manter o aviso de copyright e a licença nos arquivos derivados.
- Dados de exemplo (`data/input/*.txt`, transcrições do podcast *Behind the Tech*): CDLA-Permissive-2.0. Não devem ir para o produto; são conteúdo de terceiros com marca Microsoft.
- Marcas: o README proíbe uso das marcas Microsoft de forma que sugira patrocínio. O produto precisa de nome, logo e README próprios.
- Repositório privado: a conta `onyfibra-cpu` (usuário pessoal, 3 repos públicos) pode criar repositório privado. GitHub Free permite repos privados ilimitados; o que muda com plano pago são branch protection rules em repo privado, code owners, e GitHub Advanced Security. Para produto com múltiplos desenvolvedores recomendo organização GitHub (Team) em vez de conta pessoal, para separar propriedade do código da pessoa física.
- Não criei o repositório privado nesta sessão: é ação externa e irreversível sem sua confirmação. Passos quando decidir: criar org → criar repo privado vazio → `git remote add product <url>` → `git push product main` → adicionar `NOTICE` com o copyright MIT da Microsoft → remover `data/input`, `HOWTO.pdf`, notebooks e o `.png` com identidade Microsoft.

## 3. Instalação via compose: estado atual

O `docker-compose.yaml` original **não é instalável fora da máquina da autora**:

1. 16 referências a `/mnt/c/Users/helenzeng/...` (bind mounts absolutos do WSL da autora).
2. Nenhum serviço tem `build:`; a imagem `new-graphrag-img` precisa ser construída à mão antes.
3. O volume de dados do Postgres (`local_postgres_data`) é montado em **todos** os 8 containers, inclusive Jupyter e MCP. Qualquer processo pode corromper ou ler os arquivos brutos do banco.
4. `depends_on` sem `condition: service_healthy`; `load-data` tenta conectar antes do Postgres aceitar conexão.
5. Porta 5432 publicada no host com o superusuário do Postgres (`POSTGRES_USER` é superuser por construção da imagem oficial).
6. `env_file: .env` distribui a chave do Azure OpenAI e a senha do banco para todos os containers, inclusive os que não precisam (Jupyter).
7. Jupyter com `--allow-root`, sem token, em `0.0.0.0`.
8. `insert-table.py` tem caminho Windows hardcoded (`C:/Users/helenzeng/...`) e mistura variáveis `MY_DB_*` com `POSTGRES_*`.

Escrevi `project_folder/docker-compose.portable.yaml` corrigindo 1-7 (build a partir do Dockerfile, caminhos relativos, healthcheck, volume do Postgres só no serviço `postgres`, porta do banco só em loopback, profiles para separar indexação de serviço). Ele foi validado com `docker compose config`; o build completo da imagem está descrito na seção 3.1.

### 3.1 Resultado do build da imagem

Ver seção 8.

## 4. Achados de segurança no código

Classificação: **Crítico** (exploração direta remota), **Alto**, **Médio**, **Baixo**.

### Crítico

**S1. Execução de Cypher e SQL arbitrários pelo MCP, como superusuário.** `mcp_server.py:335-346` interpola a string do usuário dentro de `$$ ... $$` por f-string. A tool `age_cypher_query` é exposta sem autenticação (linha 587-599). Quem alcança a porta 8000 pode:
- rodar qualquer Cypher (incluindo `CREATE`, `DELETE`, `DETACH DELETE`) — a validação regex só existe no caminho NL2Cypher, não neste;
- fechar o dollar-quote com `$$` e emendar SQL arbitrário (`$$) AS (r agtype); DROP TABLE graphrag_outputs; --`). Como a conexão é do superusuário, isso inclui `COPY ... TO PROGRAM` (execução de comando no container).

**S2. Servidor MCP sem autenticação, autorização ou rate limit.** `FastMCP(..., stateless_http=True)` na porta 8000, publicada como 8011 no host. Nenhum token, nenhum tenant, nenhuma quota. Cada `graphrag_search` global custa dezenas de chamadas ao LLM; um cliente anônimo pode esgotar a cota do Azure OpenAI.

### Alto

**S3. Injeção em `age_entity_lookup`.** Linha 349 só troca `'` por espaço. Barra invertida, `$$` e quebras de linha passam. Mitigado parcialmente pelo `LIMIT`, mas ainda permite breakout de dollar-quote.

**S4. NL2Cypher: validação por regex, não por parser.** `_validate_cypher` (441-476) checa labels e presença de `LIMIT`/`RETURN`, mas não impede `DELETE`, `SET`, `CREATE`, `CALL`, nem proíbe múltiplos statements. O LLM pode ser induzido por prompt injection no texto indexado a gerar Cypher destrutivo.

**S5. Segredos em texto plano distribuídos a todos os containers.** `.env` com `AOAI_API_KEY`, `AGE_PASSWORD`, `MY_DB_PASSWORD`. Sem cofre, sem rotação, sem escopo por serviço. O notebook antigo (`Old-2025-query-notebook.ipynb`) contém o endpoint real `graphrag-eastus2.openai.azure.com` da autora; não há chave vazada, mas o padrão mostra o risco de notebooks com output commitado.

**S6. Cache do GraphRAG (prompts e respostas do LLM, incluindo o texto-fonte completo) copiado para o banco externo em texto plano** por `write-to-db.py`, diretórios `cache` e `logs`. Em contexto corporativo isso replica dados sensíveis para uma segunda base sem criptografia nem retenção.

### Médio

**S7. `build-graph.py` monta Cypher por concatenação** com um escape manual (`escape_string`, 52-60). É pipeline batch, não exposto, mas dados de entrada maliciosos (um documento contendo `$$`) quebram a carga ou executam SQL. Deve usar parâmetros (`cypher(graph, query, params)` do AGE aceita `agtype` como terceiro argumento).

**S8. `MATCH (a), (b) WHERE a.name = ... AND b.name = ...`** em `insert_relationships` é um produto cartesiano sem índice; O(n²) por aresta. Para grafos de dezenas de milhares de entidades a carga leva horas. AGE suporta índice em propriedade via `CREATE INDEX ON graphrag."Entity" (agtype_access_operator(properties, '"name"'))`.

**S9. Sem TLS** em nenhum caminho: MCP em HTTP, Postgres sem `ssl=on`, Jupyter HTTP.

**S10. Imagem roda pipeline Python e Jupyter como root** dentro da imagem `postgres`, que tem `gosu` e o entrypoint privilegiado.

### Baixo

**S11.** Dependências sem lockfile (`requirements.txt` com ranges abertos); build não reprodutível. **S12.** `prompts` montados com escrita em alguns serviços; prompt injection persistente se alguém alterar `age_nl2cypher.txt`. **S13.** Nenhum teste automatizado no repositório.

## 5. O que impede o uso multi-tenant direto

1. **Estado no filesystem.** Parquet + LanceDB por volume. Tenant = volume; não escala nem isola.
2. **Grafo único** hardcoded (`graphRAG` em `build-graph.py:40-48`, `AGE_GRAPH_NAME` global no servidor). AGE cria um schema Postgres por grafo, então tenant por grafo é viável, mas o código não parametriza.
3. **Cache de frames em variáveis globais** (`_CONFIG`, `_FRAMES`) — um processo serve um único índice.
4. **Uma chave de LLM** para tudo. Não há custo por tenant, nem BYOK.
5. **graphrag 3.x** suporta `vector_store: type: azure_ai_search | lancedb | cosmosdb`; **não há backend pgvector nativo**. Para "GraphRAG em Postgres" de verdade é preciso escrever um `VectorStore` custom (interface `graphrag.vector_stores.base.BaseVectorStore`, ~150 linhas) e um `Storage` custom (`PipelineStorage`) apontando para tabelas. Isso é factível e é o coração técnico do produto.

## 6. Onde C faz sentido (e onde não faz)

Você mencionou C e Postgres. Avaliação honesta:

| Camada | Linguagem recomendada | Motivo |
|---|---|---|
| Extensões Postgres (guarda de tenant, política de Cypher, funções de criptografia por coluna, hook de auditoria) | **C** (PGXS) | É a única forma de rodar dentro do backend do Postgres com performance e sem depender de PL/Python. Apache AGE e pgvector são C. |
| Pipeline GraphRAG (indexação, community reports, local/global search) | **Python** | `graphrag` é Python; reescrever em C custa anos e perde a evolução do upstream. |
| Gateway MCP / control plane / API (auth, tenants, quotas, cofre) | **Go** (ou Rust) | Binário único, TLS nativo, concorrência, ecossistema MCP maduro. C aqui aumenta superfície de bugs de memória em código exposto à rede, o oposto do objetivo de segurança. |
| Orquestrador de agentes (fase 2) | Go/Python | Mesmo raciocínio. |

Resumo: C na borda do banco, Go na borda da rede, Python no pipeline de IA.

## 7. Correções mínimas antes de qualquer piloto (ordem)

1. `age_cypher_query`: nunca interpolar por f-string. O AGE exige que o texto do Cypher seja um literal no momento do parse, então prepared statements do lado do servidor não funcionam; o caminho correto é quoting no cliente (`psycopg2` com `%s` gera um literal escapado) ou `quote_literal()`/`format('%L')` no servidor, sempre depois de validar o Cypher com parser (item 3). Rodar sob um **role read-only** com `SET ROLE` + `statement_timeout`. Remover superusuário das conexões de serviço.
2. Autenticação no MCP (bearer/JWT por tenant) e rate limit por tool; a tool `age_cypher_query` só para o plano Enterprise/admin.
3. Substituir a validação regex de NL2Cypher por allowlist de statements (só `MATCH/WHERE/RETURN/LIMIT/ORDER BY/WITH`) via parser (libcypher-parser, C, licença Apache-2.0).
4. Volume do Postgres só no serviço `postgres`; Jupyter fora da imagem de produção.
5. Parâmetros em `build-graph.py`; índice por `name` antes de inserir arestas.
6. Cofre de segredos (SOPS + age, ou Vault) e chave de LLM por tenant.
7. Lockfile (`pip-compile` ou `uv lock`) e imagem separada para pipeline (não baseada em `postgres`).

## 8. Resultado do build (verificado nesta sessão)

O ambiente desta sessão tem o cliente Docker 29.3 mas **não tem daemon** (`/var/run/docker.sock` ausente), então o `docker build` não pôde rodar aqui. O que foi verificado sem daemon:

| Verificação | Resultado |
|---|---|
| `docker compose config` no `docker-compose.portable.yaml` | válido; 6 serviços nos profiles `index`+`serve` |
| Branch `release/PG16/1.5.0` do Apache AGE | existe (`0048900`) |
| Tag `v0.7.4` do pgvector | existe (`103ac50`); `v0.8.1` disponível |
| `graphrag==3.0.5` no PyPI | existe; atual é 3.1.2 |
| `agent-framework==1.0.0rc2` no PyPI | existe (prerelease); atual é 1.18.0 |
| `agent-framework-azure-ai==1.0.0b251001` no PyPI | existe (prerelease); atual é 1.0.0rc6 |
| Repositório apt `packages.microsoft.com/debian/12/prod` (msodbcsql18) | não verificado |

Conclusão: todos os insumos do `Dockerfile` continuam disponíveis, logo o build é viável. Restam dois riscos que só o build real revela: (1) conflito de resolução entre `agent-framework 1.0.0rc2` e `agent-framework-azure-ai 1.0.0b251001` (o pip precisa de `--pre` implícito, o que o pin exato garante, mas as dependências transitivas das duas podem divergir); (2) tempo e tamanho: a imagem compila AGE e pgvector do fonte e instala o venv completo com faiss, scikit-learn, streamlit e jupyter; estimativa de 3 a 5 GB. Para o produto, separar imagem do banco e imagem do pipeline resolve os dois.

Comando para validar em máquina com Docker:

```
cd project_folder
cp .env-sample .env   # preencher AGE_USER, AGE_PASSWORD, AOAI_*
docker compose -f docker-compose.portable.yaml build
docker compose -f docker-compose.portable.yaml up -d postgres
```
