import http from "http";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI; // put your encoded URI in server/.env
const DB_NAME = process.env.DB_NAME || "Residents";

// ---- resolve client/dist for static serving ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "..", "client", "dist");

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js"))   return "text/javascript";
  if (filePath.endsWith(".css"))  return "text/css";
  if (filePath.endsWith(".svg"))  return "image/svg+xml";
  if (filePath.endsWith(".png"))  return "image/png";
  if (filePath.endsWith(".ico"))  return "image/x-icon";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders
  });
  res.end(payload);
}

function sendFile(res, filePath) {
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(data);
}

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in server/.env");
  process.exit(1);
}

// ---- DB ----
const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db(DB_NAME);
const residents = db.collection("residentCollection");

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  try {
    const { method, url } = req;

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      return res.end(); // IMPORTANT: return
    }

    // Parse URL once
    const u = new URL(url, `http://localhost:${PORT}`);

    // Health
    if (u.pathname === "/api/health" && method === "GET") {
      return sendJson(res, 200, { ok: true, now: new Date().toISOString() });
    }

    // Lookup: GET /api/residents/status?name=Grace
    if (u.pathname === "/api/residents/status" && method === "GET") {
      try {
        const name = (u.searchParams.get("name") || "").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });

        const doc = await residents.findOne(
          { name },
          {
            projection: { _id: 0, name: 1, status: 1 },
            collation: { locale: "en", strength: 2 } // case-insensitive exact
          }
        );

        if (!doc) return sendJson(res, 404, { error: "not found" });
        return sendJson(res, 200, doc);
      } catch (err) {
        console.error("[/api/residents/status] error:", err);
        return sendJson(res, 500, { error: "Internal Server Error" });
      }
    }

    // ---- STATIC SPA (AFTER API routes, BEFORE 404) ----
    if (method === "GET" && !u.pathname.startsWith("/api")) {
      const reqPath = u.pathname === "/" ? "/index.html" : u.pathname;
      const filePath = path.join(DIST_DIR, reqPath);

      // prevent path traversal
      if (!filePath.startsWith(DIST_DIR)) {
        return sendJson(res, 400, { error: "Bad path" });
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return sendFile(res, filePath); // IMPORTANT: return
      }

      const indexPath = path.join(DIST_DIR, "index.html");
      if (fs.existsSync(indexPath)) {
        return sendFile(res, indexPath); // IMPORTANT: return
      }

      return sendJson(res, 500, { error: "Frontend not built. Run `npm run build` in /client." });
    }

    // Catch-all 404 (KEEP THIS LAST)
    return sendJson(res, 404, { error: "Not Found" });
  } catch (err) {
    console.error("[server] unhandled:", err);
    try { return sendJson(res, 500, { error: "Internal Server Error" }); } catch {}
  }
});

server.on("error", (e) => console.error("[server error]", e));
server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});
