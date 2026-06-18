console.log("Testing v1alpha...");
const wsAlpha = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`);
wsAlpha.addEventListener('open', () => { console.log('v1alpha opened!'); wsAlpha.close(); });
wsAlpha.addEventListener('error', (e) => { console.log('v1alpha error!'); });

setTimeout(() => {
  console.log("Testing v1beta...");
  const wsBeta = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`);
  wsBeta.addEventListener('open', () => { console.log('v1beta opened!'); wsBeta.close(); });
  wsBeta.addEventListener('error', (e) => { console.log('v1beta error!'); });
}, 1000);
