const WebSocket = require("ws");
const http = require("http");

const clientId = "dev123";
const relayUrl = "ws://localhost:3005";
const localTarget = "http://localhost:3000";

const ws = new WebSocket(relayUrl);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "register", clientId }));
  console.log(`[Client] Connected as ${clientId}`);
});

ws.on("message", async (msg) => {
  const data = JSON.parse(msg);

  if (data.type === "request") {
    const { requestId, method, path, headers, body } = data;

    const options = {
      method,
      headers
    };
    const url = new URL(localTarget + "/" + path);
    console.log("🚀 ~ ws.on ~ url:", url);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      },
      (resp) => {
        const { requestId } = data;
        let chunks = [];

        resp.on("data", (chunk) => chunks.push(chunk));

        resp.on("end", () => {
          const buffer = Buffer.concat(chunks);
          ws.send(
            JSON.stringify({
              type: "response",
              requestId,
              status: resp.statusCode,
              headers: resp.headers,
              body: buffer.toString("base64"),
              encoding: "base64"
            })
          );
        });
      }
    );
    console.log(req, "lllllll");

    req.on("error", () => {
      ws.send(
        JSON.stringify({
          type: "response",
          requestId,
          status: 502,
          body: "Local proxy error"
        })
      );
    });

    if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
      const rawBody = JSON.stringify(body);
      req.setHeader("Content-Type", "application/json");
      req.setHeader("Content-Length", Buffer.byteLength(rawBody));
      req.write(rawBody);
    }
    req.end();
  }
});
