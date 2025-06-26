const express = require("express");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const pendingRequests = new Map();

wss.on("connection", (ws) => {
  let clientId = null;

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.type === "register") {
      clientId = data.clientId;
      clients.set(clientId, ws);
      console.log(`[Relay] Client registered: ${clientId}`);
      return;
    }

    if (data.type === "response") {
      const { requestId, body, status, headers, encoding, isStream } = data;
      const res = pendingRequests.get(requestId);
      if (!res) return;

      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          if (key.toLowerCase() === "content-encoding") return;
          res.setHeader(key, value);
        });
      }

      if (isStream) {
        // Initialize response with status, but don't send body yet
        res.status(status || 200);
      } else if (encoding === "base64") {
        res.status(status || 200).send(Buffer.from(body, "base64"));
        pendingRequests.delete(requestId);
      } else {
        res.status(status || 200).send(body);
        pendingRequests.delete(requestId);
      }
    }

    if (data.type === "response-chunk") {
      const { requestId, chunk } = data;
      const res = pendingRequests.get(requestId);
      if (res) {
        res.write(Buffer.from(chunk, "base64"));
      }
    }

    if (data.type === "response-end") {
      const { requestId } = data;
      const res = pendingRequests.get(requestId);
      if (res) {
        res.end();
        pendingRequests.delete(requestId);
      }
    }
  });

  ws.on("close", () => {
    if (clientId) {
      clients.delete(clientId);
      console.log(`[Relay] Client disconnected: ${clientId}`);
    }
  });
});

app.use(express.json());

app.all("/tunnel/:clientId/*", async (req, res) => {
  const clientId = req.params.clientId;
  const clientWs = clients.get(clientId);

  if (!clientWs) {
    return res.status(502).send("Tunnel client not connected");
  }

  const requestId = Math.random().toString(36).slice(2);
  pendingRequests.set(requestId, res);

  clientWs.send(
    JSON.stringify({
      type: "request",
      requestId,
      method: req.method,
      path: req.params[0],
      headers: req.headers,
      body: req.body
    })
  );

  setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      res.status(504).send("Tunnel timeout");
      pendingRequests.delete(requestId);
    }
  }, 10000);
});

server.listen(3005, () => console.log(`Relay server running at http://localhost:3005`));
