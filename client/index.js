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
  let data;
  try {
    data = JSON.parse(msg);
    console.log(`[Client] Received message:`, data);
  } catch (err) {
    console.error(`[Client] Failed to parse message:`, msg.toString(), err);
    return;
  }

  if (data.type === "request") {
    const { requestId, method, path, headers, body } = data;

    const options = {
      method,
      headers
    };
    const url = new URL(`${localTarget}/${path}`);
    console.log(`[Client] Requesting: ${url}`);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      },
      (resp) => {
        // Send response metadata
        ws.send(
          JSON.stringify({
            type: "response",
            requestId,
            status: resp.statusCode,
            headers: resp.headers,
            encoding: "base64",
            isStream: true
          })
        );

        // Stream response body
        resp.on("data", (chunk) => {
          try {
            const base64Chunk = chunk.toString("base64");
            ws.send(
              JSON.stringify({
                type: "response-chunk",
                requestId,
                chunk: base64Chunk
              })
            );
            console.log(`[Client] Sent chunk for request ${requestId}, size: ${chunk.length}`);
          } catch (err) {
            console.error(`[Client] Error encoding chunk:`, err);
          }
        });

        resp.on("end", () => {
          ws.send(
            JSON.stringify({
              type: "response-end",
              requestId
            })
          );
          console.log(`[Client] Stream ended for request ${requestId}`);
        });
      }
    );

    req.on("error", (err) => {
      console.error(`[Client] HTTP request error:`, err);
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

ws.on("error", (err) => {
  console.error(`[Client] WebSocket error:`, err);
});
