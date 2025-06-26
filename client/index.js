const WebSocket = require("ws");
const http = require("http");
const { pipeline } = require("stream");
const { URL } = require("url");

const localTarget = "http://localhost:3000";
const clientId = "dev123";

const targetURL = new URL(localTarget);

const ws = new WebSocket("ws://localhost:3005");

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "register", clientId }));
  console.log(`[Client] Registered as ${clientId}`);
});

const pendingRequests = new Map();

ws.on("message", (msg, isBinary) => {
  if (!isBinary) {
    const data = JSON.parse(msg);

    if (data.type === "request") {
      const { requestId, method, path, headers } = data;

      const reqOptions = {
        hostname: targetURL.hostname,
        port: targetURL.port || 80,
        path: `/${path}`,
        method,
        headers
      };

      const proxyReq = http.request(reqOptions, (proxyRes) => {
        ws.send(
          JSON.stringify({
            type: "response-headers",
            requestId,
            status: proxyRes.statusCode,
            headers: proxyRes.headers
          })
        );

        pipeline(proxyRes, ws, (err) => {
          if (err) console.error("Pipeline error:", err);
          ws.send(JSON.stringify({ type: "response-end", requestId }));
        });
      });

      proxyReq.on("error", (err) => {
        ws.send(
          JSON.stringify({
            type: "response-headers",
            requestId,
            status: 502,
            headers: { "content-type": "text/plain" }
          })
        );
        ws.send(Buffer.from(`Proxy Error: ${err.message}`));
        ws.send(JSON.stringify({ type: "response-end", requestId }));
      });

      pendingRequests.set(requestId, proxyReq);
    }

    if (data.type === "request-end") {
      const req = pendingRequests.get(data.requestId);
      if (req) {
        req.end();
        pendingRequests.delete(data.requestId);
      }
    }
  } else {
    const lastReq = Array.from(pendingRequests.values()).pop();
    if (lastReq) lastReq.write(msg);
  }
});
