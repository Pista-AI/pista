import { useMemo } from "react";
import { actions, toast, useApp } from "../lib/store.ts";
import { pickerName } from "../lib/llama.ts";
import { MenuItem } from "./Popover.tsx";

/** The model choices of the chat box chip and the focused error card, grouped by provider. Choosing one switches the thread. */
export function ModelMenuItems({ close }: { close: () => void }) {
  const models = useApp((s) => s.models);
  const current = useApp((s) => (s.activeThreadId ? s.views[s.activeThreadId]?.model : undefined) ?? s.config?.defaultModel);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return [...map.entries()];
  }, [models]);
  if (grouped.length === 0)
    return (
      <MenuItem
        description="No provider is signed in yet"
        onClick={() => {
          close();
          useApp.setState({ settingsOpen: "providers" });
        }}
      >
        Sign in to a model provider…
      </MenuItem>
    );
  return (
    <>
      {grouped.map(([provider, list]) => (
        <div key={provider}>
          <div className="menu-label">{provider === "llama.cpp" ? "Built-in (llama.cpp)" : provider}</div>
          {list.map((m) => (
            <MenuItem
              key={m.id}
              checked={m.provider === current?.provider && m.id === current?.id}
              onClick={() => {
                close();
                void actions.setModel(m.provider, m.id).catch((e: Error) => toast(e.message, "error"));
              }}
            >
              {pickerName(m.provider, m.name)}
            </MenuItem>
          ))}
        </div>
      ))}
    </>
  );
}
