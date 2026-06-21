#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/.backups/mysql}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-goalmate}"
MYSQL_USER="${MYSQL_USER:-goalmate}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-goalmate}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/${MYSQL_DATABASE}-${STAMP}.sql.gz"
TMP_TARGET="${TARGET}.tmp"
trap 'rm -f "${TMP_TARGET}"' EXIT

mkdir -p "${BACKUP_DIR}"
cd "${ROOT_DIR}"
docker compose exec -T -e MYSQL_PWD="${MYSQL_PASSWORD}" "${MYSQL_SERVICE}" \
  mysqldump -u"${MYSQL_USER}" --single-transaction --quick --routines --events \
  --set-gtid-purged=OFF --no-tablespaces "${MYSQL_DATABASE}" | gzip -9 > "${TMP_TARGET}"
test -s "${TMP_TARGET}"
mv "${TMP_TARGET}" "${TARGET}"
shasum -a 256 "${TARGET}" > "${TARGET}.sha256"
if [[ -n "${METRICS_TEXTFILE_DIR:-}" ]]; then
  mkdir -p "${METRICS_TEXTFILE_DIR}"
  printf 'goalmate_backup_last_success_timestamp_seconds %s\n' "$(date +%s)" > "${METRICS_TEXTFILE_DIR}/goalmate_backup.prom.tmp"
  mv "${METRICS_TEXTFILE_DIR}/goalmate_backup.prom.tmp" "${METRICS_TEXTFILE_DIR}/goalmate_backup.prom"
fi
find "${BACKUP_DIR}" -type f \( -name '*.sql.gz' -o -name '*.sql.gz.sha256' \) -mtime "+${RETENTION_DAYS}" -delete
printf '%s\n' "${TARGET}"
