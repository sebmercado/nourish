export default async function handler(req, res) {
  // Allow requests from the app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.VITE_TODOIST_API_TOKEN;
  if (!token) return res.status(500).json({ error: "Todoist token not configured" });

  const { path, method, body } = req.body || {};
  if (!path) return res.status(400).json({ error: "Missing path" });

  try {
    const opts = {
      method: method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const upstream = await fetch(`https://api.todoist.com/rest/v2${path}`, opts);

    if (upstream.status === 204) return res.status(204).end();
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
