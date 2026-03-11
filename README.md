# 🌿 Nourish

Your household dinner & grocery AI assistant, synced with Todoist.

## Setup (5 minutes)

### 1. You'll need
- [Node.js](https://nodejs.org) (v18+)
- A free [Vercel](https://vercel.com) account
- A free [GitHub](https://github.com) account
- Your Anthropic API key (from console.anthropic.com)
- Your Todoist API token (from todoist.com → Settings → Integrations → Developer)

### 2. Get the code on GitHub
- Go to github.com → New repository → name it `nourish` → Create
- Upload all these files to it

### 3. Deploy to Vercel
- Go to vercel.com → Add New Project → Import your `nourish` GitHub repo
- Before clicking Deploy, click **Environment Variables** and add:
  - `VITE_ANTHROPIC_API_KEY` → your Anthropic key
  - `VITE_TODOIST_API_TOKEN` → your Todoist token
- Click **Deploy**

### 4. Share with your wife
- Vercel gives you a URL like `nourish-xyz.vercel.app`
- Share that URL — you both use the same app, same Todoist list
- Share the Todoist "🛒 Grocery List" project with her in the Todoist app too

## Local development
```
npm install
cp .env.example .env   # fill in your keys
npm run dev
```
