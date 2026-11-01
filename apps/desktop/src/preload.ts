/**
 * Exposes `window.pistaDesktop` (see apps/ui/src/browser/bridge.ts) to the UI.
 * Everything crosses the context bridge as plain data; the page never gets ipcRenderer.
 */
import { contextBridge, ipcRenderer } from "electron";

type Rect = { x: number; y: number; width: number; height: number };

/** Main returns failures as `{ error }` values; turn them back into rejections. */
async function loginCall(channel: string, ...args: unknown[]) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && typeof r === "object" && "error" in r) throw new Error(String((r as { error: unknown }).error));
  return r;
}

contextBridge.exposeInMainWorld("pistaDesktop", {
  shell: "electron",
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  browser: {
    setBounds: (rect: Rect | null) => ipcRenderer.send("browser:setBounds", rect),
    navigate: (url: string) => ipcRenderer.invoke("browser:navigate", url),
    back: () => ipcRenderer.invoke("browser:back"),
    forward: () => ipcRenderer.invoke("browser:forward"),
    reload: () => ipcRenderer.invoke("browser:reload"),
    state: () => ipcRenderer.invoke("browser:state"),
    onState: (listener: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown) => listener(state);
      ipcRenderer.on("browser:state", handler);
      return () => ipcRenderer.removeListener("browser:state", handler);
    },
    readText: (maxChars: number) => ipcRenderer.invoke("browser:readText", maxChars),
    screenshot: () => ipcRenderer.invoke("browser:screenshot"),
    evaluate: (script: string) => ipcRenderer.invoke("browser:evaluate", script),
    armDownload: (path: string, url?: string) => ipcRenderer.invoke("browser:armDownload", path, url),
    waitDownload: async () => {
      const r = await ipcRenderer.invoke("browser:waitDownload");
      if (r && typeof r === "object" && "error" in r) throw new Error(String((r as { error: unknown }).error));
      return r;
    },
    input: (event: unknown) => ipcRenderer.invoke("browser:input", event),
    openDevTools: () => ipcRenderer.invoke("browser:openDevTools"),
    logins: {
      status: () => loginCall("logins:status"),
      list: () => loginCall("logins:list"),
      save: (input: { label: string; loginUrl: string; username: string; password: string }) => loginCall("logins:save", input),
      remove: (id: string) => loginCall("logins:remove", id),
      fill: (site: string) => loginCall("logins:fill", site),
      import: (opts: { trash: boolean }) => loginCall("logins:import", { trash: opts?.trash === true }),
    },
  },
});
