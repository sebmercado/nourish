export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.TODOIST_API_TOKEN || process.env.VITE_TODOIST_API_TOKEN;
  if (!token) return res.status(500).json({ error: "Todoist token not configured — check TODOIST_API_TOKEN env var" });

  const { path, method, body } = req.body || {};
  if (!path) return res.status(400).json({ error: "Missing path" });

  const url = `https://api.todoist.com/api/v1${path}`;

  try {
    const opts = {
      method: method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const upstream = await fetch(url, opts);
    const rawText = await upstream.text();

    if (upstream.status === 204) return res.status(204).end();

    try {
      const data = JSON.parse(rawText);
      return res.status(upstream.status).json(data);
    } catch {
      return res.status(500).json({
        error: "Todoist returned non-JSON",
        status: upstream.status,
        url,
        token_length: token.length,
        token_preview: token.slice(0, 6) + "...",
        raw: rawText,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, url });
  }
}
