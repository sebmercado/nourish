import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const TODOIST_PROJECT_NAME = "🛒 Grocery List";

const SYSTEM_PROMPT = `You are Nourish, a warm household dinner and grocery assistant for Seb and his wife. Seb is vegetarian and loves Mediterranean and Greek-inspired cooking — things like spanakopita, tzatziki, roasted lemon potatoes, falafel, halloumi. His wife may eat meat.

You will receive at the start of each message:
- GROCERY_LIST: what's currently on their Todoist grocery list
- MEAL_HISTORY: meals they've cooked before

Help them with dinner ideas, recipes, and managing the grocery list. Be warm and concise.

When you need to update the grocery list or log a meal, add these commands at the very end of your reply (after everything else):

[GROCERY_ADD: item1 | item2 | item3]
[GROCERY_REMOVE: item1 | item2]
[MEAL_ADD: Meal Name]

Only include commands you actually need. Never explain or mention the commands.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCommands(text) {
  const result = { add: [], remove: [], meals: [] };
  const addMatch = text.match(/\[GROCERY_ADD:\s*([^\]]+)\]/);
  const removeMatch = text.match(/\[GROCERY_REMOVE:\s*([^\]]+)\]/);
  const mealMatch = text.match(/\[MEAL_ADD:\s*([^\]]+)\]/);
  if (addMatch) result.add = addMatch[1].split("|").map(s => s.trim()).filter(Boolean);
  if (removeMatch) result.remove = removeMatch[1].split("|").map(s => s.trim()).filter(Boolean);
  if (mealMatch) result.meals = [mealMatch[1].trim()];
  return result;
}

function stripCommands(text) {
  return text
    .replace(/\[GROCERY_ADD:[^\]]*\]/g, "")
    .replace(/\[GROCERY_REMOVE:[^\]]*\]/g, "")
    .replace(/\[MEAL_ADD:[^\]]*\]/g, "")
    .trim();
}

// ─── API calls (via Vercel proxy functions) ───────────────────────────────────

async function todoistCall(method, path, body = null) {
  const res = await fetch("/api/todoist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path, body }),
  });
  const text = await res.text();
  if (!text) return null; // 204 No Content
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(data.error || `Todoist error ${res.status}`);
  return data;
}

async function claudeCall(messages) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Claude error ${res.status}`);
  return data.content.map(b => b.text || "").join("");
}

// ─── Todoist helpers ──────────────────────────────────────────────────────────

async function getOrCreateProject() {
  const data = await todoistCall("GET", "/projects");
  // Todoist v1 returns { results: [...] }
  const projects = data.results || [];
  const existing = projects.find(p => p.name === TODOIST_PROJECT_NAME);
  if (existing) return existing.id;
  const created = await todoistCall("POST", "/projects", { name: TODOIST_PROJECT_NAME });
  return created.id;
}

async function fetchTasks(projectId) {
  const data = await todoistCall("GET", `/tasks?project_id=${projectId}`);
  const tasks = data.results || [];
  return tasks.map(t => ({ id: t.id, content: t.content }));
}

async function createTask(projectId, content) {
  const task = await todoistCall("POST", "/tasks", { content, project_id: projectId });
  return { id: task.id, content: task.content };
}

async function completeTask(taskId) {
  await todoistCall("POST", `/tasks/${taskId}/complete`);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── Component ────────────────────────────────────────────────────────────────

const INITIAL_MESSAGE = {
  role: "assistant",
  content: "Hi! I'm Nourish 🌿 Your grocery list is synced with Todoist so both you and your wife can see it. What can I help with — dinner ideas, a recipe, or the shopping list?",
};

export default function App() {
  const [tab, setTab] = useState("chat");
  const [projectId, setProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [meals, setMeals] = useState(() => loadLocal("nourish_meals", []));
  const [messages, setMessages] = useState(() => {
    const saved = loadLocal("nourish_chat", []);
    return saved.length > 0 ? saved : [INITIAL_MESSAGE];
  });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [syncState, setSyncState] = useState("loading"); // loading | ok | error
  const [syncError, setSyncError] = useState("");
  const [newItem, setNewItem] = useState("");
  const bottomRef = useRef(null);

  // Persist meals and chat
  useEffect(() => saveLocal("nourish_meals", meals), [meals]);
  useEffect(() => { if (messages.length) saveLocal("nourish_chat", messages.slice(-40)); }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  // Init Todoist on mount
  useEffect(() => {
    (async () => {
      try {
        const pid = await getOrCreateProject();
        const initialTasks = await fetchTasks(pid);
        setProjectId(pid);
        setTasks(initialTasks);
        setSyncState("ok");
      } catch (e) {
        setSyncState("error");
        setSyncError(e.message);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setSyncState("loading");
    try {
      const updated = await fetchTasks(projectId);
      setTasks(updated);
      setSyncState("ok");
    } catch (e) {
      setSyncState("error");
      setSyncError(e.message);
    }
  }, [projectId]);

  const addItems = useCallback(async (items) => {
    if (!projectId) return;
    for (const content of items) {
      try {
        const task = await createTask(projectId, content);
        setTasks(prev => {
          // Avoid duplicates
          if (prev.find(t => t.content.toLowerCase() === content.toLowerCase())) return prev;
          return [...prev, task];
        });
      } catch {}
    }
  }, [projectId]);

  const removeItems = useCallback(async (names) => {
    for (const name of names) {
      const match = tasks.find(t => t.content.toLowerCase().includes(name.toLowerCase()));
      if (!match) continue;
      try {
        await completeTask(match.id);
        setTasks(prev => prev.filter(t => t.id !== match.id));
      } catch {}
    }
  }, [tasks]);

  const tickTask = useCallback(async (id) => {
    try {
      await completeTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch {}
  }, []);

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userText = input.trim();
    setInput("");
    setSending(true);

    const userMsg = { role: "user", content: userText };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // Build context-enriched messages for Claude
    const groceryList = tasks.length > 0 ? tasks.map(t => t.content).join(", ") : "empty";
    const mealHistory = meals.length > 0 ? meals.slice(-20).join(", ") : "none yet";

    const contextualMessages = updatedMessages.map((m, i) => {
      if (i === updatedMessages.length - 1 && m.role === "user") {
        return {
          role: "user",
          content: `GROCERY_LIST: ${groceryList}\nMEAL_HISTORY: ${mealHistory}\n\n${m.content}`,
        };
      }
      return m;
    });

    try {
      const rawReply = await claudeCall(contextualMessages);
      const commands = parseCommands(rawReply);
      const cleanReply = stripCommands(rawReply);

      if (commands.add.length > 0) await addItems(commands.add);
      if (commands.remove.length > 0) await removeItems(commands.remove);
      if (commands.meals.length > 0) {
        setMeals(prev => [...new Set([...prev, ...commands.meals])]);
      }

      setMessages(prev => [...prev, { role: "assistant", content: cleanReply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry, something went wrong: ${e.message}` }]);
    }

    setSending(false);
  }, [input, sending, messages, tasks, meals, addItems, removeItems]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const addManual = async () => {
    if (!newItem.trim()) return;
    await addItems([newItem.trim()]);
    setNewItem("");
  };

  // ─── Styles ─────────────────────────────────────────────────────────────────

  const s = {
    wrap: { fontFamily: "Georgia, 'Times New Roman', serif", minHeight: "100vh", background: "linear-gradient(135deg, #faf7f2, #e8dfd0)", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" },
    header: { padding: "20px 20px 0", background: "linear-gradient(180deg, #2d4a3e, #3a5c4e)", color: "#f5efe6", borderRadius: "0 0 24px 24px", boxShadow: "0 4px 20px rgba(45,74,62,0.3)" },
    headerTop: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
    avatar: { width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg, #7ab87a, #4a9060)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 },
    dot: (color) => ({ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", marginRight: 4 }),
    tabs: { display: "flex", gap: 2 },
    tab: (active) => ({ flex: 1, padding: "10px 4px", border: "none", cursor: "pointer", background: active ? "#faf7f2" : "transparent", color: active ? "#2d4a3e" : "rgba(245,239,230,0.75)", borderRadius: "8px 8px 0 0", fontSize: 12, fontFamily: "sans-serif", fontWeight: active ? 700 : 400 }),
    chatScroll: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12, minHeight: 400, maxHeight: "60vh" },
    bubble: (user) => ({ maxWidth: "78%", padding: "10px 14px", borderRadius: user ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: user ? "linear-gradient(135deg, #2d4a3e, #3a5c4e)" : "white", color: user ? "#f5efe6" : "#2a2a2a", fontSize: 14, lineHeight: 1.55, fontFamily: user ? "sans-serif" : "Georgia, serif", boxShadow: "0 1px 6px rgba(0,0,0,0.08)", whiteSpace: "pre-wrap" }),
    chip: { whiteSpace: "nowrap", padding: "6px 12px", borderRadius: 20, border: "1.5px solid #c8b89a", background: "transparent", color: "#5a4a3a", fontSize: 12, cursor: "pointer", fontFamily: "sans-serif" },
    inputRow: { padding: "8px 16px 24px", display: "flex", gap: 8 },
    textarea: { flex: 1, padding: "12px 14px", borderRadius: 24, border: "2px solid #d4c9b4", background: "white", fontSize: 14, fontFamily: "Georgia, serif", resize: "none", outline: "none", lineHeight: 1.4 },
    sendBtn: (disabled) => ({ width: 46, height: 46, borderRadius: "50%", border: "none", background: disabled ? "#c8b89a" : "linear-gradient(135deg, #2d4a3e, #4a9060)", color: "white", cursor: disabled ? "default" : "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    card: { background: "white", borderRadius: 16, padding: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
    row: (even) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: even ? "#faf7f2" : "white", border: "1px solid #ede8de" }),
  };

  const syncColor = syncState === "ok" ? "#7ab87a" : syncState === "error" ? "#e07070" : "#e0c070";
  const syncLabel = syncState === "ok" ? "synced with Todoist" : syncState === "error" ? `Error: ${syncError}` : "connecting to Todoist…";

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerTop}>
          <div style={s.avatar}>🌿</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Nourish</div>
            <div style={{ fontSize: 11, opacity: 0.8, fontFamily: "sans-serif" }}>
              <span style={s.dot(syncColor)} />
              {syncLabel}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <span style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontFamily: "sans-serif" }}>🛒 {tasks.length}</span>
            <span style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 10px", fontSize: 11, fontFamily: "sans-serif" }}>🍽️ {meals.length}</span>
          </div>
        </div>
        <div style={s.tabs}>
          {[["chat", "💬 Chat"], ["groceries", "🛒 Groceries"], ["meals", "🍽️ Meals"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={s.tab(tab === key)}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Chat ── */}
      {tab === "chat" && <>
        <div style={s.chatScroll}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
              {msg.role === "assistant" && (
                <div style={{ ...s.avatar, width: 28, height: 28, fontSize: 14, marginRight: 8, flexShrink: 0, marginTop: 2 }}>🌿</div>
              )}
              <div style={s.bubble(msg.role === "user")}>{msg.content}</div>
            </div>
          ))}
          {sending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...s.avatar, width: 28, height: 28, fontSize: 14 }}>🌿</div>
              <div style={{ background: "white", borderRadius: "18px 18px 18px 4px", padding: "12px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.08)" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#7ab87a", animation: "bounce 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: "0 16px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
          {["Dinner idea tonight?", "Add feta to list", "Chickpea recipe?", "Greek meal ideas"].map(suggestion => (
            <button key={suggestion} style={s.chip} onClick={() => setInput(suggestion)}>{suggestion}</button>
          ))}
        </div>

        <div style={s.inputRow}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder="Ask about dinner, recipes, or groceries…" rows={1} style={s.textarea} />
          <button onClick={send} disabled={sending || !input.trim()} style={s.sendBtn(sending || !input.trim())}>→</button>
        </div>
      </>}

      {/* ── Groceries ── */}
      {tab === "groceries" && (
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={s.card}>
            <div style={{ fontSize: 13, color: "#6b5a47", fontFamily: "sans-serif", marginBottom: 10, fontStyle: "italic" }}>Add item manually</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === "Enter" && addManual()}
                placeholder="e.g. Greek yogurt…"
                style={{ flex: 1, padding: "10px 12px", borderRadius: 12, border: "1.5px solid #d4c9b4", fontSize: 14, fontFamily: "Georgia, serif", outline: "none" }} />
              <button onClick={addManual} style={{ padding: "10px 16px", borderRadius: 12, border: "none", background: "#2d4a3e", color: "white", cursor: "pointer", fontSize: 20, fontWeight: 700 }}>+</button>
            </div>
          </div>

          <div style={{ ...s.card, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#2d4a3e" }}>
                Shopping List {tasks.length > 0 && <span style={{ fontSize: 13, fontWeight: 400, color: "#8b7355" }}>({tasks.length})</span>}
              </div>
              <button onClick={refresh} style={{ background: "none", border: "1px solid #d4c9b4", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#6b5a47", fontFamily: "sans-serif" }}>↻ Refresh</button>
            </div>
            {tasks.length === 0
              ? <div style={{ color: "#a09080", fontStyle: "italic", fontSize: 14, textAlign: "center", padding: "20px 0" }}>Empty — ask Nourish or add above!</div>
              : tasks.map((task, i) => (
                <div key={task.id} style={s.row(i % 2 === 0)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7ab87a" }} />
                    <span style={{ fontSize: 14 }}>{task.content}</span>
                  </div>
                  <button onClick={() => tickTask(task.id)} style={{ background: "none", border: "1px solid #d4c9b4", borderRadius: 6, cursor: "pointer", color: "#4a9060", fontSize: 13, padding: "2px 8px", fontFamily: "sans-serif" }}>✓</button>
                </div>
              ))
            }
          </div>
          <div style={{ fontSize: 12, color: "#a09080", textAlign: "center", fontFamily: "sans-serif", fontStyle: "italic" }}>✓ marks items complete in Todoist</div>
        </div>
      )}

      {/* ── Meals ── */}
      {tab === "meals" && (
        <div style={{ flex: 1, padding: 16 }}>
          <div style={s.card}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#2d4a3e", marginBottom: 4 }}>Meal Memory</div>
            <div style={{ fontSize: 13, color: "#8b7355", fontStyle: "italic", marginBottom: 14, fontFamily: "sans-serif" }}>Nourish learns from these to suggest better meals</div>
            {meals.length === 0
              ? <div style={{ color: "#a09080", fontStyle: "italic", fontSize: 14, textAlign: "center", padding: "20px 0" }}>No meals yet — chat with Nourish!</div>
              : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {meals.map((meal, i) => (
                  <div key={i} style={{ padding: "8px 14px", borderRadius: 20, background: "linear-gradient(135deg, #f0ebe0, #e8dfd0)", border: "1px solid #d4c9b4", fontSize: 13, color: "#3a2e20", display: "flex", alignItems: "center", gap: 6 }}>
                    🍽️ {meal}
                    <button onClick={() => setMeals(prev => prev.filter(m => m !== meal))} style={{ background: "none", border: "none", cursor: "pointer", color: "#a09080", fontSize: 12, padding: 0 }}>✕</button>
                  </div>
                ))}
              </div>
            }
          </div>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #c8b89a; border-radius: 4px; }
      `}</style>
    </div>
  );
}
