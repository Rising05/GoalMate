#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${UPLOAD_STORAGE_PATH:-${ROOT_DIR}/.data/uploads}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/.backups/storage}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/uploads-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}" "${SOURCE_DIR}"
tar -C "${SOURCE_DIR}" -czf "${TARGET}" .
shasum -a 256 "${TARGET}" > "${TARGET}.sha256"
printf '%s\n' "${TARGET}"
