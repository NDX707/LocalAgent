import express from "express";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

type ChatMessage = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type ChatRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

const app = express();
const port = Number(process.env.PORT ?? 3002);
const modelBaseUrl = (process.env.MODEL_BASE_URL ?? "http://127.0.0.1:8080/v1").replace(/\/+$/, "");
const dataDirectory = path.resolve(process.env.APP_DATA_DIR ?? path.join(process.cwd(), ".local-agent"));
const chatsFile = path.join(dataDirectory, "chats.json");
let workspaceRoot = path.resolve(process.env.WORKSPACE_DIR ?? process.cwd());
let modelProcess: ChildProcess | null = null;
let modelLaunchError = "";
let modelServerOutput = "";
const maxToolFileBytes = 1_000_000;
const terminalActions: Record<string, string> = {
  git_status: "git status --short",
  git_diff_summary: "git diff --stat",
  npm_test: "npm test",
  npm_build: "npm run build",
};
const maxTerminalOutputChars = 24_000;
const terminalTimeoutMs = 30_000;

app.use(express.json({ limit: "2mb" }));

function isWithinRoot(target: string): boolean {
  const relative = path.relative(workspaceRoot, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function safeWorkspacePath(input: unknown, allowMissing = false): Promise<string> {
  if (typeof input !== "string" || input.trim() === "" || path.isAbsolute(input)) {
    throw new Error("Provide a non-empty path relative to the workspace.");
  }
  const target = path.resolve(workspaceRoot, input);
  if (!isWithinRoot(target)) throw new Error("That path is outside the configured workspace.");
  if (target === workspaceRoot) return target;

  const parent = path.dirname(target);
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    realParent = workspaceRoot;
    for (const segment of path.relative(workspaceRoot, parent).split(path.sep).filter(Boolean)) {
      const next = path.join(realParent, segment);
      try {
        await fs.mkdir(next);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
      const resolvedNext = await fs.realpath(next);
      if (!isWithinRoot(resolvedNext) || !(await fs.stat(resolvedNext)).isDirectory()) {
        throw new Error("That path resolves outside the configured workspace or is not a folder.");
      }
      realParent = resolvedNext;
    }
  }
  if (!isWithinRoot(realParent)) throw new Error("That path resolves outside the configured workspace.");

  try {
    const realTarget = await fs.realpath(target);
    if (!isWithinRoot(realTarget)) throw new Error("That path resolves outside the configured workspace.");
    return realTarget;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return target;
    throw error;
  }
}

async function readChats(): Promise<ChatRecord[]> {
  try {
    const data = await fs.readFile(chatsFile, "utf8");
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) ? (parsed as ChatRecord[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeChats(chats: ChatRecord[]): Promise<void> {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporary = `${chatsFile}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(chats, null, 2), "utf8");
  await fs.rename(temporary, chatsFile);
}

function sendError(response: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "An unexpected server error occurred.";
  response.status(400).json({ error: message });
}

function runTerminalAction(action: string): Promise<{ command: string; exitCode: number | null; timedOut: boolean; truncated: boolean; output: string }> {
  const command = terminalActions[action];
  if (!command) throw new Error("That terminal action is not available.");

  const isWindows = process.platform === "win32";
  const executable = isWindows ? "powershell.exe" : "/bin/bash";
  const args = isWindows
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `${command}; exit $LASTEXITCODE`]
    : ["--noprofile", "--norc", "-c", command];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const appendOutput = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      const available = maxTerminalOutputChars - output.length;
      if (available > 0) output += text.slice(0, available);
      if (text.length > available) truncated = true;
    };

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start the system terminal: ${error.message}`));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command, exitCode: timedOut ? null : code, timedOut, truncated, output });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, terminalTimeoutMs);
  });
}

app.get("/api/status", async (_request, response) => {
  try {
    const result = await fetch(`${modelBaseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!result.ok) {
      response.json({ connected: false, model: null, detail: `Model server returned HTTP ${result.status}.` });
      return;
    }
    const payload = (await result.json()) as { data?: Array<{ id?: string }> };
    response.json({
      connected: true,
      model: payload.data?.[0]?.id ?? "Local model",
      detail: "Connected to your local model server.",
    });
  } catch {
    response.json({
      connected: false,
      model: null,
      detail: "Model server not found. Start llama.cpp and try again.",
    });
  }
});

app.get("/api/model/launcher", (_request, response) => {
  const apiUrl = new URL(modelBaseUrl);
  const isLocal = apiUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(apiUrl.hostname);
  response.json({
    running: modelProcess !== null && modelProcess.exitCode === null && modelProcess.signalCode === null,
    launchable: isLocal,
    port: apiUrl.port || (apiUrl.protocol === "https:" ? "443" : "80"),
    error: modelLaunchError,
  });
});

app.post("/api/model/start", async (request, response) => {
  try {
    const { executable, model } = request.body as { executable?: unknown; model?: unknown };
    if (typeof executable !== "string" || typeof model !== "string" || !path.isAbsolute(executable) || !path.isAbsolute(model)) {
      response.status(400).json({ error: "Select the full paths to llama-server and your GGUF model." });
      return;
    }

    const executablePath = await fs.realpath(executable);
    const modelPath = await fs.realpath(model);
    const [executableInfo, modelInfo] = await Promise.all([fs.stat(executablePath), fs.stat(modelPath)]);
    const executableName = path.basename(executablePath).toLowerCase();
    if (!executableInfo.isFile() || !/^llama-server(?:\.exe)?$/.test(executableName)) {
      response.status(400).json({ error: "Choose the llama-server executable (llama-server or llama-server.exe)." });
      return;
    }
    if (!modelInfo.isFile() || path.extname(modelPath).toLowerCase() !== ".gguf") {
      response.status(400).json({ error: "Choose a .gguf model file." });
      return;
    }

    const apiUrl = new URL(modelBaseUrl);
    if (apiUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(apiUrl.hostname)) {
      response.status(400).json({ error: "Automatic launch is available only for a local model URL." });
      return;
    }
    const port = apiUrl.port || "80";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      response.status(400).json({ error: "The configured local model URL has an invalid port." });
      return;
    }
    if (modelProcess && modelProcess.exitCode === null && modelProcess.signalCode === null) {
      response.status(409).json({ error: "A model server launched by this app is already running." });
      return;
    }

    modelLaunchError = "";
    modelServerOutput = "";
    const child = spawn(executablePath, ["-m", modelPath, "--host", "127.0.0.1", "--port", port, "--jinja"], {
      cwd: path.dirname(executablePath),
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    modelProcess = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      modelServerOutput = (modelServerOutput + chunk.toString("utf8")).slice(-3000);
    });
    child.once("error", (error) => {
      modelLaunchError = `Could not launch llama-server: ${error.message}`;
      if (modelProcess === child) modelProcess = null;
    });
    child.once("exit", (code, signal) => {
      if (modelProcess === child) modelProcess = null;
      if (code !== 0 && code !== null) {
        const details = modelServerOutput.trim();
        modelLaunchError = `llama-server exited with code ${code}.${details ? ` Details: ${details}` : " Check the executable, model, and port."}`;
      }
      else if (signal) modelLaunchError = `llama-server stopped (${signal}).`;
    });
    response.status(202).json({ started: true, port });
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/model/stop", (_request, response) => {
  if (!modelProcess || modelProcess.exitCode !== null || modelProcess.signalCode !== null) {
    response.status(409).json({ error: "No model server launched by this app is running." });
    return;
  }
  modelProcess.kill();
  response.json({ stopped: true });
});

app.get("/api/workspace", (_request, response) => {
  response.json({ root: workspaceRoot });
});

app.get("/api/chats", async (_request, response) => {
  try {
    const chats = await readChats();
    response.json(chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/chats", async (request, response) => {
  try {
    const now = new Date().toISOString();
    const chat: ChatRecord = {
      id: randomUUID(),
      title: typeof request.body?.title === "string" ? request.body.title : "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const chats = await readChats();
    chats.push(chat);
    await writeChats(chats);
    response.status(201).json(chat);
  } catch (error) {
    sendError(response, error);
  }
});

app.put("/api/chats/:id", async (request, response) => {
  try {
    const { title, messages } = request.body as { title?: unknown; messages?: unknown };
    if (typeof title !== "string" || !Array.isArray(messages)) {
      response.status(400).json({ error: "A chat title and messages array are required." });
      return;
    }
    const chats = await readChats();
    const index = chats.findIndex((chat) => chat.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ error: "Chat not found." });
      return;
    }
    chats[index] = {
      ...chats[index],
      title: title.slice(0, 100),
      messages: messages as ChatMessage[],
      updatedAt: new Date().toISOString(),
    };
    await writeChats(chats);
    response.json(chats[index]);
  } catch (error) {
    sendError(response, error);
  }
});

app.delete("/api/chats/:id", async (request, response) => {
  try {
    const chats = await readChats();
    const remaining = chats.filter((chat) => chat.id !== request.params.id);
    if (remaining.length === chats.length) {
      response.status(404).json({ error: "Chat not found." });
      return;
    }
    await writeChats(remaining);
    response.status(204).end();
  } catch (error) {
    sendError(response, error);
  }
});

app.post("/api/complete", async (request, response) => {
  try {
    const { messages, tools, model } = request.body as {
      messages?: unknown;
      tools?: unknown;
      model?: unknown;
    };
    if (!Array.isArray(messages)) {
      response.status(400).json({ error: "A messages array is required." });
      return;
    }
    const upstream = await fetch(`${modelBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: typeof model === "string" ? model : "local-model",
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.7,
      }),
    });
    const payload = (await upstream.json()) as { choices?: Array<{ message?: ChatMessage }>; error?: { message?: string } };
    if (!upstream.ok) {
      response.status(upstream.status).json({ error: payload.error?.message ?? `Model server returned HTTP ${upstream.status}.` });
      return;
    }
    const message = payload.choices?.[0]?.message;
    if (!message) {
      response.status(502).json({ error: "The model server returned no assistant message." });
      return;
    }
    response.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the local model server.";
    response.status(502).json({ error: `Model request failed: ${message}` });
  }
});

app.post("/api/tools/execute", async (request, response) => {
  try {
    const { name, arguments: rawArguments } = request.body as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string" || typeof rawArguments !== "string") {
      response.status(400).json({ error: "A tool name and JSON arguments are required." });
      return;
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      response.status(400).json({ error: "The model supplied invalid tool arguments." });
      return;
    }

    let result: unknown;
    switch (name) {
      case "list_files": {
        const directory = await safeWorkspacePath(args.path ?? ".");
        const entries = await fs.readdir(directory, { withFileTypes: true });
        result = entries
          .filter((entry) => !entry.name.startsWith(".git"))
          .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
        break;
      }
      case "read_file": {
        const file = await safeWorkspacePath(args.path);
        const info = await fs.stat(file);
        if (!info.isFile()) throw new Error("The requested path is not a file.");
        if (info.size > maxToolFileBytes) throw new Error("That file is over the 1 MB read limit.");
        result = await fs.readFile(file, "utf8");
        break;
      }
      case "write_file": {
        if (typeof args.content !== "string") throw new Error("File content must be text.");
        const file = await safeWorkspacePath(args.path, true);
        await fs.writeFile(file, args.content, { encoding: "utf8", flag: "w" });
        result = { success: true, path: path.relative(workspaceRoot, file), bytes: Buffer.byteLength(args.content) };
        break;
      }
      case "create_file": {
        if (typeof args.content !== "string") throw new Error("File content must be text.");
        const file = await safeWorkspacePath(args.path, true);
        await fs.writeFile(file, args.content, { encoding: "utf8", flag: "wx" });
        result = { success: true, path: path.relative(workspaceRoot, file), bytes: Buffer.byteLength(args.content) };
        break;
      }
      case "make_directory": {
        const directory = await safeWorkspacePath(args.path, true);
        await fs.mkdir(directory);
        result = { success: true, path: path.relative(workspaceRoot, directory) };
        break;
      }
      case "append_file": {
        if (typeof args.content !== "string") throw new Error("File content must be text.");
        const file = await safeWorkspacePath(args.path);
        await fs.appendFile(file, args.content, "utf8");
        result = { success: true, path: path.relative(workspaceRoot, file), appendedBytes: Buffer.byteLength(args.content) };
        break;
      }
      case "search_files": {
        if (typeof args.query !== "string" || args.query.length === 0) throw new Error("A non-empty search query is required.");
        const start = await safeWorkspacePath(args.path ?? ".");
        const matches: Array<{ path: string; line: number; text: string }> = [];
        async function visit(directory: string): Promise<void> {
          if (matches.length >= 100) return;
          const entries = await fs.readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            if (matches.length >= 100) break;
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) await visit(fullPath);
            else if (entry.isFile()) {
              const info = await fs.stat(fullPath);
              if (info.size > maxToolFileBytes) continue;
              const contents = await fs.readFile(fullPath, "utf8");
              contents.split(/\r?\n/).forEach((line, index) => {
                if (matches.length < 100 && line.toLowerCase().includes(args.query!.toString().toLowerCase())) {
                  matches.push({ path: path.relative(workspaceRoot, fullPath), line: index + 1, text: line.slice(0, 300) });
                }
              });
            }
          }
        }
        await visit(start);
        result = { matches, truncated: matches.length >= 100 };
        break;
      }
      case "run_terminal_command": {
        if (typeof args.action !== "string") throw new Error("Choose an approved terminal action.");
        result = await runTerminalAction(args.action);
        break;
      }
      default:
        throw new Error("That tool is not available.");
    }
    response.json({ result });
  } catch (error) {
    sendError(response, error);
  }
});

const staticDirectory = path.resolve(process.cwd(), "dist-web");
app.use(express.static(staticDirectory));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(staticDirectory, "index.html")));

async function startServer(): Promise<void> {
  workspaceRoot = await fs.realpath(workspaceRoot);
  app.listen(port, "127.0.0.1", () => {
    console.log(`Local Agent Studio server listening at http://127.0.0.1:${port}`);
    console.log(`Workspace tools are scoped to: ${workspaceRoot}`);
  });
}

function stopManagedModel(): void {
  if (modelProcess && modelProcess.exitCode === null && modelProcess.signalCode === null) {
    modelProcess.kill();
  }
}

process.on("SIGINT", () => {
  stopManagedModel();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopManagedModel();
  process.exit(0);
});

void startServer().catch((error: unknown) => {
  console.error("Could not start Local Agent Studio:", error);
  process.exitCode = 1;
});
