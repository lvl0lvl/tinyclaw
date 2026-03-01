import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig, InvokeResult } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';
import { loadObserverState, formatObservationsPrompt } from './observer';
import { findTeamForAgent } from './routing';

/** Default timeout for SDK query in milliseconds (2 minutes). */
const SDK_QUERY_TIMEOUT_MS = 120_000;

// Cached dynamic import for ESM SDK (TinyClaw compiles to CommonJS)
let _sdkModule: any = null;
async function getSDK(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
    if (!_sdkModule) {
        _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
    }
    return _sdkModule;
}

function cleanEnvForSDK(): Record<string, string | undefined> {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    return env;
}

/**
 * Map SDK message stream to observer-compatible format.
 * Extracts assistant and user messages, skipping replays, system, and result messages.
 */
function collectObserverMessages(
    sdkMessages: Array<{ type: string; message?: any; isReplay?: boolean }>
): Array<{ role: string; content: any }> {
    const messages: Array<{ role: string; content: any }> = [];
    for (const msg of sdkMessages) {
        if ((msg as any).isReplay) continue;
        if (msg.type === 'assistant' && msg.message?.content) {
            messages.push({ role: 'assistant', content: msg.message.content });
        } else if (msg.type === 'user' && !(msg as any).isReplay && msg.message?.content) {
            messages.push({ role: 'user', content: msg.message.content });
        }
    }
    return messages;
}

export async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns InvokeResult for observer-enabled agents, plain string otherwise.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
): Promise<string | InvokeResult> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir);

        // Parse JSONL output and extract final agent_message
        let response = '';
        const lines = codexOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    } else if (provider === 'opencode') {
        // OpenCode CLI — non-interactive mode via `opencode run`.
        // Outputs JSONL with --format json; extract "text" type events for the response.
        // Model passed via --model in provider/model format (e.g. opencode/claude-sonnet-4-5).
        // Supports -c flag for conversation continuation (resumes last session).
        const modelId = resolveOpenCodeModel(agent.model);
        log('INFO', `Using OpenCode CLI (agent: ${agentId}, model: ${modelId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting OpenCode conversation for agent: ${agentId}`);
        }

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) {
            opencodeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            opencodeArgs.push('-c');
        }
        opencodeArgs.push(message);

        const opencodeOutput = await runCommand('opencode', opencodeArgs, workingDir);

        // Parse JSONL output and collect all text parts
        let response = '';
        const lines = opencodeOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.part?.text) {
                    response = json.part.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from OpenCode.';
    } else {
        // Default to Claude (Anthropic) — via Agent SDK
        log('INFO', `Using Claude provider via SDK (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const sdk = await getSDK();
        const modelId = resolveClaudeModel(agent.model);

        // Build system prompt with observer observations + team routing
        let appendParts: string[] = [];

        if (agent.observer_enabled) {
            const state = loadObserverState(agentId, workspacePath);
            if (state?.observations_text) {
                appendParts.push(formatObservationsPrompt(state));

                // Add continuation hint after reset
                if (shouldReset) {
                    message = `[Your previous conversation was cleared. Your observations contain your memory of past work. Pick up where you left off.]\n\n${message}`;
                }
            }
        }

        // Inject team routing instructions when agent is in a team
        const teamContext = findTeamForAgent(agentId, teams);
        if (teamContext) {
            const teammateIds = teamContext.team.agents.filter(id => id !== agentId);
            if (teammateIds.length > 0) {
                appendParts.push(
                    `<team-routing>\n` +
                    `You are agent "${agentId}" in team "${teamContext.teamId}".\n` +
                    `Your teammates: ${teammateIds.join(', ')}\n\n` +
                    `CRITICAL: To send a message to a teammate, you MUST include the tag ` +
                    `[@teammate_id: your message] in your response text. ` +
                    `This is the ONLY way to communicate with teammates. ` +
                    `Do NOT use SendMessage, Task, or any other tool for teammate communication. ` +
                    `Do NOT claim you sent a message unless you included the [@tag: msg] in your response.\n\n` +
                    `Example: [@${teammateIds[0]}: Can you help with this task?]\n` +
                    `</team-routing>`
                );
            }
        }

        let systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string } =
            appendParts.length > 0
                ? { type: 'preset', preset: 'claude_code', append: appendParts.join('\n\n') }
                : { type: 'preset', preset: 'claude_code' };

        // Abort controller for timeout — prevents fresh sessions from hanging
        const abortController = new AbortController();
        const timeout = setTimeout(() => {
            log('WARN', `SDK query timed out after ${SDK_QUERY_TIMEOUT_MS / 1000}s (agent: ${agentId})`);
            abortController.abort();
        }, SDK_QUERY_TIMEOUT_MS);

        const options: any = {
            cwd: workingDir,
            env: cleanEnvForSDK(),
            permissionMode: 'bypassPermissions' as const,
            allowDangerouslySkipPermissions: true,
            systemPrompt,
            tools: { type: 'preset' as const, preset: 'claude_code' as const },
            maxTurns: 1,
            abortController,
            // Only load project-level settings; skip user-global settings
            // that may configure heavy MCP servers (slack, playwright, etc.)
            settingSources: ['project' as const],
        };

        if (modelId) {
            options.model = modelId;
        }
        if (continueConversation) {
            options.continue = true;
        } else {
            // Fresh session: use a unique session ID and skip persistence
            // to avoid loading stale session state
            options.sessionId = crypto.randomUUID();
            options.persistSession = false;
        }

        // Iterate the async generator, collect messages
        const allMessages: Array<{ type: string; message?: any; isReplay?: boolean }> = [];
        let resultText = '';
        let sessionId = '';

        try {
            const queryStream = sdk.query({ prompt: message, options });
            for await (const msg of queryStream) {
                if (msg.type === 'assistant' || msg.type === 'user') {
                    allMessages.push(msg as any);
                }

                // Track session_id from any message that has it
                if ('session_id' in msg && msg.session_id && !sessionId) {
                    sessionId = msg.session_id;
                }

                if (msg.type === 'result') {
                    if (msg.subtype === 'success') {
                        resultText = msg.result;
                        sessionId = msg.session_id;
                    } else {
                        // SDKResultError — throw to be caught by queue-processor
                        const errorMsg = (msg as any).errors?.join('; ') || `SDK error: ${msg.subtype}`;
                        throw new Error(errorMsg);
                    }
                }
            }
        } finally {
            clearTimeout(timeout);
        }

        const observerMessages = collectObserverMessages(allMessages);

        return {
            response: resultText,
            messages: observerMessages,
            sessionId,
        };
    }
}
