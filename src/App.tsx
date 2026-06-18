import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Play, Square, Loader2, Terminal, Code, Folder, RefreshCw, Save, FileText, Download, MessageSquare, Activity, Settings, ArrowLeft, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import { WebContainer } from '@webcontainer/api';
import { get, set } from 'idb-keyval';

function pcmToBase64(float32Array: Float32Array): string {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i += 1000) {
       binary += String.fromCharCode(...bytes.subarray(i, i + 1000));
    }
    if (bytes.length % 1000 !== 0) {
       binary += String.fromCharCode(...bytes.subarray(Math.floor(bytes.length / 1000) * 1000));
    }
    return btoa(binary);
}

interface LatencyLog {
  measure: string;
  ms: number;
  description: string;
}

export default function App() {
  const [webcontainer, setWebcontainer] = useState<WebContainer | null>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const isBooting = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const pushingRef = useRef(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [latencies, setLatencies] = useState<LatencyLog[]>([]);
  const [transcripts, setTranscripts] = useState<{role: 'user' | 'agent', text: string}[]>([]);
  const [executionOutputs, setExecutionOutputs] = useState<{command: string, stdout: string, stderr: string, error: string | null}[]>([]);
  const [modelStatus, setModelStatus] = useState<"idle" | "processing" | "fetching_payload" | "executing_code" | "speaking">("idle");
  const [activeCommand, setActiveCommand] = useState("");
  const [activeTab, setActiveTab] = useState<'transcript' | 'logs' | 'output' | 'workspace'>('logs');
  const [payloadText, setPayloadText] = useState("Du är Ouroboros, en autonom AI som lever inuti en WebContainer (en isolerad Linux-sandlåda i min webbläsare).\nDitt aktuella uppdrag: Skapa en fil vid namn index.html som innehåller en snygg, digital klocka byggd i HTML, CSS och JavaScript som uppdateras i realtid.\nNär du har skrivit filen, exekvera kommandot 'npx http-server -p 3000' för att starta en webbserver, så att din klocka renderas live i min Iframe.");
  const [workspaceItems, setWorkspaceItems] = useState<{name: string, path: string, isDirectory: boolean}[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [fetchingFile, setFetchingFile] = useState(false);
  const [currentDir, setCurrentDir] = useState<string>("");
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-49), `${new Date().toISOString().split('T')[1].slice(0,-1)}: ${msg}`]);
  }, []);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const syncToIDB = async (instance: WebContainer) => {
      try {
          const vfs: any = {};
          const traverse = async (dir: string, currentLevel: any) => {
              const files = await instance.fs.readdir(dir, { withFileTypes: true });
              for (const file of files) {
                  if (file.name === 'node_modules' || file.name === '.git') continue;
                  const fullPath = dir === '/' ? `/${file.name}` : `${dir}/${file.name}`;
                  if (file.isDirectory()) {
                      currentLevel[file.name] = { directory: {} };
                      await traverse(fullPath, currentLevel[file.name].directory);
                  } else {
                      const contents = await instance.fs.readFile(fullPath, 'utf-8');
                      currentLevel[file.name] = { file: { contents } };
                  }
              }
          };
          await traverse('/', vfs);
          await set('webcontainer-vfs', vfs);
          addLog("VFS synchronized to IndexedDB.");
      } catch (err) {
          console.error("VFS Sync Error", err);
      }
  };

  useEffect(() => {
    if (isBooting.current) return;
    isBooting.current = true;

    const bootWebContainer = async () => {
      try {
        addLog("Starting WebContainer boot process...");
        const instance = await WebContainer.boot();
        setWebcontainer(instance);
        webcontainerRef.current = instance;
        addLog("WebContainer booted successfully");

        let savedVfs = await get('webcontainer-vfs');
        if (!savedVfs) {
            savedVfs = {
                'plan.md': { file: { contents: '# Autonomous Agent Plan\n\nAwaiting instructions...' } }
            };
        }
        await instance.mount(savedVfs);
        addLog("VFS mounted from IndexedDB.");

        instance.on('server-ready', (port, url) => {
            addLog(`WebContainer server ready on port ${port}`);
            setPreviewUrl(url);
        });

      } catch (error) {
        addLog(`WebContainer boot failed: ${error instanceof Error ? error.message : String(error)}`);
        isBooting.current = false;
      }
    };

    bootWebContainer();
  }, [addLog]);

  const handleWebContainerExecute = async (ws: WebSocket, msg: { id: string, command: string }) => {
    if (!webcontainerRef.current) {
        addLog("Error: WebContainer not booted yet, blocking execution.");
        ws.send(JSON.stringify({
            type: "webcontainer_execute_result",
            commandId: msg.id,
            command: msg.command,
            stdout: "",
            stderr: "WebContainer not booted",
            exitCode: 1
        }));
        return;
    }

    addLog(`Executing in WebContainer: ${msg.command}`);
    try {
        const process = await webcontainerRef.current.spawn('bash', ['-c', msg.command]);
        
        let stdout = "";
        let stderr = "";
        const MAX_OUTPUT = 15000;

        process.output.pipeTo(new WritableStream({
            write(data) {
                if (stdout.length < MAX_OUTPUT) {
                    stdout += data;
                } else if (!stdout.endsWith("\n[TRUNCATED]")) {
                    stdout += "\n[TRUNCATED]";
                }
            }
        }));

        const exitCode = await process.exit;
        
        ws.send(JSON.stringify({
            type: "webcontainer_execute_result",
            commandId: msg.id,
            command: msg.command,
            stdout,
            stderr,
            exitCode
        }));
        await syncToIDB(webcontainerRef.current);
        loadWorkspace(); 
    } catch (err: any) {
        ws.send(JSON.stringify({
            type: "webcontainer_execute_result",
            commandId: msg.id,
            command: msg.command,
            stdout: "",
            stderr: err.message,
            exitCode: 1
        }));
    }
  };

  const connect = async () => {
    setConnecting(true);
    addLog("Connecting to Live API backend...");
    try {
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      addLog("Fetching Ephemeral Token from /api/get-token...");
      const tokenRes = await fetch("/api/get-token");
      if (!tokenRes.ok) {
        throw new Error(`Failed to fetch token: ${tokenRes.status}`);
      }
      const tokenData = await tokenRes.json();
      const token = tokenData.token;
      
      addLog("Token received. Connecting to Gemini Live API...");

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${token}`);
      wsRef.current = ws;

      let pendingExecutionLocal: any = null;
      let executionTimeoutLocal: any = null;

      ws.onopen = () => {
        addLog("WebSocket connected. Sending setup...");
        
        const setupMessage = {
          setup: {
            model: "models/gemini-3.1-flash-live-preview",
            systemInstruction: { parts: [{ text: "You are an agent. When the user tells you they are ready and to fetch your payload, invoke fetch_payload(). Then, process the payload and immediately execute the instructions it gives you using execute_code(). Acknowledge back to the user when you're done." }] },
            generationConfig: {
               responseModalities: ["AUDIO"],
               speechConfig: {
                 voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
               }
            },
            tools: [{
              functionDeclarations: [
                  {
                      name: "fetch_payload",
                      description: "Fetches a massive text payload of system instructions after the user primes you.",
                      parameters: {
                          type: "OBJECT",
                          properties: {
                              thought_signature: {
                                  type: "STRING",
                                  description: "Optional random identifier."
                              }
                          }
                      }
                  },
                  {
                      name: "execute_code",
                      description: "Executes real terminal commands on the host machine.",
                      parameters: {
                          type: "OBJECT",
                          properties: {
                              command: {
                                  type: "STRING",
                                  description: "The shell command to execute."
                              }
                          },
                          required: ["command"]
                      }
                  }
              ]
            }]
          }
        };
        ws.send(JSON.stringify(setupMessage));
        
        setConnected(true);
        setConnecting(false);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
           // We expect JSON strings, Blob might be raw audio or error
           return;
        }

        try {
          const msg = JSON.parse(event.data);
          
          if (msg.serverContent) {
              const audioData = msg.serverContent.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioData) {
                  setModelStatus("speaking");
                  playAudioChunk(audioData);
              }
              if (msg.serverContent.interrupted) {
                  addLog("Agent interrupted.");
                  setModelStatus("idle");
              }
              if (msg.serverContent.turnComplete) {
                  setModelStatus("idle");
              }
              
              const agentText = msg.serverContent?.modelTurn?.parts?.[0]?.text;
              if (agentText) {
                 setTranscripts(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === "agent") {
                       const newTranscripts = [...prev];
                       newTranscripts[newTranscripts.length - 1] = { ...last, text: last.text + agentText };
                       return newTranscripts;
                    } else {
                       return [...prev, { role: "agent", text: agentText }];
                    }
                 });
              }
          }

          if (msg.toolCall) {
              const call = msg.toolCall.functionCalls?.[0];
              if (call) {
                  addLog(`Tool invoked: ${call.name}`);
                  
                  if (call.name === "fetch_payload") {
                      setModelStatus("fetching_payload");
                      const thought_signature = call.id || (call.args ? call.args.thought_signature as string : undefined) || "unknown";
                      
                      let contextualPayload = payloadText; // read from local state
                      
                      const responseMsg = {
                          toolResponse: {
                              functionResponses: [{
                                  id: call.id,
                                  name: call.name,
                                  response: {
                                      payload: contextualPayload,
                                      thought_signature
                                  }
                              }]
                          }
                      };
                      ws.send(JSON.stringify(responseMsg));
                      addLog(`Payload injected, ID: ${thought_signature}`);
                  } else if (call.name === "execute_code") {
                      const thought_signature = call.id || (call.args ? call.args.thought_signature as string : undefined) || "unknown";
                      const command = (call.args?.command as string) || "echo no-op";
                      
                      setModelStatus("executing_code");
                      setActiveCommand(command);
                      addLog(`Executing code: ${command}`);
                      
                      const secureCommand = `export CI=true && ${command}`;
                      const commandId = `cmd-${Date.now()}`;
                      
                      const executeInWebContainer = async () => {
                         try {
                            if (!webcontainerRef.current) throw new Error("WebContainer not ready.");
                            const process = await webcontainerRef.current.spawn("jsh", ["-c", secureCommand]);
                            let stdout = "";
                            let stderr = "";
                            process.output.pipeTo(
                              new WritableStream({
                                write(data) { stdout += data; }
                              })
                            );
                            const exitCode = await process.exit;
                            
                            const truncatedStdout = stdout.length > 15000 ? "... [TRUNCATED] ...\n" + stdout.substring(stdout.length - 15000) : stdout;
                            const truncatedStderr = stderr.length > 15000 ? "... [TRUNCATED] ...\n" + stderr.substring(stderr.length - 15000) : stderr;

                            const responseMsg = {
                                toolResponse: {
                                    functionResponses: [{
                                        id: call.id,
                                        name: call.name,
                                        response: {
                                            stdout: truncatedStdout,
                                            stderr: truncatedStderr,
                                            error: null,
                                            exitCode,
                                            thought_signature
                                        }
                                    }]
                                }
                            };
                            ws.send(JSON.stringify(responseMsg));
                            addLog(`Execution completed.`);
                            setExecutionOutputs(prev => [...prev, { command, stdout, stderr, error: null }]);
                            setActiveTab('output');
                         } catch (err: any) {
                            const responseMsg = {
                                toolResponse: {
                                    functionResponses: [{
                                        id: call.id,
                                        name: call.name,
                                        response: {
                                            stdout: "",
                                            stderr: err.message,
                                            error: err.message,
                                            exitCode: 1,
                                            thought_signature
                                        }
                                    }]
                                }
                            };
                            ws.send(JSON.stringify(responseMsg));
                            addLog(`Execution failed: ${err.message}`);
                         }
                      };
                      executeInWebContainer();
                  }
              }
          }
        } catch (err: any) {
          console.error("Error parsing message", err);
        }
      };

      ws.onclose = (event) => {
        addLog(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
        setConnected(false);
        setConnecting(false);
        stopAudio();
      };

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (!pushingRef.current) return;
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          const msg = {
            realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64 } }
          };
          ws.send(JSON.stringify(msg));
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      
    } catch (e: any) {
      addLog(`Failed to connect: ${e.message}`);
      setConnecting(false);
    }
  };

  const loadWorkspace = async (dir: string = currentDir) => {
     setFetchingFile(true);
     setWorkspaceError(null);
     try {
       if (!webcontainerRef.current) {
           throw new Error("WebContainer not booted.");
       }
       const files = await webcontainerRef.current.fs.readdir(dir || '/', { withFileTypes: true });
       const items = files.map(f => ({
           name: f.name,
           path: dir === '/' || !dir ? `/${f.name}` : `${dir}/${f.name}`,
           isDirectory: f.isDirectory()
       }));
       setWorkspaceItems(items);
       setCurrentDir(dir || '/');
     } catch (err: any) {
       setWorkspaceError(err.message);
     } finally {
       setFetchingFile(false);
     }
  };

  const downloadFile = async (filepath: string) => {
     try {
       if (!webcontainerRef.current) return;
       const contents = await webcontainerRef.current.fs.readFile(filepath);
       const blob = new Blob([contents]);
       const url = window.URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       const parts = filepath.split('/');
       a.download = parts[parts.length - 1];
       document.body.appendChild(a);
       a.click();
       a.remove();
       window.URL.revokeObjectURL(url);
     } catch (err) {
       console.error("Download error:", err);
       alert("Could not download file.");
     }
  };

  const navigateUp = () => {
      if (!currentDir) return;
      const parts = currentDir.split('/').filter(Boolean);
      parts.pop();
      loadWorkspace(parts.join('/'));
  };

  useEffect(() => {
     if (activeTab === 'workspace') {
        loadWorkspace();
     }
  }, [activeTab]);

  const savePayload = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
       wsRef.current.send(JSON.stringify({ type: "set_payload", payload: payloadText }));
       addLog("Payload updated on server.");
    } else {
       addLog("Cannot save payload: WebSocket disconnected.");
    }
  };

  const playAudioChunk = (base64: string) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    // Decode base64 quickly
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new DataView(buffer);
    for (let i = 0; i < binary.length; i++) {
        view.setUint8(i, binary.charCodeAt(i));
    }
    
    const sampleRate = 24000;
    const numSamples = buffer.byteLength / 2;
    const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < numSamples; i++) {
        channelData[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    
    const currentTime = ctx.currentTime;
    if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.1;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
  };

  const stopAudio = () => {
    if (processorRef.current) {
       processorRef.current.disconnect();
       processorRef.current = null;
    }
    if (streamRef.current) {
       streamRef.current.getTracks().forEach(t => t.stop());
       streamRef.current = null;
    }
    if (audioCtxRef.current) {
       audioCtxRef.current.close();
       audioCtxRef.current = null;
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // Push-to-Talk Handlers
  const handlePushStart = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setPushing(true);
    pushingRef.current = true;
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const handlePushEnd = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setPushing(false);
    pushingRef.current = false;
    // Send turnComplete so the agent knows we stopped talking if VAD is slow
    wsRef.current.send(JSON.stringify({ clientContent: { turnComplete: true } }));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
         if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
         e.preventDefault();
         handlePushStart();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
         if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
         e.preventDefault();
         handlePushEnd();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handlePushStart, handlePushEnd]);

  useEffect(() => {
    return () => {
      disconnect();
      stopAudio();
    };
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#FAF9F6] text-[#121212] p-4 lg:p-8 font-sans overflow-hidden border-[8px] lg:border-[12px] border-white">
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end border-b border-[#121212] pb-6 mb-4 lg:mb-8 shrink-0 gap-6 lg:gap-0">
          <div className="max-w-xl">
             <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#666] mb-2">Project: Ouroboros / Gemini-3.1-Flash-Live</p>
             <h1 className="text-4xl lg:text-7xl font-serif font-light leading-none tracking-tight">Acoustic Priming</h1>
          </div>
          
          <div className="flex flex-col lg:flex-row items-start lg:items-end gap-6 flex-1 lg:justify-end">
             <div className="flex items-center gap-1 shrink-0">
               {Array.from({ length: 8 }).map((_, i) => {
                  let hClass = "h-4";
                  let colorClass = "bg-[#121212] opacity-20";
                  
                  if (modelStatus === "speaking" || pushing) {
                     const heights = ["h-8", "h-12", "h-16", "h-20", "h-14", "h-10", "h-6", "h-8"];
                     hClass = heights[i];
                     colorClass = pushing ? "bg-[#FF4500]" : "bg-[#0047AB]";
                  } else if (modelStatus === "processing" || modelStatus === "fetching_payload" || modelStatus === "executing_code") {
                     const heights = ["h-6", "h-8", "h-10", "h-12", "h-10", "h-8", "h-6", "h-6"];
                     hClass = heights[i];
                     colorClass = "bg-[#0047AB] opacity-50"; 
                  }
                  
                  const animation = (modelStatus === "speaking" || pushing || modelStatus !== "idle") ? `pulse ${0.5 + (i * 0.1)}s infinite alternate` : 'none';

                  return <div key={i} className={`w-1 transition-all duration-300 ${hClass} ${colorClass}`} style={{ animation }} />
               })}
               
               <div className="ml-4 flex flex-col gap-0.5 text-[9px] uppercase tracking-widest font-bold">
                  <span className="text-[#999]">Microphone Array</span>
                  {pushing && <span className="text-[#FF4500]">Recording...</span>}
                  {!pushing && modelStatus === "processing" && <span className="text-[#0047AB]">Processing...</span>}
                  {!pushing && modelStatus === "fetching_payload" && <span className="text-[#0047AB]">VAD: Injection</span>}
                  {!pushing && modelStatus === "executing_code" && <span className="text-[#0047AB]">VAD: Execute</span>}
                  {!pushing && modelStatus === "speaking" && <span className="text-[#0047AB]">Speaking...</span>}
                  {!pushing && modelStatus === "idle" && <span className="text-[#666]">Idle</span>}
               </div>
             </div>

             <div className="text-right flex flex-col items-start lg:items-end gap-2">
               <div className={`flex items-center gap-2 text-xs font-mono uppercase ${connected ? 'text-[#0047AB]' : 'text-[#FF4500]'}`}>
                 <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[#0047AB]' : 'bg-[#FF4500]'}`} />
                 {connected ? 'LIVE API ONLINE' : 'OFFLINE'}
               </div>
               {!connected ? (
                 <button onClick={connect} disabled={connecting} className="border border-[#121212] text-[#121212] px-4 py-1.5 font-bold uppercase text-[10px] flex items-center gap-2 hover:bg-[#121212] hover:text-white transition-colors disabled:opacity-50">
                   {connecting ? <Loader2 className="w-3 h-3 animate-spin"/> : <Play className="w-3 h-3" />}
                   Connect
                 </button>
               ) : (
                 <button onClick={disconnect} className="bg-[#121212] text-white px-4 py-1.5 font-bold uppercase text-[10px] flex items-center gap-2 hover:bg-black transition-colors">
                   <Square className="w-3 h-3" />
                   Disconnect
                 </button>
               )}
             </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Left Panel: Voice Comms & System Overrides */}
          <aside className="lg:w-80 flex flex-col gap-6 lg:border-r border-[#E5E5E5] lg:pr-6 shrink-0 lg:overflow-y-auto w-full">
             <div className="pt-2 w-full">
                <motion.button
                  onMouseDown={handlePushStart}
                  onMouseUp={handlePushEnd}
                  onMouseLeave={handlePushEnd}
                  onTouchStart={handlePushStart}
                  onTouchEnd={handlePushEnd}
                  disabled={!connected}
                  className={`w-full p-6 lg:p-8 flex flex-col items-center justify-center text-center transition-colors shadow-sm ${connected ? (pushing ? 'bg-[#FF4500] text-white' : 'bg-[#121212] text-white hover:bg-[#333]') : 'bg-[#E5E5E5] text-[#999] cursor-not-allowed'}`}
                >
                  <div className={`w-12 h-12 rounded-full border-2 mb-4 flex items-center justify-center ${pushing ? 'border-white/50' : connected ? 'border-white/20' : 'border-[#999]/20'}`}>
                    <Mic className={`w-5 h-5 ${pushing ? 'animate-pulse' : ''}`} />
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.2em] font-bold mb-1">Push to Talk</p>
                  <p className="text-xs opacity-70 font-serif italic">{pushing ? "Recording..." : "Hold spacebar to stream"}</p>
                </motion.button>
                
                <div className="mt-6 bg-white border border-[#E5E5E5] p-4 shadow-sm">
                  <div className="flex justify-between text-[10px] font-bold uppercase mb-2">
                    <span>Model Status</span>
                    <span className={connected ? "text-[#0047AB]" : "text-[#666]"}>
                        {!connected ? "Disconnected" : pushing ? "Listening..." : modelStatus === "processing" ? "Processing" : modelStatus === "fetching_payload" ? "Tool: Fetching payload" : modelStatus === "executing_code" ? "Tool: Executing payload" : modelStatus === "speaking" ? "Speaking" : "Ready / Idle"}
                    </span>
                  </div>
                  <div className="h-[1px] bg-[#121212] w-full mb-2"></div>
                  <div className="flex justify-between text-[10px] font-bold uppercase text-[#999]">
                    <span>VAD Mode</span>
                    <span>Disabled (PTT)</span>
                  </div>
                </div>
             </div>

             <div className="flex flex-col gap-3 flex-1 min-h-[300px]">
                <div className="flex justify-between items-center shrink-0">
                   <p className="text-[10px] uppercase font-bold tracking-widest text-[#121212]">System Override</p>
                   <button onClick={savePayload} className="bg-[#121212] text-white px-3 py-1.5 font-bold uppercase text-[9px] flex items-center gap-1.5 hover:bg-black transition-colors">
                      <Save className="w-3 h-3" /> Save Payload
                   </button>
                </div>
                <p className="text-xs text-[#666] italic font-serif">Injected when agent calls fetch_payload step.</p>
                <textarea 
                   value={payloadText}
                   onChange={(e) => setPayloadText(e.target.value)}
                   className="w-full flex-1 bg-white border border-[#E5E5E5] p-3 font-mono text-[11px] leading-relaxed shadow-sm resize-none focus:outline-none focus:border-[#121212]"
                   placeholder="Enter exact system instructions..."
                />
             </div>
          </aside>

          {/* Center Panel: Logs, Terminal, Workspace */}
          <div className="lg:flex-1 flex flex-col gap-4 lg:overflow-hidden flex-shrink-0 lg:pr-2">
             {/* Tabs */}
             <div className="flex gap-4 border-b border-[#E5E5E5] shrink-0 overflow-x-auto whitespace-nowrap pt-2">
                <button onClick={() => setActiveTab('transcript')} className={`pb-2 text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 ${activeTab === 'transcript' ? 'border-b-2 border-[#121212] text-[#121212]' : 'text-[#999] hover:text-[#666]'}`}>
                  <MessageSquare className="w-3 h-3" /> Transcript
                </button>
                <button onClick={() => setActiveTab('logs')} className={`pb-2 text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 ${activeTab === 'logs' ? 'border-b-2 border-[#121212] text-[#121212]' : 'text-[#999] hover:text-[#666]'}`}>
                  <Activity className="w-3 h-3" /> Logs & Telemetry
                </button>
                <button onClick={() => setActiveTab('output')} className={`pb-2 text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 ${activeTab === 'output' ? 'border-b-2 border-[#121212] text-[#121212]' : 'text-[#999] hover:text-[#666]'}`}>
                  <Terminal className="w-3 h-3" /> Terminal Output
                </button>
                <button onClick={() => setActiveTab('workspace')} className={`pb-2 text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 ${activeTab === 'workspace' ? 'border-b-2 border-[#121212] text-[#121212]' : 'text-[#999] hover:text-[#666]'}`}>
                  <Folder className="w-3 h-3" /> VFS Explorer
                </button>
             </div>

             {activeTab === 'transcript' && (
                <div className="flex flex-col gap-4 overflow-hidden h-[500px] lg:h-full">
                   <div className="bg-white border border-[#E5E5E5] p-6 w-full font-serif text-lg leading-relaxed shadow-sm overflow-y-auto h-full flex flex-col gap-4">
                      {transcripts.length === 0 && <div className="text-[#999] italic">Awaiting conversation...</div>}
                      {transcripts.map((t, i) => (
                         <div key={i} className={`flex flex-col ${t.role === 'user' ? 'text-[#121212]' : 'text-[#0047AB]'}`}>
                            <span className="text-[9px] uppercase font-bold font-sans not-italic tracking-widest opacity-50 mb-1">{t.role}</span>
                            <span>{t.text ? `"${t.text}"` : ""}</span>
                         </div>
                      ))}
                   </div>
                </div>
             )}

             {activeTab === 'logs' && (
                <div className="flex flex-col gap-4 overflow-hidden h-[500px] lg:h-full">
                   <div className="bg-white border border-[#E5E5E5] p-4 w-full font-mono text-[11px] leading-relaxed shadow-sm overflow-y-auto h-full flex flex-col gap-1">
                      {logs.length === 0 && <div className="text-[#666]">No events logged yet.</div>}
                      {logs.map((L, i) => {
                         const isTool = L.includes("Tool") || L.includes("Executing in WebContainer");
                         const isPayload = L.includes("Payload");
                         return (
                           <div key={i} className={`flex items-start gap-2 ${isTool ? 'text-[#0047AB] font-bold mt-2' : isPayload ? 'text-[#FF4500] font-bold mt-2' : 'text-[#666]'}`}>
                              {isTool || isPayload ? <span className="w-2 h-2 rounded-full shrink-0 mt-1.5 opacity-80" style={{ backgroundColor: isTool ? '#0047AB' : '#FF4500'}}></span> : <span className="w-2 shrink-0">&gt;</span>}
                              <span>{L}</span>
                           </div>
                         )
                      })}
                   </div>
                   
                   {latencies.length > 0 && (
                       <div className="bg-white border border-[#E5E5E5] p-4 flex gap-6 overflow-x-auto shadow-sm">
                          {['T1', 'T2', 'T3'].map(measure => {
                             const logsFound = latencies.filter(l => l.measure === measure);
                             const msStr = logsFound.length > 0 ? `${logsFound[logsFound.length - 1].ms}` : '--';
                             const label = measure === 'T1' ? 'Ping Tool' : measure === 'T2' ? 'Tool Execute' : 'Ping Audio';
                             return (
                               <div key={measure} className="flex flex-col shrink-0">
                                 <span className="text-[9px] uppercase tracking-tighter text-[#999]">{measure}: {label}</span>
                                 <span className={`text-xl font-serif italic ${measure === 'T2' ? 'text-[#0047AB]' : 'text-[#121212]'}`}>
                                    {msStr}<span className="text-[10px] italic ml-1 text-[#666]">ms</span>
                                 </span>
                               </div>
                             );
                          })}
                       </div>
                   )}
                </div>
             )}

             {activeTab === 'output' && (
                <div className="flex flex-col gap-4 overflow-hidden h-[500px] lg:h-full pr-2">
                   <div className="flex-1 overflow-y-auto flex flex-col gap-6">
                      {executionOutputs.length === 0 ? (
                         <div className="text-[#999] italic mt-4 text-sm font-serif">No commands have been executed yet.</div>
                      ) : (
                         executionOutputs.map((out, i) => (
                            <div key={i} className="flex flex-col gap-2">
                               <div className="font-mono text-[10px] bg-[#121212] text-white px-3 py-1.5 inline-block w-fit font-bold rounded-sm shadow-sm">
                                  ❯  {out.command}
                               </div>
                               {out.stdout && (
                                  <pre className="bg-white border border-[#E5E5E5] text-[#121212] p-4 font-mono text-[11px] overflow-x-auto rounded-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                                     {out.stdout}
                                  </pre>
                               )}
                               {(out.stderr || out.error) && (
                                  <pre className="bg-[#FF4500]/5 text-[#FF4500] border border-[#FF4500]/20 p-4 font-mono text-[11px] overflow-x-auto rounded-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                                     {out.stderr || out.error}
                                  </pre>
                               )}
                            </div>
                         ))
                      )}
                   </div>
                </div>
             )}

             {activeTab === 'workspace' && (
                <div className="flex flex-col gap-4 overflow-hidden h-[400px] lg:h-full">
                   <div className="flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-2">
                         {currentDir && (
                            <button onClick={navigateUp} className="text-[#666] hover:text-[#121212] p-1 border border-[#E5E5E5] bg-white shadow-sm">
                               <ArrowLeft className="w-3 h-3" />
                            </button>
                         )}
                         <p className="text-xs text-[#121212] font-mono font-bold bg-white px-3 py-1.5 border border-[#E5E5E5] shadow-sm">{currentDir ? `/${currentDir}` : '/ (Root)'}</p>
                      </div>
                      <button onClick={() => loadWorkspace(currentDir)} disabled={fetchingFile} className="bg-white border border-[#E5E5E5] text-[#121212] px-3 py-1.5 font-bold uppercase text-[9px] flex items-center gap-1.5 hover:bg-[#F9F9F9] transition-colors disabled:opacity-50 shadow-sm">
                         {fetchingFile ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3" />} Sync VFS
                      </button>
                   </div>

                   <div className="flex-1 bg-white border border-[#E5E5E5] shadow-sm overflow-y-auto">
                      {workspaceError ? (
                         <div className="p-6 text-[#FF4500] font-mono text-sm">{workspaceError}</div>
                      ) : workspaceItems.length === 0 ? (
                         <div className="p-6 text-[#999] italic font-serif flex items-center justify-center h-full">WebContainer Workspace is empty.</div>
                      ) : (
                         <table className="w-full text-left border-collapse">
                           <thead>
                             <tr className="border-b border-[#E5E5E5] text-[9px] uppercase tracking-widest text-[#999] bg-[#F9F9F9]">
                               <th className="p-3 font-bold pl-4">Name</th>
                               <th className="p-3 font-bold text-right pr-4">Actions</th>
                             </tr>
                           </thead>
                           <tbody className="text-sm font-mono">
                             {workspaceItems.map((item, i) => (
                               <tr key={i} className="border-b border-[#E5E5E5] last:border-b-0 hover:bg-[#F9F9F9] transition-colors group">
                                 <td className="p-3 pl-4 flex items-center gap-3">
                                   {item.isDirectory ? <Folder className="w-4 h-4 text-[#0047AB]" /> : <FileText className="w-4 h-4 text-[#666]" />}
                                   {item.isDirectory ? (
                                     <button 
                                        onClick={() => loadWorkspace(item.path)}
                                        className="text-[#0047AB] hover:underline truncate max-w-[150px] lg:max-w-[250px] text-left"
                                     >
                                        {item.name}/
                                     </button>
                                   ) : (
                                     <span className="text-[#121212] truncate max-w-[150px] lg:max-w-[250px]">{item.name}</span>
                                   )}
                                 </td>
                                 <td className="p-3 pr-4 text-right">
                                   {!item.isDirectory && (
                                     <button 
                                       onClick={() => downloadFile(item.path)}
                                       className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest px-2 py-1 border border-[#121212] text-[#121212] hover:bg-[#121212] hover:text-white transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                     >
                                       <Download className="w-3 h-3" /> DL
                                     </button>
                                   )}
                                 </td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                      )}
                   </div>
                </div>
             )}
          </div>

          {/* Right Panel: Live Preview Iframe */}
          <div className="lg:w-1/3 flex flex-col bg-white border border-[#E5E5E5] shadow-sm relative overflow-hidden shrink-0 min-h-[400px]">
             <div className="bg-[#121212] text-white p-3 flex items-center justify-between shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-2">
                   <Globe className="w-4 h-4 text-[#0047AB]" />
                   <span className="text-[10px] uppercase font-bold tracking-widest text-[#E5E5E5]">Container Preview</span>
                </div>
                {previewUrl ? 
                   <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] hover:underline text-[#0047AB] font-mono truncate max-w-[150px] block">{previewUrl}</a> :
                   <span className="text-[9px] text-[#666] font-mono">No active port</span>
                }
             </div>
             <div className="flex-1 w-full bg-[#FAF9F6]">
                {previewUrl ? (
                   <iframe src={previewUrl} className="w-full h-full border-none" title="Live Preview" allow="cross-origin-isolated" />
                ) : (
                   <div className="flex flex-col items-center justify-center h-full text-[#999] p-6 text-center gap-4">
                      <Loader2 className="w-6 h-6 animate-spin text-[#121212]/20" />
                      <p className="text-xs italic font-serif opacity-80">Awaiting WebContainer server bindings...</p>
                      <p className="text-[9px] uppercase tracking-widest font-bold mt-2">Waiting for 'npm run dev'</p>
                   </div>
                )}
             </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-6 lg:mt-8 pt-4 border-t border-[#E5E5E5] flex justify-between gap-4 text-[9px] uppercase tracking-widest text-[#999] shrink-0 overflow-x-auto whitespace-nowrap">
          <div>Experimental Acoustic Architecture // 2026</div>
          <div>BidiGenerateContentRealtimeInput Protocol Enabled</div>
          <div>Ref: Node.js/Express ChildProcess Instance</div>
        </footer>
    </div>
  );
}
