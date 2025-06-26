const express = require("express");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // clientId -> WebSocket
const streams = new Map(); // requestId -> res

wss.on("connection", (ws) => {
  let clientId;

  ws.on("message", (msg, isBinary) => {
    if (!isBinary) {
      const data = JSON.parse(msg);

      if (data.type === "register") {
        clientId = data.clientId;
        clients.set(clientId, ws);
        console.log(`[Relay] Client registered: ${clientId}`);
        return;
      }

      if (data.type === "response-headers") {
        const { requestId, status, headers } = data;
        const res = streams.get(requestId);
        if (res) {
          res.writeHead(status || 200, headers);
        }
        return;
      }

      if (data.type === "response-end") {
        const res = streams.get(data.requestId);
        if (res) res.end();
        streams.delete(data.requestId);
        return;
      }
    } else {
      // Binary data -> pipe to HTTP response
      const { requestId } = ws; // must be tracked
      const res = streams.get(requestId);
      if (res) res.write(msg);
    }
  });

  ws.on("close", () => {
    if (clientId) clients.delete(clientId);
  });
});

app.all("/tunnel/:clientId/*", async (req, res) => {
  const clientId = req.params.clientId;
  const clientWs = clients.get(clientId);
  const path = req.params[0];

  if (!clientWs) return res.status(502).send("Tunnel client not connected");

  const requestId = Math.random().toString(36).substring(2);
  streams.set(requestId, res);
  clientWs.requestId = requestId;

  const requestPayload = JSON.stringify({
    type: "request",
    requestId,
    method: req.method,
    path,
    headers: req.headers
  });

  clientWs.send(requestPayload);

  req.on("data", (chunk) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(chunk, { binary: true });
    }
  });

  req.on("end", () => {
    clientWs.send(JSON.stringify({ type: "request-end", requestId }));
  });

  setTimeout(() => {
    if (streams.has(requestId)) {
      res.status(504).send("Tunnel timeout");
      streams.delete(requestId);
    }
  }, 10000);
});

server.listen(3005, () => {
  console.log("Relay server listening on http://localhost:3005");
});
