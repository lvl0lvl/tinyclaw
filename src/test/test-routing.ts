/**
 * Unit tests for routing functions (bracket tags + bare @mention fallback).
 * Plain Node assert — no test framework needed.
 *
 * Run: npm run test:routing
 */
import assert from 'assert';
import { extractTeammateMentions, isTeammate, parseAgentRouting } from '../lib/routing';
import { AgentConfig, TeamConfig } from '../lib/types';

// ── Fixtures ─────────────────────────────────────────────────

const agents: Record<string, AgentConfig> = {
    'agent-a': { name: 'Alice', provider: 'anthropic', model: 'claude-sonnet-4-20250514' } as AgentConfig,
    'agent-b': { name: 'Bob', provider: 'anthropic', model: 'claude-sonnet-4-20250514' } as AgentConfig,
    'agent-c': { name: 'Charlie', provider: 'anthropic', model: 'claude-sonnet-4-20250514' } as AgentConfig,
};

const teams: Record<string, TeamConfig> = {
    'test-team': {
        name: 'Test Team',
        agents: ['agent-a', 'agent-b', 'agent-c'],
        leader_agent: 'agent-a',
    } as TeamConfig,
};

// ── Bracket syntax tests ────────────────────────────────────

function testBracketSyntax() {
    const response = 'Here is my analysis.\n\n[@agent-b: Please review the database schema.]';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');
    assert.ok(results[0].message.includes('Please review the database schema'), 'Missing directed message');
    assert.ok(results[0].message.includes('Here is my analysis'), 'Missing shared context');

    console.log('  PASS: testBracketSyntax');
}

function testBracketMultipleTeammates() {
    const response = '[@agent-b: Do the backend.]\n[@agent-c: Do the frontend.]';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 2, `Expected 2 matches, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');
    assert.strictEqual(results[1].teammateId, 'agent-c');

    console.log('  PASS: testBracketMultipleTeammates');
}

function testBracketCommaSeparated() {
    const response = '[@agent-b,agent-c: Please both review this.]';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 2, `Expected 2 matches, got ${results.length}`);
    const ids = results.map(r => r.teammateId).sort();
    assert.deepStrictEqual(ids, ['agent-b', 'agent-c']);

    console.log('  PASS: testBracketCommaSeparated');
}

function testBracketSelfMentionIgnored() {
    const response = '[@agent-a: Talking to myself.]';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 0, 'Self-mention should be ignored');

    console.log('  PASS: testBracketSelfMentionIgnored');
}

// ── Bare @mention fallback tests ────────────────────────────

function testBareMentionBasic() {
    const response = 'I think @agent-b should handle the database queries for this task.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');
    assert.strictEqual(results[0].message, response, 'Bare mention should send full response');

    console.log('  PASS: testBareMentionBasic');
}

function testBareMentionWithTrailingPunctuation() {
    const response = 'Let me ask @agent-b, they know more about this.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');

    console.log('  PASS: testBareMentionWithTrailingPunctuation');
}

function testBareMentionPeriod() {
    const response = 'Forwarding to @agent-b.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');

    console.log('  PASS: testBareMentionPeriod');
}

function testBareMentionMultiple() {
    const response = 'I need @agent-b for backend and @agent-c for frontend.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 2, `Expected 2 matches, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');
    assert.strictEqual(results[1].teammateId, 'agent-c');

    console.log('  PASS: testBareMentionMultiple');
}

function testBareMentionByName() {
    const response = 'I think @bob should handle this.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b', 'Should resolve name "bob" to agent-b');

    console.log('  PASS: testBareMentionByName');
}

function testBareMentionSelfIgnored() {
    const response = 'I (@agent-a) will handle this myself.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 0, 'Self-mention should be ignored');

    console.log('  PASS: testBareMentionSelfIgnored');
}

function testBareMentionUnknownAgentIgnored() {
    const response = 'Hey @unknown-agent can you help?';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 0, 'Unknown agent should be ignored');

    console.log('  PASS: testBareMentionUnknownAgentIgnored');
}

function testBareMentionNotUsedWhenBracketsFound() {
    // If bracket syntax is present, bare mentions should NOT trigger
    const response = '[@agent-b: Review this.] Also cc @agent-c for awareness.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match (bracket only), got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');

    console.log('  PASS: testBareMentionNotUsedWhenBracketsFound');
}

function testBareMentionAtStartOfLine() {
    const response = '@agent-b please check the logs for errors.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, `Expected 1 match, got ${results.length}`);
    assert.strictEqual(results[0].teammateId, 'agent-b');

    console.log('  PASS: testBareMentionAtStartOfLine');
}

function testNoMentions() {
    const response = 'This is just a regular response with no mentions at all.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 0, 'No mentions should return empty');

    console.log('  PASS: testNoMentions');
}

function testBareMentionDedup() {
    const response = '@agent-b check this. Also @agent-b see that.';
    const results = extractTeammateMentions(response, 'agent-a', 'test-team', teams, agents);

    assert.strictEqual(results.length, 1, 'Duplicate mentions should be deduplicated');
    assert.strictEqual(results[0].teammateId, 'agent-b');

    console.log('  PASS: testBareMentionDedup');
}

// ── Runner ───────────────────────────────────────────────────

function main() {
    console.log('Routing Tests');
    console.log('='.repeat(40));

    let passed = 0;
    let failed = 0;

    const tests = [
        // Bracket syntax
        testBracketSyntax,
        testBracketMultipleTeammates,
        testBracketCommaSeparated,
        testBracketSelfMentionIgnored,
        // Bare @mention fallback
        testBareMentionBasic,
        testBareMentionWithTrailingPunctuation,
        testBareMentionPeriod,
        testBareMentionMultiple,
        testBareMentionByName,
        testBareMentionSelfIgnored,
        testBareMentionUnknownAgentIgnored,
        testBareMentionNotUsedWhenBracketsFound,
        testBareMentionAtStartOfLine,
        testNoMentions,
        testBareMentionDedup,
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
