import React, { useState } from "react";

export default function App() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSearch(e) {
    e.preventDefault();
    setError(""); setResult(null);

    const name = q.trim();
    if (!name) { setError("Enter a name"); return; }

    setLoading(true);
    try {
      const url = `/api/residents/status?name=${encodeURIComponent(name)}`; 
      console.log("GET", url);
      const r = await fetch(url);

      const txt = await r.text();
      let data = null; try { data = txt ? JSON.parse(txt) : null; } catch {}

      if (!r.ok) setError((data && (data.error || data.message)) || `HTTP ${r.status}`);
      else setResult(data);
    } catch (err) {
      console.error("Network error:", err);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return React.createElement(
    "div",
    { style: { padding: "2rem", fontFamily: "system-ui, sans-serif" } },
    [
      React.createElement("h1", { key: "h1" }, "senior software"),
      React.createElement("form", { key: "f", onSubmit: onSearch, style: { display: "flex", gap: 8 } }, [
        React.createElement("input", { key: "i", value: q, onChange: e => setQ(e.target.value), placeholder: "Enter name" }),
        React.createElement("button", { key: "b", type: "submit", disabled: loading }, loading ? "Searching..." : "Search")
      ]),
      error && React.createElement("p", { key: "e", style: { color: "#c00" } }, String(error)),
      result && React.createElement("p", { key: "r" }, `${result.name}: ${result.status}`)
    ]
  );
}
