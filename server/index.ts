import express from 'express';
import { Server as WebSocketServer } from 'ws';
import { Client, PseudoTtyOptions } from 'ssh2';
import http from 'http';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/ssh-ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', ws => {
  console.log('WebSocket connection established');
  let sshClient: Client | null = null;
  let shellStream: any = null;

  ws.on('message', (msg: string) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log('Received message type:', data.type);

      if (data.type === 'connect') {
        console.log(`SSH connect request for ${data.username}@${data.host}:${data.port || 22}`);
        sshClient = new Client();

        sshClient.on('ready', () => {
          console.log('SSH client ready');
          ws.send(JSON.stringify({ type: 'status', data: 'SSH Connection Established' }));

          const pty: PseudoTtyOptions = {
            rows: data.rows || 24,
            cols: data.cols || 80,
            term: 'xterm-256color'
          };

          sshClient?.shell(pty, (err, stream) => {
            if (err) {
              console.error('SSH shell error:', err);
              ws.send(JSON.stringify({ type: 'error', data: err.message }));
              return;
            }
            console.log('SSH shell stream opened');
            shellStream = stream;
            stream.on('data', (chunk: Buffer) => {
              ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
            });
            stream.on('close', () => {
              console.log('SSH shell stream closed');
              sshClient?.end();
              ws.close();
            });
          });
        });

        sshClient.on('error', (err) => {
          console.error('SSH client error:', err);
          ws.send(JSON.stringify({ type: 'error', data: err.message }));
        });

        sshClient.on('close', () => {
          console.log('SSH client closed');
          ws.send(JSON.stringify({ type: 'status', data: 'SSH Connection Closed' }));
        });

        sshClient.connect({
          host: data.host,
          port: data.port || 22,
          username: data.username,
          password: data.password,
          readyTimeout: 20000,
        });
      }

      if (data.type === 'input' && shellStream) {
        shellStream.write(data.data);
      }

      if (data.type === 'resize' && shellStream) {
        shellStream.setWindow(data.rows, data.cols, 0, 0);
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    shellStream?.end();
    sshClient?.end();
  });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SSH backend running on http://0.0.0.0:${PORT}`);
});
