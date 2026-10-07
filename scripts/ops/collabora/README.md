# Collabora CODE pilot setup

This example prepares CODE **26.04.4.2.1**, pinned to
`sha256:4e983196eb9878f339cc506c38c21f1cc3473bca3d6de883c5de08f9c0cc3a6c`.
It does not provision DNS, change the running application or enable a public editor.
CODE is an evaluation distribution; select a supported service and complete the
acceptance checks in [Job documents](../../../docs/JOB_DOCUMENTS.md) before a
production rollout.

Requirements: Linux, Docker with Compose v2, Python 3.9+, OpenSSL 3 and a TLS reverse
proxy on the Docker host. For rootless Docker, configure its subordinate UID/GID
range and select its CLI context first. `docker info` should report `rootless` and
`seccomp`. [Docker rootless prerequisites](https://docs.docker.com/engine/security/rootless/).

## Prepare configuration without starting the editor

Run from the repository root. Replace both example HTTPS origins with the planned
public DNS origins. The application origin must exactly match
`FOREMANHQ_PUBLIC_URL`; the editor origin must match `COLLABORA_URL`.

```sh
collabora_image='collabora/code@sha256:4e983196eb9878f339cc506c38c21f1cc3473bca3d6de883c5de08f9c0cc3a6c'
docker pull "$collabora_image"
mkdir -m 700 -p scripts/ops/collabora/private-config
collabora_reader=$(docker create "$collabora_image")
docker cp "$collabora_reader:/etc/coolwsd/coolwsd.xml" scripts/ops/collabora/private-config/image-coolwsd.xml
docker rm "$collabora_reader"
python3 scripts/ops/collabora/prepare.py \
  --template scripts/ops/collabora/private-config/image-coolwsd.xml \
  --output scripts/ops/collabora/private-config \
  --app-origin https://foreman.example.com \
  --editor-origin https://office.example.com
```

`prepare.py` retains an existing private proof key or generates a new 4096-bit RSA
PEM. It writes an XML configuration and `config.tar`, whose entries have numeric
UID/GID 1001 and mode 0600. The host copies remain private to the invoking user.
Keep this directory in a protected backup: the archive also contains the private
key. Do not commit it. Re-running preparation preserves the key.

The generated configuration disables the admin console, macros, remote AI/grammar
providers and generic conversion POST access. It replaces WOPI aliases with the
single escaped application origin, clears default localhost/private-network
external-data allowances and checks HTTPS peer certificates. Collabora also trusts
the configured WOPI hostname for external data, so this is not an unrestricted
external-data service. `security.capabilities` and `security.seccomp` stay enabled;
`mount_jail_tree=false` uses copying/linking for jail contents. The official image
is distroless and runs as UID 1001; no shell is needed inside it.

## Initialize and start a pilot

Review the generated XML before loading it. The initializer refuses an existing
configuration volume, so it cannot silently replace a deployed proof key. It uses
a stopped container and Docker's archive copy operation to preserve UID/GID mapping
with rootless Docker. [Docker archive-copy behavior](https://docs.docker.com/reference/cli/docker/container/cp/).

```sh
bash scripts/ops/collabora/install-volume.sh scripts/ops/collabora/private-config/config.tar
docker compose -f scripts/ops/collabora/compose.yaml config --quiet
docker compose -f scripts/ops/collabora/compose.yaml up -d
docker compose -f scripts/ops/collabora/compose.yaml ps
```

Only `127.0.0.1:9980` is published. The example uses 2 GiB, two CPUs and 512 process
slots as pilot limits; verify effective cgroup limits with your rootless runtime
and size the service for the tested workload. Keep Docker's default seccomp policy
and capability set; the image uses file capabilities to establish document jails.
Do not disable isolation to make a failed startup pass.

Use [Caddyfile.example](./Caddyfile.example) as a reviewed addition to an existing
proxy configuration, replacing its hostname. Caddy terminates public HTTPS and
proxies HTTP over the same host's loopback interface; XML `ssl.termination=true`
ensures discovery returns HTTPS editor URLs. Browser-to-proxy and editor-to-WOPI
traffic remain HTTPS. Do not forward this cleartext backend across another host.
The proxy must pass WebSocket upgrades on `/cool/ws` and the legacy routes.
No access log is configured because request URLs may contain tokens.
[Caddy proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Configure the application with the two HTTPS origins and a random
`DOCUMENT_EDITOR_SECRET` of at least 32 bytes in its server secret store, then
restart it through its normal deployment process. The setup scripts do not do this.

## Verify and retain

Check the local health probe, HTTPS discovery, a populated `<proof-key>`, trusted
HTTPS action URLs and startup evidence of document isolation plus seccomp. Avoid
sharing raw editor logs or callback URLs. A healthy process alone is insufficient:
complete real DOCX/XLSX save/reopen, two-user coauthoring, mobile, token renewal,
read-only, revoked-access and concurrent-upload conflict tests.

`docker compose ... down` removes the container while retaining the external
configuration volume. Back up the application database and private document
storage separately; editor runtime cache is not the authoritative file store.
For an update, retain the proof key, drain/save active sessions, select a reviewed
new image digest, regenerate configuration from that image's template and repeat
acceptance tests. Do not delete or replace the existing configuration volume as
part of routine restart.

The preparation helper has been checked against the pinned image's extracted XML,
including key retention, private file/archive permissions and strict host settings.
The generated archive and named-volume initialization have also passed with the
actual rootless Docker pilot. Compose configuration validation passes; this exact
generic Compose/Caddy deployment has not been acceptance tested. The persistent
pilot uses user systemd services and a Cloudflare Tunnel instead. Public connection
and document loading passed; durable save/close acceptance needs a retest after the
correlated storage receipt fix. Live results and deployed service details are recorded
in [Job documents](../../../docs/JOB_DOCUMENTS.md).
