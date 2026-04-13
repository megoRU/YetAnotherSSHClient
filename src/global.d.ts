export interface IpcRendererApi {
  getPathForFile: (file: File) => string;
  send: (channel: string, data?: unknown) => void;
  on: (channel: string, func: (...args: unknown[]) => void) => () => void;
  invoke: (channel: string, data?: unknown) => Promise<unknown>;
  removeAllListeners: (channel: string) => void;
  platform: string;
}

declare global {
  interface Window {
    ipcRenderer: IpcRendererApi;
  }
}
