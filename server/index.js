const express = require("express");
const WebSocket = require("ws");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();

wss.on("connection", (ws) => {
  let clientId = null;

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.type === "response") {
      const { requestId, body, status, headers, encoding } = data;

      const res = pendingRequests.get(requestId);
      if (!res) return;

      if (headers) {
        Object.entries(headers).forEach(([key, value]) => {
          if (key.toLowerCase() === "content-encoding") return;
          res.setHeader(key, value);
        });
      }

      if (encoding === "base64") {
        res.status(status || 200).send(Buffer.from(body, "base64"));
      } else {
        res.status(status || 200).send(body);
      }

      pendingRequests.delete(requestId);
    }
  });

  ws.on("close", () => {
    if (clientId) clients.delete(clientId);
  });
});

const pendingRequests = new Map();

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
