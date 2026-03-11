export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.TODOIST_API_TOKEN;
  if (!token) return res.status(500).json({ error: "TODOIST_API_TOKEN env var not set" });

  // Vercel parses JSON body automatically when Content-Type is application/json
  const { method, path, body } = req.body;

  if (!path) return res.status(400).json({ error: "Missing path in request body" });
  if (!method) return res.status(400).json({ error: "Missing method in request body" });

  const url = `https://api.todoist.com/api/v1${path}`;

  const fetchOptions = {
    method: method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  // Only attach body for non-GET requests that have a body
  if (body && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const upstream = await fetch(url, fetchOptions);
    const text = await upstream.text();

    // Handle empty responses (e.g. 204 No Content)
    if (!text) return res.status(upstream.status).end();

    // Try to parse as JSON
    try {
      const data = JSON.parse(text);
      return res.status(upstream.status).json(data);
    } catch {
      return res.status(500).json({
        error: "Todoist returned non-JSON",
        status: upstream.status,
        raw: text.slice(0, 500),
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Fetch failed: " + err.message });
  }
}
