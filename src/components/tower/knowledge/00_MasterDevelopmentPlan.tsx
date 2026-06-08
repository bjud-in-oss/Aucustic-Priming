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
1.  **File System API:** Backend endpoints (\`/api/workspace/list\` and \`/api/workspace/download\`) will be created to read the directory structure and serve raw files as attachments.
2.  **Visual Explorer:** The UI will present an interactive file tree or list. 
3.  **One-Click Download:** Files can be previewed or directly downloaded to the user's local machine via standard browser mechanics.

## Agile Cycles
We are preparing for Cycle 4 execution of the Workspace Explorer.
`;
