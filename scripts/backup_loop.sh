#!/bin/sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
IMAGES_DIR=${IMAGES_DIR:-/images}
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-21600}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
BACKUP_ON_START=${BACKUP_ON_START:-1}
PGDATABASE=${PGDATABASE:-quizparty}

log() {
  printf '[backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

wait_for_db() {
  log "Waiting for PostgreSQL ${PGHOST:-db}:${PGPORT:-5432}/${PGDATABASE}..."
  until pg_isready -q; do
    sleep 2
  done
  log "PostgreSQL ready."
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    cksum "$1" | awk '{print $1}'
  fi
}

backup_once() {
  wait_for_db

  ts=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/images" "$BACKUP_DIR/manifests"

  db_tmp="$BACKUP_DIR/db/quizparty-$ts.dump.tmp"
  db_file="$BACKUP_DIR/db/quizparty-$ts.dump"
  images_tmp="$BACKUP_DIR/images/quizparty-images-$ts.tar.gz.tmp"
  images_file="$BACKUP_DIR/images/quizparty-images-$ts.tar.gz"
  manifest_file="$BACKUP_DIR/manifests/quizparty-$ts.json"

  log "Creating PostgreSQL custom dump: $db_file"
  pg_dump --format=custom --file="$db_tmp"
  mv "$db_tmp" "$db_file"

  if [ -d "$IMAGES_DIR" ]; then
    log "Creating image archive: $images_file"
    tar czf "$images_tmp" -C "$IMAGES_DIR" .
    mv "$images_tmp" "$images_file"
  else
    log "Images directory $IMAGES_DIR does not exist; skipping image archive."
    images_file=""
  fi

  db_sha=$(sha256_file "$db_file")
  images_sha=""
  if [ -n "$images_file" ]; then
    images_sha=$(sha256_file "$images_file")
  fi

  cat > "$manifest_file" <<EOF_MANIFEST
{
  "created_at": "$ts",
  "database": {
    "file": "$db_file",
    "sha256": "$db_sha",
    "format": "pg_dump_custom"
  },
  "images": {
    "file": "$images_file",
    "sha256": "$images_sha",
    "format": "tar.gz"
  },
  "retention_days": $BACKUP_RETENTION_DAYS
}
EOF_MANIFEST

  ln -sfn "$(basename "$db_file")" "$BACKUP_DIR/db/latest.dump"
  if [ -n "$images_file" ]; then
    ln -sfn "$(basename "$images_file")" "$BACKUP_DIR/images/latest.tar.gz"
  fi
  ln -sfn "$(basename "$manifest_file")" "$BACKUP_DIR/manifests/latest.json"

  log "Backup complete: $manifest_file"

  if [ "$BACKUP_RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
    log "Pruning backups older than $BACKUP_RETENTION_DAYS days."
    find "$BACKUP_DIR/db" -type f -name 'quizparty-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -delete
    find "$BACKUP_DIR/images" -type f -name 'quizparty-images-*.tar.gz' -mtime +"$BACKUP_RETENTION_DAYS" -delete
    find "$BACKUP_DIR/manifests" -type f -name 'quizparty-*.json' -mtime +"$BACKUP_RETENTION_DAYS" -delete
  fi
}

case "${1:-loop}" in
  once)
    backup_once
    ;;
  loop)
    if [ "$BACKUP_ON_START" = "1" ]; then
      backup_once
    fi
    while :; do
      log "Sleeping $BACKUP_INTERVAL_SECONDS seconds before next backup."
      sleep "$BACKUP_INTERVAL_SECONDS"
      backup_once
    done
    ;;
  *)
    echo "Usage: $0 [once|loop]" >&2
    exit 2
    ;;
esac
