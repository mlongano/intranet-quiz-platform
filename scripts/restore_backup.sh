#!/bin/sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-compose.yaml}
BACKUP_VOLUME_PATH=${BACKUP_VOLUME_PATH:-/var/lib/docker/volumes/quizpartyplatform_app_backups/_data}
DB_DUMP=${DB_DUMP:-}
IMAGES_TAR=${IMAGES_TAR:-}
DRY_RUN=0
CONFIRM=${CONFIRM:-}

usage() {
  cat <<'EOF'
Usage:
  scripts/restore_backup.sh --db-dump PATH [--images-tar PATH] [--confirm RESTORE_QUIZPARTY]
  scripts/restore_backup.sh --latest [--confirm RESTORE_QUIZPARTY]
  scripts/restore_backup.sh --dry-run --latest

This restores PostgreSQL and optionally uploaded images from a backup.
It is destructive: the current database objects are replaced by the dump,
and the current image volume is replaced if --images-tar is provided.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --db-dump)
      DB_DUMP=${2:?Missing value for --db-dump}
      shift 2
      ;;
    --images-tar)
      IMAGES_TAR=${2:?Missing value for --images-tar}
      shift 2
      ;;
    --latest)
      DB_DUMP="$BACKUP_VOLUME_PATH/db/latest.dump"
      IMAGES_TAR="$BACKUP_VOLUME_PATH/images/latest.tar.gz"
      shift
      ;;
    --confirm)
      CONFIRM=${2:?Missing value for --confirm}
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$DB_DUMP" ]; then
  echo "Missing --db-dump PATH or --latest." >&2
  usage >&2
  exit 2
fi

if [ ! -f "$DB_DUMP" ]; then
  echo "Database dump not found: $DB_DUMP" >&2
  exit 1
fi

if [ -n "$IMAGES_TAR" ] && [ ! -f "$IMAGES_TAR" ]; then
  echo "Image archive not found: $IMAGES_TAR" >&2
  exit 1
fi

cat <<EOF
Restore plan
============
Compose file: $COMPOSE_FILE
Database dump: $DB_DUMP
Image archive: ${IMAGES_TAR:-<none>}

The restore will:
- stop app and worker containers;
- replace database objects in the quizparty database from the dump;
- replace the uploaded image volume if an image archive is provided;
- start the stack again.
EOF

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run only; no changes made."
  exit 0
fi

if [ "$CONFIRM" != "RESTORE_QUIZPARTY" ]; then
  echo "Refusing restore without explicit confirmation." >&2
  echo "Re-run with: --confirm RESTORE_QUIZPARTY" >&2
  exit 1
fi

echo "Stopping app and worker..."
docker compose -f "$COMPOSE_FILE" stop app worker

echo "Restoring PostgreSQL from $DB_DUMP..."
cat "$DB_DUMP" | docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_restore -U quizparty -d quizparty --clean --if-exists --no-owner --role=quizparty

if [ -n "$IMAGES_TAR" ]; then
  echo "Restoring uploaded images from $IMAGES_TAR..."
  docker run --rm \
    -v quizpartyplatform_app_images:/images \
    -v "$(dirname "$IMAGES_TAR")":/backup:ro \
    alpine sh -c 'find /images -mindepth 1 -delete && tar xzf /backup/'"$(basename "$IMAGES_TAR")"' -C /images'
fi

echo "Starting stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Restore completed."
