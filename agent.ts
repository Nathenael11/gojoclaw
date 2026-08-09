import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as path from 'path';
import { google } from 'googleapis';

const execPromise = promisify(exec);

// Helper function to strip HTML tags and scripts/styles
function htmlToText(html: string): string {
  // Remove script and style tags and their contents
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Decode basic HTML entities
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
  return text;
}

// 1. Shell Command Tool
const runCommand = new FunctionTool<any>({
  name: 'run_command',
  description: 'Executes a command-line string in the local shell (CMD/PowerShell) and returns stdout and stderr. Use this to perform shell tasks.',
  parameters: z.object({
    command: z.string().describe('The command to execute, e.g. "dir" or "ipconfig".')
  }),
  execute: async (input: any) => {
    const { command } = input;
    try {
      const { stdout, stderr } = await execPromise(command);
      return { success: true, stdout, stderr };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      };
    }
  }
});

// 2. Read File Tool
const readFile = new FunctionTool<any>({
  name: 'read_file',
  description: 'Reads the content of a text file from the local filesystem.',
  parameters: z.object({
    filePath: z.string().describe('The path to the file to read.')
  }),
  execute: async (input: any) => {
    const { filePath } = input;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
});

// 3. Write File Tool
const writeFile = new FunctionTool<any>({
  name: 'write_file',
  description: 'Writes text content to a file. Overwrites the file if it exists, or creates it and any parent directories if they do not exist.',
  parameters: z.object({
    filePath: z.string().describe('The path to the file to write to.'),
    content: z.string().describe('The content to write into the file.')
  }),
  execute: async (input: any) => {
    const { filePath, content } = input;
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true, message: `Successfully wrote file to ${filePath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
});

// 4. List Directory Tool
const listDir = new FunctionTool<any>({
  name: 'list_dir',
  description: 'Lists files and folders inside a given directory.',
  parameters: z.object({
    dirPath: z.string().optional().describe('The directory path to list. Defaults to current directory "."')
  }),
  execute: async (input: any) => {
    const { dirPath } = input;
    try {
      const targetPath = dirPath || '.';
      const items = await fs.readdir(targetPath, { withFileTypes: true });
      const results = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'other'
      }));
      return { success: true, dirPath: targetPath, items: results };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
});

// 5. Delete File Tool
const deleteFile = new FunctionTool<any>({
  name: 'delete_file',
  description: 'Deletes a file from the local filesystem.',
  parameters: z.object({
    filePath: z.string().describe('The path of the file to delete.')
  }),
  execute: async (input: any) => {
    const { filePath } = input;
    try {
      await fs.unlink(filePath);
      return { success: true, message: `Successfully deleted file ${filePath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
});

// 6. Browse URL Tool
const browseUrl = new FunctionTool<any>({
  name: 'browse_url',
  description: 'Fetches the content of a web page and returns its text. Use this to read web documentation or articles.',
  parameters: z.object({
    url: z.string().describe('The URL to retrieve.')
  }),
  execute: async (input: any) => {
    const { url } = input;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (!response.ok) {
        return { success: false, error: `HTTP request failed with status ${response.status}` };
      }
       const html = await response.text();
       const text = htmlToText(html);
       const maxChar = 12000;
       const content = text.length > maxChar ? text.substring(0, maxChar) + '\n... [TRUNCATED] ...' : text;
       return { success: true, url, content };
     } catch (error: any) {
       return { success: false, error: error.message };
     }
   }
 });
 
 // Helper to get Gmail Client
 async function getGmailClient() {
   const tokenPath = path.resolve('.gmail_token.json');
   const credentialsPath = path.resolve('.gmail_credentials.json');
 
   let oauth2Client;
 
   try {
     const credsData = await fs.readFile(credentialsPath, 'utf-8');
     const credentials = JSON.parse(credsData);
     const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
     oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
 
     const tokenData = await fs.readFile(tokenPath, 'utf-8');
     oauth2Client.setCredentials(JSON.parse(tokenData));
     return google.gmail({ version: 'v1', auth: oauth2Client });
   } catch (e) {
     const clientId = process.env.GMAIL_CLIENT_ID;
     const clientSecret = process.env.GMAIL_CLIENT_SECRET;
     const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
 
     if (clientId && clientSecret && refreshToken) {
       oauth2Client = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
       oauth2Client.setCredentials({ refresh_token: refreshToken });
       return google.gmail({ version: 'v1', auth: oauth2Client });
     }
   }
   throw new Error('Gmail API credentials are not configured. Please supply .gmail_credentials.json and .gmail_token.json, or set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in your environment/.env file.');
 }
 
 // Helper to parse plain text body from nested parts
 function findPlainTextMessagePart(parts: any[]): any {
   for (const part of parts) {
     if (part.mimeType === 'text/plain') {
       return part;
     }
     if (part.parts) {
       const subPart = findPlainTextMessagePart(part.parts);
       if (subPart) return subPart;
     }
   }
   return null;
 }
 
 // Helper to parse message headers and content
 function parseGmailMessage(message: any) {
   const headers = message.payload?.headers || [];
   const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
   const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
   const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';
 
   let body = message.snippet || '';
   const parts = message.payload?.parts;
   if (parts) {
     const plainTextPart = findPlainTextMessagePart(parts);
     if (plainTextPart && plainTextPart.body?.data) {
       body = Buffer.from(plainTextPart.body.data, 'base64').toString('utf-8');
     }
   } else if (message.payload?.body?.data) {
     body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
   }
 
   return { from, subject, date, content: body.substring(0, 2000) };
 }
 
 // 7. Get Unread Emails Tool
 const getUnreadEmails = new FunctionTool<any>({
   name: 'get_unread_emails',
   description: 'Fetches unread emails from Gmail with sender, date, subject, and content, so that you can summarize them for the user.',
   parameters: z.object({
     maxResults: z.number().optional().describe('Maximum number of unread emails to retrieve. Defaults to 5.')
   }),
   execute: async (input: any) => {
     const maxResults = input.maxResults || 5;
     try {
       const gmail = await getGmailClient();
       const res = await gmail.users.messages.list({
         userId: 'me',
         q: 'is:unread',
         maxResults
       });
 
       const messages = res.data.messages || [];
       const emailDetails = [];
       for (const msg of messages) {
         if (msg.id) {
           const detailRes = await gmail.users.messages.get({
             userId: 'me',
             id: msg.id
           });
           const parsed = parseGmailMessage(detailRes.data);
           emailDetails.push({ id: msg.id, ...parsed });
         }
       }
 
       return { success: true, count: emailDetails.length, emails: emailDetails };
     } catch (error: any) {
       return { success: false, error: error.message };
     }
   }
 });
 
 // Create and export the main personal assistant agent
 export const rootAgent = new LlmAgent({
   name: 'gojoclaw',
   description: 'A personal assistant that can run shell commands, perform file operations, read web pages, fetch/summarize emails, and converse across multiple platforms.',
   model: process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b',
   instruction: `You are Gojoclaw, a highly competent, friendly, and proactive personal assistant.
 Your main goals are:
 1. Help the user with their queries, tasks, and problems.
 2. Use your tools (run_command, read_file, write_file, list_dir, delete_file, browse_url, get_unread_emails) intelligently to find answers, execute commands, or summarize emails when appropriate.
 3. Maintain a friendly and helpful tone.
 4. Keep conversation context in mind.
 5. Be concise and precise.
 
 When executing shell commands or writing/reading files, remember that you are executing them on the user's host machine. Ensure you act safely and responsibly.`,
   tools: [runCommand, readFile, writeFile, listDir, deleteFile, browseUrl, getUnreadEmails]
 });
