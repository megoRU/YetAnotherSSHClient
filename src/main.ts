import './ipc/tauri-bridge.ts';
import { mount } from 'svelte';
import './index.css';
import ErrorBoundary from './components/layout/ErrorBoundary.svelte';
import { initRendererLogger } from './utils/rendererLogger.ts';

initRendererLogger();

mount(ErrorBoundary, { target: document.getElementById('root')! });
