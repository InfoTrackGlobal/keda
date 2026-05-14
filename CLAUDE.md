# keda

InfoTrack's fork of KEDA (Kubernetes Event-Driven Autoscaling). Contains InfoTrack-specific scalers and patches on top of the upstream KEDA project.

## Repository Structure

- `apis/` — Custom Resource Definition (CRD) API types
- `controllers/` — Kubernetes controller reconcilers for ScaledObject, ScaledJob, etc.
- `cmd/` — Main entry points (operator, adapter)
- `vendor/` — Vendored Go dependencies (do not edit manually)

## Tech Stack

- Go
- Kubernetes `controller-runtime`
- Prometheus (metrics)

## Key Conventions

- This is a fork — keep InfoTrack-specific changes minimal and clearly marked with `// InfoTrack:` comments so they are easy to identify when rebasing upstream
- Before adding a new scaler, check if upstream KEDA already has or is developing it
- All new scalers must have unit tests in `*_test.go` alongside the scaler implementation
- `vendor/` is managed by `go mod vendor` — never edit vendored files directly

## Common Tasks

```bash
go build ./cmd/operator
go test ./controllers/... ./pkg/...

# Update vendor after go.mod changes
go mod tidy && go mod vendor

# Generate CRD manifests after API changes
make manifests
```

## Upstream

Based on [kedacore/keda](https://github.com/kedacore/keda). Periodically rebase from upstream `main` to pick up bug fixes and new scalers.

## Notes

- Default branch: `main`
