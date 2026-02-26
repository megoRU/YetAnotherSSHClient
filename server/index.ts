import express from 'express';
import { Server as WebSocketServer } from 'ws';
import { Client, PseudoTtyOptions } from 'ssh2';
import http from 'http';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  let sshClient: Client | null = null;
  let shellStream: any = null;

  ws.on('message', (msg: string) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'connect') {
        sshClient = new Client();
        sshClient.on('ready', () => {
          ws.send(JSON.stringify({ type: 'status', data: 'SSH Connection Established' }));

          const pty: PseudoTtyOptions = {
            rows: data.rows || 24,
            cols: data.cols || 80,
            term: 'xterm-256color'
          };

          sshClient?.shell(pty, (err, stream) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'error', data: err.message }));
              return;
            }
            shellStream = stream;
            stream.on('data', (chunk: Buffer) => {
              ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
            });
            stream.on('close', () => {
              sshClient?.end();
              ws.close();
            });
          });
        });

        sshClient.on('error', (err) => {
          ws.send(JSON.stringify({ type: 'error', data: err.message }));
        });

        sshClient.on('close', () => {
          ws.send(JSON.stringify({ type: 'status', data: 'SSH Connection Closed' }));
        });

        sshClient.connect({
          host: data.host,
          port: data.port || 22,
          username: data.username,
          password: data.password
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
    shellStream?.end();
    sshClient?.end();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SSH backend running on http://localhost:${PORT}`);
});
