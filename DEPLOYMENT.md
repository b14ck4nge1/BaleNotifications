# Deploying BaleNotifications to Cloudflare

This guide covers first-time deployment, verification, configuration, and common problems. The commands are written for Windows PowerShell, with `curl` alternatives included where useful.

## Prerequisites

- [Node.js 22 or later](https://nodejs.org/)
- Git
- A Cloudflare account with Workers enabled
- Bark installed and configured on your iPhone
- Access to [Bale Web](https://web.bale.ai/)

Deploying BaleNotifications creates a separate Worker named `bale-notifications`. It does not interfere with other Workers unless another project uses the same Worker name.

## 1. Download and test the project

```powershell
git clone https://github.com/b14ck4nge1/BaleNotifications.git
cd BaleNotifications
node --version
npm test
```

If Git must use a SOCKS5 proxy on port `10808`:

```powershell
git -c http.proxy=socks5h://127.0.0.1:10808 clone https://github.com/b14ck4nge1/BaleNotifications.git
```

## 2. Collect the credentials

### Bale token

Sign in to [Bale Web](https://web.bale.ai/), open the browser developer tools, and copy the value of the `access_token` cookie. It is normally a JWT beginning with `eyJ`.

Treat this token like your Bale password. Do not put it in a source file, issue, chat message, or normal Cloudflare variable.

### Bark URL

Open Bark on your iPhone and copy its full push URL:

```text
https://api.day.app/YOUR_DEVICE_KEY
```

The device key can send notifications to your phone, so treat the URL as a secret.

### Admin token

Generate a strong random token locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save the generated value in a password manager. It protects every management endpoint.

## 3. Sign in and deploy

```powershell
npx wrangler@latest login
npx wrangler@latest whoami
npm run deploy
```

The first deployment creates:

- The `bale-notifications` Worker
- One SQLite-backed Durable Object class
- A cron watchdog that runs every minute
- A `workers.dev` URL

If another project already uses the name `bale-notifications`, change the `name` field in `wrangler.jsonc` before deploying.

## 4. Add Cloudflare secrets

Run each command and paste the matching value when prompted:

```powershell
npx wrangler@latest secret put BALE_TOKEN
npx wrangler@latest secret put BARK_URL
npx wrangler@latest secret put ADMIN_TOKEN
```

| Secret | Value |
| --- | --- |
| `BALE_TOKEN` | Bale Web `access_token` cookie |
| `BARK_URL` | Full Bark URL containing the device key |
| `ADMIN_TOKEN` | Random token generated in the previous step |

Never add these values to `wrangler.jsonc` or commit them to Git.

## 5. Verify the deployment

Wrangler prints the Worker URL after deployment. Set it without a trailing slash:

```powershell
$WorkerUrl = "https://bale-notifications.YOUR-SUBDOMAIN.workers.dev"
$AdminToken = Read-Host "Enter your ADMIN_TOKEN"
$Headers = @{ Authorization = "Bearer $AdminToken" }
```

Confirm the Worker is online:

```powershell
Invoke-RestMethod -Uri $WorkerUrl
```

Send a Bark test notification:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "$WorkerUrl/admin/test" `
  -Headers $Headers
```

`AUTO_START` is enabled by default, so the relay should start itself within one minute. Check its state:

```powershell
$Status = Invoke-RestMethod `
  -Uri "$WorkerUrl/admin/status" `
  -Headers $Headers

$Status | Format-List
```

The expected result includes:

```text
running                 : True
connected               : True
selfMessageFilterActive : True
```

If you do not want to wait for the watchdog, start it manually:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "$WorkerUrl/admin/start" `
  -Headers $Headers
```

Send a private Bale message from another account. The Bark notification should show the sender's name, message, and profile picture when Bale exposes one.

## macOS and Linux verification

```bash
export WORKER_URL="https://bale-notifications.YOUR-SUBDOMAIN.workers.dev"
export ADMIN_TOKEN="YOUR_ADMIN_TOKEN"

curl -X POST "$WORKER_URL/admin/test" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

curl "$WORKER_URL/admin/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Configuration

Non-secret settings are stored in `wrangler.jsonc`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BALE_WS_URL` | `https://next-ws.bale.ai/ws/` | Bale WebSocket endpoint |
| `BARK_GROUP` | `BaleNotifications` | Bark namespace; each sender gets a separate subgroup |
| `NOTIFY_CHAT_TYPES` | `1` | Comma-separated Bale chat types to notify |
| `MESSAGE_PREVIEW` | `true` | Set to `false` to hide message contents |
| `AUTO_START` | `true` | Start and recover the relay through the cron watchdog |

`BALE_SELF_ID` is an optional Worker variable that overrides automatic self-account detection. Add it only if `/admin/status` reports `selfMessageFilterActive: false`.

Bale chat types:

| Value | Chat type |
| --- | --- |
| `1` | Private |
| `2` | Group |
| `3` | Channel |
| `4` | Bot |
| `5` | Supergroup |

For private messages, groups, and supergroups, set:

```json
"NOTIFY_CHAT_TYPES": "1,2,5"
```

After changing `wrangler.jsonc`, redeploy with `npm run deploy`.

## Operations

### View live logs

```powershell
npm run logs
```

### Restart manually

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "$WorkerUrl/admin/start" `
  -Headers $Headers
```

### Stop the relay

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "$WorkerUrl/admin/stop" `
  -Headers $Headers
```

With `AUTO_START` set to `true`, a manual stop lasts no more than one minute. For a persistent stop, change `AUTO_START` to `false`, deploy, and then call `/admin/stop`.

### Test a sender profile

Use the `lastSenderId` returned by `/admin/status`:

```powershell
Invoke-RestMethod `
  -Uri "$WorkerUrl/admin/profile?sender_id=$($Status.lastSenderId)" `
  -Headers $Headers
```

The response includes `name`, plus `iconUrl` and `avatarFileId` when a profile photo is available. Bark custom icons require iOS 15 or later.

## Updating

```powershell
git pull
npm test
npm run deploy
```

Cloudflare preserves the existing secrets during a normal code deployment.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, add test credentials, then run:

```powershell
npm run dev
```

`.dev.vars` is ignored by Git. Local Durable Object and outbound WebSocket behavior can differ from Cloudflare, so always perform a final deployed test.

## Troubleshooting

### `/admin/test` returns `Not found`

Remove the trailing slash from `$WorkerUrl`. A value ending in `/` produces `//admin/test` when the path is appended.

Correct:

```powershell
$WorkerUrl = "https://bale-notifications.YOUR-SUBDOMAIN.workers.dev"
```

### An admin endpoint returns `Unauthorized`

Confirm that `$AdminToken` is the exact value stored in the `ADMIN_TOKEN` Cloudflare secret, then rebuild `$Headers`:

```powershell
$Headers = @{ Authorization = "Bearer $AdminToken" }
```

### Bale WebSocket upgrade fails with HTTP 401 or 403

The Bale token is missing, expired, revoked, or copied incorrectly. Obtain a new `access_token`, run `npx wrangler@latest secret put BALE_TOKEN`, and restart the relay.

### `connected` becomes `False`

The Durable Object alarm and cron watchdog retry automatically with exponential backoff. Check `npm run logs`. Replace `BALE_TOKEN` if Bale no longer accepts it.

### Bark test works but Bale messages do not

- Confirm `/admin/status` shows `running: true` and `connected: true`.
- Check whether `NOTIFY_CHAT_TYPES` includes the conversation type.
- Inspect live logs with `npm run logs`.
- If Bale changed its private binary schema, `src/bale.ts` may need an update.

### Notifications appear for messages you send

Check `/admin/status`. `selfMessageFilterActive` should be `true`. If it is `false`, add your numeric Bale user ID as a `BALE_SELF_ID` Worker variable in `wrangler.jsonc`, then deploy again.

### Sender name works but the profile picture does not

Bale may hide the photo because of the sender's privacy settings. The relay falls back gracefully and Bark uses its default icon. Bark also requires iOS 15 or later for custom notification icons.

### Duplicate notifications

The relay persists the most recent 200 delivered-message keys. If Bale replays more than 200 updates after a long interruption, increase `SEEN_LIMIT` in `src/relay.ts`.

## Security notes

- Never expose or log `BALE_TOKEN`, `BARK_URL`, or `ADMIN_TOKEN`.
- Rotate any secret that appears in terminal history, logs, screenshots, or chat.
- Set `MESSAGE_PREVIEW` to `false` if Cloudflare and Bark should not receive message bodies.
- Bark's public service receives notification content; self-host Bark if you need control of that hop.
- The relay receives messages and performs read-only profile lookups. It never sends, edits, deletes, or marks Bale messages as read.

## Protocol notice

BaleNotifications uses Bale Web's undocumented personal-account protocol. It can stop working if Bale changes that protocol, and its use may conflict with Bale's terms. Test with a secondary account first.
