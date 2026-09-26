import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const DEFAULT_TIMEOUT_MS = 60_000;

// Modos aceitos pelo POST /query do LightRAG (Literal do QueryRequest).
const MODOS = ["mix", "local", "global", "hybrid", "naive", "bypass"] as const;

interface ConectorConfig {
  baseUrl?: unknown;
  apiKey?: unknown;
  timeoutMs?: unknown;
}

interface FacadeParams {
  acao: "consultar" | "saude" | "indexacao";
  pergunta?: string;
  modo?: (typeof MODOS)[number];
  com_referencias?: boolean;
}

function resolverConfig(config: ConectorConfig): {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
} {
  const baseUrl = config.baseUrl;
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    throw new Error(
      "conector-graphrag: configure plugins.entries.conector-graphrag.config.baseUrl " +
        "com a URL da instância LightRAG (http:// ou https://).",
    );
  }
  const apiKey = config.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    // Um objeto aqui costuma ser um SecretRef que o host não resolveu —
    // erro claro em vez de mandar "[object Object]" como credencial.
    const detalhe =
      apiKey !== null && typeof apiKey === "object"
        ? "recebi um objeto (SecretRef não resolvido pelo host?)"
        : "valor ausente ou vazio";
    throw new Error(
      `conector-graphrag: apiKey inválida na config (${detalhe}). ` +
        "Grave a chave com `openclaw secrets store` e referencie o SecretRef, " +
        "ou informe a string diretamente.",
    );
  }
  const timeoutMs =
    typeof config.timeoutMs === "number" && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, timeoutMs };
}

async function chamarApi(
  cfg: { baseUrl: string; apiKey: string; timeoutMs: number },
  caminho: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const resposta = await fetch(`${cfg.baseUrl}${caminho}`, {
      method: init?.method ?? "GET",
      headers: {
        "X-API-Key": cfg.apiKey,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (!resposta.ok) {
      // Nunca inclui a chave; corpo truncado para não inundar o contexto.
      const corpo = (await resposta.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `conector-graphrag: a base de conhecimento respondeu HTTP ${resposta.status} ` +
          `em ${caminho}${corpo ? ` — ${corpo}` : ""}`,
      );
    }
    return await resposta.json();
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new Error(
        `conector-graphrag: tempo esgotado (${cfg.timeoutMs} ms) chamando ${caminho}. ` +
          "Verifique se a instância LightRAG está no ar e acessível deste servidor.",
      );
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

export default defineToolPlugin({
  id: "conector-graphrag",
  name: "Conector GraphRAG",
  description:
    "Consulta a base de conhecimento central (LightRAG: grafo + vetores) da empresa configurada.",
  configSchema: Type.Object(
    {
      baseUrl: Type.String({
        description:
          "URL da instância LightRAG desta empresa (ex.: https://dominio/empresa1 ou http://ip-interno:9621).",
      }),
      apiKey: Type.String({
        description:
          "Chave de API da instância (header X-API-Key). Recomendado: SecretRef via `openclaw secrets store`.",
      }),
      timeoutMs: Type.Optional(
        Type.Number({ description: "Timeout por chamada em ms (padrão 60000)." }),
      ),
    },
    { additionalProperties: false },
  ),
  tools: (tool) => [
    tool({
      name: "base_conhecimento",
      label: "Base de conhecimento",
      description:
        "Facade da base de conhecimento corporativa (documentação, manuais, treinamentos, POPs). " +
        "Ações: 'consultar' responde uma pergunta usando grafo + busca vetorial (use antes de " +
        "responder dúvida sobre procedimento, produto ou norma interna); 'saude' verifica se o " +
        "serviço está no ar; 'indexacao' mostra o status do processamento de documentos.",
      parameters: Type.Object(
        {
          acao: Type.Union(
            [Type.Literal("consultar"), Type.Literal("saude"), Type.Literal("indexacao")],
            { description: "O que fazer na base de conhecimento." },
          ),
          pergunta: Type.Optional(
            Type.String({
              description: "Obrigatória em acao=consultar. A pergunta, em linguagem natural.",
            }),
          ),
          modo: Type.Optional(
            Type.Union(
              MODOS.map((m) => Type.Literal(m)),
              {
                description:
                  "Modo de recuperação (padrão 'mix', o recomendado). Só vale para acao=consultar.",
              },
            ),
          ),
          com_referencias: Type.Optional(
            Type.Boolean({
              description:
                "Se true, inclui as referências dos documentos-fonte na resposta (acao=consultar).",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (params: FacadeParams, config: unknown) => {
        const cfg = resolverConfig(config as ConectorConfig);
        switch (params.acao) {
          case "consultar": {
            const pergunta = params.pergunta?.trim();
            if (!pergunta) {
              throw new Error(
                "conector-graphrag: acao=consultar exige o campo 'pergunta'.",
              );
            }
            const corpo: Record<string, unknown> = {
              query: pergunta,
              mode: params.modo ?? "mix",
            };
            if (params.com_referencias !== undefined) {
              corpo.include_references = params.com_referencias;
            }
            const dados = (await chamarApi(cfg, "/query", {
              method: "POST",
              body: corpo,
            })) as { response?: string; references?: unknown[] };
            return {
              resposta: dados.response ?? "",
              ...(dados.references ? { referencias: dados.references } : {}),
            };
          }
          case "saude":
            return await chamarApi(cfg, "/health");
          case "indexacao":
            return await chamarApi(cfg, "/documents/pipeline_status");
        }
      },
    }),
  ],
});
