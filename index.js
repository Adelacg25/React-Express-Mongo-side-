// /index.js  (Node server)
import http from "http";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "Residents";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in .env at project root");
  process.exit(1);
}

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find a built frontend to serve (Vite=dist, CRA=build)
const distCandidates = [
  path.join(__dirname, "client", "dist"),
  path.join(__dirname, "client", "build"),
];
const DIST_DIR = distCandidates.find(p => fs.existsSync(p)) || null;

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
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders
  });
  res.end(JSON.stringify(obj));
}

function sendFile(res, filePath) {
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", chunk => {
      buf += chunk;
      if (buf.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      if (!buf) return resolve(null);
      try { resolve(JSON.parse(buf)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const residents = db.collection("residentCollection");

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
        return res.end();
      }

      const u = new URL(url, `http://localhost:${PORT}`);

      if (u.pathname === "/api/health" && method === "GET") {
        return sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      }

      if (u.pathname === "/api/residents" && method === "GET") {
        const list = await residents.find({}, { projection: { name: 1, status: 1 } })
                                    .sort({ _id: -1 })
                                    .toArray();
        return sendJson(res, 200, list);
      }

      if (u.pathname === "/api/residents" && method === "POST") {
        let body;
        try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: "Invalid JSON" }); }
        const name = (body?.name || "").trim();
        const status = (body?.status || "unknown").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        const r = await residents.insertOne({ name, status });
        return sendJson(res, 201, { _id: r.insertedId, name, status });
      }

      if (u.pathname === "/api/residents/status" && method === "GET") {
        const name = (u.searchParams.get("name") || "").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        const doc = await residents.findOne(
          { name },
          {
            projection: { _id: 0, name: 1, status: 1 },
            collation: { locale: "en", strength: 2 }
          }
        );
        return doc ? sendJson(res, 200, doc) : sendJson(res, 404, { error: "not found" });
      }

      if (u.pathname.startsWith("/api/residents/") && method === "DELETE") {
        const id = u.pathname.split("/").pop();
        try {
          const r = await residents.deleteOne({ _id: new ObjectId(id) });
          return r.deletedCount ? sendJson(res, 200, { ok: true }) :
                                  sendJson(res, 404, { error: "not found" });
        } catch {
          return sendJson(res, 400, { error: "bad id" });
        }
      }

      if (method === "GET" && !u.pathname.startsWith("/api") && DIST_DIR) {
        const requestPath = u.pathname === "/" ? "/index.html" : u.pathname;
        const abs = path.resolve(path.join(DIST_DIR, requestPath));
        const safeBase = path.resolve(DIST_DIR);
        if (!abs.startsWith(safeBase)) return sendJson(res, 400, { error: "Bad path" });

        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          return sendFile(res, abs);
        }
        const fallback = path.join(DIST_DIR, "index.html");
        if (fs.existsSync(fallback)) {
          return sendFile(res, fallback);
        }
      }

      return sendJson(res, 404, { error: "Not Found" });
    } catch (e) {
      console.error("[server] unhandled:", e);
      try { return sendJson(res, 500, { error: "Internal Server Error" }); } catch {}
    }
  });

  server.on("error", (e) => console.error("[server error]", e));
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });

  const stop = async () => { await client.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

start().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
