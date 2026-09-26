import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Fora de um host OpenClaw o SDK não está instalado; o stub devolve a
      // definição crua, que é o que os testes inspecionam.
      "openclaw/plugin-sdk/tool-plugin": fileURLToPath(
        new URL("./test/stub-tool-plugin.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
