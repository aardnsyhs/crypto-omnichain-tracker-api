# Dependency review, 2026-10-08

Source: executed `npm audit --json` and `npm audit --omit=dev --json` against the final lockfile. Counts are affected package entries, not distinct exploitable vulnerabilities. Offline installation summaries were not used as security evidence.

Full dependency tree: `{'info': 0, 'low': 0, 'moderate': 5, 'high': 33, 'critical': 0, 'total': 38}`.
Runtime audit: `{'info': 0, 'low': 0, 'moderate': 0, 'high': 4, 'critical': 0, 'total': 4}`.

The critical proxy-addr advisory was fixed with a compatible transitive patch to 2.0.8. A compatible brace-expansion update was also applied. No major framework or Prisma upgrade was made.

The four remaining runtime audit entries are `@prisma/config`, `deepmerge-ts`, `prisma`, and `mysql2`. Prisma CLI is also pulled through the client peer dependency, so `--omit=dev` does not eliminate these entries. The serving application uses the PostgreSQL adapter, not mysql2, and does not accept remote Prisma configuration. This reduces exposure but does not make the advisory report clean. Keep migration/build tooling restricted to trusted configuration and networks. Review patched Prisma 7-compatible releases and retest generation/migrations when available; npm suggests major downgrades, which were intentionally not applied.

Jest 29 and its glob/micromatch/braces/sprintf dependency chain account for most other findings. Tests run trusted repository fixtures. A Jest major upgrade requires separate validation, especially around ESM and Nest loading. Backend CI uploads the complete advisory report as an artifact with an advisory-only audit step; implementation, integration, and startup checks remain required.

## Remaining direct advisories

| Package | Severity | Advisory | Affected range |
| --- | --- | --- | --- |
| braces | high | [braces vulnerable to stack-exhaustion denial of service through deeply nested patterns](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `<=3.0.3` |
| deepmerge-ts | high | [DeepmergeTS has stack exhaustion when merging recursive object graphs](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `<8.0.0` |
| mysql2 | high | [MySQL2: Auth Plugin Downgrade to mysql_clear_password Leaks Plaintext Credentials](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) | `<3.22.0` |
| mysql2 | moderate | [MySQL2: Unbounded zlib inflate in compressed MySQL protocol handler allows decompression-bomb DoS](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) | `<=3.23.0` |
| sprintf-js | moderate | [sprintf-js vulnerable to denial of service through unbounded precision specifiers](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | `<=1.1.3` |

Before live deployment, review these residual risks with the actual VPS permissions and provider endpoints. Do not treat a successful build or a clean subset audit as a complete security assessment.
