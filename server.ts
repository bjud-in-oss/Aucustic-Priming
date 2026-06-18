import express from "express";
import { createServer } from "http";
import process from "process";
import { WebSocketServer } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import * as path from "path";
import fs from "fs/promises";

const PORT = 3000;

const ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
});

async function startServer() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  });

  const server = createServer(app);

  let activePayload = `
<ouroboros_system_override timestamp="2026-06-08T14:30:00Z" priority="CRITICAL">
  <mission_manifesto>
    Du är Ouroboros V2. Ditt uppdrag är att autonomt arkitektera och skriva en fullständig WebSocket-chattserver. 
    VIKTIGT: För att inte krascha utvecklingsservern MÅSTE du bygga detta i mappen '/tmp/min_chatt_app' vilket är utanför projektets watched root.
  </mission_manifesto>

  <cognitive_laws>
    1. ZERO TRUNCATION: Tappa aldrig ditt slutmål.
    2. MULTI-STEP SURVIVAL: Du kommer att behöva anropa 'execute_code' flera gånger i rad. Du MÅSTE invänta svar från varje anrop innan du gör nästa.
    3. NO INTERACTIVE COMMANDS: Använd 'cat << "EOF" > filnamn' för att skriva kod.
  </cognitive_laws>

  <execution_directive>
    Skapa programmet sekventiellt (ett verktygsanrop per steg):

    STEG 1 - INFRASTRUKTUR:
    Skapa mappen i /tmp, initiera npm och installera 'ws'.
    Kommando att köra: mkdir -p /tmp/min_chatt_app && cd /tmp/min_chatt_app && npm init -y && npm install ws

    STEG 2 - BACKEND (SERVER):
    Skriv serverkoden till /tmp/min_chatt_app/server.js.
    Kommando att köra: 
    cat << 'EOF' > /tmp/min_chatt_app/server.js
    const WebSocket = require('ws');
    const wss = new WebSocket.Server({ port: 8080 });
    wss.on('connection', function connection(ws) {
      ws.on('message', function incoming(message) {
        console.log('Mottaget: %s', message);
        wss.clients.forEach(function each(client) {
          if (client.readyState === WebSocket.OPEN) {
            client.send("Eko från Ouroboros: " + message);
          }
        });
      });
      ws.send('Välkommen till Ouroboros Agent Chat!');
    });
    console.log('Server körs på port 8080');
    EOF

    STEG 3 - FRONTEND (KLIENT):
    Skriv klientkoden till /tmp/min_chatt_app/index.html.
    Kommando att köra:
    cat << 'EOF' > /tmp/min_chatt_app/index.html
    <!DOCTYPE html>
    <html><body>
      <h2>Ouroboros Testklient</h2>
      <input type="text" id="msg" placeholder="Skriv meddelande..."><button onclick="send()">Skicka</button>
      <ul id="log"></ul>
      <script>
        const ws = new WebSocket('ws://localhost:8080');
        ws.onmessage = (e) => {
          if(e.data instanceof Blob) {
            e.data.text().then(text => document.getElementById('log').innerHTML += '<li>' + text + '</li>');
          } else {
            document.getElementById('log').innerHTML += '<li>' + e.data + '</li>';
          }
        };
        function send() { ws.send(document.getElementById('msg').value); }
      </script>
    </body></html>
    EOF

    STEG 4 - BEKRÄFTELSE:
    När filerna i /tmp/min_chatt_app/ är skapade, tala till människan och bekräfta att allt är klart.
  </execution_directive>
</ouroboros_system_override>
`;

  app.get("/api/get-token", async (req, res) => {
    // Return the raw API key directly as fallback since Ephemeral token generation is currently failing or unsupported for this model.
    res.json({ token: process.env.GEMINI_API_KEY });
  });

  app.get("/api/workspace/list", async (req, res) => {
    try {
      const dirPath = req.query.dir as string || "";
      const cwd = process.cwd();
      const targetPath = path.join(cwd, dirPath);
      
      if (!targetPath.startsWith(cwd)) {
          return res.status(403).json({ error: "Access denied" });
      }

      const items = await fs.readdir(targetPath, { withFileTypes: true });

      const ignored = ['node_modules', '.git', 'dist', '.env', '.env.example', '.nvmrc'];
      const files = items
          .filter((item: any) => !ignored.includes(item.name) && !item.name.startsWith('.'))
          .map((item: any) => ({
              name: item.name,
              path: path.join(dirPath, item.name).replace(/\\/g, '/'),
              isDirectory: item.isDirectory(),
          }));

      res.json({ files });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/workspace/download", (req, res) => {
     const filename = req.query.path as string;
     if (!filename) {
        return res.status(400).json({ error: "No path provided" });
     }
     const cwd = process.cwd();
     const filePath = path.join(cwd, filename);
     if (!filePath.startsWith(cwd)) {
          return res.status(403).json({ error: "Access denied" });
     }
     res.download(filePath, (err) => {
        if (err) {
           if (!res.headersSent) res.status(404).json({ error: "File not found" });
        }
     });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();