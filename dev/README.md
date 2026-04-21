# Local Dev Assets

`dev/` owns the local-only in-cluster development support material for
`firapps`.

Current truth:

- `../Tiltfile` is the canonical in-cluster backend loop for the product repo
- `k8s/` contains the local-only CNPG cluster and backend workload manifests
  that Tilt applies on `kind-platform`
- these assets are developer support material for the product repo, not the
  deployment truth for shared platform environments

Use this path when you need backend pods, a dev CNPG cluster, and local Tilt
feedback while keeping cluster-side steady-state ownership in `firops`.
