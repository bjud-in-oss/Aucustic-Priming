const WebSocket = require('ws');
console.log("Testing v1alpha...");
const wsAlpha = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`);
wsAlpha.on('open', () => { console.log('v1alpha opened!'); wsAlpha.close(); });
wsAlpha.on('error', (e) => { console.log('v1alpha error:', e.message); });

setTimeout(() => {
  console.log("Testing v1beta...");
  const wsBeta = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`);
  wsBeta.on('open', () => { console.log('v1beta opened!'); wsBeta.close(); });
  wsBeta.on('error', (e) => { console.log('v1beta error:', e.message); });
}, 1000);
