import type { IpcRendererApi } from './ipc';

export type { IpcRendererApi };

declare global {
  interface Window {
    ipcRenderer: IpcRendererApi;
  }
}