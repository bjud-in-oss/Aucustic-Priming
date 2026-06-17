export const MasterDevelopmentPlan = `
# Master System Documentation

## Architecture & Goals
- Real-time voice interaction using Gemini Live API.
- Execute code and visualize the output properly.
- Persist terminal logs/conversation context for seamless agent continuity.

## Feature: Distinct Execution Output
Instead of treating code execution as just a hidden tool run, the server will broadcast \`execution_output\` (stdout/stderr) over WebSockets. The client will render this in a dedicated, professionally scoped terminal window or tab, giving immediate feedback on what the agent did.

## Feature: Terminal Context Injection
To provide historical context to the agent, the server will capture and store terminal logs + conversation history either locally or in-memory, and inject it as part of the initial system prompt upon websocket reconnection, giving the agent amnesic-immunity.

## Feature: Professional Workspace Explorer
To elevate the Workspace tab from a simple fetch-input into a professional utility:
1.  **File System API:** Backend endpoints (\`/api/workspace/list\` and \`/api/workspace/download\`) will be created to read the directory structure and serve raw files as attachments. Added directory traversal via query params.
2.  **Visual Explorer:** The UI will present an interactive file tree or list. 
3.  **One-Click Download:** Files can be downloaded to the user's local machine via standard browser mechanics.

## Feature: UI Layout Modernization
1.  **Global Header:** Moved the microphone/status visualizer (pulsing bars) from the terminal tab into the global header. It now serves as a persistent, global system state indicator.
2.  **Semantic Naming:** "Payload" is renamed to "Input" throughout the application for broader clarity.
3.  **Tab Restructuring:** The chaotic generic "Terminal" tab is split into semantic responsibilities:
    *   **Transcript:** Historic conversation dialogue.
    *   **System Logs:** Telemetry and tool execution tracking.
    *   **Output:** The raw stdout/stderr from executing code.
    *   **Workspace:** The file directory browser.
    *   **Input:** The system instructions injector.

## Feature: Client-Side WebContainer Node.js Environment
To provide a full, isolated Node.js environment directly in the browser with full performance:
1.  **Cross-Origin Isolation:** \`vite.config.ts\` requires headers \`Cross-Origin-Embedder-Policy: require-corp\` and \`Cross-Origin-Opener-Policy: same-origin\` to enable \`SharedArrayBuffer\`.
2.  **WebContainer Bootstrapping:** \`src/App.tsx\` must instantiate \`@webcontainer/api\` exactly once during component mount via a dedicated \`useEffect\` with proper tracking refs, storing the instance in state and logging status to the system telemetry tracker.

## Feature: Cycle 5 - Bridging the Execution Gap
To transition execution from the external backend into the client-side WebContainer:
1.  **WebSocket Command Routing:** The `execute_code` tool on `server.ts` will stop using `child_process.exec`. Instead, the server will emit the raw bash command via WebSocket to the connected client.
2.  **WebContainer Execution:** The client receives the WebSocket event and immediately spins up a process inside the WebContainer instance using `webcontainerInstance.spawn()`.
3.  **Self-Modifying Memory (`plan.md`):** A persistent state mechanism within the WebContainer volume will be implemented. The agent can use terminal commands (e.g., `echo` or `cat`) to read/write a `plan.md` file. This acts as a localized, autonomous memory payload, mimicking classic bash routine memory loops.

## Feature: Cycle 5 & 6 - End-to-End Agentic Sandbox
To realize a genuine autonomous agent platform and fix cognitive file mismatches, we are building a 3-Pillar Sandbox architecture:
1.  **VFS Persistence via IndexedDB:** Client-side storage (IndexedDB) acts as a hard drive. On boot, the WebContainer receives the IndexedDB state (bypassing the 5MB localStorage limit), establishing long-term memory for `plan.md` and generated code. Snapshotting occurs on command completion, aggressively excluding heavy folders like `node_modules` to prevent I/O lockups.
2.  **Server-Ready Visuals:** The system listens for `webcontainerInstance.on('server-ready')` to capture the ephemeral preview URL and automatically injects it into a live Iframe.
3.  **3-Panel UI Architecture:** Refactoring the application view from a strict Tab layout to an industrial 3-pane split:
    *   *Left:* Voice Comms & System Overrides.
    *   *Center:* Terminal Logs & Direct WebContainer VFS Explorer.
    *   *Right:* Live Agent-Built Application Iframe.

## Agile Cycles
We are currently operating at the start of Cycle 6: Redefining the user interface layout and implementing VFS state synchronization via IndexedDB.
`;

export const Cycle7_DirectStreamAlignment = {
  title: "Cycle 7: Direct-Stream Alignment & Ephemeral Auth",
  objective: "Decentralize WebSocket streaming to the frontend (Browser-Direct) to eliminate backend latency, leveraging Ephemeral Tokens for security and WebContainers for edge-native tool execution.",
  status: "PLANNED",
  architecture_shifts: [
    {
      component: "Backend (Express/Node.js)",
      previous_role: "Live API Proxy & Stream Handler",
      new_role: "Stateless Token Distributor",
      details: "Exposes a single endpoint `/api/get-token`. Uses the master API key to generate a Google GenAI Ephemeral Token (valid for 1 min connect / 30 min session) and returns it to the client. No heavy I/O."
    },
    {
      component: "Frontend (React/App.tsx)",
      previous_role: "Dumb Terminal / UI Renderer",
      new_role: "Live API Master Controller",
      details: "Initiates the WebSocket directly to Gemini `v1alpha` endpoint using the ephemeral `access_token`. Handles `sendRealtimeInput` for Acoustic Priming (audio/mic) natively in the browser."
    },
    {
      component: "WebContainers (Layer 1)",
      previous_role: "Backend-synced execution environment",
      new_role: "Edge-native Execution Engine",
      details: "Tool calls (`BidiGenerateContentToolCall`) generated by Gemini are intercepted directly in the browser and executed immediately in the local WebContainer. The `ToolResponse` is sent straight back to Google. Zero backend hops."
    }
  ],
  implementation_steps: [
    "1. Skapa `/api/get-token` i backend som genererar en Ephemeral Token via `@google/genai`.",
    "2. Bygg om `App.tsx` för att hämta token vid uppstart.",
    "3. Initiera WebSocket-klienten (Live API) i React med `v1alpha` och den hämtade tokenen.",
    "4. Flytta Audio/PCM-inspelning och Acoustic Priming (Push-to-talk) från backend-bro till direkt API-injektion.",
    "5. Mappa WebContainer-anrop direkt mot frontendens WebSocket-lyssnare."
  ]
};
