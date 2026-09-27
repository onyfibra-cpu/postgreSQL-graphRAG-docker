# Deploy interno no Umbrel (Dell R720)

Mesmo stack da Hostinger, sem Traefik: o serviço fica **só na rede
interna**. Cada empresa sai numa porta da LAN:

| Empresa | WebUI | API |
|---|---|---|
| 1 | `http://IP_DO_SERVIDOR:9621/webui` | `http://IP_DO_SERVIDOR:9621/...` |
| 2 | `http://IP_DO_SERVIDOR:9622/webui` | `http://IP_DO_SERVIDOR:9622/...` |
| 3 | `http://IP_DO_SERVIDOR:9623/webui` | `http://IP_DO_SERVIDOR:9623/...` |

## Como instalar

Três caminhos, do recomendado ao frágil (fonte: suporte oficial da
Umbrel, "Running custom Docker containers", fev/2026):

**1. Portainer (recomendado para o piloto).** É o caminho oficial da
Umbrel para compose customizado: instale **Portainer** pela App Store,
abra, crie uma *Stack* colando o `docker-compose.yml` desta pasta e
preencha as variáveis do `.env.example` na seção *Environment variables*
da stack. Este compose já cumpre as exigências oficiais: **só volumes
nomeados** (bind mount perde dados quando o Portainer atualiza) e
`restart: unless-stopped`. Duas ressalvas do próprio suporte:

- **Desinstalar o Portainer apaga todos os containers e volumes criados
  por ele** — com Neo4j/Postgres de 3 empresas dentro, mantenha backup
  dos volumes e nunca desinstale sem exportar.
- Confira conflito de portas com outros apps (9621-9623 não conflitam
  com o painel do Umbrel, que usa 80/8080).

**2. Community App Store própria (recomendado para a instalação
definitiva).** Empacotar este stack no template
`getumbrel/umbrel-community-app-store` (repo GitHub com
`umbrel-app.yml` + compose no formato Umbrel, com `app_proxy`) e
adicionar em App Store → menu ⋯ → Community App Stores. O stack vira um
app de verdade: ícone no painel, dados no diretório gerenciado pelo
umbrelOS, sobrevive a atualizações do OS e não depende do Portainer.
Candidato natural para hospedar a store: o repositório
`-umbrel-painel-ony`.

**3. SSH + `docker compose` direto no host.** Funciona (o host roda
Docker), mas é não-suportado no umbrelOS 1.x+ — há relatos na
comunidade de compose avulso quebrando após atualização do OS. Use só
para depuração rápida:

```bash
ssh umbrel@IP_DO_SERVIDOR
git clone https://github.com/onyfibra-cpu/postgresql-graphrag-docker.git
cd postgresql-graphrag-docker/graphrag-stack/umbrel
cp .env.example .env && chmod 600 .env
nano .env            # preencher chaves e senhas
docker compose up -d
```

Em qualquer caminho, o acesso é `umbrel.local:9621` (ou o IP da LAN).

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
