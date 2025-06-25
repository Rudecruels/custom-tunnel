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
      headers,
    };

    const req = http.request(localTarget + "/" + path, options, (resp) => {
      let responseBody = "";
      resp.on("data", (chunk) => (responseBody += chunk));
      resp.on("end", () => {
        ws.send(
          JSON.stringify({
            type: "response",
            requestId,
            body: responseBody,
            status: resp.statusCode,
          })
        );
      });
    });

    req.on("error", () => {
      ws.send(
        JSON.stringify({
          type: "response",
          requestId,
          status: 502,
          body: "Local proxy error",
        })
      );
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  }
});
