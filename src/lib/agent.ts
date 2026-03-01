import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR } from './config';

/**
 * Recursively copy directory, overwriting existing files.
 */
export function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Recursively copy directory, skipping files that already exist at destination.
 */
export function copyDirSyncNoOverwrite(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSyncNoOverwrite(srcPath, destPath);
        } else if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Ensure agent directory exists with all required template files.
 * Creates directory if missing, and repairs incomplete directories by
 * copying any missing files without overwriting existing ones.
 */
export function ensureAgentDirectory(agentDir: string): void {
    fs.mkdirSync(agentDir, { recursive: true });

    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
    const sourceAgents = path.join(SCRIPT_DIR, 'AGENTS.md');
    const sourceSoul = path.join(SCRIPT_DIR, 'SOUL.md');
    const sourceSkills = fs.existsSync(path.join(SCRIPT_DIR, '.agent', 'skills'))
        ? path.join(SCRIPT_DIR, '.agent', 'skills')
        : path.join(SCRIPT_DIR, '.agents', 'skills');

    // Copy .claude directory (only missing files)
    const targetClaudeDir = path.join(agentDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSyncNoOverwrite(sourceClaudeDir, targetClaudeDir);
    }

    // Copy heartbeat.md if missing
    const targetHeartbeat = path.join(agentDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat) && !fs.existsSync(targetHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    // Copy AGENTS.md if missing
    const targetAgents = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(sourceAgents) && !fs.existsSync(targetAgents)) {
        fs.copyFileSync(sourceAgents, targetAgents);
    }

    // Copy AGENTS.md as .claude/CLAUDE.md if missing
    const targetClaudeMd = path.join(agentDir, '.claude', 'CLAUDE.md');
    if (fs.existsSync(sourceAgents) && !fs.existsSync(targetClaudeMd)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.copyFileSync(sourceAgents, targetClaudeMd);
    }

    // Symlink skills directory into .claude/skills if missing
    const targetClaudeSkills = path.join(agentDir, '.claude', 'skills');
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetClaudeSkills)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.symlinkSync(sourceSkills, targetClaudeSkills);
    }

    // Symlink .agent/skills if missing
    const targetAgentDir = path.join(agentDir, '.agent');
    const targetAgentSkills = path.join(targetAgentDir, 'skills');
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetAgentSkills)) {
        fs.mkdirSync(targetAgentDir, { recursive: true });
        fs.symlinkSync(sourceSkills, targetAgentSkills);
    }

    // Create .tinyclaw directory and copy SOUL.md if missing
    const targetTinyclaw = path.join(agentDir, '.tinyclaw');
    fs.mkdirSync(targetTinyclaw, { recursive: true });
    const targetSoul = path.join(targetTinyclaw, 'SOUL.md');
    if (fs.existsSync(sourceSoul) && !fs.existsSync(targetSoul)) {
        fs.copyFileSync(sourceSoul, targetSoul);
    }
}

/**
 * Update the AGENTS.md in an agent's directory with current teammate info.
 * Replaces content between <!-- TEAMMATES_START --> and <!-- TEAMMATES_END --> markers.
 */
export function updateAgentTeammates(agentDir: string, agentId: string, agents: Record<string, AgentConfig>, teams: Record<string, TeamConfig>): void {
    const agentsMdPath = path.join(agentDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) return;

    let content = fs.readFileSync(agentsMdPath, 'utf8');
    const startMarker = '<!-- TEAMMATES_START -->';
    const endMarker = '<!-- TEAMMATES_END -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) return;

    // Find teammates from all teams this agent belongs to
    const teammates: { id: string; name: string; model: string }[] = [];
    for (const team of Object.values(teams)) {
        if (!team.agents.includes(agentId)) continue;
        for (const tid of team.agents) {
            if (tid === agentId) continue;
            const agent = agents[tid];
            if (agent && !teammates.some(t => t.id === tid)) {
                teammates.push({ id: tid, name: agent.name, model: agent.model });
            }
        }
    }

    let block = '';
    const self = agents[agentId];
    if (self) {
        block += `\n### You\n\n- \`@${agentId}\` — **${self.name}** (${self.model})\n`;
    }
    if (teammates.length > 0) {
        block += '\n### Your Teammates\n\n';
        for (const t of teammates) {
            block += `- \`@${t.id}\` — **${t.name}** (${t.model})\n`;
        }
    }

    const newContent = content.substring(0, startIdx + startMarker.length) + block + content.substring(endIdx);
    fs.writeFileSync(agentsMdPath, newContent);

    // Also write to .claude/CLAUDE.md
    const claudeDir = path.join(agentDir, '.claude');
    if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
    }
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    let claudeContent = '';
    if (fs.existsSync(claudeMdPath)) {
        claudeContent = fs.readFileSync(claudeMdPath, 'utf8');
    }
    const cStartIdx = claudeContent.indexOf(startMarker);
    const cEndIdx = claudeContent.indexOf(endMarker);
    if (cStartIdx !== -1 && cEndIdx !== -1) {
        claudeContent = claudeContent.substring(0, cStartIdx + startMarker.length) + block + claudeContent.substring(cEndIdx);
    } else {
        // Append markers + block
        claudeContent = claudeContent.trimEnd() + '\n\n' + startMarker + block + endMarker + '\n';
    }
    fs.writeFileSync(claudeMdPath, claudeContent);
}
