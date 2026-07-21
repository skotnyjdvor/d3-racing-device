#!/bin/sh
set -eu

mkdir -p /backups
while true; do
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  pg_dump --format=custom --file="/backups/laptrace-${timestamp}.dump"
  find /backups -type f -name 'laptrace-*.dump' -mtime +14 -delete
  sleep 86400
done
