# Paper Pal 🐾

Your Desktop AI Paper Reading Companion - A cute desktop sprite that helps you track and read the latest AI papers.

English | [中文文档](README_CN.md)

## ✨ Features

- 🔍 **Auto Paper Fetching** - Fetch latest AI papers from ArXiv
- 🤖 **AI Smart Scoring** - Score papers based on your interests using LLM API
- 📄 **PDF Full-Text Analysis** - Download and analyze complete PDF content
- 💬 **Smart Q&A** - RAG-based conversation with PDF full text for accurate answers
- 🔍 **Multi-language Search** - Support Chinese and English semantic and keyword search
- 🏷️ **Response Source Labels** - Clear indication whether response is based on PDF or abstract
- 🖥️ **Desktop Sprite** - Cute desktop pet that reminds you of new papers
- 🎨 **Custom Skins** - Drag and drop GIF/PNG files to change skins
- 📚 **Read Later** - Save papers for later reading
- ⚡ **Smart Fallback** - Auto fallback to abstract mode when PDF processing fails

## 🚀 Quick Start

### Requirements

- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (recommended Python package manager)
- LLM API Key (supports OpenRouter, Gemini, OpenAI, Deepseek)

> **Note**: uv automatically manages Python versions and virtual environments. No need to install Python separately.

### 0. Install uv (recommended)

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

$env:Path = "C:\Users\Wang\.local\bin;$env:Path"

# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

> **Important**: After installation, you must restart your terminal for `uv` command to be available.

### 1. Install Dependencies

```bash
# Install frontend dependencies
# Optional: Use China mirror for faster downloads
# npm config set registry https://registry.npmmirror.com
npm install

# Install backend dependencies (using uv - recommended)
cd backend
uv venv --python 3.12                # Create virtual environment, known issue: higher Python versions may have library conflicts
uv pip install -r requirements.txt   # Install dependencies

# Alternative: using traditional pip (requires Python 3.9+ pre-installed)
# cd backend
# python -m venv .venv
# .venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Mac/Linux
# pip install -r requirements.txt
```

> **Why uv?** uv automatically downloads and manages Python versions, creates isolated environments, and installs packages faster than traditional pip. No need to install Python separately!

### 2. Configure Environment Variables

Copy `backend/.env.example` to `backend/.env` and edit:

```env
# LLM API Key (required)
# Get from your provider's website
LLM_API_KEY=your_api_key_here

# LLM Provider
# Options: "openrouter", "gemini", "openai", "deepseek"
LLM_PROVIDER=openrouter

# Proxy settings (optional, leave empty for no proxy)
HTTP_PROXY=
HTTPS_PROXY=

# Paper score threshold (optional, default: 7.0)
SCORE_THRESHOLD=7.0

# Auto fetch interval (minutes, default: 60)
FETCH_INTERVAL_MINUTES=60

# Enable auto fetch (default: true)
AUTO_FETCH_ENABLED=true
```

### 3. Start the Application

**Development Mode (recommended for first-time users)**

```bash
# Terminal 1 - Start backend
cd backend
# Using uv (recommended) - automatically uses the virtual environment
uv run python -m uvicorn src.api.server:app --reload --port 8002
```

```bash
# One-command development startup (recommended)
npm run electron:dev
```

This command will automatically:
- Compile TypeScript files
- Start Next.js development server
- Wait for dev server to be ready, then start Electron
- Handle port conflicts automatically (3000 → 3001)

**Step-by-step startup (for debugging)**

```bash
# Terminal 1 - Start backend
cd backend
# Using uv (recommended) - automatically uses the virtual environment
uv run python -m uvicorn src.api.server:app --reload --port 8002

# Terminal 2 - Start frontend development server
npm run dev

# Terminal 3 - Start Electron (after frontend server is ready)
npm run electron:compile  # Compile TypeScript
electron .                # Start Electron

# Alternative: using traditional venv
# cd backend
# .venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Mac/Linux
# python -m uvicorn src.api.server:app --reload --port 8002
```

**Custom development server address**

```bash
# If you need to use a different port or address
DEV_SERVER_URL=http://localhost:3002 npm run electron:dev
```

**Production Build**

```bash
# Build and package the application
# Set chinese source 
# $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run electron:build

# The packaged app will be in the dist/ folder
```

**Frontend only (without Electron desktop app)**

```bash
npm run dev
```

### 4. Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:8002
- API Docs: http://localhost:8002/docs

> **Note**: The backend server must be running for the application to work properly. In production, you can run the backend as a background service.

## 📖 Usage Guide

### Desktop Sprite Mode

1. After starting the app, a cute sprite appears on your desktop
2. **Left-click** - Open main interface
3. **Right-click** - Open menu (scale, close menu, quit)
4. **ESC key** - Close context menu

### Custom Sprite Skins

Drag and drop any GIF or PNG file onto the sprite to change its skin.

![datawhale_skin](images/screenshots/datawhale_skin.png)

![datawhale_pal](images/screenshots/datawhale_pal.png)

![pandas_skin](images/screenshots/pandas_skin.png)

![pandas_pal](images/screenshots/pandas_pal.png)

### Fetching Papers

1. Click "Fetch Papers" button to fetch latest papers from ArXiv
2. System will automatically score papers using AI
3. When high-scoring papers are found, the sprite shows a bubble notification

![alert_pal](images/screenshots/alert_pal.png)

### Reading Papers

1. Click on a paper in the list to view details
2. View AI-generated one-liner, pros and cons analysis
3. Click "Chat" to start intelligent conversation based on PDF full text
4. **PDF Processing Status**:
   - 🔄 Downloading PDF...
   - 📄 Processing text...
   - ✅ PDF processing complete, full-text chat available
   - ⚠️ PDF processing failed, fallback to abstract mode
5. **Response Source Labels**:
   - 📄 **Green label**: Response based on PDF full text (high reliability)
   - 📝 **Yellow label**: Response based on abstract only, may contain hallucinations

![paper_list](images/screenshots/paper_list.png)

![chat](images/screenshots/chat.png)

### Saving Papers

Click "Read Later" button to save papers for future reading.

## 🛠️ Tech Stack

- **Frontend**: Next.js + React + TypeScript + Tailwind CSS
- **Backend**: Python + FastAPI
- **Desktop**: Electron
- **AI**: OpenRouter / Gemini / OpenAI / Deepseek (via OpenAI-compatible interface)
- **PDF Processing**: PyMuPDF (fitz)
- **Text Search**: Improved BM25 algorithm with Chinese/English support
- **Storage**: JSON files (no database required)

## 📁 Project Structure

```
paper-pal/
├── src/                    # Frontend source
│   ├── app/               # Next.js pages
│   ├── components/        # React components
│   │   ├── Avatar/        # Sprite components
│   │   ├── Bubble/        # Bubble notifications
│   │   ├── Chat/          # Chat interface (PDF RAG support)
│   │   └── ...
│   ├── skin/              # Skin management
│   └── api/               # API client
├── electron/              # Electron main process
│   ├── main.ts            # Main entry
│   ├── preload.ts         # Preload script
│   └── WindowManager.ts   # Window management
├── backend/               # Python backend
│   ├── src/
│   │   ├── api/          # FastAPI routes
│   │   ├── fetcher/      # Paper fetching
│   │   ├── scorer/       # AI scoring
│   │   ├── pdf/          # PDF processing
│   │   ├── rag/          # RAG service
│   │   └── db/           # JSON storage
│   └── data/             # Data files
└── public/               # Static assets
```

## ⚙️ Configuration

### LLM Provider Configuration

Supports four LLM providers via OpenAI-compatible interface:

| Provider | Endpoint | Default Model |
|----------|----------|---------------|
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.0-flash-001` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-1.5-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |

### Getting API Keys

- **OpenRouter**: https://openrouter.ai/keys (Recommended, supports multiple models, no proxy needed)
- **Gemini**: https://makersuite.google.com/app/apikey
- **OpenAI**: https://platform.openai.com/api-keys
- **Deepseek**: https://platform.deepseek.com/ (Cost-effective, good for Chinese content)

## 🐛 FAQ

### Q: Bubble notifications not fully displayed on macOS?
A: You can adjust the sprite space size in the sprite settings.

### Q: Cannot connect to ArXiv?
A: Check proxy settings, ensure `HTTP_PROXY` and `HTTPS_PROXY` are configured correctly.

### Q: AI scoring failed?
A: Confirm `LLM_API_KEY` is valid and `LLM_PROVIDER` is set correctly.

### Q: PDF processing failed?
A: 
1. Ensure PyMuPDF is installed: `pip install PyMuPDF`
2. Check network connection to ArXiv PDF links
3. System will auto fallback to abstract mode if PDF processing fails

### Q: Which LLM provider is recommended?
A: OpenRouter is recommended - it supports multiple models and doesn't require a proxy.

### Q: How to quit the application?
A: Right-click the sprite and select "Quit", or click "Close Menu" then "Quit".

### Q: Windows shows "ImportError: DLL load failed while importing _ssl"?
A: Check if `libssl-1_1.dll` and `libcrypto-1_1.dll` exist in your system paths (or `libssl-1_1-x64.dll`).

### Q: Development server connection failed?
A:
1. Ensure Next.js dev server is running: `npm run dev`
2. System will automatically try ports 3000 and 3001
3. Use `DEV_SERVER_URL` environment variable to customize address
4. Check terminal logs to confirm actual running port

### Q: Electron shows wrong environment?
A:
1. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
2. Recompile TypeScript: `npm run electron:compile`
3. Ensure no multiple Electron processes are running

## 🛠️ Development Workflow

### Daily Development Process

```bash
# 1. Start complete development environment
npm run electron:dev

# 2. Start backend in another terminal (for full functionality)
cd backend && uv run python -m uvicorn src.api.server:app --reload --port 8002

# 3. During development
# - Frontend code changes: automatic hot reload
# - Backend code changes: automatic restart
# - Electron code changes: manual restart required (Ctrl+C then rerun)
```

### Debugging Tools

- **Frontend debugging**: Browser dev tools (Ctrl+Shift+I or F12)
- **Backend debugging**: FastAPI auto docs http://localhost:8002/docs
- **Electron debugging**: Main process logs in terminal, renderer process in dev tools

### Build Testing

```bash
npm run build                # Test Next.js build
npm run electron:compile     # Test TypeScript compilation
npm run electron:build       # Full packaging test
```

## 🤝 Contributing

Contributions are welcome! Feel free to submit Issues and Pull Requests.

## 📄 License

MIT License

---

**Paper Pal** - Making AI research more convenient and fun! 🐾✨
