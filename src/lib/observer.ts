import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ObserverSettings } from './types';
import { log } from './logging';

let observerConfig: ObserverSettings | null = null;

/**
 * Initialize the observer bridge. Call once at startup.
 * Validates that observer_path exists and stores the config for later use.
 */
export function initObserver(settings: { observer?: ObserverSettings }): void {
    const obs = settings?.observer;
    if (!obs || !obs.enabled) {
        log('INFO', 'Observer: disabled (no observer config or enabled=false)');
        return;
    }

    const srcDir = path.join(obs.observer_path, 'src');
    if (!fs.existsSync(srcDir)) {
        log('WARN', `Observer: observer_path/src not found at ${srcDir} — disabling`);
        return;
    }

    observerConfig = obs;
    log('INFO', `Observer: initialized (provider=${obs.provider}, store=${obs.store}, force=${obs.force})`);
}

/**
 * Observe an agent interaction by spawning hook.py as a fire-and-forget subprocess.
 * Writes messages to a temp JSON file in {projectRoot}/.switchboard/, then spawns
 * python3 -m switchboard.observer.hook with the appropriate flags.
 *
 * Never throws, never blocks the caller.
 */
export function observeInteraction(
    agentId: string,
    projectRoot: string,
    messages: Array<{ role: string; content: string }>
): void {
    try {
        if (!observerConfig) return;

        const switchboardDir = path.join(projectRoot, '.switchboard');
        if (!fs.existsSync(switchboardDir)) {
            fs.mkdirSync(switchboardDir, { recursive: true });
        }

        // Collision-resistant temp file name
        const timestamp = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const tempFile = path.join(switchboardDir, `pending_${agentId}_${timestamp}_${rand}.json`);

        fs.writeFileSync(tempFile, JSON.stringify(messages), 'utf8');

        const pythonPath = observerConfig.python_path || 'python3';
        const observerSrc = path.join(observerConfig.observer_path, 'src');

        const args = [
            '-m', 'switchboard.observer.hook',
            '--messages-file', tempFile,
            '--project-root', projectRoot,
            '--provider', observerConfig.provider,
            '--store', observerConfig.store,
        ];

        if (observerConfig.force) {
            args.push('--force');
        }

        if (observerConfig.engram_db) {
            args.push('--engram-db', observerConfig.engram_db);
        }

        const child = spawn(pythonPath, args, {
            cwd: projectRoot,
            stdio: 'ignore',
            detached: true,
            env: { ...process.env, PYTHONPATH: observerSrc },
        });

        child.on('error', (err) => {
            log('WARN', `Observer: spawn failed for agent ${agentId}: ${err.message}`);
        });

        child.unref();

        log('INFO', `Observer: spawned for agent ${agentId} (${messages.length} messages)`);

    } catch (err) {
        log('WARN', `Observer: error for agent ${agentId}: ${(err as Error).message}`);
    }
}
