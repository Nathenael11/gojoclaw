# Gojoclaw Personal Assistant

Gojoclaw is a personal assistant built on top of **Google ADK 2.0 (Agent Development Kit)**. It is written in TypeScript and integrates multiple messaging channels (Telegram, Discord, WhatsApp) with local capabilities like executing shell commands, reading/writing files, and fetching webpage content.

## Features

1. **Natural Chatting**: Powered by Gemini models (defaults to `gemini-1.5-flash-8b` to minimize quota issues).
2. **Context Memory**: Remembers conversation context per-user and per-channel natively.
3. **Tools**:
   - **`run_command`**: Runs shell commands locally (CMD/PowerShell).
   - **`read_file`**: Reads text files.
   - **`write_file`**: Writes files, including automatic directory creation.
   - **`list_dir`**: Lists files and folders.
   - **`delete_file`**: Deletes files.
   - **`browse_url`**: Fetches content of a URL and converts it to raw text.
4. **Multi-Channel Integration**: Runs Telegram, Discord, and WhatsApp bots concurrently, routing messages to separate conversation sessions.

---

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```
   *Note: If `googleapis` is not yet installed in your project, run:*
   ```bash
   npm install googleapis
   ```

2. Configure environment variables. Copy `.env.example` to `.env` and fill in the values:
   ```bash
   cp .env.example .env
   ```

3. Configure your API keys:
   - **`GEMINI_API_KEY`**: Set your Gemini developer key.
   - **`ENABLE_TELEGRAM`**, **`ENABLE_DISCORD`**, **`ENABLE_WHATSAPP`**: Enable the platforms you want to run.
   - Set the bot tokens for Telegram or Discord as needed.

4. Configure Gmail API (for Email Summary):
   To enable Gojoclaw to access Gmail and summarize your unread emails, choose one of these two setup methods:
   - **Option A (Environment Variables)**: Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` in your `.env` file.
   - **Option B (JSON files)**: Save your Google Developer Console desktop credentials JSON file as `.gmail_credentials.json` and your authorized OAuth2 token JSON file as `.gmail_token.json` in the root of the `gojoclaw` directory.

---

## Usage

### 1. Interactive Developer CLI
Run the assistant locally in your terminal for debugging:
```bash
npm run dev:cli
```

### 2. Developer Web UI
Start the ADK Web server to inspect agent logic, parameters, and run traces visually:
```bash
npm run dev:web
```
Then navigate to `http://localhost:8000`.

### 3. Multi-Channel Gateway
Compile the TypeScript code and start the bot client listener for Telegram, Discord, and WhatsApp:
```bash
npm start
```
*Note: If WhatsApp is enabled (`ENABLE_WHATSAPP=true`), a QR code will print to the terminal. Scan it using your mobile WhatsApp app to link the bot.*

---


