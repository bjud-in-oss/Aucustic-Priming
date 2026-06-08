import express from "express";
import { createServer } from "http";
import process from "process";
import { WebSocketServer } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import * as path from "path";

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
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/live" });

  let activePayload = "Analyze the local directory and create a file named 'ouroboros_test.txt' containing 'ouroboros_test'. You MUST use the execute_code tool. Your execute_code command should be exactly: echo 'ouroboros_test' > ouroboros_test.txt";

  wss.on("connection", async (clientWs) => {
    function safeClientSend(payload: any) {
      if (clientWs.readyState === 1) { // 1 is OPEN
        try {
          clientWs.send(JSON.stringify(payload));
        } catch (err) {
          console.error("Failed to send message to client:", err);
        }
      }
    }

    let session: any = null;
    let tEndPushToTalk: number | null = null;
    let tFetchPayloadSent: number | null = null;
    let tExecuteFinish: number | null = null;

    try {
      session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            try {
              // Forward audio to frontend
              const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audio) {
                safeClientSend({ type: "status", status: "speaking" });
                safeClientSend({ type: "audio", audio });
                
                if (tExecuteFinish) {
                   const tReceiveAudio = Date.now();
                   const T3 = tReceiveAudio - tExecuteFinish;
                   safeClientSend({ type: "latency", measure: "T3", ms: T3, description: "Execution Finish -> First valid Audio output" });
                   tExecuteFinish = null; 
                }
              }
              if (message.serverContent?.interrupted) {
                safeClientSend({ type: "interrupted" });
                safeClientSend({ type: "status", status: "idle" });
              }
              if (message.serverContent?.turnComplete) {
                safeClientSend({ type: "status", status: "idle" });
              }

              // Output transcription
              const text = message.serverContent?.outputTranscription?.text;
              if (text) {
                  safeClientSend({ type: "transcription", text, role: "agent" });
              }
              
              // Input transcription
              const userText = message.serverContent?.inputTranscription?.text;
              if (userText) {
                  safeClientSend({ type: "transcription", text: userText, role: "user" });
              }

              // Handle tools
              if (message.toolCall) {
                  const call = message.toolCall.functionCalls?.[0];
                  if (call) {
                      safeClientSend({ type: "log", message: `Tool invoked: ${call.name}` });
                      
                      if (call.name === "fetch_payload") {
                          const tFetch = Date.now();
                          if (tEndPushToTalk) {
                              const T1 = tFetch - tEndPushToTalk;
                              safeClientSend({ type: "latency", measure: "T1", ms: T1, description: "activityEnd -> Tool call: fetch_payload" });
                          }
                          
                          // Extract thought_signature
                          const thought_signature = call.id || (call.args ? call.args.thought_signature as string : undefined) || "unknown";

                          safeClientSend({ type: "status", status: "fetching_payload" });

                          const functionResponses = [{
                              id: call.id,
                              name: call.name,
                              response: {
                                  payload: activePayload,
                                  thought_signature
                              }
                          }];
                          session.sendToolResponse({ functionResponses });
                          tFetchPayloadSent = Date.now();
                          safeClientSend({ type: "log", message: `Payload injected, ID: ${thought_signature}` });
                      } else if (call.name === "execute_code") {
                          const tExecute = Date.now();
                          if (tFetchPayloadSent) {
                              const T2 = tExecute - tFetchPayloadSent;
                              safeClientSend({ type: "latency", measure: "T2", ms: T2, description: "Payload Response -> Tool call: execute_code" });
                          }
                          
                          const command = (call.args?.command as string) || "echo no-op";
                          safeClientSend({ type: "status", status: "executing_code", command });
                          safeClientSend({ type: "log", message: `Executing code: ${command}` });
                          
                          exec(command, (error, stdout, stderr) => {
                              try {
                                const functionResponses = [{
                                    id: call.id,
                                    name: call.name,
                                    response: {
                                        stdout: stdout || "",
                                        stderr: stderr || "",
                                        error: error ? error.message : null
                                    }
                                }];
                                session.sendToolResponse({ functionResponses });
                                tExecuteFinish = Date.now();
                                safeClientSend({ type: "log", message: `Execution completed.` });
                              } catch (innerErr) {
                                console.error("Error sending tool response:", innerErr);
                              }
                          });
                      }
                  }
              }
            } catch (msgErr) {
              console.error("Error handling message from Gemini:", msgErr);
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are an agent. When the user tells you they are ready and to fetch your payload, invoke fetch_payload(). Then, process the payload and immediately execute the instructions it gives you using execute_code(). Acknowledge back to the user when you're done.",
          outputAudioTranscription: {},
          realtimeInputConfig: {
              automaticActivityDetection: { disabled: true }
          },
          tools: [{
              functionDeclarations: [
                  {
                      name: "fetch_payload",
                      description: "Fetches a massive text payload of system instructions after the user primes you.",
                      parameters: {
                          type: Type.OBJECT,
                          properties: {
                              thought_signature: {
                                  type: Type.STRING,
                                  description: "Optional random identifier."
                              }
                          }
                      }
                  },
                  {
                      name: "execute_code",
                      description: "Executes real terminal commands on the host machine.",
                      parameters: {
                          type: Type.OBJECT,
                          properties: {
                              command: {
                                  type: Type.STRING,
                                  description: "The shell command to execute."
                              }
                          },
                          required: ["command"]
                      }
                  }
              ]
          }]
        },
      });

      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.event === "activityStart" && session) {
              session.sendRealtimeInput({ activityStart: {} });
              safeClientSend({ type: "log", message: "activityStart sent to model." });
          } else if (msg.event === "activityEnd" && session) {
              tEndPushToTalk = Date.now();
              session.sendRealtimeInput({ activityEnd: {} });
              safeClientSend({ type: "status", status: "processing" });
              safeClientSend({ type: "log", message: "activityEnd sent to model." });
          } else if (msg.type === "set_payload") {
              activePayload = msg.payload;
              safeClientSend({ type: "log", message: "Payload updated by user." });
          } else if (msg.audio && session) {
              // Audio from client microphone
              session.sendRealtimeInput({
                audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
              });
          }
        } catch (err) {
          console.error("Error processing client message", err);
        }
      });
      
      clientWs.on("close", () => {
          if (session) {
             // Let garbage collection handle this or cleanup
          }
      });

    } catch (err: any) {
        console.error("Gemini session connection failed: ", err);
        safeClientSend({ type: "error", message: err.message || JSON.stringify(err) });
    }
  });

  // Custom API route for fetching files
  app.get("/api/workspace/file", async (req, res) => {
    const filename = req.query.name as string;
    if (!filename) {
       return res.status(400).json({ error: "No filename provided" });
    }
    
    // Security note: highly insecure, just for demo prototype purposes.
    const filePath = path.join(process.cwd(), filename);
    try {
      const fs = require("fs/promises");
      const content = await fs.readFile(filePath, "utf-8");
      res.json({ content });
    } catch (err: any) {
      if (err.code === "ENOENT") {
         res.status(404).json({ error: "File not found yet" });
      } else {
         res.status(500).json({ error: err.message });
      }
    }
  });

  // Vite middleware for development
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
