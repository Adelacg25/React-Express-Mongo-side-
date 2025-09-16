import http from "http";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "Residents";
const RES_COLL = process.env.RES_COLL || "residentCollection"; 
const SVC_COLL = process.env.SVC_COLL || "Services";          


const PYTHON_BIN = process.env.PYTHON_BIN || "python"; 

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in .env at project root");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const distCandidates = [
  path.join(__dirname, "client", "dist"),
  path.join(__dirname, "client", "build"),
];
const DIST_DIR = distCandidates.find((p) => fs.existsSync(p)) || null;

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extraHeaders,
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
    req.on("data", (chunk) => {
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
  const residentsCol = db.collection(RES_COLL);
  const servicesCol  = db.collection(SVC_COLL);

  const SOLVER_PATH = path.join(__dirname, "weekly_solver.py");

  const server = http.createServer(async (req, res) => {
    try {
      const { method, url } = req;

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        return res.end();
      }

      const u = new URL(url, `http://localhost:${PORT}`);
      console.log("REQ", method, u.pathname);

      if (u.pathname === "/api/health" && method === "GET") {
        return sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      }

      if (u.pathname === "/api/residents" && method === "GET") {
        const list = await residentsCol.find({}, { projection: { name: 1, status: 1 } })
                                       .sort({ _id: -1 }).toArray();
        return sendJson(res, 200, list);
      }

      if (u.pathname === "/api/residents" && method === "POST") {
        let body;
        try { body = await readJsonBody(req); } catch { return sendJson(res, 400, { error: "Invalid JSON" }); }
        const name = (body?.name || "").trim();
        const status = (body?.status || "unknown").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        const r = await residentsCol.insertOne({ name, status });
        return sendJson(res, 201, { _id: r.insertedId, name, status });
      }

      if (u.pathname === "/api/residents/status" && method === "GET") {
        const name = (u.searchParams.get("name") || "").trim();
        if (!name) return sendJson(res, 400, { error: "name required" });
        const doc = await residentsCol.findOne(
          { name },
          { projection: { _id: 0, name: 1, status: 1 }, collation: { locale: "en", strength: 2 } }
        );
        return doc ? sendJson(res, 200, doc) : sendJson(res, 404, { error: "not found" });
      }

      if (u.pathname.startsWith("/api/residents/") && method === "DELETE") {
        const id = u.pathname.split("/").pop();
        try {
          const r = await residentsCol.deleteOne({ _id: new ObjectId(id) });
          return r.deletedCount ? sendJson(res, 200, { ok: true }) :
                                  sendJson(res, 404, { error: "not found" });
        } catch {
          return sendJson(res, 400, { error: "bad id" });
        }
      }

      if (/^\/api\/weeks\/?$/.test(u.pathname) && method === "GET") {
        const count = parseInt(u.searchParams.get("count") || "10", 10);
        const rotationLen = parseInt(u.searchParams.get("rotationLen") || "5", 10);

        const residentsRaw = await residentsCol.find(
          {},
          { projection: { name: 1, email: 1, year: 1, "weeksOff": 1 } }
        ).toArray();

        const servicesRaw = await servicesCol.find(
          {},
          { projection: { Service: 1, residentsRequired: 1 } }
        ).toArray();

        if (!fs.existsSync(SOLVER_PATH)) {
          return sendJson(res, 500, { ok: false, error: `weekly_solver.py not found at ${SOLVER_PATH}` });
        }

        const py = spawn(PYTHON_BIN, [SOLVER_PATH]); 
        const payload = JSON.stringify({ residents: residentsRaw, services: servicesRaw, weeks: count, rotationLen });
        py.stdin.write(payload);
        py.stdin.end();

        let out = "", err = "";
        py.stdout.on("data", d => out += d.toString());
        py.stderr.on("data", d => err += d.toString());
        py.on("close", code => {
          if (code !== 0) {
            return sendJson(res, 500, { ok: false, error: "solver failed", stderr: err, stdout: out });
          }
          try {
            const json = JSON.parse(out);
            return sendJson(res, 200, json);
          } catch (e) {
            return sendJson(res, 500, { ok: false, error: "invalid solver output", stdout: out, stderr: err });
          }
        });
        return; 
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

      if (/^\/api\/residents\/full\/?$/.test(u.pathname) && method === "GET") {
        const list = await residentsCol.find({}, { projection: { name: 1, email: 1, year: 1, "weeksOff": 1 } }).toArray();
        return sendJson(res, 200, { ok: true, residents: list });
      }

      return sendJson(res, 404, { error: "Not Found" });
    } catch (e) {
      console.error("[server] unhandled:", e);
      try { return sendJson(res, 500, { error: "Internal Server Error" }); } catch {}
    }
  });
  const residentsRaw = await residentsCol.find(
    {},
    { projection: { name: 1, email: 1, year: 1, "weeksOff": 1 } }
  ).toArray();
  const allColls = await db.listCollections().toArray();


  const servicesRaw = await servicesCol.find(
    {},
    { projection: { Service: 1, residentsRequired: 1 } }
  ).toArray();
  server.on("error", (e) => console.error("[server error]", e));
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`GET /api/weeks?count=10&rotationLen=5`);
    console.log("[/api/weeks] counts => residents:", residentsRaw.length, "services:", servicesRaw.length);
    console.log("[/api/weeks] DB:", DB_NAME, "collections:", allColls.map(c => c.name))
  });

  const stop = async () => { await client.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

start().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
