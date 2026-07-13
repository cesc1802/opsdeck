import { SquareTerminal } from "lucide-react";

export function CommandChip({ name, args }: { name: string; args: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted px-2 py-1 font-mono text-xs">
      <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">{name}</span>
      {args && <span className="truncate text-muted-foreground">{args}</span>}
    </span>
  );
}
