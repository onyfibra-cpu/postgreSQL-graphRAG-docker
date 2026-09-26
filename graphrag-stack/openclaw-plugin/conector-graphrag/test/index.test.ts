import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import plugin from "../src/index.js";

type ToolSpec = {
  name: string;
  description: string;
  execute: (
    params: Record<string, unknown>,
    config: unknown,
    context?: { signal?: AbortSignal },
  ) => Promise<unknown>;
};

const def = plugin as unknown as {
  id: string;
  tools: (tool: <T>(spec: T) => T) => ToolSpec[];
};
const tools = def.tools((spec) => spec);
const facade = tools[0];

const configOk = {
  baseUrl: "https://rag.example.test/empresa1/",
  apiKey: "chave-teste",
};

function respostaJson(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("contrato do pacote", () => {
  it("registra exatamente as tools declaradas em contracts.tools do manifesto", () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url)),
        "utf8",
      ),
    );
    expect(tools.map((t) => t.name)).toEqual(manifest.contracts.tools);
  });

  it("mantém a mesma versão em package.json e openclaw.plugin.json", () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url)),
        "utf8",
      ),
    );
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    expect(manifest.version).toBe(pkg.version);
  });
});

describe("acao=consultar", () => {
  it("chama POST {base}/query com X-API-Key, modo padrão mix e mapeia a resposta", async () => {
    const fetchMock = vi.fn(async () =>
      respostaJson(200, { response: "Siga o POP 12.", references: [{ reference_id: "r1" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await facade.execute(
      { acao: "consultar", pergunta: "Como ativar cliente?", com_referencias: true },
      configOk,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rag.example.test/empresa1/query");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("chave-teste");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "Como ativar cliente?",
      mode: "mix",
      include_references: true,
    });
    expect(resultado).toEqual({
      resposta: "Siga o POP 12.",
      referencias: [{ reference_id: "r1" }],
    });
  });

  it("exige o campo pergunta", async () => {
    await expect(
      facade.execute({ acao: "consultar", pergunta: "  " }, configOk),
    ).rejects.toThrow(/exige o campo 'pergunta'/);
  });

  it("em erro HTTP relata o status sem expor a chave", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson(401, { detail: "negado" })));
    const promessa = facade.execute(
      { acao: "consultar", pergunta: "qualquer coisa" },
      configOk,
    );
    await expect(promessa).rejects.toThrow(/HTTP 401/);
    await promessa.catch((erro: Error) => {
      expect(erro.message).not.toContain("chave-teste");
    });
  });
});

describe("demais ações", () => {
  it("saude chama GET {base}/health e embrulha a resposta (sem 'status' no topo)", async () => {
    const fetchMock = vi.fn(async () => respostaJson(200, { status: "healthy" }));
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await facade.execute({ acao: "saude" }, configOk);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rag.example.test/empresa1/health");
    expect(init.method).toBe("GET");
    // "status" é nome reservado na avaliação de resultado do OpenClaw:
    // no topo do details, "healthy" marcaria a chamada como falha.
    expect(resultado).toEqual({ saude: { status: "healthy" } });
    expect(Object.keys(resultado as object)).not.toContain("status");
  });

  it("indexacao chama GET {base}/documents/pipeline_status e embrulha", async () => {
    const fetchMock = vi.fn(async () => respostaJson(200, { busy: false }));
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await facade.execute({ acao: "indexacao" }, configOk);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://rag.example.test/empresa1/documents/pipeline_status",
    );
    expect(resultado).toEqual({ indexacao: { busy: false } });
  });

  it("respeita o cancelamento do host (context.signal já abortado)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controlador = new AbortController();
    controlador.abort();
    await expect(
      facade.execute({ acao: "saude" }, configOk, { signal: controlador.signal }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("validação de config", () => {
  it("rejeita baseUrl ausente ou sem esquema http(s)", async () => {
    await expect(
      facade.execute({ acao: "saude" }, { apiKey: "x" }),
    ).rejects.toThrow(/baseUrl/);
    await expect(
      facade.execute({ acao: "saude" }, { baseUrl: "ftp://x", apiKey: "x" }),
    ).rejects.toThrow(/baseUrl/);
  });

  it("explica quando apiKey chega como objeto (SecretRef não resolvido)", async () => {
    await expect(
      facade.execute(
        { acao: "saude" },
        { baseUrl: "https://x.test", apiKey: { source: "store", id: "K" } },
      ),
    ).rejects.toThrow(/SecretRef não resolvido/);
  });
});
