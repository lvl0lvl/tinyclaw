import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { getSettings, getAgents } from '../../lib/config';
import { log } from '../../lib/logging';
import { mutateSettings } from './settings';

const app = new Hono();

const DEFAULT_TOKEN_THRESHOLD = 50_000;
const DEFAULT_REFLECTION_THRESHOLD = 40_000;

interface ObserverState {
    observations_text: string;
    total_tokens_observed: number;
    observation_count: number;
    reflection_count: number;
    last_observed_at: string | null;
    current_task: string;
    suggested_response: string;
}

function readObserverState(agentDir: string): ObserverState {
    const stateFile = path.join(agentDir, '.switchboard', 'observer_state.json');
    try {
        const raw = fs.readFileSync(stateFile, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {
            observations_text: '',
            total_tokens_observed: 0,
            observation_count: 0,
            reflection_count: 0,
            last_observed_at: null,
            current_task: '',
            suggested_response: '',
        };
    }
}

// GET /api/agents/:id/observer
app.get('/api/agents/:id/observer', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agents = getAgents(settings);
    const agent = agents[agentId];

    if (!agent) {
        return c.json({ error: `agent '${agentId}' not found` }, 404);
    }

    const state = readObserverState(agent.working_directory);

    const config = {
        token_threshold: agent.observer_token_threshold ?? DEFAULT_TOKEN_THRESHOLD,
        reflection_threshold: agent.observer_reflection_threshold ?? DEFAULT_REFLECTION_THRESHOLD,
        observer_enabled: agent.observer_enabled ?? false,
        provider: agent.observer_model ?? 'claude',
    };

    // Try to read buffer state from the observer's buffer file
    let buffer = { message_count: 0, token_count: 0 };
    const bufferFile = path.join(agent.working_directory, '.switchboard', 'buffer_state.json');
    try {
        const raw = fs.readFileSync(bufferFile, 'utf8');
        const parsed = JSON.parse(raw);
        buffer = {
            message_count: parsed.message_count ?? 0,
            token_count: parsed.token_count ?? 0,
        };
    } catch {
        // Buffer state not available — use defaults
    }

    return c.json({ state, config, buffer });
});

// PUT /api/agents/:id/observer/config
app.put('/api/agents/:id/observer/config', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json();
    const settings = getSettings();
    const agents = getAgents(settings);

    if (!agents[agentId]) {
        return c.json({ error: `agent '${agentId}' not found` }, 404);
    }

    mutateSettings((s) => {
        if (!s.agents) s.agents = {};
        if (!s.agents[agentId]) return;

        if (typeof body.token_threshold === 'number') {
            s.agents[agentId].observer_token_threshold = body.token_threshold;
        }
        if (typeof body.reflection_threshold === 'number') {
            s.agents[agentId].observer_reflection_threshold = body.reflection_threshold;
        }
        if (typeof body.observer_enabled === 'boolean') {
            s.agents[agentId].observer_enabled = body.observer_enabled;
        }
    });

    log('INFO', `[API] Observer config updated for agent '${agentId}'`);
    return c.json({ ok: true });
});

export default app;
