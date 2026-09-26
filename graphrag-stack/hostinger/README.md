# Deploy na Hostinger (VPS + Traefik + subdomínio)

Stack: Traefik (TLS/roteamento) + Neo4j (grafo) + Qdrant (vetores) +
Postgres (KV/status) + 3 instâncias LightRAG, uma por empresa.

Requisitos: VPS Ubuntu com Docker + Docker Compose plugin, 4 vCPU / 8 GB
(16 GB dá folga), e o subdomínio da Hostinger (`srvXXXXXX.hstgr.cloud`)
ou um domínio próprio apontando para o IP da VPS.

## Passo a passo

```bash
# 1. Clonar e entrar
git clone https://github.com/onyfibra-cpu/postgresql-graphrag-docker.git
cd postgresql-graphrag-docker/graphrag-stack/hostinger

# 2. Configurar segredos
cp .env.example .env
chmod 600 .env
nano .env        # preencher domínio, chaves sk-cp, senhas (openssl rand -hex 32)

# 3. Preparar armazenamento do certificado
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json

# 4. Firewall — só SSH e HTTP/HTTPS
ufw default deny incoming
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# 5. Subir
docker compose up -d
docker compose logs -f traefik   # aguardar emissão do certificado
```

Endpoints (todos por HTTPS, no mesmo domínio):

| Empresa | WebUI | API |
|---|---|---|
| 1 | `https://SEU_DOMINIO/empresa1/webui` | `https://SEU_DOMINIO/empresa1/...` |
| 2 | `https://SEU_DOMINIO/empresa2/webui` | `https://SEU_DOMINIO/empresa2/...` |
| 3 | `https://SEU_DOMINIO/empresa3/webui` | `https://SEU_DOMINIO/empresa3/...` |

Teste rápido de API:

```bash
curl -s https://SEU_DOMINIO/empresa1/health \
  -H "X-API-Key: $LIGHTRAG_API_KEY_EMPRESA1"
```

## Segurança — o que este compose já garante

- **Nenhum banco exposto.** Neo4j, Qdrant e Postgres vivem numa rede Docker
  `internal: true`, sem porta publicada. Do lado de fora só existem 80/443
  no Traefik (e o 22 do SSH, fora do Docker).
- **Isolamento por credencial.** Cada instância tem `LIGHTRAG_API_KEY`
  própria (header `X-API-Key`) e login de WebUI próprio. O OpenClaw da
  empresa 1 recebe apenas a chave da empresa 1 — não há como consultar
  outro workspace com ela.
- **TLS obrigatório** (Let's Encrypt automático), HTTP redirecionado para
  HTTPS, TLS ≥ 1.2, HSTS, e headers de proteção (`traefik/dynamic.yml`).
- **Rate limit** de 20 req/s (burst 60) por IP na borda — segura scraping
  e brute force na WebUI.
- **Dashboard do Traefik desligado** (`--api.dashboard=false`).
- Segredos só no `.env` (chmod 600, ignorado pelo Git).

O que fica por sua conta na VPS: manter o sistema atualizado
(`unattended-upgrades`), SSH por chave (desativar senha) e, se quiser,
fail2ban para o SSH. Backups: volumes `neo4j_data`, `qdrant_data`,
`postgres_data` e `empresa*_storage` (um `docker run --rm -v ...:/v alpine
tar czf` agendado resolve).

## Verificação pós-deploy (faça uma vez)

```bash
# De FORA da VPS: as portas dos bancos não podem responder
nmap -Pn -p 7474,7687,6333,5432,9621 SEU_DOMINIO
# Esperado: todas filtered/closed; apenas 80/443 abertas

# Sem API key a API deve negar (401/403)
curl -s -o /dev/null -w "%{http_code}\n" https://SEU_DOMINIO/empresa1/api/health
```

## Indexação fora do horário (cota compartilhada com o OpenClaw)

A cota do Token Plan é da conta da empresa — a mesma que o OpenClaw usa.
Agende os uploads em massa de madrugada. Exemplo de cron na VPS que envia
tudo que estiver numa pasta `fila/` às 02h:

```bash
0 2 * * * for f in /root/fila-empresa1/*; do \
  curl -s -X POST https://SEU_DOMINIO/empresa1/documents/upload \
    -H "X-API-Key: SUA_CHAVE" -F "file=@$f" && mv "$f" /root/enviados/; done
```

Uploads pontuais pela WebUI durante o dia são leves; o `MAX_ASYNC_LLM=2`
do compose já impede que a extração dispute a janela de 5 h do plano com o
atendimento.
