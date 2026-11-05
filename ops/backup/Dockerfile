# Одноразовый ops/backup container (ТЗ 10, 36.3, 39.10):
# PostgreSQL 18 client, rclone (crypt/s3/webdav/local), zstd, jq.
FROM debian:12.15-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg zstd jq rclone tar coreutils findutils \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
COPY scripts/ /opt/crm-backup/
RUN sed -i 's/\r$//' /opt/crm-backup/*.sh /opt/crm-backup/*.sql \
 && chmod +x /opt/crm-backup/*.sh
ENV PATH="/opt/crm-backup:${PATH}"
WORKDIR /backups
ENTRYPOINT []
CMD ["backup.sh", "--help"]
