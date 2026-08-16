// Agent Fleet Brain — standalone console.
//
// Fleet Brain is a separate product direction from DAS, so it gets its own front
// door: its own name, its own port, no specialist-compiler sidebar. It deliberately
// reads the SAME evidence loader as the DAS console (loadFleetConsoleState), so
// the two surfaces can never disagree about what the fleet actually did.
//
// Nothing here calls a model or spends money. It renders preserved, integrity-
// checked artifacts from artifacts/fleet/.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFleetConsoleState } from "../console/fleet-state.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const consoleDirectory = path.resolve(directory, "../console");
const port = Number(process.env.FLEET_PORT ?? 4392);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const files = {
  "/": [path.join(directory, "index.html"), "text/html; charset=utf-8"],
  "/fleet-console.css": [path.join(directory, "fleet-console.css"), "text/css; charset=utf-8"],
  "/fleet-console.js": [path.join(directory, "fleet-console.js"), "text/javascript; charset=utf-8"],
  // shared with the DAS console on purpose — one source of visual truth for the fleet view
  "/fleet.css": [path.join(consoleDirectory, "fleet.css"), "text/css; charset=utf-8"],
  "/vendor/gsap.js": [path.resolve("node_modules/gsap/dist/gsap.min.js"), "text/javascript; charset=utf-8"],
  "/vendor/ScrollTrigger.js": [path.resolve("node_modules/gsap/dist/ScrollTrigger.min.js"), "text/javascript; charset=utf-8"],
};

const server = http.createServer((request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/fleet") {
      const fleet = loadFleetConsoleState();
      return json(response, 200, { fleet, generatedAt: new Date().toISOString(), paidModelCallsInThisConsole: 0 });
    }
    const entry = files[request.url ?? "/"];
    if (!entry) return json(response, 404, { error: "Not found" });
    const [file, contentType] = entry;
    if (!fs.existsSync(file)) return json(response, 404, { error: `Missing asset: ${path.basename(file)}` });
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(fs.readFileSync(file));
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Agent Fleet Brain console: http://127.0.0.1:${port}`));
