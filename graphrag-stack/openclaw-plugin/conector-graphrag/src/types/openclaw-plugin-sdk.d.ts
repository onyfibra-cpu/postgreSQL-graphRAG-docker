// Shim de tipos para compilar fora de um host OpenClaw instalado.
// Em runtime o host fornece o módulo real; `openclaw plugins build` e
// `plugins validate` (rodados no VM com o host) fazem a checagem estrita.
declare module "openclaw/plugin-sdk/tool-plugin" {
  export function defineToolPlugin(definition: {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    tools: (tool: <T>(spec: T) => T) => unknown[];
  }): unknown;
}
