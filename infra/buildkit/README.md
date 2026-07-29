# BuildKit daemon (Proxmox LXC build host)

Host build infrastructure, not part of the application. It exists so that
`docker compose build` works on the school server, where the app runs inside an
unprivileged Proxmox LXC container.

## The problem it solves

On that host the default Docker builder fails on every Dockerfile `RUN` step:

```
runc run failed: unable to apply apparmor profile:
  apparmor failed to apply profile: write .../attr/apparmor/exec: no such file or directory
```

or, with the legacy builder, more plainly:

```
AppArmor enabled on system but the docker-default profile could not be loaded:
  apparmor_parser: Access denied. You need policy admin privileges to manage profiles.
```

An unprivileged LXC cannot load AppArmor profiles. The `security_opt:
apparmor:unconfined` entries in the app's `compose.yaml` fix *running*
containers, but Dockerfile build steps get no such escape — BuildKit invokes
`runc` itself and there is no per-build way to opt out.

The fix is to delegate builds to a **privileged** BuildKit daemon, which can set
up the namespaces and profiles the LXC cannot. That daemon is this service.

## Setup

Once per host:

```bash
# 1. start the daemon
cd infra/buildkit
docker compose up -d

# 2. register it as a buildx builder (once; the selection is persistent)
docker buildx create --name lxc-remote2 --driver remote tcp://127.0.0.1:1235
docker buildx use lxc-remote2
```

Verify — the node must report `running`, not `inactive`:

```bash
docker buildx ls
#   lxc-remote2*      remote
#    \_ lxc-remote20   \_ tcp://127.0.0.1:1235   running   v0.30.0
```

Then build the application normally, from the repository root:

```bash
docker compose build && docker compose up -d
```

`restart: unless-stopped` means the daemon comes back after a host reboot, so
this is a one-time setup. A deliberate `docker compose stop` stays stopped.

## Security

The daemon is bound to **127.0.0.1 only**, on purpose.

BuildKit here speaks plain TCP with no authentication, and every build runs
privileged. Anything that can reach port 1235 can execute arbitrary code as root
on this host. Publishing it as `0.0.0.0:1235` — which is easy to do by accident,
and was the case before this file existed — exposes that to the entire school
network.

Do not widen the binding. If a remote machine genuinely needs to build here,
tunnel it instead:

```bash
ssh -L 1235:127.0.0.1:1235 user@build-host
```

or configure BuildKit's mTLS (`--tlscacert`, `--tlscert`, `--tlskey`).

## Troubleshooting

**`buildx ls` shows `inactive`, builds fail with `context deadline exceeded`.**
The daemon is not running. `docker compose up -d` here, then re-check. This is
the usual cause: nothing is wrong with the build, the builder is simply absent.

**Builds still hit AppArmor errors.** The wrong builder is selected. Check for
the `*` in `docker buildx ls` and run `docker buildx use lxc-remote2`. The
selection is per-user and persistent, so this normally only happens on a new
account or after `buildx rm`.

**A build fails inside a `RUN` step** (for example `pnpm build` exiting
non-zero). That is an application build failure, not an infrastructure one — the
daemon is working. Read the step's output rather than restarting anything here.

**Stale builders in `docker buildx ls`.** Entries persist in
`~/.docker/buildx/instances/` even when the container behind them is gone, and a
dead entry is indistinguishable from a live one until you try to build. Remove
with `docker buildx rm <name>`.

## Build cache

Kept in the named volume `quizparty_buildkit_cache`, so it survives recreating
the container. It is safe to delete — builds simply get slower for one run:

```bash
docker compose down
docker volume rm quizparty_buildkit_cache
docker compose up -d
```
