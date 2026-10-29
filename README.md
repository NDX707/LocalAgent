# Local Agent Studio

A private chat and file-agent interface for GGUF models running on your own computer. It does not use a paid API or send chat content to a cloud model. The model server and this app run locally.

This project is cross-platform. The app itself works on Windows, macOS, and Linux. The only part that changes between operating systems is the exact terminal command you use to launch llama.cpp and set environment variables.

## What it can do

- Keep and search a history of conversations on this computer.
- Connect to a local llama.cpp server and chat with its currently loaded model.
- List files, read text files, search text, create files and folders, replace file contents, and append text.
- Ask for permission before a tool creates or changes a file.
- Limit all file tools to one configured workspace folder.
- Render assistant replies with Markdown and code blocks.
- Start and stop llama.cpp from the setup panel after selecting its executable and a GGUF model.

The local model needs to support chat and tool/function calling. A model that does not understand tool calls can still chat, but may not use the file tools reliably.

## Quick start summary

1. Install Node.js LTS.
2. Download llama.cpp and a GGUF instruct/chat model.
3. Start the llama.cpp server locally.
4. Start this app with `npm install` and `npm run dev`.
5. Open `http://localhost:5173`.

Use the OS-specific steps below for the exact launch commands.

## Windows (PowerShell)

### 1. Install Node.js

Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/). After setup, open a new PowerShell window and check:

```powershell
node --version
npm --version
```

### 2. Download llama.cpp

1. Open the [official llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases).
2. Download a Windows build that matches your system. The CPU build works without a supported graphics card; a compatible GPU build can be faster.
3. Extract the ZIP to a folder you can find again, for example `C:\llama.cpp`.

### 3. Download a GGUF chat model

Choose a GGUF instruct/chat model from a source you trust. For a first local model, 3B–8B parameters with a `Q4_K_M` quantization is a reasonable starting point. The model must fit in your available RAM or GPU memory; larger models generally need more memory. Review the model’s licence and download the `.gguf` file.

Keep the model somewhere permanent, for example `C:\AI\models\my-model.gguf`.

### 4. Start the model server

You can start the model from the app's **Getting started** panel: enter the full path to `llama-server.exe` and your `.gguf` file, then choose **Start local model**. The app starts the local server with fixed arguments and keeps it available until you stop it or close the app server.

Or, open PowerShell in the folder containing `llama-server.exe` and run:

```powershell
.\llama-server.exe -m "C:\AI\models\my-model.gguf" --port 8080 --jinja
```

This app expects the OpenAI-compatible API at `http://127.0.0.1:8080/v1`. Keep that window open while you use the app.

### 5. Start this app

Open a second PowerShell window, move into this project folder, install dependencies, and start the app:

```powershell
cd "C:\path\to\Co-pilot"
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

Optional helper script:

```powershell
cd "C:\path\to\Co-pilot"
.\scripts\start-local-agent.ps1
```

## macOS

### 1. Install Node.js

Install Node.js LTS with Homebrew or from [nodejs.org](https://nodejs.org/):

```bash
node --version
npm --version
```

### 2. Download llama.cpp

1. Download the official llama.cpp source or release for macOS from GitHub.
2. Build it or use the prebuilt binary if available for your system.
3. Put it somewhere stable, for example `~/llama.cpp`.

### 3. Download a GGUF chat model

Download a GGUF instruct/chat model that you are allowed to use. Place it somewhere easy to access, for example `~/Downloads/my-model.gguf`.

### 4. Start the model server

Open Terminal in the llama.cpp folder and run:

```bash
./llama-server -m "~/Downloads/my-model.gguf" --port 8080 --jinja
```

If your llama.cpp build puts the binary elsewhere, use that full path instead.

### 5. Start this app

Open a second Terminal window and run:

```bash
cd /path/to/Co-pilot
npm install
npm run dev
```

Or use the helper script:

```bash
cd /path/to/Co-pilot
chmod +x ./scripts/start-local-agent.sh
./scripts/start-local-agent.sh
```

Then open `http://localhost:5173`. The Getting started panel contains a saved first-run checklist and OS-specific instructions.

## Linux

### 1. Install Node.js

Use your distro package manager or install Node.js from [nodejs.org](https://nodejs.org/):

```bash
node --version
npm --version
```

### 2. Download llama.cpp

1. Download the official llama.cpp repo or release package.
2. Build it in the checked-out folder (for example `~/llama.cpp`):

```bash
git clone https://github.com/ggml-org/llama.cpp.git ~/llama.cpp
cd ~/llama.cpp
make
```

3. Confirm the server binary exists, such as `./llama-server` in the build folder.

### 3. Download a GGUF chat model

Choose a GGUF instruct/chat model and keep it in a stable location, for example `~/models/my-model.gguf`.

### 4. Start the model server

```bash
cd ~/llama.cpp
./llama-server -m "/home/you/models/my-model.gguf" --port 8080 --jinja
```

### 5. Start this app

```bash
cd /path/to/Co-pilot
npm install
npm run dev
```

Or use the helper script:

```bash
cd /path/to/Co-pilot
chmod +x ./scripts/start-local-agent.sh
./scripts/start-local-agent.sh
```

Then open `http://localhost:5173`.

## Choose which folder the agent can access

By default, the workspace is the folder from which you run `npm run dev`—usually this app’s folder. For a safer and more useful setup, point it at the project you want the agent to work on.

### PowerShell

```powershell
cd "C:\path\to\Co-pilot"
$env:WORKSPACE_DIR = "C:\Users\you\Documents\my-project"
npm run dev
```

### macOS / Linux

```bash
cd /path/to/Co-pilot
export WORKSPACE_DIR="/Users/you/Documents/my-project"
npm run dev
```

The workspace shown in the lower-left of the app confirms the selected folder. The agent cannot access files outside this workspace through its tools.

## Using the agent

1. Type a request, or choose a suggested prompt on the welcome screen.
2. Ask it to inspect a project, read a file, or search for text. Read-only tools run when needed.
3. Before any create, replace, append, or folder-creation action, inspect the preview and choose **Allow change** or **No, cancel**.
4. Start another conversation with **New chat** or `Ctrl+K`. Use the search field or `Ctrl+F` to find an earlier conversation.
5. To remove a conversation, point at it in the sidebar and choose the trash icon.

The agent may make mistakes. Review the proposed path and contents before allowing a change, and keep normal backups or use version control for important files. There is intentionally no delete-file tool.

## Common questions

### “Model not connected”

- Confirm the llama.cpp window is still running and says it is listening on port `8080`.
- Check that the model file loaded successfully; the llama.cpp window displays startup errors.
- Make sure another application is not already using port `8080`.
- If you changed the server port, set `MODEL_BASE_URL` before starting the app:

### PowerShell

```powershell
$env:MODEL_BASE_URL = "http://127.0.0.1:8081/v1"
npm run dev
```

### macOS / Linux

```bash
export MODEL_BASE_URL="http://127.0.0.1:8081/v1"
npm run dev
```

### It answers but never uses tools

Use an instruct model that supports function/tool calling and has a llama.cpp-compatible chat template. Keep `--jinja` enabled. Tool use is a model capability and cannot be guaranteed for every GGUF.

### The model is very slow or runs out of memory

Try a smaller model or a more compressed quantization, close other memory-heavy apps, or use a compatible GPU build of llama.cpp. Model size, context length, quantization, and available memory all affect performance.

### Where is chat history saved?

Chats are stored as JSON in `.local-agent/chats.json` (or `.local-agent\chats.json` on Windows) in the folder where you start the app. Keep this folder private; it contains your prompts and replies. Removing a chat in the UI deletes that conversation from this local history.

### Can I use this without internet?

The app and model run locally and the interface uses system fonts, so normal chat and file tools work offline after dependencies and model files have been downloaded. Internet access is needed for the initial Node.js, llama.cpp, model, and npm dependency downloads.

## Configuration

Set these optional environment variables before `npm run dev`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKSPACE_DIR` | Current directory | Root folder available to file tools |
| `MODEL_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible local model API |
| `APP_DATA_DIR` | `.local-agent` under current directory | Local conversation history storage |
| `PORT` | `3002` | Local app API port |

### PowerShell example

```powershell
$env:WORKSPACE_DIR = "C:\Users\you\Documents\my-project"
$env:MODEL_BASE_URL = "http://127.0.0.1:8080/v1"
npm run dev
```

### Bash example

```bash
export WORKSPACE_DIR="/Users/you/Documents/my-project"
export MODEL_BASE_URL="http://127.0.0.1:8080/v1"
npm run dev
```

The app server listens on `127.0.0.1` and is intended for use on your own computer, not as a public or network-hosted service.

The in-app **Start local model** action is supported when `MODEL_BASE_URL` points to a loopback address (`localhost`, `127.0.0.1`, or `::1`). It launches only the selected `llama-server` executable, passes the selected `.gguf` file as an argument without invoking a shell, and uses the port configured in `MODEL_BASE_URL`. If you connect to a model server on another computer, start that server separately.

## Build for production

### macOS / Linux

```bash
npm run build
npm start
```

### Windows

```powershell
npm run build
npm start
```

Then open `http://localhost:3002`. The llama.cpp server must still be running separately.
