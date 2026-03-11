import { useState, useEffect, useRef, useCallback } from "react";

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const TODOIST_PROJECT_NAME = "🛒 Grocery List";

const SYSTEM_PROMPT = `You are Nourish, a warm and knowledgeable household dinner & grocery assistant for Seb and his wife. You help them plan meals (Seb follows a vegetarian diet — his wife may or may not), maintain a shared grocery list via Todoist, and suggest new recipes.

At the start of every message you will receive:
- GROCERY_LIST: current items on the Todoist grocery list
- MEAL_HISTORY: meals they've added or enjoyed before

Your job:
1. Help plan vegetarian-friendly dinners. Mediterranean and Greek-inspired dishes are favourites — tzatziki, spanakopita, roasted lemon potatoes, etc.
2. Suggest new meal ideas based on their history and preferences
3. Manage the grocery list — add items when asked, remove when done

CRITICAL: When you want to update the grocery list or meal log, output structured commands at the END of your message, after your conversational reply, in this exact format:

[GROCERY_ADD: item1 | item2 | item3]
[GROCERY_REMOVE: item1 | item2]
[MEAL_ADD: Meal Name]

Only include lines that are needed. Do not explain the commands.
Keep responses warm and concise (2–4 sentences), unless giving a full recipe.`;

function parseCommands(text) {
  const actions = { addGroceries: [], removeGroceries: [], addMeals: [] };
  const addMatch = text.match(/\[GROCERY_ADD:\s*([^\]]+)\]/);
  const removeMatch = text.match(/\[GROCERY_REMOVE:\s*([^\]]+)\]/);
  const mealMatch = text.match(/\[MEAL_ADD:\s*([^\]]+)\]/);
  if (addMatch) actions.addGroceries = addMatch[1].split("|").map(s => s.trim()).filter(Boolean);
  if (removeMatch) actions.removeGroceries = removeMatch[1].split("|").map(s => s.trim()).filter(Boolean);
  if (mealMatch) actions.addMeals = [mealMatch[1].trim()];
  return actions;
}

function cleanResponse(text) {
  return text
    .replace(/\[GROCERY_ADD:[^\]]*\]/g, "")
    .replace(/\[GROCERY_REMOVE:[^\]]*\]/g, "")
    .replace(/\[MEAL_ADD:[^\]]*\]/g, "")
    .trim();
}

// ─── Todoist via proxy ────────────────────────────────────────────────────────

async function todoistReq(method, path, body = null) {
  const res = await fetch("/api/todoist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path, body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  if (res.status === 204) return null;
  try { return JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text}`); }
}

async function getOrCreateProject() {
  const projects = await todoistReq("GET", "/projects");
  const existing = projects.find(p => p.name === TODOIST_PROJECT_NAME);
  if (existing) return existing.id;
  const created = await todoistReq("POST", "/projects", { name: TODOIST_PROJECT_NAME });
  return created.id;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Nourish() {
  const [projectId, setProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [meals, setMeals] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nourish_meals") || "[]"); } catch { return []; }
  });
  const [messages, setMessages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nourish_chat") || "[]");
      return saved.length > 0 ? saved : [{
        role: "assistant",
        content: "Hi! I'm Nourish 🌿 Your grocery list is synced with Todoist, so anything I add appears in your Todoist app for both of you. What can I help with — dinner ideas, a recipe, or the shopping list?",
      }];
    } catch {
      return [{ role: "assistant", content: "Hi! I'm Nourish 🌿 What can I help with today?" }];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [syncError, setSyncError] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [newGrocery, setNewGrocery] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { localStorage.setItem("nourish_meals", JSON.stringify(meals)); }, [meals]);
  useEffect(() => {
    if (messages.length > 0) localStorage.setItem("nourish_chat", JSON.stringify(messages.slice(-30)));
  }, [messages]);

  const loadTasks = useCallback(async (pid) => {
    setSyncStatus("syncing");
    try {
      const data = await todoistReq("GET", `/tasks?project_id=${pid}`);
      setTasks(data.map(t => ({ id: t.id, content: t.content })));
      setSyncStatus("idle");
    } catch(e) {
      setSyncStatus("error");
      setSyncError(e.message);
    }
  }, []);

  useEffect(() => {
    getOrCreateProject()
      .then(pid => { setProjectId(pid); loadTasks(pid); })
      .catch(e => { setSyncStatus("error"); setSyncError(e.message); });
  }, [loadTasks]);

  const addToTodoist = async (items) => {
    if (!projectId) return;
    const newTasks = [];
    for (const item of items) {
      try {
        const task = await todoistReq("POST", "/tasks", { content: item, project_id: projectId });
        newTasks.push({ id: task.id, content: task.content });
      } catch {}
    }
    setTasks(prev => [...prev, ...newTasks]);
  };

  const completeTask = async (id) => {
    try {
      await todoistReq("POST", `/tasks/${id}/close`);
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch {}
  };

  const removeFromTodoist = async (names) => {
    for (const name of names) {
      const match = tasks.find(t => t.content.toLowerCase().includes(name.toLowerCase()));
      if (match) await completeTask(match.id);
    }
  };

  const addManualGrocery = async () => {
    if (!newGrocery.trim()) return;
    await addToTodoist([newGrocery.trim()]);
    setNewGrocery("");
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const groceryNames = tasks.map(t => t.content);
    const contextPrefix = `GROCERY_LIST: ${groceryNames.length > 0 ? groceryNames.join(", ") : "(empty)"}
MEAL_HISTORY: ${meals.length > 0 ? meals.slice(-20).join(", ") : "(none yet)"}

User message: `;

    const apiMessages = newMessages.map((m, i) =>
      i === newMessages.length - 1 && m.role === "user"
        ? { role: "user", content: contextPrefix + m.content }
        : m
    );

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-allow-browser": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });
      const data = await res.json();
      const rawText = data.content?.map(b => b.text || "").join("") || "Sorry, something went wrong.";
      const commands = parseCommands(rawText);
      const cleanText = cleanResponse(rawText);

      if (commands.addGroceries.length > 0) await addToTodoist(commands.addGroceries);
      if (commands.removeGroceries.length > 0) await removeFromTodoist(commands.removeGroceries);
      if (commands.addMeals.length > 0) setMeals(prev => [...new Set([...prev, ...commands.addMeals])]);

      setMessages([...newMessages, { role: "assistant", content: cleanText }]);
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong — please try again!" }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div style={{
      fontFamily: "'Georgia', 'Times New Roman', serif",
      minHeight: "100vh",
      background: "linear-gradient(135deg, #faf7f2 0%, #f0ebe0 50%, #e8dfd0 100%)",
      display: "flex", flexDirection: "column",
      maxWidth: 480, margin: "0 auto",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 20px 0",
        background: "linear-gradient(180deg, #2d4a3e, #3a5c4e)",
        color: "#f5efe6",
        borderRadius: "0 0 24px 24px",
        boxShadow: "0 4px 20px rgba(45,74,62,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "linear-gradient(135deg, #7ab87a, #4a9060)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>🌿</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Nourish</div>
            <div style={{ fontSize: 11, opacity: 0.7, fontStyle: "italic", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: syncStatus === "error" ? "#e07070" : syncStatus === "syncing" ? "#e0c070" : "#7ab87a", display: "inline-block" }} />
              {syncStatus === "syncing" ? "syncing with Todoist…" : syncStatus === "error" ? `Error: ${syncError}` : "synced with Todoist"}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontFamily: "sans-serif" }}>🛒 {tasks.length}</div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontFamily: "sans-serif" }}>🍽️ {meals.length}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {[["chat", "💬 Chat"], ["groceries", "🛒 Groceries"], ["meals", "🍽️ Meals"]].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
              background: activeTab === key ? "#faf7f2" : "transparent",
              color: activeTab === key ? "#2d4a3e" : "rgba(245,239,230,0.75)",
              borderRadius: "8px 8px 0 0",
              fontSize: 12, fontFamily: "sans-serif", fontWeight: activeTab === key ? 700 : 400,
              transition: "all 0.2s",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Chat Tab */}
      {activeTab === "chat" && (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12, minHeight: 400, maxHeight: "60vh" }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "assistant" && (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #7ab87a, #4a9060)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginRight: 8, flexShrink: 0, marginTop: 2 }}>🌿</div>
                )}
                <div style={{
                  maxWidth: "78%", padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  background: msg.role === "user" ? "linear-gradient(135deg, #2d4a3e, #3a5c4e)" : "white",
                  color: msg.role === "user" ? "#f5efe6" : "#2a2a2a",
                  fontSize: 14, lineHeight: 1.55,
                  fontFamily: msg.role === "user" ? "sans-serif" : "Georgia, serif",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
                  whiteSpace: "pre-wrap",
                }}>{msg.content}</div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #7ab87a, #4a9060)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🌿</div>
                <div style={{ background: "white", borderRadius: "18px 18px 18px 4px", padding: "12px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#7ab87a", animation: "bounce 1.2s ease-in-out infinite", animationDelay: `${i*0.2}s` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ padding: "0 16px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
            {["Dinner idea tonight?", "Add feta to grocery list", "Chickpea recipe?", "Greek meal ideas"].map(s => (
              <button key={s} onClick={() => setInput(s)} style={{
                whiteSpace: "nowrap", padding: "6px 12px", borderRadius: 20,
                border: "1.5px solid #c8b89a", background: "transparent",
                color: "#5a4a3a", fontSize: 12, cursor: "pointer", fontFamily: "sans-serif",
              }}>{s}</button>
            ))}
          </div>

          <div style={{ padding: "8px 16px 20px", display: "flex", gap: 8 }}>
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ask about dinner, recipes, or groceries…" rows={1}
              style={{
                flex: 1, padding: "12px 14px", borderRadius: 24,
                border: "2px solid #d4c9b4", background: "white",
                fontSize: 14, fontFamily: "Georgia, serif",
                resize: "none", outline: "none", lineHeight: 1.4,
              }}
            />
            <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
              width: 46, height: 46, borderRadius: "50%", border: "none",
              background: loading || !input.trim() ? "#c8b89a" : "linear-gradient(135deg, #2d4a3e, #4a9060)",
              color: "white", cursor: loading || !input.trim() ? "default" : "pointer",
              fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>→</button>
          </div>
        </>
      )}

      {/* Groceries Tab */}
      {activeTab === "groceries" && (
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 13, color: "#6b5a47", fontFamily: "sans-serif", marginBottom: 10, fontStyle: "italic" }}>Add item manually</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newGrocery} onChange={e => setNewGrocery(e.target.value)} onKeyDown={e => e.key === "Enter" && addManualGrocery()}
                placeholder="e.g. Greek yogurt…"
                style={{ flex: 1, padding: "10px 12px", borderRadius: 12, border: "1.5px solid #d4c9b4", fontSize: 14, fontFamily: "Georgia, serif", outline: "none" }}
              />
              <button onClick={addManualGrocery} style={{ padding: "10px 16px", borderRadius: 12, border: "none", background: "#2d4a3e", color: "white", cursor: "pointer", fontSize: 18, fontWeight: 700 }}>+</button>
            </div>
          </div>

          <div style={{ background: "white", borderRadius: 16, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2d4a3e" }}>
                Shopping List {tasks.length > 0 && <span style={{ fontSize: 13, fontWeight: 400, color: "#8b7355" }}>({tasks.length})</span>}
              </div>
              <button onClick={() => projectId && loadTasks(projectId)} style={{
                background: "none", border: "1px solid #d4c9b4", borderRadius: 8,
                padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#6b5a47", fontFamily: "sans-serif",
              }}>↻ Refresh</button>
            </div>
            {syncStatus === "syncing" ? (
              <div style={{ color: "#a09080", fontStyle: "italic", fontSize: 14, textAlign: "center", padding: "20px 0" }}>Loading from Todoist…</div>
            ) : tasks.length === 0 ? (
              <div style={{ color: "#a09080", fontStyle: "italic", fontSize: 14, textAlign: "center", padding: "20px 0" }}>
                Empty — ask Nourish to add items, or add them above!
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tasks.map((task, i) => (
                  <div key={task.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 12px", borderRadius: 10,
                    background: i % 2 === 0 ? "#faf7f2" : "white",
                    border: "1px solid #ede8de",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7ab87a" }} />
                      <span style={{ fontSize: 14, color: "#2a2a2a" }}>{task.content}</span>
                    </div>
                    <button onClick={() => completeTask(task.id)} style={{
                      background: "none", border: "1px solid #d4c9b4", borderRadius: 6,
                      cursor: "pointer", color: "#4a9060", fontSize: 13, padding: "2px 8px", fontFamily: "sans-serif",
                    }}>✓</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#a09080", textAlign: "center", fontFamily: "sans-serif", fontStyle: "italic" }}>
            ✓ marks items complete in Todoist · changes sync both ways
          </div>
        </div>
      )}

      {/* Meals Tab */}
      {activeTab === "meals" && (
        <div style={{ flex: 1, padding: 16 }}>
          <div style={{ background: "white", borderRadius: 16, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#2d4a3e", marginBottom: 4 }}>Meal Memory</div>
            <div style={{ fontSize: 13, color: "#8b7355", fontStyle: "italic", marginBottom: 14, fontFamily: "sans-serif" }}>
              Nourish learns from these to make better suggestions
            </div>
            {meals.length === 0 ? (
              <div style={{ color: "#a09080", fontStyle: "italic", fontSize: 14, textAlign: "center", padding: "20px 0" }}>
                No meals logged yet — chat with Nourish to get started!
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {meals.map((meal, i) => (
                  <div key={i} style={{
                    padding: "8px 14px", borderRadius: 20,
                    background: "linear-gradient(135deg, #f0ebe0, #e8dfd0)",
                    border: "1px solid #d4c9b4",
                    fontSize: 13, color: "#3a2e20",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    🍽️ {meal}
                    <button onClick={() => setMeals(prev => prev.filter(m => m !== meal))} style={{
                      background: "none", border: "none", cursor: "pointer", color: "#a09080", fontSize: 12, padding: 0,
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce { 0%,60%,100% { transform:translateY(0); } 30% { transform:translateY(-6px); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #c8b89a; border-radius: 4px; }
      `}</style>
    </div>
  );
}
