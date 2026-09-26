# Padrão de versão para plugins OpenClaw

Regra da casa: **todo plugin novo, e toda atualização de plugin
existente, mira a versão vigente do host OpenClaw e o SDK atual** — não
uma versão antiga "por compatibilidade". Hoje a frota roda **2026.9.4**.

## Antes de criar ou atualizar um plugin

1. **Confirme a versão vigente no host** (não confie em tabela ou
   memória):

   ```bash
   openclaw --version
   ```

2. **Leia os release notes** entre a versão que o plugin declarava e a
   vigente (https://docs.openclaw.ai/releases/ e a página
   https://docs.openclaw.ai/plugins/sdk-migration). Breaking changes de
   SDK são frequentes; imports do SDK raiz e de barrels amplos já foram
   removidos — só subpath focado (`openclaw/plugin-sdk/<subpath>`).

3. **Declare como piso a versão que será testada de verdade**, nos três
   lugares, sempre iguais:

   ```json
   "peerDependencies": { "openclaw": ">=2026.9.4" },
   "openclaw": {
     "compat": { "pluginApi": ">=2026.9.4" },
     "install": { "minHostVersion": ">=2026.9.4" }
   }
   ```

   A doc oficial é explícita: as APIs de plugin são experimentais —
   declare compatível apenas o que você testa. Piso antigo que ninguém
   testa é promessa falsa.

4. **Valide contra o host vigente** antes de instalar em qualquer
   tenant:

   ```bash
   npm run build
   openclaw plugins build --entry ./dist/index.js --check
   openclaw plugins validate --entry ./dist/index.js
   npm test
   ```

5. Ao subir a versão do host da frota, repita 2–4 para **cada plugin
   instalado** e suba os pisos junto. Plugin que não passou pela
   validação na versão nova não é "provavelmente compatível" — é não
   testado.

## Referências vigentes (2026.9.4)

- Tool plugins: https://docs.openclaw.ai/plugins/tool-plugins
- Entry points/SDK: https://docs.openclaw.ai/plugins/sdk-entrypoints
- Migração de SDK: https://docs.openclaw.ai/plugins/sdk-migration
- Manifesto: https://docs.openclaw.ai/plugins/manifest

Pontos do contrato atual que já pegaram plugin desta operação:

- `details` com `status`/`ok`/`success`/`error`/`timedOut`/`exitCode` no
  topo é avaliado pelo host como resultado da chamada — dado de domínio
  com esses nomes vai embrulhado numa chave própria.
- `execute(params, config, context)` recebe `context.signal`; propague o
  abort para qualquer I/O.
- `typebox` é dependência de runtime (`dependencies`, nunca só
  `devDependencies`).
- Host exige Node 24.16+ ou 26.1+ desde 2026.9.3.
