# Publishing, Drive & notifications

All optional. The app renders fine without any of this. When you do want to ship a video,
you can upload it to Google Drive and/or publish it straight to Instagram and TikTok with
**free native APIs** — no paid schedulers.

The caption for social posts is built from the script's `titulo` + `descripcion`
(front-matter). The same text is written next to each render as `outputs/<name>.txt`.

---

## Instagram Reels (Graph API)

Instagram publishing is **fully automatic**: the app hosts the mp4 on a temporary public
URL (litterbox, auto-expiring), tells the Graph API to fetch it, waits for processing, and
publishes the Reel.

### What you need (one-time)

1. An **Instagram Business or Creator** account, linked to a **Facebook Page**.
2. A **Meta app** ([developers.facebook.com](https://developers.facebook.com)). In
   *development mode* it can publish to **your own** account with no App Review.
3. A **long-lived access token** with the `instagram_content_publish` permission.
4. Your **Instagram Business account ID** (the `ig-user-id`).

### Configure it

Copy the template and fill it in (this file is **gitignored** — never commit tokens):

```bash
cp social.config.example.json social.config.json
```

```json
{
  "ig": { "token": "LONG_LIVED_TOKEN", "userId": "IG_BUSINESS_ACCOUNT_ID" },
  "tiktok": { "token": "" }
}
```

You can also fill these from the UI: **Settings → Publicar**. Tokens are stored server-side
and never sent back to the browser.

Set the Graph version with `IG_GRAPH_VERSION` in `.env` (default `v21.0`).

---

## TikTok (Content Posting API)

TikTok uploads the video to your account's **inbox / drafts**. You open the TikTok app and
tap **Post** (adding/confirming the caption). This "inbox upload" mode does **not** require
TikTok's audit, so it works from day one.

### What you need (one-time)

1. A **TikTok for Developers** app ([developers.tiktok.com](https://developers.tiktok.com)).
2. An **OAuth access token** with the `video.upload` scope.

Put the token in `social.config.json` under `tiktok.token` (or via **Settings → Publicar**).

> Renders here fit in a single upload chunk (≤ 64 MB), so the whole file is sent at once.

---

## Publishing a video

- **From the UI:** open a finished output and use **Publicar**, choosing the networks. The
  default selection is `SOCIAL_DEFAULT` in `.env`.
- Each network reports its own result; one failing doesn't block the other. TikTok returns a
  "sent to your drafts — tap Post" note; Instagram returns the published Reel id.

---

## Google Drive

Uploads finished mp4s (and their caption `.txt`) to Drive via [`rclone`](https://rclone.org),
which handles Drive's OAuth and refreshes the token itself — no browser after the first setup.

### Setup (one-time)

```bash
brew install rclone       # if you don't have it
rclone config             # create a remote of type "drive" (authorize in the browser)
```

Point the app at it in `.env`:

```ini
DRIVE_REMOTE=drive              # the rclone remote name you chose
DRIVE_FOLDER=ContentCreator     # destination folder inside that Drive
DRIVE_AUTO=0                    # 1 = upload automatically after every render
```

### Use it

```bash
pnpm subir                      # upload all outputs/*.mp4
pnpm subir 001_demo             # just that one (with or without .mp4)
```

Or set `DRIVE_AUTO=1` to upload automatically when a render finishes.

---

## Email (optional)

Two independent features, both using `mail.config.json` (copy `mail.config.example.json`):

- **Inbox (read-only IMAP):** skim newsletters inside the app to gather content ideas. It
  never sends or deletes anything.
- **Notifications (SMTP):** `pnpm avisar <script>` uploads the video + caption to Drive,
  grabs shareable links, and emails you (or a recipient) the description and links.

```bash
pnpm avisar 001_demo                 # email yourself
pnpm avisar 001_demo you@example.com # email someone else
```

`mail.config.json` holds credentials **in cleartext**, so it's gitignored. **Use an app
password** (Gmail/Outlook/…), never your main password. The SMTP host is derived from the
IMAP host (`imap.` → `smtp.`); override with `SMTP_HOST` / `SMTP_PORT` in `.env` if your
provider differs.
