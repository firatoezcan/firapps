allow_k8s_contexts("kind-platform")

k8s_yaml(kustomize("dev/k8s"))

docker_build(
    "ghcr.io/firatoezcan/firapps-public-api:dev",
    ".",
    dockerfile="apps/public-api/Dockerfile",
    only=[
        "apps/public-api",
        "packages/backend-common",
        "packages/db",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "vite.config.ts",
    ],
)

docker_build(
    "ghcr.io/firatoezcan/firapps-internal-api:dev",
    ".",
    dockerfile="apps/internal-api/Dockerfile",
    only=[
        "apps/internal-api",
        "packages/backend-common",
        "packages/db",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "vite.config.ts",
    ],
)

k8s_resource("public-api", labels=["backend"], port_forwards=["4000:4000"])
k8s_resource("internal-api", labels=["backend"], port_forwards=["4001:4001"])
