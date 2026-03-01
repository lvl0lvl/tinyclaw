/**
 * Unit tests for the observer bridge functions.
 * Plain Node assert — no test framework needed.
 *
 * Run: npm run test:observer
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseStreamJson, formatObservationsPrompt, loadObserverState, filterStaleTeamReferences } from '../lib/observer';

// ── Fixtures ─────────────────────────────────────────────────

const NDJSON_FIXTURE = [
    '{"type":"system","session_id":"sess-abc123","message":{"role":"system","content":"System prompt"}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I\'ll read that file."},{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"/workspace/README.md"}}]}}',
    '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"# My Project\\nA CLI tool."}]}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"This project is a CLI tool."}]}}',
    '{"type":"result","result":"This project is a CLI tool.","session_id":"sess-abc123"}',
].join('\n');

// ── Tests ────────────────────────────────────────────────────

function testParseStreamJson() {
    const parsed = parseStreamJson(NDJSON_FIXTURE);

    // Result text comes from the final "result" event
    assert.strictEqual(parsed.result, 'This project is a CLI tool.');
    assert.strictEqual(parsed.sessionId, 'sess-abc123');

    // Should capture assistant and user messages (not system)
    assert.ok(parsed.messages.length >= 3, `Expected >= 3 messages, got ${parsed.messages.length}`);

    // First assistant message should have content array with tool_use
    const firstAssistant = parsed.messages.find(m => m.role === 'assistant');
    assert.ok(firstAssistant, 'No assistant message found');
    assert.ok(Array.isArray(firstAssistant.content), 'Assistant content should be an array');

    const toolUseBlock = firstAssistant.content.find((b: any) => b.type === 'tool_use');
    assert.ok(toolUseBlock, 'No tool_use block in first assistant message');
    assert.strictEqual(toolUseBlock.name, 'Read');

    // User message with tool_result
    const userMsg = parsed.messages.find(m => m.role === 'user');
    assert.ok(userMsg, 'No user message found');
    const toolResultBlock = userMsg.content.find((b: any) => b.type === 'tool_result');
    assert.ok(toolResultBlock, 'No tool_result block in user message');

    console.log('  PASS: testParseStreamJson');
}

function testFormatObservationsPrompt() {
    const state = {
        observations_text: '* HIGH (10:00) User prefers Python\n* MEDIUM (10:05) Project uses Click',
        total_tokens_observed: 500,
        observation_count: 2,
        reflection_count: 0,
        last_observed_at: '2026-02-26T10:00:00Z',
        current_task: 'Reviewing project structure',
    };

    const prompt = formatObservationsPrompt(state);

    assert.ok(prompt.includes('<observer-context>'), 'Missing opening tag');
    assert.ok(prompt.includes('</observer-context>'), 'Missing closing tag');
    assert.ok(prompt.includes('<current-task>Reviewing project structure</current-task>'), 'Missing current-task');
    assert.ok(prompt.includes('User prefers Python'), 'Missing observation text');
    assert.ok(prompt.includes('MOST RECENT'), 'Missing recency instruction');
    assert.ok(prompt.includes('team-routing'), 'Missing team-routing staleness note');

    // Without current_task
    const stateNoTask = { ...state, current_task: '' };
    const promptNoTask = formatObservationsPrompt(stateNoTask);
    assert.ok(!promptNoTask.includes('<current-task>'), 'Should not include empty current-task tag');

    console.log('  PASS: testFormatObservationsPrompt');
}

function testFilterStaleTeamReferences() {
    // Team structure assertions should be filtered
    const input = [
        '* HIGH (10:00) User wants to build a CLI tool',
        '* MEDIUM (10:05) Your team includes @agent-a, @agent-b, and @agent-c',
        '* HIGH (10:10) The project uses Python 3.13',
        '* LOW (10:15) You are in team legal-research with osha-researcher',
        '* MEDIUM (10:20) The database schema needs updating',
        '* LOW (10:25) Team research-team with agent-x, agent-y comprises the analysis group',
        '* LOW (10:26) Team dev-squad comprises the frontend and backend developers',
        '* HIGH (10:30) The API endpoint returns 404',
    ].join('\n');

    const filtered = filterStaleTeamReferences(input);

    // Non-team lines should be preserved
    assert.ok(filtered.includes('User wants to build a CLI tool'), 'Should keep non-team observation');
    assert.ok(filtered.includes('Python 3.13'), 'Should keep tech observation');
    assert.ok(filtered.includes('database schema needs updating'), 'Should keep task observation');
    assert.ok(filtered.includes('API endpoint returns 404'), 'Should keep bug observation');

    // Team structure lines should be removed
    assert.ok(!filtered.includes('Your team includes'), 'Should filter team roster');
    assert.ok(!filtered.includes('You are in team'), 'Should filter team membership assertion');
    assert.ok(!filtered.includes('Team research-team with'), 'Should filter team composition with agents');
    assert.ok(!filtered.includes('Team dev-squad comprises'), 'Should filter team comprises pattern');

    console.log('  PASS: testFilterStaleTeamReferences');
}

function testFilterPreservesNonTeamContent() {
    // Lines that mention "team" in non-structural ways should be kept
    const input = [
        '* HIGH (10:00) The team discussed refactoring options',
        '* MEDIUM (10:05) User wants team communication via Slack',
        '* HIGH (10:10) The project uses teamwork-based approach',
    ].join('\n');

    const filtered = filterStaleTeamReferences(input);

    assert.ok(filtered.includes('discussed refactoring options'), 'Should keep discussion reference');
    assert.ok(filtered.includes('team communication via Slack'), 'Should keep feature request');
    assert.ok(filtered.includes('teamwork-based approach'), 'Should keep general mention');

    console.log('  PASS: testFilterPreservesNonTeamContent');
}

function testFilterHandlesEmptyInput() {
    assert.strictEqual(filterStaleTeamReferences(''), '');
    assert.strictEqual(filterStaleTeamReferences('\n\n'), '\n\n');
    console.log('  PASS: testFilterHandlesEmptyInput');
}

function testFormatObservationsFiltersTeamReferences() {
    // The full pipeline should filter team references from observations
    const state = {
        observations_text: '* HIGH (10:00) User prefers Python\n* MEDIUM (10:05) Your team includes @old-agent and @stale-agent\n* HIGH (10:10) Project uses FastAPI',
        total_tokens_observed: 500,
        observation_count: 3,
        reflection_count: 0,
        last_observed_at: '2026-02-28T10:00:00Z',
        current_task: 'Building API',
    };

    const prompt = formatObservationsPrompt(state);

    assert.ok(prompt.includes('User prefers Python'), 'Should keep relevant observation');
    assert.ok(prompt.includes('Project uses FastAPI'), 'Should keep tech observation');
    assert.ok(!prompt.includes('Your team includes'), 'Should filter team roster from prompt');

    console.log('  PASS: testFormatObservationsFiltersTeamReferences');
}

function testLoadObserverState() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-observer-test-'));

    // Non-existent path returns null
    const missing = loadObserverState('no-agent', tmpDir);
    assert.strictEqual(missing, null, 'Should return null for missing state');

    // Create a valid state file at the expected path
    const agentId = 'test-agent';
    const stateDir = path.join(tmpDir, agentId, '.switchboard', agentId);
    fs.mkdirSync(stateDir, { recursive: true });

    const stateData = {
        observations_text: '* HIGH (10:00) Test observation',
        total_tokens_observed: 100,
        observation_count: 1,
        reflection_count: 0,
        last_observed_at: '2026-02-26T10:00:00Z',
        current_task: 'Testing',
    };
    fs.writeFileSync(path.join(stateDir, 'observer_state.json'), JSON.stringify(stateData));

    const loaded = loadObserverState(agentId, tmpDir);
    assert.ok(loaded, 'Should load existing state');
    assert.strictEqual(loaded!.observation_count, 1);
    assert.ok(loaded!.observations_text.includes('Test observation'));

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log('  PASS: testLoadObserverState');
}

function testMessageNormalization() {
    // Simulate the normalization logic from runObserver in observer.ts
    const rawMessages: Array<{ role: string; content: any }> = [
        {
            role: 'assistant',
            content: [
                { type: 'text', text: 'Let me read that.' },
                { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/workspace/README.md' } },
            ],
        },
        {
            role: 'user',
            content: [
                { type: 'tool_result', tool_use_id: 'tu_1', content: '# My Project\nA CLI tool.' },
            ],
        },
        {
            role: 'assistant',
            content: 'Plain string content — no normalization needed.',
        },
    ];

    // Apply the same normalization as runObserver
    const normalized = rawMessages.map(msg => {
        if (Array.isArray(msg.content)) {
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
    });

    // Verify normalization results
    assert.strictEqual(normalized.length, 3);

    // First message: assistant with tool use
    assert.strictEqual(typeof normalized[0].content, 'string');
    assert.ok(normalized[0].content.includes('[Tool: Read]'), 'Missing tool name');
    assert.ok(normalized[0].content.includes('Let me read that.'), 'Missing text block');
    assert.ok(normalized[0].content.includes('file_path'), 'Missing input');

    // Second message: user with tool result
    assert.strictEqual(typeof normalized[1].content, 'string');
    assert.ok(normalized[1].content.includes('[Tool Result]'), 'Missing tool result marker');
    assert.ok(normalized[1].content.includes('My Project'), 'Missing tool result content');

    // Third message: already a string, unchanged
    assert.strictEqual(normalized[2].content, 'Plain string content — no normalization needed.');

    console.log('  PASS: testMessageNormalization');
}

// ── Runner ───────────────────────────────────────────────────

function main() {
    console.log('Observer Bridge Tests');
    console.log('='.repeat(40));

    let passed = 0;
    let failed = 0;

    const tests = [
        testParseStreamJson,
        testFormatObservationsPrompt,
        testLoadObserverState,
        testMessageNormalization,
        testFilterStaleTeamReferences,
        testFilterPreservesNonTeamContent,
        testFilterHandlesEmptyInput,
        testFormatObservationsFiltersTeamReferences,
    ];

    for (const test of tests) {
        try {
            test();
            passed++;
        } catch (err) {
            console.log(`  FAIL: ${test.name}`);
            console.log(`        ${(err as Error).message}`);
            failed++;
        }
    }

    console.log(`\n${passed}/${tests.length} tests passed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

main();
