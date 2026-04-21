import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{css,html,json,md,ts,tsx,yaml,yml}": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
  },
});
