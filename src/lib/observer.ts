import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { log } from './logging';

interface ObserverState {
    observations_text: string;
    total_tokens_observed: number;
    observation_count: number;
    reflection_count: number;
    last_observed_at: string | null;
    current_task: string;
    suggested_response?: string;
}

interface ParsedStreamJson {
    result: string;
    messages: Array<{ role: string; content: any }>;
    sessionId: string;
}

/**
 * Get the observer state directory for an agent.
 */
export function getObserverStateDir(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, '.switchboard', agentId);
}

/**
 * Load observer state from disk. Returns null if no state exists.
 */
export function loadObserverState(agentId: string, workspacePath: string): ObserverState | null {
    const stateDir = getObserverStateDir(agentId, workspacePath);
    const stateFile = path.join(stateDir, 'observer_state.json');

    if (!fs.existsSync(stateFile)) return null;

    try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        return data as ObserverState;
    } catch (err) {
        log('WARN', `Failed to read observer state for ${agentId}: ${(err as Error).message}`);
        return null;
    }
}

/**
 * Build the system prompt injection block from observer state.
 */
export function formatObservationsPrompt(state: ObserverState): string {
    const parts: string[] = ['<observer-context>'];

    if (state.current_task) {
        parts.push(`<current-task>${state.current_task}</current-task>`);
    }

    if (state.suggested_response) {
        parts.push(`<suggested-response>${state.suggested_response}</suggested-response>`);
    }

    parts.push(`<observations>${state.observations_text}</observations>`);
    parts.push('</observer-context>');
    parts.push('');
    parts.push('Reference specific details from these observations when relevant.');
    parts.push('Prefer the MOST RECENT information when observations conflict.');

    return parts.join('\n');
}

/**
 * Parse NDJSON stream-json output from Claude CLI.
 * Extracts: result text, structured messages, session_id.
 * @deprecated No longer used by the anthropic provider path (migrated to SDK).
 */
export function parseStreamJson(ndjsonOutput: string): ParsedStreamJson {
    const lines = ndjsonOutput.trim().split('\n');
    let result = '';
    let sessionId = '';
    const messages: Array<{ role: string; content: any }> = [];

    for (const line of lines) {
        let json: any;
        try {
            json = JSON.parse(line);
        } catch {
            continue;
        }

        // Track session ID
        if (json.session_id && !sessionId) {
            sessionId = json.session_id;
        }

        // Collect assistant messages (tool use + text)
        if (json.type === 'assistant' && json.message?.content) {
            const content = json.message.content;
            messages.push({ role: 'assistant', content });

            // Extract text result
            for (const block of content) {
                if (block.type === 'text' && block.text) {
                    result = block.text;
                }
            }
        }

        // Collect tool results
        if (json.type === 'user' && json.message?.content) {
            messages.push({ role: 'user', content: json.message.content });
        }

        // Final result event has the full text
        if (json.type === 'result' && json.result) {
            result = json.result;
            if (json.session_id) sessionId = json.session_id;
        }
    }

    return { result, messages, sessionId };
}

/**
 * Run the observer hook.py against a set of messages.
 * Spawns Python subprocess, writes messages to temp file.
 */
export async function runObserver(
    agentId: string,
    messages: Array<{ role: string; content: any }>,
    workspacePath: string,
    provider: string = 'dummy',
    tokenThreshold: number = 1000,
    reflectionThreshold: number = 40_000,
    observerSrc?: string,
    observerPython?: string,
): Promise<void> {
    // Write messages to temp file
    const tmpFile = path.join(os.tmpdir(), `observer-${agentId}-${Date.now()}.json`);

    // Normalize messages: flatten content arrays to strings for the observer
    const normalized = messages.map(msg => {
        if (Array.isArray(msg.content)) {
            // Concatenate text blocks, summarize tool use/results
            const parts: string[] = [];
            for (const block of msg.content) {
                if (block.type === 'text' && block.text) {
                    parts.push(block.text);
                } else if (block.type === 'tool_use') {
                    parts.push(`[Tool: ${block.name}] Input: ${JSON.stringify(block.input).substring(0, 500)}`);
                } else if (block.type === 'tool_result') {
                    const content = typeof block.content === 'string'
                        ? block.content.substring(0, 1000)
                        : JSON.stringify(block.content).substring(0, 1000);
                    parts.push(`[Tool Result] ${content}`);
                }
            }
            return { role: msg.role, content: parts.join('\n') };
        }
        return msg;
    }).map(msg => {
        if (typeof msg.content !== 'string') return msg;
        // Strip team routing artifacts before sending to observer
        let content = msg.content;
        content = content.replace(/^\[Message from teammate @[^\]]+\]:\n/, '');
        content = content.replace(/\n\n------\n\n\[\d+ other teammate response\(s\) are still being processed[^\]]*\]/, '');
        return { role: msg.role, content };
    });

    fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2));

    const agentDir = path.join(workspacePath, agentId);

    try {
        await new Promise<void>((resolve, reject) => {
            const pythonBin = observerPython || process.env.SWITCHBOARD_PYTHON || 'python3';
            const srcPath = observerSrc || process.env.SWITCHBOARD_OBSERVER_SRC;
            if (!srcPath) {
                log('WARN', `Observer for ${agentId}: no observer source path configured. Set workspace.observer_src in settings or SWITCHBOARD_OBSERVER_SRC env var.`);
            }
            const child = spawn(pythonBin, [
                '-m', 'switchboard.observer.hook',
                '--messages-file', tmpFile,
                '--project-root', agentDir,
                '--agent-id', agentId,
                '--provider', provider,
                '--token-threshold', String(tokenThreshold),
                '--reflection-threshold', String(reflectionThreshold),
            ], {
                cwd: agentDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PYTHONPATH: [srcPath, process.env.PYTHONPATH]
                        .filter(Boolean).join(path.delimiter),
                },
            });

            let stderr = '';
            child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            child.on('error', (err) => reject(err));
            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`observer hook exited with code ${code}: ${stderr.trim()}`));
                }
            });
        });
    } finally {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}
