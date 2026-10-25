/**
 * Exposes `window.pistaDesktop` (see apps/ui/src/browser/bridge.ts) to the UI.
 * Everything crosses the context bridge as plain data; the page never gets ipcRenderer.
 */
import { contextBridge, ipcRenderer } from "electron";

type Rect = { x: number; y: number; width: number; height: number };

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
    input: (event: unknown) => ipcRenderer.invoke("browser:input", event),
    openDevTools: () => ipcRenderer.send("browser:openDevTools"),
  },
});
