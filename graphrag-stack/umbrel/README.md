# Deploy interno no Umbrel (Dell R720)

Mesmo stack da Hostinger, sem Traefik: o serviço fica **só na rede
interna**. Cada empresa sai numa porta da LAN:

| Empresa | WebUI | API |
|---|---|---|
| 1 | `http://IP_DO_SERVIDOR:9621/webui` | `http://IP_DO_SERVIDOR:9621/...` |
| 2 | `http://IP_DO_SERVIDOR:9622/webui` | `http://IP_DO_SERVIDOR:9622/...` |
| 3 | `http://IP_DO_SERVIDOR:9623/webui` | `http://IP_DO_SERVIDOR:9623/...` |

O Umbrel não instala compose avulso pela loja, mas o host roda Docker —
basta subir via SSH:

```bash
ssh umbrel@IP_DO_SERVIDOR
git clone https://github.com/onyfibra-cpu/postgresql-graphrag-docker.git
cd postgresql-graphrag-docker/graphrag-stack/umbrel
cp .env.example .env && chmod 600 .env
nano .env            # preencher chaves e senhas
docker compose up -d
```

As portas do Umbrel (80/8080 do painel) não conflitam com 9621-9623.

## Segurança

- Neo4j, Qdrant e Postgres continuam sem porta publicada (rede Docker
  interna); só as 3 portas do LightRAG aparecem na LAN, e todas exigem
  API key / login mesmo dentro da rede.
- **Não faça port-forward** de 9621-9623 no roteador. Para o Claude/Codex
  (ou você fora da empresa) acessarem este servidor interno, use VPN —
  Tailscale tem app oficial no Umbrel; com ele o endpoint vira
  `http://IP_TAILSCALE:9621` sem nada exposto à internet.
- O tráfego LAN é HTTP puro. Dentro de uma rede de confiança é aceitável;
  se a LAN for compartilhada com visitantes, coloque o serviço numa VLAN
  ou suba um Caddy/Traefik local com certificado interno.

## Hostinger × Umbrel — os dois ao mesmo tempo?

Os dois composes são independentes e podem coexistir, mas **cada base é
separada** (documento indexado na VPS não aparece no Umbrel). Escolha um
como oficial e use o outro como teste/backup — manter os dois sincronizados
exigiria reindexar tudo duas vezes (custo de LLM em dobro) ou replicar os
volumes dos bancos manualmente.

Sugestão prática: valide o piloto no Umbrel (hardware próprio, custo zero
de VPS) e promova para a Hostinger quando os OpenClaws e o Claude
precisarem de acesso de fora sem VPN.
