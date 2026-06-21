#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <backup.sql.gz>\n' "$0" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP="$1"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-root}"
DRILL_DATABASE="goalmate_restore_drill_$(date -u +%Y%m%d%H%M%S)"
STARTED="$(date +%s)"

test -f "${BACKUP}"
test -f "${BACKUP}.sha256"
shasum -a 256 -c "${BACKUP}.sha256"
cd "${ROOT_DIR}"

cleanup() {
  docker compose exec -T -e MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" "${MYSQL_SERVICE}" mysql -uroot -e "DROP DATABASE IF EXISTS \`${DRILL_DATABASE}\`;" >/dev/null
}
trap cleanup EXIT

docker compose exec -T -e MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" "${MYSQL_SERVICE}" mysql -uroot -e "CREATE DATABASE \`${DRILL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gzip -dc "${BACKUP}" | docker compose exec -T -e MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" "${MYSQL_SERVICE}" mysql -uroot "${DRILL_DATABASE}"
TABLE_COUNT="$(docker compose exec -T -e MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" "${MYSQL_SERVICE}" mysql -uroot -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DRILL_DATABASE}';")"
MIGRATION_COUNT="$(docker compose exec -T -e MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" "${MYSQL_SERVICE}" mysql -uroot -Nse "SELECT COUNT(*) FROM \`${DRILL_DATABASE}\`.\`_prisma_migrations\` WHERE finished_at IS NOT NULL;")"
[[ "${TABLE_COUNT}" -gt 0 ]]
[[ "${MIGRATION_COUNT}" -gt 0 ]]
DURATION="$(( $(date +%s) - STARTED ))"
printf 'restore_drill_status=PASS database=%s tables=%s migrations=%s duration_seconds=%s\n' "${DRILL_DATABASE}" "${TABLE_COUNT}" "${MIGRATION_COUNT}" "${DURATION}"
