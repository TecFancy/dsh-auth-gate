# dsh-auth-gate

**English** | [简体中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![npm downloads](https://img.shields.io/npm/dt/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![npm monthly downloads](https://img.shields.io/npm/dm/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![node](https://img.shields.io/node/v/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![types](https://img.shields.io/npm/types/dsh-auth-gate.svg)](https://www.npmjs.com/package/dsh-auth-gate)
[![CI](https://github.com/TecFancy/dsh-auth-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/TecFancy/dsh-auth-gate/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-auth-gate.svg)](LICENSE)

A login door for your [DeepSeek Harness](https://github.com/deepseek-ai/dsh)
(dsh) web instance. Put it in front of a public dsh deployment and nobody can
reach your agents, your chat sessions, or your LLM credentials without signing
in first.

## What it does

- **Everything needs a login.** Every page, API call, and WebSocket connection
  is checked. Visitors without a valid session are sent to a simple login page
  (or rejected with `401` for API/script requests).
- **Two ways to sign in** (pick one in the configuration):
  - **Password** (recommended): each admin gets a username and password.
  - **Token**: one shared secret token for the whole instance.
- **Works for browsers and scripts.** Browsers use the login page; scripts and
  curl can pass `Authorization: Bearer <token>` and skip the page entirely.
- **Safe by default.** Passwords are stored hashed, logins are rate-limited
  (repeated wrong attempts temporarily lock the address), session cookies are
  secure, and any missing or broken configuration **blocks access instead of
  silently opening the door**.
- **A small command-line tool** for managing users:

  ```sh
  dsh-auth user add admin --password-stdin   # add a user
  dsh-auth user list                          # list users
  dsh-auth user disable admin                 # block a user's future logins
  ```

  `dsh-auth` is directly on your PATH when the package is installed globally.
  After `dsh plugin add` the binary lives inside the profile and must be called
  through it — see [Quick start](#quick-start).

## Quick start

```sh
# 1. Install the plugin from npm into your dsh profile.
#    Since 0.4.1 the package declares a `dsh.bundle` manifest, so `dsh plugin add`
#    also registers the mount (dsh.profile.bundles) automatically:
dsh plugin --profile web add dsh-auth-gate

# 2. Create an admin account.
#    `dsh plugin add` installs the plugin into the profile's node_modules
#    ($DSH_HOME/profiles/web, default ~/.dsh/...) — the CLI is NOT added to your
#    PATH, so call it through the profile. `dsh plugin` already requires pnpm:
printf '%s\n' 'choose-a-strong-password' | \
  pnpm --dir "$DSH_HOME/profiles/web" exec dsh-auth user add admin --password-stdin

# 3. Turn on password login: override the plugin config in $DSH_HOME/cordis.patch.yml
#    (a ready-to-use config-override template ships in deploy/cordis.patch.yml;
#    see Configuration below — the mount itself needs no manual patch row)

# 4. Restart dsh. Open your site — you will be asked to sign in.
```

## See it in action

Visitors without a session are sent to the login page:

![Login page](docs/demo/login-page.png)

After signing in, they land on your instance:

![dsh instance](docs/demo/dashboard.png)

A prominent **Sign out / 退出登录** button sits inside the **Settings panel**
(the Settings → General page, below the last preference row). It's a centered,
danger-styled filled button (16px door icon + localized label, theme tokens
for light/dark), and its label follows the GUI language through the same
locale mechanism the Settings language switch uses. Clicking it runs the same
native `POST /auth/logout?next=/` flow as before.

## Configuration

The bundle mount (id `dsh-auth-gate`, inserted by `dsh plugin add`) uses the
default config: `mode: "token"` backed by the `DSH_AUTH_TOKEN` environment
variable. To change it, override the config in `$DSH_HOME/cordis.patch.yml`
(or the profile's `cordis.patch.yml` — a ready-to-use override template ships
in `deploy/cordis.patch.yml`). The override targets the mounted row by id
(no `insert` — adding one would double-mount the plugin):

```yaml
- id: dsh-auth-gate
  config:
    mode: "password" # "password" (recommended) or "token"
    cookieSecure: true # keep true when you use https
```

| Option         | Default            | What it does                                                                                                                                |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`         | `"token"`          | `"password"` = username/password login; `"token"` = one shared secret                                                                       |
| `sessionTtl`   | `604800`           | How long a login lasts (seconds) before you must sign in again                                                                              |
| `cookieName`   | `dsh_auth`         | Name of the session cookie (rarely needs changing)                                                                                          |
| `tokenRef`     | `"DSH_AUTH_TOKEN"` | Token mode only: which environment variable holds the shared secret                                                                         |
| `cookieSecure` | `true`             | Set to `false` only if you are testing over plain http                                                                                      |
| `usersFile`    | `""`               | Password mode: where your user list lives. Defaults to `$DSH_HOME/auth/users.yaml`                                                          |
| `logoutOrder`  | `1000`             | Slot order of the "Sign out" button in Settings → General (higher = lower on the page). Raise it if another plugin registers a bigger order |

## Troubleshooting

### `dsh-auth: command not found`

`dsh plugin --profile web add dsh-auth-gate` installs the package into the
profile's `node_modules` (`$DSH_HOME/profiles/web/node_modules/dsh-auth-gate`,
default `~/.dsh/...`), but nothing is added to your shell's `PATH`, so the CLI
binary is not callable by name. This only affects the CLI — the plugin itself
runs fine. Pick one:

1. **Call it through the profile (recommended).** `dsh plugin` already requires
   pnpm, so the CLI resolves from the same place the plugin lives:

   ```sh
   pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec dsh-auth user add admin --password-stdin
   pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec dsh-auth user list
   ```

   Optionally, once per shell session:

   ```sh
   alias dsh-auth='pnpm --dir "${DSH_HOME:-$HOME/.dsh}/profiles/web" exec dsh-auth'
   ```

2. **Direct node invocation** (no pnpm needed at runtime):

   ```sh
   node "$DSH_HOME/profiles/web/node_modules/dsh-auth-gate/lib/cli.js" user add admin --password-stdin
   ```

3. **Install the package globally**, then `dsh-auth` is on your PATH:

   ```sh
   npm install -g dsh-auth-gate
   dsh-auth user add admin --password-stdin
   ```

Whichever way you call it, the CLI manages the same shared user list
(`$DSH_HOME/auth/users.yaml`, fallback `~/.dsh/auth/users.yaml`) that the plugin
reads — the global copy is just a launcher.

## Deployment

- [Reverse-proxy deployment guide](docs/reverse-proxy.md) — Caddy/nginx
  setups, the browser-trust fence gotcha (Settings-page `403`s behind a proxy,
  and why auth alone doesn't fix them), and the recommended semi-shell
  topology.
- [`docs/deployment.md`](docs/deployment.md) — ops checklist, acceptance steps
  (A–I) and troubleshooting. Chinese version:
  [`docs/deployment_zh.md`](docs/deployment_zh.md).

## Requirements

- Node ≥ 22.19 and pnpm on the server.
- The dsh `web` profile running (`dsh --profile web`).
- If `cookieSecure` is `true`, your site must be served over https (browsers
  refuse secure cookies on plain http).

## License

[MIT](./LICENSE)

## Notes & limitations

- Disabling a user only stops **new** logins; already-signed-in sessions stay
  valid until they expire.
- Login rate limiting resets when the server restarts.
- Behind a reverse proxy, rate limiting counts by the proxy's address.
- Sign out from the GUI: a prominent "Sign out / 退出登录" button sits in the
  Settings panel (Settings → General, bottom) — client half, requires the
  web app's client bundle (dsh 0.1.0-rc.6+); the direct
  `/auth/logout?next=/` URL always works as a fallback.
- The plugin only protects dsh's web surface. It is not a replacement for
  server-level security: keep the server OS user locked down and the config
  files private (`.credentials.yaml` and `auth/users.yaml` are created with
  `0600` permissions).
