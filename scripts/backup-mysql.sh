#!/usr/bin/env bash
set -Eeuo pipefail

# Required environment: MYSQL_HOST, MYSQL_PORT (optional), MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD.
# Keep the password in a protected environment file; this script creates a short-lived mode-600 client file.
: "${MYSQL_HOST:?Set MYSQL_HOST}"
: "${MYSQL_DATABASE:?Set MYSQL_DATABASE}"
: "${MYSQL_USER:?Set MYSQL_USER}"
: "${MYSQL_PASSWORD:?Set MYSQL_PASSWORD}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/watch-party}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
TMP_CNF="$(mktemp)"
trap 'rm -f "$TMP_CNF"' EXIT
chmod 600 "$TMP_CNF"
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' \
  "$MYSQL_HOST" "$MYSQL_PORT" "$MYSQL_USER" "$MYSQL_PASSWORD" > "$TMP_CNF"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DEST="$BACKUP_DIR/${MYSQL_DATABASE}-${STAMP}.sql.gz"
# --single-transaction makes a consistent logical backup for InnoDB tables.
mysqldump --defaults-extra-file="$TMP_CNF" --single-transaction --quick --no-tablespaces \
  --triggers --hex-blob "$MYSQL_DATABASE" | gzip -9 > "$DEST"
test -s "$DEST"
chmod 600 "$DEST"
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${MYSQL_DATABASE}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
echo "Backup created: $DEST"
