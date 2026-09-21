# BaleNotifications

> Receive iPhone notifications for messages sent to your personal Bale account.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bark](https://img.shields.io/badge/Notifications-Bark-2EA44F)
![Runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-success)
[![Tests](https://github.com/b14ck4nge1/BaleNotifications/actions/workflows/test.yml/badge.svg)](https://github.com/b14ck4nge1/BaleNotifications/actions/workflows/test.yml)

BaleNotifications is a lightweight TypeScript relay that keeps a connection to Bale inside a Cloudflare Durable Object and forwards incoming messages to [Bark](https://github.com/Finb/Bark).

<p align="center"><strong>Bale → Cloudflare Durable Object → Bark → iPhone</strong></p>

## Notification experience

Each Bark notification is formatted to feel like a native messenger alert:

| Part | Content |
| --- | --- |
| Title | Sender's Bale display name |
| Body | Message text or attachment caption |
| Icon | Sender's Bale profile picture, when available |
| Group | One separate notification group per sender |

The `BaleNotifications` group namespace also keeps these alerts separate from notifications sent by your other Bark services.

## Highlights

- Runs entirely on Cloudflare Workers and Durable Objects
- Automatically starts after deployment and reconnects after interruptions
- Ignores messages sent by your own Bale account
- Groups all messages from the same sender together
- Filters private, group, channel, bot, and supergroup chats
- Suppresses duplicate message notifications
- Protects management endpoints with an admin token
- Uses no runtime npm dependencies

## Get started

See the **[deployment guide](DEPLOYMENT.md)** for the complete Windows PowerShell setup, Cloudflare secrets, testing steps, configuration, and troubleshooting.

Requirements: Node.js 22+, a Cloudflare account, the Bark iOS app, and access to Bale Web.

## Admin API

All `/admin/*` routes require `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/admin/start` | Start or reconnect the relay |
| `POST` | `/admin/stop` | Stop it temporarily |
| `POST` | `/admin/test` | Send a Bark test notification |
| `GET` | `/admin/status` | View connection and delivery status |
| `GET` | `/admin/profile?sender_id=123` | Test a Bale profile lookup |

## How it works

The Worker uses one Durable Object to own the Bale WebSocket, decode incoming message updates, resolve sender profiles, deduplicate messages, and deliver Bark pushes. A one-minute Cloudflare cron acts as a watchdog, while Durable Object alarms handle faster reconnect attempts.

The implementation is intentionally narrow: it receives message updates and performs read-only sender-profile lookups. It does not send, edit, delete, or mark messages as read in Bale, and it is not a general Bale SDK.

## License

See [LICENSE](LICENSE).
