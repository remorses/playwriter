/// <reference types="vitest/config" />
import { reactRouter } from "@react-router/dev/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import EnvironmentPlugin from "vite-plugin-environment";
import { defineConfig } from "vite";
import {
  viteExternalsPlugin,
  enablePreserveModulesPlugin,
} from "@xmorse/deployment-utils/dist/vite-externals-plugin.js";
import { reactRouterServerPlugin } from "@xmorse/deployment-utils/dist/react-router.js";
import tsconfigPaths from "vite-tsconfig-paths";

const NODE_ENV = JSON.stringify(process.env.NODE_ENV || "production");

export default defineConfig({
  clearScreen: false,
  define: {
    "process.env.NODE_ENV": NODE_ENV,
  },
  test: {
    pool: "threads",
    exclude: ["**/dist/**", "**/esm/**", "**/node_modules/**", "**/e2e/**"],
    poolOptions: {
      threads: {
        isolate: false,
      },
    },
  },
  plugins: [
    EnvironmentPlugin("all", { prefix: "PUBLIC" }),
    EnvironmentPlugin("all", { prefix: "NEXT_PUBLIC" }),
    process.env.VITEST ? react() : reactRouter(),
    tsconfigPaths(),
    // viteExternalsPlugin({
    //   externals: ["@sentry/node"],
    // }),
    // enablePreserveModulesPlugin(),
    // reactRouterServerPlugin({ port: process.env.PORT || '8044' }),
    tailwindcss(),
  ],
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
