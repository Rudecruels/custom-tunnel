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
    let data;
    try {
      data = JSON.parse(msg);
      console.log(`[Server] Received message:`, data);
    } catch (err) {
      console.error(`[Server] Failed to parse message:`, msg.toString(), err);
      return;
    }

    if (data.type === "register") {
      clientId = data.clientId;
      clients.set(clientId, ws);
      console.log(`[Relay] Client registered: ${clientId}`);
      return;
    }

    if (data.type === "response") {
      const { requestId, body, status, headers, encoding, isStream } = data;
      const res = pendingRequests.get(requestId);
      if (!res) {
        console.warn(`[Server] No pending request for ID: ${requestId}`);
        return;
      }

      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          if (key.toLowerCase() === "content-encoding") return;
          res.setHeader(key, value);
        });
      }

      if (isStream) {
        res.status(status || 200);
        console.log(`[Server] Started streaming response for request ${requestId}`);
      } else if (encoding === "base64") {
        try {
          res.status(status || 200).send(Buffer.from(body, "base64"));
          pendingRequests.delete(requestId);
          console.log(`[Server] Sent non-streamed response for request ${requestId}`);
        } catch (err) {
          console.error(`[Server] Error decoding body:`, err);
          res.status(500).send("Server error");
          pendingRequests.delete(requestId);
        }
      } else {
        res.status(status || 200).send(body);
        pendingRequests.delete(requestId);
        console.log(`[Server] Sent non-streamed response for request ${requestId}`);
      }
    }

    if (data.type === "response-chunk") {
      const { requestId, chunk } = data;
      const res = pendingRequests.get(requestId);
      if (res) {
        try {
          res.write(Buffer.from(chunk, "base64"));
          console.log(`[Server] Wrote chunk for request ${requestId}, size: ${Buffer.from(chunk, "base64").length}`);
        } catch (err) {
          console.error(`[Server] Error decoding chunk:`, err);
          res.status(500).end("Chunk decoding error");
          pendingRequests.delete(requestId);
        }
      }
    }

    if (data.type === "response-end") {
      const { requestId } = data;
      const res = pendingRequests.get(requestId);
      if (res) {
        res.end();
        pendingRequests.delete(requestId);
        console.log(`[Server] Stream ended for request ${requestId}`);
      }
    }
  });

  ws.on("close", () => {
    if (clientId) {
      clients.delete(clientId);
      console.log(`[Relay] Client disconnected: ${clientId}`);
    }
  });

  ws.on("error", (err) => {
    console.error(`[Server] WebSocket error:`, err);
  });
});

app.use(express.json());

app.all("/tunnel/:clientId/*", async (req, res) => {
  const clientId = req.params.clientId;
  const clientWs = clients.get(clientId);

  if (!clientWs) {
    console.error(`[Server] Client ${clientId} not connected`);
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
  console.log(`[Server] Sent request ${requestId} to client ${clientId}`);

  setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      console.warn(`[Server] Timeout for request ${requestId}`);
      res.status(504).send("Tunnel timeout");
      pendingRequests.delete(requestId);
    }
  }, 30000);
});

server.listen(3005, () => console.log(`Relay server running at http://localhost:3005`));
