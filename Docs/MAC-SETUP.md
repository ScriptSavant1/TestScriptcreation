# PerfX Studio — Mac Setup Guide
# Moving from Windows to Apple MacBook

---

## Overview

This guide covers everything needed to run the project on a new Mac — including
Node.js, the project itself, Claude Code CLI, and migrating Claude's memory so
it retains full project context from day one.

---

## Step 1 — Install Xcode Command Line Tools

Open **Terminal** (Spotlight → `Cmd+Space` → type Terminal → Enter).

```bash
xcode-select --install
```

A popup appears — click **Install**. Takes ~5 minutes.  
This is required to compile native modules like `better-sqlite3`.

---

## Step 2 — Install Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts. At the end, the installer prints a **"Next steps"** block with
two `echo` and `eval` commands — run those exactly as shown. They add Homebrew to
your PATH permanently.

Verify:
```bash
brew --version
```

---

## Step 3 — Install Node.js via nvm

`nvm` (Node Version Manager) handles Node cleanly and avoids permission issues.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

**Close Terminal completely, then reopen it**, then:

```bash
nvm install 20
nvm use 20
nvm alias default 20
node -v     # should print v20.x.x
npm -v      # should print 10.x.x
```

---

## Step 4 — Clone the Repository

```bash
mkdir -p ~/Workspace
cd ~/Workspace
git clone https://github.com/ScriptSavant1/TestScriptcreation.git bruno-devweb-converter
cd bruno-devweb-converter
```

Switch to the working branch:

```bash
git checkout best_Practices
git status
# Expected: "On branch best_Practices, nothing to commit"
```

---

## Step 5 — Install Dependencies

```bash
npm install
```

This compiles `better-sqlite3` natively for your Mac. On Apple Silicon (M1/M2/M3)
this takes 1–2 minutes — C++ compiler output is normal.

Verify the native module loaded correctly:

```bash
node -e "require('better-sqlite3'); console.log('ok')"
```

If it prints `ok` — all good.  
If it throws an error — run `npm rebuild better-sqlite3` then retry.

---

## Step 6 — Create the `.env` File

The `.env` file is excluded from git (`.gitignore`) — it must be created manually
on every machine.

```bash
cat > ~/Workspace/bruno-devweb-converter/.env << 'EOF'
# PerfX Studio — local environment config
ADMIN_TOKEN=admin123

# Optional overrides (uncomment to use):
# PORT=3000
# MAX_CONCURRENT_CONVERSIONS=8
# ANALYTICS_RETENTION_DAYS=730
# ANALYTICS_DB_PATH=./data/analytics.db
EOF
```

> **Note:** The `ADMIN_TOKEN` in `.env` is loaded automatically on `npm run web`
> — no need to `export` it manually in the terminal (unlike the PowerShell
> `$env:ADMIN_TOKEN=` step that was needed on Windows before `.env` existed).

---

## Step 7 — Start the Server

```bash
cd ~/Workspace/bruno-devweb-converter
npm run web
```

Expected output:
```
◇ injected env (1) from .env
🌐  PerfX Studio  →  http://localhost:3000/converter
```

Open in browser:
- App → `http://localhost:3000/converter`
- Admin → `http://localhost:3000/admin?token=admin123`

Press `Ctrl+C` to stop.

---

## Step 8 — Run the Test Suite

```bash
npm test
```

Expected: **165 tests passing** across 5 suites. If all green, the setup matches
Windows exactly.

---

## Step 9 — Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

Verify:
```bash
claude --version
```

Authenticate (opens a browser tab):
```bash
claude
```

Follow the login flow. Once authenticated, `claude` works from any folder.

---

## Step 10 — Migrate Claude Memory (Critical — Do This Before First Session)

Claude's memory gives it full project context — architecture, rules, bug history,
session state. Without it, Claude starts from scratch. Follow these steps exactly.

### What memory files exist

On Windows, the memory lives at:
```
C:\Users\karrir\.claude\projects\c--Workspace-bruno-devweb-converter\memory\
```

Files to migrate:
```
MEMORY.md                    ← index file (loaded every session)
state.md                     ← current feature status (read first every session)
architecture.md              ← server.js route map, helpers, upload lifecycle
vugen-rules.md               ← VuGen extractor rules, per-request helpers
lre-utils-dat.md             ← lre-utils.dat AV bypass details
portal-ui.md                 ← portal navigation, design tokens
jmx-converter.md             ← JMX parser details
improvement-plan.md          ← phased improvement plan
analyzers-audit.md           ← analyzer audit notes
feedback_memory_strategy.md  ← feedback and collaboration preferences
```

### Where memory lives on Mac

Claude derives the memory folder name from the **absolute project path**.

| Machine | Project path | Memory folder name |
|---------|-------------|-------------------|
| Windows | `C:\Workspace\bruno-devweb-converter` | `c--Workspace-bruno-devweb-converter` |
| Mac | `/Users/<yourname>/Workspace/bruno-devweb-converter` | `-Users-<yourname>-Workspace-bruno-devweb-converter` |

Replace `<yourname>` with your Mac login username (run `whoami` in Terminal to confirm).

### Migration steps

**On your Windows machine:**

1. Open File Explorer
2. Navigate to `C:\Users\karrir\.claude\projects\c--Workspace-bruno-devweb-converter\`
3. Right-click the `memory` folder → **Send to → Compressed (zipped) folder**
4. Transfer `memory.zip` to your Mac via AirDrop, USB, or Google Drive

**On your Mac:**

```bash
# Replace <yourname> with your Mac username (run: whoami)
PROJ="-Users-<yourname>-Workspace-bruno-devweb-converter"

# Create the memory directory
mkdir -p ~/.claude/projects/$PROJ/memory

# Unzip into it (adjust the path to where you saved the zip)
unzip ~/Downloads/memory.zip -d ~/.claude/projects/$PROJ/memory

# Verify all files are there
ls ~/.claude/projects/$PROJ/memory
```

Expected output:
```
MEMORY.md
analyzers-audit.md
architecture.md
feedback_memory_strategy.md
improvement-plan.md
jmx-converter.md
lre-utils-dat.md
portal-ui.md
state.md
vugen-rules.md
```

### Also migrate Claude's global settings (optional but recommended)

Global settings store your preferences, keybindings, and allowed permissions.

On Windows, copy from: `C:\Users\karrir\.claude\settings.json`
On Mac, place at: `~/.claude/settings.json`

Transfer via the same zip/AirDrop approach.

---

## Step 11 — First Claude Session on Mac

Open Terminal in the project folder and launch Claude:

```bash
cd ~/Workspace/bruno-devweb-converter
claude
```

Claude will read `MEMORY.md` automatically and load full project context.
At the start of each session it follows the Session Startup Protocol from `CLAUDE.md`:
1. Reads `~/.claude/projects/.../memory/state.md` → current feature status
2. Reads `Docs/BUGS.md` → active bugs
3. Proceeds with your task

---

## Daily Use — Quick Reference

| Task | Command |
|------|---------|
| Start server | `cd ~/Workspace/bruno-devweb-converter && npm run web` |
| Run tests | `npm test` |
| Syntax check a file | `node --check src/web/public/studio-app.js` |
| Open app | `http://localhost:3000/converter` |
| Open admin | `http://localhost:3000/admin?token=admin123` |
| Launch Claude | `cd ~/Workspace/bruno-devweb-converter && claude` |
| Check git branch | `git branch` |
| Pull latest changes | `git pull origin best_Practices` |

---

## Mac vs Windows — Key Differences

| Thing | Windows | Mac |
|-------|---------|-----|
| Terminal | PowerShell | Terminal (zsh) |
| Set env var | `$env:VAR="value"` | `export VAR="value"` |
| Path separator | `\` | `/` |
| Env var (permanent) | `setx VAR value` | Add `export VAR=value` to `~/.zshenv` |
| Package manager | — | Homebrew (`brew`) |
| Node path | Installed via installer | `~/.nvm/versions/node/...` |
| `.env` file | Works identically | Works identically |

> **The `.env` file approach means most env var differences don't apply to this
> project** — `ADMIN_TOKEN` and all config values load automatically.

---

## Troubleshooting

**`better-sqlite3` fails to load:**
```bash
npm rebuild better-sqlite3
```

**`nvm: command not found` after install:**
```bash
source ~/.nvm/nvm.sh
# Then add this line to ~/.zshrc so it loads permanently
echo 'source ~/.nvm/nvm.sh' >> ~/.zshrc
```

**Port 3000 already in use:**
```bash
lsof -i :3000          # find what's using it
kill -9 <PID>          # kill that process
```

**Claude memory folder name — how to find it exactly:**
```bash
ls ~/.claude/projects/
# Look for the folder that matches your project path
```

**`git clone` asks for password:**
Use a GitHub Personal Access Token instead of your password.
Generate one at: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
Use the token as the password when prompted.
