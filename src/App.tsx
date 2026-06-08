import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Play, Square, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

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
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const pushingRef = useRef(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [latencies, setLatencies] = useState<LatencyLog[]>([]);
  const [transcripts, setTranscripts] = useState<{role: 'user' | 'agent', text: string}[]>([]);
  const [modelStatus, setModelStatus] = useState<"idle" | "processing" | "fetching_payload" | "executing_code" | "speaking">("idle");
  const [activeCommand, setActiveCommand] = useState("");
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-49), `${new Date().toISOString().split('T')[1].slice(0,-1)}: ${msg}`]);
  }, []);

  const connect = async () => {
    setConnecting(true);
    addLog("Connecting to Live API backend...");
    try {
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        addLog("WebSocket connected.");
        setConnected(true);
        setConnecting(false);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "log") {
           addLog(msg.message);
        } else if (msg.type === "latency") {
           setLatencies(prev => [...prev, { measure: msg.measure, ms: msg.ms, description: msg.description }]);
        } else if (msg.type === "transcription") {
           setTranscripts(prev => {
              const last = prev[prev.length - 1];
              if (last && last.role === msg.role) {
                 const newTranscripts = [...prev];
                 newTranscripts[newTranscripts.length - 1] = { ...last, text: last.text + msg.text };
                 return newTranscripts;
              } else {
                 return [...prev, { role: msg.role, text: msg.text }];
              }
           });
        } else if (msg.type === "status") {
           setModelStatus(msg.status);
           if (msg.status === "executing_code" && msg.command) {
              setActiveCommand(msg.command);
           } else if (msg.status !== "executing_code") {
              setActiveCommand("");
           }
        } else if (msg.type === "interrupted") {
           addLog("Agent interrupted.");
           nextStartTimeRef.current = audioCtxRef.current!.currentTime;
        } else if (msg.type === "error") {
           addLog(`Error: ${msg.message}`);
        } else if (msg.type === "audio") {
           playAudioChunk(msg.audio);
        }
      };

      ws.onclose = () => {
        addLog("WebSocket disconnected.");
        setConnected(false);
        setConnecting(false);
        stopAudio();
      };

      const source = audioCtx.createMediaStreamSource(stream);
      // Deprecated but works reliably for raw PCM dumping
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (!pushingRef.current) return; // Only send when Push-to-Talk is active
        if (ws.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      
    } catch (e: any) {
      addLog(`Failed to connect: ${e.message}`);
      setConnecting(false);
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
    wsRef.current.send(JSON.stringify({ event: "activityStart" }));
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const handlePushEnd = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setPushing(false);
    pushingRef.current = false;
    wsRef.current.send(JSON.stringify({ event: "activityEnd" }));
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
        <header className="flex justify-between items-end border-b border-[#121212] pb-4 mb-4 lg:mb-8 shrink-0">
          <div className="max-w-xl">
             <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#666] mb-2">Project: Ouroboros / Gemini-3.1-Flash-Live</p>
             <h1 className="text-4xl lg:text-7xl font-serif font-light leading-none tracking-tight">Acoustic Priming</h1>
          </div>
          <div className="text-right flex flex-col items-end gap-2">
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
        </header>

        <main className="flex-1 flex flex-col lg:flex-row gap-6 lg:gap-12 min-h-0">
          {/* Left Column: Transcript & Terminal Logs */}
          <div className="flex-1 flex flex-col gap-6 overflow-hidden">
            {/* Component State Visualizer */}
            <div className="h-24 flex items-center gap-1 border-b border-[#E5E5E5] pb-6 shrink-0">
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
                 
                 // Add simple CSS animation based on state
                 const animation = (modelStatus === "speaking" || pushing || modelStatus !== "idle") ? `pulse ${0.5 + (i * 0.1)}s infinite alternate` : 'none';

                 return <div key={i} className={`w-1 transition-all duration-300 ${hClass} ${colorClass}`} style={{ animation }} />
              })}
              
              <div className="ml-4 flex flex-col gap-1 text-[10px] uppercase tracking-widest font-bold">
                 <span>16kHz / 16-bit PCM / Mic Input</span>
                 {pushing && <span className="text-[#FF4500]">Recording Activity...</span>}
                 {!pushing && modelStatus === "processing" && <span className="text-[#0047AB]">Model Processing...</span>}
                 {!pushing && modelStatus === "fetching_payload" && <span className="text-[#0047AB]">Tool Call: fetch_payload()</span>}
                 {!pushing && modelStatus === "executing_code" && <span className="text-[#0047AB]">Tool Call: execute_code()</span>}
                 {!pushing && modelStatus === "speaking" && <span className="text-[#0047AB]">Model Speaking...</span>}
                 {!pushing && modelStatus === "idle" && <span className="text-[#666]">Idle / Listening</span>}
              </div>
            </div>

            <div className="flex flex-col gap-6 overflow-hidden h-full">
              <div className="flex gap-4 shrink-0 h-1/3 min-h-[150px]">
                 <span className="text-[10px] uppercase font-bold text-[#666] shrink-0 w-20 pt-2">Transcript</span>
                 <div className="text-xl lg:text-2xl flex-1 italic font-serif leading-relaxed overflow-y-auto pr-4 flex flex-col gap-3">
                    {transcripts.length === 0 && <span className="text-[#666]">Awaiting conversation...</span>}
                    {transcripts.map((t, i) => (
                       <div key={i} className={`flex flex-col ${t.role === 'user' ? 'text-[#121212]' : 'text-[#0047AB]'}`}>
                          <span className="text-[9px] uppercase font-bold font-sans not-italic tracking-widest opacity-50 mb-1">{t.role}</span>
                          <span>{t.text ? `"${t.text}"` : ""}</span>
                       </div>
                    ))}
                 </div>
              </div>

              <div className="flex gap-4 flex-1 overflow-hidden">
                 <span className="text-[10px] uppercase font-bold text-[#666] shrink-0 w-20 pt-2">Execution</span>
                 <div className="bg-white border border-[#E5E5E5] p-4 lg:p-6 w-full font-mono text-[11px] lg:text-[13px] leading-relaxed shadow-sm overflow-y-auto h-full flex flex-col gap-1">
                    {logs.length === 0 && <div className="text-[#666]">No events logged yet.</div>}
                    {logs.map((L, i) => {
                       const isTool = L.includes("Tool");
                       const isPayload = L.includes("Payload");
                       return (
                         <div key={i} className={`flex items-start gap-2 ${isTool ? 'text-[#0047AB] font-bold mt-2' : isPayload ? 'text-[#FF4500] font-bold mt-2' : 'text-[#666]'}`}>
                            {isTool || isPayload ? <span className="w-2 h-2 rounded-full shrink-0 mt-1.5 opacity-80" style={{ backgroundColor: isTool ? '#0047AB' : '#FF4500'}}></span> : <span className="w-2 shrink-0">&gt;</span>}
                            <span>{L}</span>
                         </div>
                       )
                    })}
                 </div>
              </div>
            </div>
          </div>

          {/* Right Column: Metrics & Controls */}
          <aside className="lg:w-80 flex flex-col lg:border-l border-[#121212] lg:pl-12 shrink-0 overflow-y-auto w-full">
             <div className="mb-8 lg:mb-12 mt-4 lg:mt-0">
               <h2 className="text-xs font-bold uppercase tracking-widest mb-6 border-b border-[#121212] pb-2">Telemetry Logs</h2>
               
               <div className="flex flex-col gap-6">
                  {['T1', 'T2', 'T3'].map(measure => {
                     const logsFound = latencies.filter(l => l.measure === measure);
                     const msStr = logsFound.length > 0 ? `${logsFound[logsFound.length - 1].ms}` : '--';
                     const label = measure === 'T1' ? 'ActivityEnd \u2192 ToolCall' : measure === 'T2' ? 'ToolResp \u2192 ExecuteCode' : 'Exec \u2192 AudioStart';
                     const colorClass = measure === 'T2' ? 'text-[#0047AB]' : '';

                     return (
                       <div key={measure} className="flex justify-between items-baseline">
                         <span className="text-[10px] uppercase tracking-tighter">{measure}: {label}</span>
                         <span className={`text-3xl lg:text-4xl font-serif italic ${colorClass}`}>
                            {msStr}<span className="text-sm italic ml-1 text-[#121212]">ms</span>
                         </span>
                       </div>
                     );
                  })}
               </div>
             </div>

             <div className="mt-auto pt-4 lg:pt-8 w-full">
                <motion.button
                  onMouseDown={handlePushStart}
                  onMouseUp={handlePushEnd}
                  onMouseLeave={handlePushEnd}
                  onTouchStart={handlePushStart}
                  onTouchEnd={handlePushEnd}
                  disabled={!connected}
                  className={`w-full p-6 lg:p-8 flex flex-col items-center justify-center text-center transition-colors ${connected ? (pushing ? 'bg-[#FF4500] text-white' : 'bg-[#121212] text-white hover:bg-[#333]') : 'bg-[#E5E5E5] text-[#999] cursor-not-allowed'}`}
                >
                  <div className={`w-12 h-12 rounded-full border-2 mb-4 flex items-center justify-center ${pushing ? 'border-white/50' : connected ? 'border-white/20' : 'border-[#999]/20'}`}>
                    <Mic className={`w-5 h-5 ${pushing ? 'animate-pulse' : ''}`} />
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.2em] font-bold mb-1">Push to Talk</p>
                  <p className="text-xs opacity-70 font-serif italic">{pushing ? "Recording..." : "Hold spacebar to stream"}</p>
                </motion.button>
                
                <div className="mt-6">
                  <div className="flex justify-between text-[10px] font-bold uppercase mb-2">
                    <span>Model Status</span>
                    <span className={connected ? "text-[#0047AB]" : "text-[#666]"}>
                        {!connected ? "Disconnected" : pushing ? "Listening..." : modelStatus === "processing" ? "Processing" : modelStatus === "fetching_payload" ? "Tool: Fetching payload" : modelStatus === "executing_code" ? "Tool: Executing payload" : modelStatus === "speaking" ? "Speaking" : "Ready / Idle"}
                    </span>
                  </div>
                  <div className="h-[1px] bg-[#121212] w-full mb-2"></div>
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span>VAD Mode</span>
                    <span>Disabled (PTT)</span>
                  </div>
                </div>
             </div>
          </aside>
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
