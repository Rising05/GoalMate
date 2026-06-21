#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || "$2" != "--confirm-restore" ]]; then
  printf 'Usage: %s <backup.sql.gz> --confirm-restore\n' "$0" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP="$1"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-goalmate}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root}"

if [[ "${APP_ENV:-development}" == "production" && "${ALLOW_PRODUCTION_RESTORE:-false}" != "true" ]]; then
  printf 'Production restore is blocked unless ALLOW_PRODUCTION_RESTORE=true.\n' >&2
  exit 3
fi
test -f "${BACKUP}"
test -f "${BACKUP}.sha256"
shasum -a 256 -c "${BACKUP}.sha256"
[[ "${MYSQL_DATABASE}" =~ ^[A-Za-z0-9_]+$ ]] || { printf 'Unsafe database name.\n' >&2; exit 4; }

cd "${ROOT_DIR}"
gzip -dc "${BACKUP}" | docker compose exec -T -e MYSQL_PWD="${MYSQL_PASSWORD}" "${MYSQL_SERVICE}" mysql -u"${MYSQL_USER}" "${MYSQL_DATABASE}"
printf 'Restored %s into %s.\n' "${BACKUP}" "${MYSQL_DATABASE}"
