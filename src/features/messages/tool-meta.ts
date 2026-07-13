import {
  FileText,
  FilePen,
  FilePlus,
  Terminal,
  Search,
  FolderSearch,
  Bot,
  Globe,
  ListTodo,
  BookOpen,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { JsonValue } from "@/lib/bindings";

interface ToolMeta {
  icon: LucideIcon;
  /** Short human target extracted from the tool input, e.g. a file path. */
  target: (input: JsonValue) => string | null;
}

function str(input: JsonValue, key: string): string | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const value = (input as Record<string, JsonValue>)[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

const first =
  (...keys: string[]) =>
  (input: JsonValue) => {
    for (const key of keys) {
      const value = str(input, key);
      if (value) return value;
    }
    return null;
  };

const TOOL_META: Record<string, ToolMeta> = {
  Read: { icon: FileText, target: first("file_path") },
  Write: { icon: FilePlus, target: first("file_path") },
  Edit: { icon: FilePen, target: first("file_path") },
  MultiEdit: { icon: FilePen, target: first("file_path") },
  NotebookEdit: { icon: FilePen, target: first("notebook_path") },
  Bash: { icon: Terminal, target: first("command") },
  BashOutput: { icon: Terminal, target: first("bash_id") },
  Grep: { icon: Search, target: first("pattern") },
  Glob: { icon: FolderSearch, target: first("pattern") },
  Task: { icon: Bot, target: first("description", "prompt") },
  Agent: { icon: Bot, target: first("description", "prompt") },
  WebFetch: { icon: Globe, target: first("url") },
  WebSearch: { icon: Globe, target: first("query") },
  TodoWrite: { icon: ListTodo, target: () => null },
  Skill: { icon: BookOpen, target: first("skill", "command") },
};

const DEFAULT_META: ToolMeta = { icon: Wrench, target: () => null };

export function toolMeta(name: string): ToolMeta {
  return TOOL_META[name] ?? DEFAULT_META;
}
