// Stub de teste para "openclaw/plugin-sdk/tool-plugin": devolve a definição
// crua para os testes inspecionarem tools/execute sem o host instalado.
export function defineToolPlugin<T>(definition: T): T {
  return definition;
}
