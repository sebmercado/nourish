# 🌿 Nourish

Your household dinner & grocery AI assistant, synced with Todoist.

## File structure

Your GitHub repo must look exactly like this:

```
api/
  claude.js
  todoist.js
src/
  App.jsx
  main.jsx
index.html
package.json
vite.config.js
```

## Environment variables

In Vercel → Settings → Environment Variables, add these two (exact names, no typos):

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |
| `TODOIST_API_TOKEN` | Your token from todoist.com → Settings → Integrations → Developer |

## Deploy steps

1. Create a free account at **vercel.com** (sign in with GitHub)
2. Click **Add New Project** → import your GitHub repo
3. Add the two environment variables above
4. Click **Deploy**

## Sharing with your wife

- Send her the Vercel URL (e.g. `nourish-xxx.vercel.app`)
- In the Todoist app, share the **🛒 Grocery List** project with her
- You both use the same URL — the grocery list is shared via Todoist

## Redeploying after changes

If you update any files in GitHub, Vercel redeploys automatically.
If you update environment variables, you need to manually redeploy:
Deployments → ⋯ → Redeploy → uncheck "Use existing Build Cache"
