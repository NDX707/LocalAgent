export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export const agentTools = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and folders inside the current workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative folder path. Use . for the workspace root." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file inside the current workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative file path." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new UTF-8 text file. Fails if the file already exists.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Complete file contents." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_directory",
      description: "Create a folder and any missing parent folders inside the current workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative folder path." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Replace the contents of a UTF-8 text file or create it if missing.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Complete new file contents." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_file",
      description: "Append text to an existing UTF-8 text file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Text to append." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search text within workspace files, skipping dependencies and hidden version-control data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for." },
          path: { type: "string", description: "Optional workspace-relative folder. Defaults to ." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_terminal_command",
      description:
        "Request a one-shot terminal check. The user must approve each run. Only git status, git diff summary, npm test, and npm build are allowed. Commands run in the workspace with a 30-second timeout and limited output. No arbitrary commands or interactive terminal sessions.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["git_status", "git_diff_summary", "npm_test", "npm_build"],
            description: "Choose one approved development check. Do not construct shell commands.",
          },
        },
        required: ["action"],
      },
    },
  },
] as const;
