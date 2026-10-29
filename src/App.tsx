import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  FileCode2,
  FolderOpen,
  LoaderCircle,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { agentTools, type ToolCall } from "./tools";

type Message = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

type Chat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

type Connection = { connected: boolean; model: string | null; detail: string };
type Approval = { call: ToolCall; resolve: (approved: boolean) => void };
type SetupOS = "Windows" | "macOS" | "Linux";

function detectSetupOS(): SetupOS {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "Windows";
  if (platform.includes("mac")) return "macOS";
  return "Linux";
}

function readStoredString(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readSetupChecklist(): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem("local-agent-setup-checklist") ?? "[]");
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (HTTP ${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function toolArguments(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toolSummary(call: ToolCall): string {
  const args = toolArguments(call);
  const path = typeof args.path === "string" ? args.path : "";
  return path ? `${call.function.name} · ${path}` : call.function.name.replaceAll("_", " ");
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [connection, setConnection] = useState<Connection>({ connected: false, model: null, detail: "Checking local model…" });
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approval, setApproval] = useState<Approval | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [setupOS, setSetupOS] = useState<SetupOS>(detectSetupOS);
  const [modelExecutable, setModelExecutable] = useState(() => readStoredString("local-agent-llama-server"));
  const [modelFile, setModelFile] = useState(() => readStoredString("local-agent-gguf-model"));
  const [modelLaunching, setModelLaunching] = useState(false);
  const [modelLaunchMessage, setModelLaunchMessage] = useState("");
  const [launcherRunning, setLauncherRunning] = useState(false);
  const [launcherAvailable, setLauncherAvailable] = useState(true);
  const [setupChecklist, setSetupChecklist] = useState<string[]>(readSetupChecklist);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeChat = chats.find((chat) => chat.id === activeId) ?? null;

  async function refreshStatus() {
    try {
      const [status, details, launcher] = await Promise.all([
        request<Connection>("/api/status"),
        request<{ root: string }>("/api/workspace"),
        request<{ running: boolean; launchable: boolean; error: string }>("/api/model/launcher"),
      ]);
      setConnection(status);
      setWorkspace(details.root);
      setLauncherRunning(launcher.running);
      setLauncherAvailable(launcher.launchable);
      if (launcher.error) setModelLaunchMessage(launcher.error);
    } catch (reason) {
      setConnection({ connected: false, model: null, detail: friendlyError(reason) });
    }
  }

  async function refreshChats() {
    try {
      const result = await request<Chat[]>("/api/chats");
      setChats(result);
      setActiveId((current) => current && result.some((chat) => chat.id === current) ? current : result[0]?.id ?? null);
    } catch (reason) {
      setError(friendlyError(reason));
    }
  }

  useEffect(() => {
    void refreshChats();
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("local-agent-llama-server", modelExecutable);
      window.localStorage.setItem("local-agent-gguf-model", modelFile);
      window.localStorage.setItem("local-agent-setup-checklist", JSON.stringify(setupChecklist));
    } catch {
      setModelLaunchMessage("Could not save setup details in this browser. You can still enter them again next time.");
    }
  }, [modelExecutable, modelFile, setupChecklist]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeChat?.messages.length, busy, approval]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void createChat();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSidebarOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, []);

  async function createChat(): Promise<Chat> {
    const chat = await request<Chat>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ title: "New chat" }),
    });
    setChats((previous) => [chat, ...previous]);
    setActiveId(chat.id);
    setDraft("");
    setError("");
    window.setTimeout(() => composerRef.current?.focus(), 30);
    return chat;
  }

  async function saveChat(id: string, messages: Message[]) {
    const firstPrompt = messages.find((message) => message.role === "user")?.content?.trim() ?? "";
    const title = firstPrompt ? firstPrompt.slice(0, 52) + (firstPrompt.length > 52 ? "…" : "") : "New chat";
    const updated = await request<Chat>(`/api/chats/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title, messages }),
    });
    setChats((previous) => [updated, ...previous.filter((chat) => chat.id !== id)]);
  }

  async function deleteChat(chat: Chat) {
    if (!window.confirm(`Delete “${chat.title}”? This cannot be undone.`)) return;
    try {
      await request<void>(`/api/chats/${chat.id}`, { method: "DELETE" });
      setChats((previous) => previous.filter((item) => item.id !== chat.id));
      setActiveId((current) => current === chat.id ? chats.find((item) => item.id !== chat.id)?.id ?? null : current);
    } catch (reason) {
      setError(friendlyError(reason));
    }
  }

  async function runTool(call: ToolCall): Promise<string> {
    const mutating = ["create_file", "make_directory", "write_file", "append_file"].includes(call.function.name);
    if (mutating) {
      const approved = await new Promise<boolean>((resolve) => setApproval({ call, resolve }));
      setApproval(null);
      if (!approved) return JSON.stringify({ cancelled: true, message: "The user declined this file change." });
    }
    try {
      const result = await request<{ result: unknown }>("/api/tools/execute", {
        method: "POST",
        body: JSON.stringify({ name: call.function.name, arguments: call.function.arguments }),
      });
      return JSON.stringify(result.result);
    } catch (reason) {
      return JSON.stringify({ error: friendlyError(reason) });
    }
  }

  async function sendMessage(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    if (!connection.connected) {
      setError("Start llama.cpp first, then use Check connection again.");
      return;
    }
    setError("");
    let chat = activeChat;
    try {
      if (!chat) chat = await createChat();
      const id = chat.id;
      const messages: Message[] = [...chat.messages, { role: "user", content }];
      setChats((previous) => previous.map((item) => item.id === id ? { ...item, messages } : item));
      setDraft("");
      setBusy(true);
      await saveChat(id, messages);

      for (let turn = 0; turn < 8; turn += 1) {
        const completion = await request<{ message: Message }>("/api/complete", {
          method: "POST",
          body: JSON.stringify({ messages, tools: agentTools, model: connection.model ?? undefined }),
        });
        const assistantMessage = completion.message;
        messages.push(assistantMessage);
        setChats((previous) => previous.map((item) => item.id === id ? { ...item, messages: [...messages] } : item));
        await saveChat(id, messages);

        if (!assistantMessage.tool_calls?.length) break;
        for (const call of assistantMessage.tool_calls) {
          const output = await runTool(call);
          const toolMessage: Message = {
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: output,
          };
          messages.push(toolMessage);
          setChats((previous) => previous.map((item) => item.id === id ? { ...item, messages: [...messages] } : item));
          await saveChat(id, messages);
        }
      }
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
      setApproval(null);
      composerRef.current?.focus();
    }
  }

  function decideApproval(approved: boolean) {
    approval?.resolve(approved);
    setApproval(null);
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy to clipboard. Check your browser permissions.");
    }

    async function launchLocalModel() {
      setModelLaunching(true);
      setModelLaunchMessage("");
      try {
        await request<{ started: boolean; port: string }>("/api/model/start", {
          method: "POST",
          body: JSON.stringify({ executable: modelExecutable.trim(), model: modelFile.trim() }),
        });
        setModelLaunchMessage("Model server started. Loading can take a minute; connection status will update automatically.");
        setLauncherRunning(true);
        window.setTimeout(() => void refreshStatus(), 1500);
      } catch (reason) {
        setModelLaunchMessage(friendlyError(reason));
      } finally {
        setModelLaunching(false);
      }
    }

    async function stopLocalModel() {
      try {
        await request<{ stopped: boolean }>("/api/model/stop", { method: "POST", body: "{}" });
        setLauncherRunning(false);
        setModelLaunchMessage("Model server stopped.");
        await refreshStatus();
      } catch (reason) {
        setModelLaunchMessage(friendlyError(reason));
      }
    }

    function toggleChecklist(item: string) {
      setSetupChecklist((previous) => previous.includes(item)
        ? previous.filter((entry) => entry !== item)
        : [...previous, item]);
    }
  }

  const visibleChats = chats.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase()));
  const completedSetupCount = ["node", "llama", "model"].filter((item) => setupChecklist.includes(item)).length;
  const approvalArgs = approval ? toolArguments(approval.call) : {};
  const approvalPath = typeof approvalArgs.path === "string" ? approvalArgs.path : "(path not provided)";

  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={17} strokeWidth={2.2} /></div>
          <div className="brand-name">local<span>agent</span></div>
          <button className="icon-button sidebar-hide" aria-label="Hide sidebar" onClick={() => setSidebarOpen(false)}><Menu size={18} /></button>
        </div>
        <button className="new-chat-button" onClick={() => void createChat()}>
          <SquarePen size={17} /> <span>New chat</span><kbd>Ctrl K</kbd>
        </button>
        <label className="history-search">
          <Search size={15} />
          <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" />
          <kbd>Ctrl F</kbd>
        </label>
        <div className="history-heading">YOUR CHATS <span>{chats.length}</span></div>
        <div className="chat-list">
          {visibleChats.map((chat) => (
            <div className={`chat-row ${activeId === chat.id ? "selected" : ""}`} key={chat.id}>
              <button className="chat-select" onClick={() => setActiveId(chat.id)}>
                <MessageSquare size={15} />
                <span>{chat.title}</span>
              </button>
              <button className="chat-delete" aria-label={`Delete ${chat.title}`} onClick={() => void deleteChat(chat)}><Trash2 size={14} /></button>
            </div>
          ))}
          {visibleChats.length === 0 && <div className="empty-history">{search ? "No matching chats" : "Your conversations will appear here"}</div>}
        </div>
        <div className="sidebar-bottom">
          <button className="workspace-card" onClick={() => setShowSettings(true)}>
            <div className="workspace-icon"><FolderOpen size={16} /></div>
            <div className="workspace-copy"><strong>Workspace</strong><span title={workspace}>{workspace ? workspace.split(/[\\/]/).filter(Boolean).slice(-2).join("/") : "Loading…"}</span></div>
            <MoreHorizontal size={17} />
          </button>
          <div className="privacy-note"><ShieldCheck size={14} /><span>Your files stay on this device</span></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && <button className="icon-button show-sidebar" aria-label="Show sidebar" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>}
            <div className="model-pill">
              <span className={`status-dot ${connection.connected ? "online" : ""}`} />
              <span>{connection.connected ? connection.model : "Local model offline"}</span>
              <ChevronDown size={14} />
            </div>
          </div>
          <div className="topbar-right">
            <button className="help-button" onClick={() => setShowSettings(true)}><CircleHelp size={16} /><span>Getting started</span></button>
            <button className="icon-button" aria-label="Workspace settings" onClick={() => setShowSettings(true)}><MoreHorizontal size={19} /></button>
          </div>
        </header>

        <div className="conversation-scroll">
          {activeChat?.messages.length ? (
            <div className="conversation">
              {activeChat.messages.map((message, index) => {
                if (message.role === "tool") {
                  return (
                    <div className="tool-result-row" key={`${message.tool_call_id}-${index}`}>
                      <div className="tool-result-icon"><Terminal size={14} /></div>
                      <div className="tool-result-content">
                        <div className="tool-result-title">{(message.name ?? "tool").replaceAll("_", " ")} <span>completed</span></div>
                        <pre>{message.content}</pre>
                      </div>
                    </div>
                  );
                }
                return (
                  <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    {message.role === "assistant" ? <div className="avatar assistant-avatar"><Sparkles size={15} /></div> : <div className="avatar user-avatar">Y</div>}
                    <div className="message-main">
                      <div className="message-author">{message.role === "assistant" ? "Local Agent" : "You"} <span>{message.role === "assistant" ? "· local model" : ""}</span></div>
                      {message.content && <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>}
                      {message.tool_calls?.map((call) => (
                        <div className="tool-call-pill" key={call.id}><Terminal size={14} />{toolSummary(call)}<Check size={13} /></div>
                      ))}
                      {message.role === "assistant" && message.content && (
                        <div className="message-actions">
                          <button onClick={() => void copyText(message.content ?? "", `message-${index}`)} aria-label="Copy response">{copied === `message-${index}` ? <Check size={14} /> : <span className="copy-glyph">▢</span>}</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {busy && !approval && (
                <div className="working-indicator"><div className="avatar assistant-avatar"><Sparkles size={15} /></div><div><span className="working-dots"><i /><i /><i /></span><span className="working-label">Thinking</span></div></div>
              )}
              {error && <div className="error-banner"><AlertCircle size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
              <div ref={bottomRef} />
            </div>
          ) : (
            <div className="welcome">
              <div className="welcome-spark"><Sparkles size={20} /></div>
              <div className="eyebrow">YOUR PRIVATE AI WORKSPACE</div>
              <h1>What can we make<br /> <span>happen today?</span></h1>
              <p>Chat, explore your project, and work with files — all powered by a model running on your own machine.</p>
              <div className="suggestion-grid">
                <button onClick={() => void sendMessage("Take a look at the files in my workspace and give me a quick overview.")}>
                  <div className="suggestion-icon mint"><FolderOpen size={17} /></div><strong>Explore my project</strong><span>Get a tour of your files</span>
                </button>
                <button onClick={() => void sendMessage("Help me plan a small project. Ask me a couple of questions first.")}>
                  <div className="suggestion-icon violet"><Sparkles size={17} /></div><strong>Think it through</strong><span>Plan your next idea</span>
                </button>
                <button onClick={() => void sendMessage("Create a simple README.md for this project. Ask me before you write any files.")}>
                  <div className="suggestion-icon orange"><FileCode2 size={17} /></div><strong>Make something</strong><span>Create or edit a file</span>
                </button>
              </div>
              {error && <div className="error-banner welcome-error"><AlertCircle size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {!connection.connected && (
            <button className="offline-hint" onClick={() => setShowSettings(true)}>
              <AlertCircle size={14} /> {connection.detail} <span>How to connect <ArrowUp size={12} /></span>
            </button>
          )}
          <div className={`composer ${!connection.connected ? "disabled-composer" : ""}`}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={connection.connected ? "Message your local agent…" : "Start llama.cpp to begin chatting"}
              rows={1}
              disabled={!connection.connected || busy}
            />
            <div className="composer-footer">
              <div className="composer-tools"><span className="tools-indicator"><span className="tiny-dot" /> Tools on</span><span className="tool-count">7 available</span></div>
              <div className="composer-submit-area">
                <span className="enter-hint">Shift + Enter for a new line</span>
                <button className="send-button" aria-label="Send message" disabled={!draft.trim() || busy || !connection.connected} onClick={() => void sendMessage()}>
                  {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}
                </button>
              </div>
            </div>
          </div>
          <div className="composer-disclaimer"><ShieldCheck size={12} /> Private by design · Your model runs locally on your computer</div>
        </div>
      </main>

      {approval && (
        <div className="modal-backdrop" role="presentation">
          <section className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
            <button className="modal-close" aria-label="Close" onClick={() => decideApproval(false)}><X size={18} /></button>
            <div className="approval-icon"><ShieldCheck size={21} /></div>
            <div className="eyebrow">PERMISSION REQUIRED</div>
            <h2 id="approval-title">Allow this file change?</h2>
            <p>Your agent wants to run <strong>{approval.call.function.name.replaceAll("_", " ")}</strong> in your workspace.</p>
            <div className="approval-file"><FileCode2 size={16} /><span>{approvalPath}</span></div>
            {typeof approvalArgs.content === "string" && <pre className="approval-preview">{approvalArgs.content.slice(0, 1400)}{approvalArgs.content.length > 1400 ? "\n…" : ""}</pre>}
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => decideApproval(false)}>No, cancel</button>
              <button className="primary-button" onClick={() => decideApproval(true)}><Check size={15} /> Allow change</button>
            </div>
            <div className="approval-footnote"><ShieldCheck size={13} /> Only changes files inside your selected workspace.</div>
          </section>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" aria-label="Close" onClick={() => setShowSettings(false)}><X size={18} /></button>
            <div className="settings-heading"><div className="welcome-spark"><Sparkles size={19} /></div><div><div className="eyebrow">QUICK SETUP</div><h2 id="settings-title">Your local AI</h2></div></div>
            <p className="settings-intro">This app connects to llama.cpp running on your computer. Your prompts and files are not sent to a cloud AI service.</p>
            <div className={`connection-card ${connection.connected ? "connected" : ""}`}>
              <span className={`status-dot ${connection.connected ? "online" : ""}`} />
              <div><strong>{connection.connected ? "Model connected" : "Model not connected"}</strong><span>{connection.connected ? connection.model : connection.detail}</span></div>
              <button className="icon-button" aria-label="Check connection again" onClick={() => void refreshStatus()}><ArrowDown size={16} /></button>
            </div>
            <div className="checklist-card">
              <div className="checklist-heading"><strong>First-run checklist</strong><span>{completedSetupCount}/3 ready</span></div>
              <label><input type="checkbox" checked={setupChecklist.includes("node")} onChange={() => toggleChecklist("node")} /> Node.js installed</label>
              <label><input type="checkbox" checked={setupChecklist.includes("llama")} onChange={() => toggleChecklist("llama")} /> llama.cpp downloaded</label>
              <label><input type="checkbox" checked={setupChecklist.includes("model")} onChange={() => toggleChecklist("model")} /> GGUF model downloaded</label>
              <div className="checklist-progress"><span style={{ width: `${completedSetupCount / 3 * 100}%` }} /></div>
            </div>
            <div className="os-picker" aria-label="Choose operating system">
              {(["Windows", "macOS", "Linux"] as const).map((os) => (
                <button key={os} className={setupOS === os ? "active" : ""} onClick={() => setSetupOS(os)}>{os}</button>
              ))}
            </div>
            <div className="setup-steps">
              <div className="setup-step"><span>1</span><div><strong>Install Node.js LTS</strong><p>Get the current LTS version from <a href="https://nodejs.org/" target="_blank" rel="noreferrer">nodejs.org</a>. Then open a new terminal and check <code>node --version</code> and <code>npm --version</code>.</p></div></div>
              <div className="setup-step"><span>2</span><div><strong>Download llama.cpp</strong><p>Download a build for {setupOS} from <a href="https://github.com/ggml-org/llama.cpp/releases" target="_blank" rel="noreferrer">the official releases</a>. On Linux, you can also build from source. Find the <code>{setupOS === "Windows" ? "llama-server.exe" : "llama-server"}</code> executable.</p></div></div>
              <div className="setup-step"><span>3</span><div><strong>Get an instruct GGUF model</strong><p>Choose a model from a source you trust. A 3B–8B model in Q4_K_M quantization is a reasonable start. Check its licence and that it fits your available memory.</p></div></div>
            </div>
            <div className="launcher-card">
              <div className="launcher-title"><Terminal size={15} /><strong>Start your local model</strong></div>
              {!launcherAvailable
                ? <p className="launcher-description">Automatic launch is disabled because MODEL_BASE_URL is not a local address. Start the server separately and connect to it.</p>
                : connection.connected && !launcherRunning
                ? <p className="launcher-description">A local model is already connected. This app can only stop servers it started itself.</p>
                : launcherRunning
                  ? <p className="launcher-description">Started by this app. The model may take a little while to load.</p>
                  : <p className="launcher-description">Choose the llama-server program and GGUF file on this computer. The app launches it with fixed, local-only settings—no shell commands are run.</p>}
              <label className="path-field"><span>llama-server program</span><input value={modelExecutable} onChange={(event) => setModelExecutable(event.target.value)} placeholder={setupOS === "Windows" ? "C:\\llama.cpp\\llama-server.exe" : "/path/to/llama-server"} spellCheck={false} /></label>
              <label className="path-field"><span>GGUF model file</span><input value={modelFile} onChange={(event) => setModelFile(event.target.value)} placeholder={setupOS === "Windows" ? "C:\\AI\\models\\my-model.gguf" : "/path/to/my-model.gguf"} spellCheck={false} /></label>
              <div className="launcher-actions">
                <button className="primary-button" disabled={!launcherAvailable || modelLaunching || launcherRunning || connection.connected || !modelExecutable.trim() || !modelFile.trim()} onClick={() => void launchLocalModel()}>
                  {modelLaunching ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={15} />}
                  {modelLaunching ? "Starting…" : "Start local model"}
                </button>
                {launcherRunning && <button className="secondary-button" onClick={() => void stopLocalModel()}>Stop model</button>}
              </div>
              {modelLaunchMessage && <div className="launch-message" role="status">{modelLaunchMessage}</div>}
              {!connection.connected && <div className="command-example"><strong>Or start it in a terminal:</strong><code>{setupOS === "Windows" ? '.\\llama-server.exe -m "C:\\path\\to\\model.gguf" --port 8080 --jinja' : './llama-server -m "/path/to/model.gguf" --port 8080 --jinja'}</code></div>}
            </div>
            <div className="setup-steps">
              <div className="setup-step"><span>4</span><div><strong>Start this app</strong><p>In a second terminal, open the app folder and run <code>npm install</code> once, then <code>npm run dev</code>. Open <code>http://localhost:5173</code>. On later visits, just run <code>npm run dev</code>.</p></div></div>
            </div>
            <div className="settings-note"><ShieldCheck size={15} /><span>File tools can only access the workspace shown in the sidebar. The agent asks before creating folders or changing files. Model executable and model paths are saved only in this browser.</span></div>
            <button className="settings-done" onClick={() => setShowSettings(false)}>Got it</button>
          </section>
        </div>
      )}
    </div>
  );
}
