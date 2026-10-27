<p align="center">
  <img src="docs/favicon.svg" width="72" height="72" alt="WixNote logo" />
</p>

<h1 align="center">WixNote</h1>

<p align="center">Write quietly, think clearly — a self-hosted, single-container personal notes service</p>

<p align="center">
  <a href="https://ikiwihome.github.io/wixnote/"><strong>Website</strong></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A524.22.1-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/docker-compose-2496ed?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

![WixNote workspace](docs/screenshots/workspace-light.png)

WixNote (灵眸笔记) is a clean, private note-taking app: rich-text and outline editing, full-text search, version history and multi-format export, while your notes always stay on your own server.

It is built with React + Express + SQLite and ships as a **single container image**. No external database, Redis or search cluster is required; one `docker compose` command gets it running.

> The user interface is currently in Simplified Chinese.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/workspace-dark.png" alt="Dark mode" /></td>
    <td width="50%"><img src="docs/screenshots/login.png" alt="Sign-in screen" /></td>
  </tr>
  <tr>
    <td align="center">Dark mode</td>
    <td align="center">Sign-in screen</td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile-list.png" width="240" alt="Note list on a phone" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-note.png" width="240" alt="A note opened on a phone" />
</p>
<p align="center">Mobile</p>

## Features

**Writing and organizing**

- Rich-text and outline notes: headings, lists, to-do checklists, tables, code blocks, images and attachments, plus flowchart / UML diagrams.
- 5 built-in templates: blank, meeting minutes, daily journal, reading notes and project plan. Markdown files can be imported as new notes.
- Nested folders, tags and favorites; sort by modified time, created time or title; detailed or compact list view.

**Finding and going back**

- Full-text search across Chinese titles and body text, available any time with `Ctrl/⌘ + K`.
- Save with the save icon or `Ctrl/⌘ + S`. Unsaved drafts are kept in the current browser and survive a reload.
- Version history with restore, a trash bin, and conflict warnings when a note is edited in another window.

**Sharing and exporting**

- Read-only share links that can be revoked, and private comments on notes.
- Export to Word, PDF, HTML, Markdown and plain text.
- Full JSON backup with append-only restore.

**Experience and security**

- Light / dark / system theme, adjustable font size, focus mode and a single-column layout on phones.
- Data is isolated per account. Registration closes after the first account is created, and there is no default password.
- The container runs as a non-root user on a read-only root filesystem.

## Quick start

### Docker Compose (recommended)

Requires Docker Engine / Docker Desktop and Docker Compose v2.

```sh
git clone https://github.com/ikiwihome/wixnote.git
cd wixnote
docker compose up -d --build
```

Open <http://localhost:8080> and create the first account. There is no default password; passwords need at least 10 characters. Registration is closed by default once the first account exists.

```sh
docker compose ps
docker compose logs -f --tail=100
```

Notes, history, comments and attachments live in the named volume `wixnote-data`, so rebuilding the container does not lose data. The Compose file runs as a non-root user with a read-only root filesystem, `cap_drop: ALL`, a health check and the `unless-stopped` restart policy.

Stop the service with `docker compose down`; `docker compose down -v` also deletes the data volume.

### Plain Docker

```sh
docker build -t wixnote:local .
docker run -d --name wixnote --restart unless-stopped \
  -p 8080:3000 -v wixnote-data:/data wixnote:local
```

Inside the container the service always listens on `3000`, and the data directory is `/data`.

### First sign-in

1. Open the home page and register the first account with an email, a display name and a password of at least 10 characters.
2. After the first account is created, `ALLOW_REGISTRATION=false` takes effect; other users can register only after an administrator turns it on.
3. Folders, tags, notes and attachments are isolated between accounts.

## Configuration

Copy `.env.example` to `.env`, adjust it, then run `docker compose up -d --build`.

| Variable             | Default                     | Description                                                            |
| -------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `PORT`               | `8080`                      | Host port mapped by Compose (always `3000` inside the container)       |
| `HOST`               | `0.0.0.0`                   | Address the service listens on                                         |
| `DATA_DIR`           | `./data` (`/data` in image) | Directory for the SQLite database and attachments                      |
| `MAX_UPLOAD_MB`      | `100`                       | Size limit for one attachment and for extracted ZIP assets, 1–1024     |
| `ALLOW_REGISTRATION` | `false`                     | Whether more accounts can register after the first one                 |
| `SECURE_COOKIE`      | `false`                     | Set to `true` when served over HTTPS so the session cookie is `Secure` |
| `WIX_RESET_PASSWORD` | empty                       | Only used by the password reset script in non-interactive mode         |

To use a host directory instead, change the Compose volume mapping to `./data:/data`. On Linux the directory must be readable and writable by UID/GID `1000:1000`.

## Local development

Requires Node.js 24.22.1 or later and pnpm 12.3.4; Docker is not needed:

```sh
npm install --global pnpm@12.3.4
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev
```

- Frontend dev server: <http://localhost:5173> (Vite, proxies `/api` and `/files` to 3000)
- API / backend: <http://localhost:3000>
- The local database is written to `data/` by default

If port 3000 is already taken by a production preview, stop that process first.

Production mode:

```sh
pnpm run build
pnpm start
# http://localhost:3000
```

## Testing and verification

```sh
pnpm run lint                          # JavaScript / React, CSS and formatting checks
pnpm run lint:js                       # ESLint (including React Hooks rules)
pnpm run lint:css                      # Stylelint
pnpm run format                        # Apply formatting
pnpm test                              # Runs when tests/*.test.js exist
pnpm run build                         # Production build
curl http://localhost:3000/api/health  # Returns {"ok":true,...}
```

## Data and backups

### Data directory

```text
data/
├── wixnote.sqlite        # Accounts, sessions, folders, tags, notes, history, comments, attachment metadata
├── wixnote.sqlite-wal    # WAL file (present while running)
├── wixnote.sqlite-shm    # Shared-memory file (present while running)
├── attachments/          # Attachment binaries, named by attachment ID
└── .uploads/             # Temporary upload directory
```

Accounts and sessions are stored in the database too, so restoring the database also restores sign-in state.

### In-app JSON backup

Export JSON from "设置 → 数据管理" (Settings → Data). It contains folders, native editor blocks, tags, comments, history and attachments (embedded as base64). Import works in **append** mode: IDs are remapped and inserted without overwriting existing content.

Limits: attachments in one backup may total at most 100 MB, and the serialized JSON at most 150 MB. Beyond that, back up the data directory instead.

### Data directory backup (recommended for large data)

```sh
docker compose stop
docker compose cp wixnote:/data ./wixnote-data-backup
docker compose start
```

To restore, stop the service first, put the backup back into the volume or mounted directory, and make sure UID/GID `1000:1000` can write to it. The SQLite files and `attachments/` must be restored together from the same backup.

### Resetting a password

Run this from an admin terminal on the host and enter the new password when prompted (existing sessions are revoked):

```sh
docker compose exec wixnote node scripts/reset-password.js you@example.com
```

Outside a container:

```sh
DATA_DIR=./data node scripts/reset-password.js you@example.com

# Non-interactive (CI / containers):
WIX_RESET_PASSWORD='new-password-123' node scripts/reset-password.js you@example.com
```

The command only reads and writes the local database; it never sends email or contacts any official server.

## Deploying to the internet

Reverse-proxy to host port `8080` (or container port `3000`) and keep everything same-origin; no extra UDP ports are needed.

```nginx
server {
    listen 443 ssl;
    server_name notes.example.com;
    # Configure ssl_certificate / ssl_certificate_key for your own certificate

    client_max_body_size 160m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
```

Always set `SECURE_COOKIE=true` once HTTPS is enabled. Share links are generated from the address used in the browser; images are served inline and other attachments are forced to download.

`client_max_body_size` must cover JSON backup imports (up to 150 MB) and attachment uploads.

## Project structure

```text
.
├── src/                     # React frontend
│   ├── App.jsx              # Layout, lists, dialogs, keyboard shortcuts
│   ├── Editor.jsx           # Editor host, postMessage bridge to the iframe
│   ├── editor/              # Editor page adapter and bootstrap imported from wiz-editor/client
│   ├── api.js               # fetch wrapper and formatting helpers
│   ├── components.jsx       # Shared components and built-in templates
│   └── style.css
├── server/
│   ├── index.js             # Express app, all REST routes, security middleware
│   ├── db.js                # node:sqlite setup and schema migrations
│   ├── document.js          # Native editor block validation and asset path rewriting
│   └── zip.js               # ZIP reading and writing
├── public/
│   ├── editor/              # Isolated editor page, styles and license notices
│   └── assets/
├── scripts/
│   ├── dev.js               # Starts the backend and Vite together
│   ├── e2e-server.js        # Test server with a temporary data directory
│   └── reset-password.js
├── docs/                    # Project website (GitHub Pages) and screenshots
├── .github/workflows/       # Build, E2E and container smoke tests
├── compose.yaml
├── Dockerfile
└── playwright.config.js
```

## Contributing

1. Fork the repository and create a branch from `main`.
2. Keep the existing code style: `npx prettier --write .` (see `.prettierrc.json`).
3. Run at least `npm run build` before committing; for changes to the editor, uploads or backups, also do a manual regression pass.
4. Open a pull request describing the motivation, behavior changes and how you verified them.

## License

[MIT](LICENSE)
