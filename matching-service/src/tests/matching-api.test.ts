import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import {
    getQueueStatus,
    joinQueue,
    listQueuedUsers,
    pickBestWaitingUserIndex,
    resetMatchingState,
} from '../services/matching-service';
import type { QueueEntry } from '../models/matching-model';

let server: Server;
let baseUrl: string;

async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    token?: string,
): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    return {
        status: response.status,
        json: await response.json(),
    };
}

test.before(async () => {
    const app = createApp();
    server = app.listen(0);

    await new Promise<void>((resolve) => {
        server.on('listening', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
});

test.beforeEach(() => {
    resetMatchingState();
});

function createToken(userId: string, role = 'user') {
    return jwt.sign({ sub: userId, role, type: 'access' }, 'dev-jwt-secret', { expiresIn: '15m' });
}

test('GET /matching/health returns service health', async () => {
    const result = await request('GET', '/matching/health');

    assert.equal(result.status, 200);
    assert.deepEqual(result.json, {
        status: 'ok',
        service: 'matching-service',
    });
});

test('POST /matching/join queues first user and matches second user with same criteria', async () => {
    const tokenA = createToken('user-a');
    const tokenB = createToken('user-b');

    const firstJoin = await request('POST', '/matching/join', {
        userId: 'user-a',
        topic: 'arrays',
        difficulty: 'easy',
    }, tokenA);

    assert.equal(firstJoin.status, 202);

    const secondJoin = await request('POST', '/matching/join', {
        userId: 'user-b',
        topic: 'arrays',
        difficulty: 'easy',
    }, tokenB);

    assert.equal(secondJoin.status, 200);
    const secondJson = secondJoin.json as { message: string; match: { userIds: string[] } };
    assert.equal(secondJson.message, 'Matched successfully');
    assert.deepEqual(secondJson.match.userIds, ['user-a', 'user-b']);
});

test('POST /matching/join rejects invalid difficulty', async () => {
    const token = createToken('user-a');
    const result = await request('POST', '/matching/join', {
        userId: 'user-a',
        topic: 'graphs',
        difficulty: 'expert',
    }, token);

    assert.equal(result.status, 400);
    assert.deepEqual(result.json, {
        message: 'difficulty must be easy, medium, or hard',
    });
});

test('POST /matching/leave removes queued user', async () => {
    const token = createToken('user-c');

    const queued = await request('POST', '/matching/join', {
        userId: 'user-c',
        topic: 'dp',
        difficulty: 'hard',
    }, token);
    assert.equal(queued.status, 202);

    const left = await request('POST', '/matching/leave', {
        userId: 'user-c',
    }, token);
    assert.equal(left.status, 200);

    const status = await request('GET', '/matching/status/user-c', undefined, token);
    assert.equal(status.status, 200);
    assert.deepEqual(status.json, {
        userId: 'user-c',
        state: 'not_found',
    });
});

test('GET /matching/status/:userId reports queued state', async () => {
    const token = createToken('user-d');

    await request('POST', '/matching/join', {
        userId: 'user-d',
        topic: 'trees',
        difficulty: 'medium',
    }, token);

    const status = await request('GET', '/matching/status/user-d', undefined, token);
    assert.equal(status.status, 200);

    const statusJson = status.json as {
        userId: string;
        state: string;
        entry?: { topic: string; difficulty: string };
    };
    assert.equal(statusJson.userId, 'user-d');
    assert.equal(statusJson.state, 'queued');
    assert.equal(statusJson.entry?.topic, 'trees');
    assert.equal(statusJson.entry?.difficulty, 'medium');
});

test('matching endpoints reject missing auth token', async () => {
    const result = await request('POST', '/matching/join', {
        userId: 'user-no-auth',
        topic: 'arrays',
        difficulty: 'easy',
    });

    assert.equal(result.status, 401);
});

test('matching endpoints reject userId that does not match authenticated token', async () => {
    const token = createToken('user-token');
    const result = await request('POST', '/matching/join', {
        userId: 'user-body',
        topic: 'arrays',
        difficulty: 'easy',
    }, token);

    assert.equal(result.status, 403);
});

test('queue priority always prefers exact topic+difficulty match first', () => {
    const waitingQueue: QueueEntry[] = [
        {
            userId: 'user-p1',
            topic: 'graphs',
            difficulty: 'hard',
            proficiency: 2,
            joinedAt: '2026-04-04T10:00:00.000Z',
        },
        {
            userId: 'user-p2',
            topic: 'graphs',
            difficulty: 'easy',
            joinedAt: '2026-04-04T10:01:00.000Z',
        },
    ];

    const joiningUser: QueueEntry = {
        userId: 'user-new',
        topic: 'graphs',
        difficulty: 'hard',
        joinedAt: '2026-04-04T10:02:00.000Z',
    };

    const selectedIndex = pickBestWaitingUserIndex(
        waitingQueue,
        joiningUser,
        new Date('2026-04-04T10:02:00.000Z').getTime(),
    );
    assert.equal(selectedIndex, 0);
});

test('queue priority expands to topic-only after first wait window', () => {
    const waitingQueue: QueueEntry[] = [
        {
            userId: 'user-f1',
            topic: 'dp',
            difficulty: 'easy',
            joinedAt: '2026-04-04T10:00:00.000Z',
        },
        {
            userId: 'user-f2',
            topic: 'arrays',
            difficulty: 'medium',
            joinedAt: '2026-04-04T10:01:00.000Z',
        },
    ];

    const joiningUser: QueueEntry = {
        userId: 'user-later',
        topic: 'dp',
        difficulty: 'medium',
        joinedAt: '2026-04-04T10:02:00.000Z',
    };

    const selectedIndex = pickBestWaitingUserIndex(
        waitingQueue,
        joiningUser,
        new Date('2026-04-04T10:00:16.000Z').getTime(),
    );
    assert.equal(selectedIndex, 0);
});

test('queue priority falls back to FIFO after second wait window', () => {
    const waitingQueue: QueueEntry[] = [
        {
            userId: 'user-global-1',
            topic: 'strings',
            difficulty: 'easy',
            joinedAt: '2026-04-04T10:00:00.000Z',
        },
        {
            userId: 'user-global-2',
            topic: 'graphs',
            difficulty: 'hard',
            joinedAt: '2026-04-04T10:00:05.000Z',
        },
    ];

    const joiningUser: QueueEntry = {
        userId: 'user-incoming',
        topic: 'dp',
        difficulty: 'medium',
        joinedAt: '2026-04-04T10:02:00.000Z',
    };

    const selectedIndex = pickBestWaitingUserIndex(
        waitingQueue,
        joiningUser,
        new Date('2026-04-04T10:00:31.000Z').getTime(),
    );
    assert.equal(selectedIndex, 0);
});

test('edge case: duplicate join from the same user is not idempotent', async () => {
    // Why this matters: repeated clicks/retries can unexpectedly create a self-match response.
    const token = createToken('user-dup');

    const firstJoin = await request('POST', '/matching/join', {
        userId: 'user-dup',
        topic: 'graphs',
        difficulty: 'easy',
    }, token);
    const secondJoin = await request('POST', '/matching/join', {
        userId: 'user-dup',
        topic: 'graphs',
        difficulty: 'easy',
    }, token);

    assert.equal(firstJoin.status, 202);
    assert.equal(secondJoin.status, 200);

    const secondJoinJson = secondJoin.json as { match: { userIds: [string, string] } };
    assert.deepEqual(secondJoinJson.match.userIds, ['user-dup', 'user-dup']);
});

test('edge case: repeated join can self-match the same user id', async () => {
    // Why this matters: a user can be matched with themselves, which is logically invalid.
    const token = createToken('user-self');

    const firstJoin = await request('POST', '/matching/join', {
        userId: 'user-self',
        topic: 'arrays',
        difficulty: 'medium',
    }, token);
    const secondJoin = await request('POST', '/matching/join', {
        userId: 'user-self',
        topic: 'arrays',
        difficulty: 'medium',
    }, token);

    assert.equal(firstJoin.status, 202);
    assert.equal(secondJoin.status, 200);

    const secondJoinJson = secondJoin.json as { match: { userIds: [string, string] } };
    assert.deepEqual(secondJoinJson.match.userIds, ['user-self', 'user-self']);
});

test('edge case: matched state cannot be cleared through leave endpoint', async () => {
    // Why this matters: once matched, there is no API path to clear match state in memory.
    const tokenA = createToken('user-stale-a');
    const tokenB = createToken('user-stale-b');

    const firstJoin = await request('POST', '/matching/join', {
        userId: 'user-stale-a',
        topic: 'dp',
        difficulty: 'hard',
    }, tokenA);
    assert.equal(firstJoin.status, 202);

    const secondJoin = await request('POST', '/matching/join', {
        userId: 'user-stale-b',
        topic: 'dp',
        difficulty: 'hard',
    }, tokenB);
    assert.equal(secondJoin.status, 200);

    const left = await request('POST', '/matching/leave', {
        userId: 'user-stale-a',
    }, tokenA);
    assert.equal(left.status, 404);

    const status = getQueueStatus('user-stale-a');
    assert.equal(status.state, 'matched');
});

test('edge case: expansion boundaries activate exactly at 15s and 30s', () => {
    // Why this matters: tiny timing differences at threshold boundaries can change who gets matched.
    const waitingQueue: QueueEntry[] = [
        {
            userId: 'user-topic-only',
            topic: 'trees',
            difficulty: 'easy',
            joinedAt: '2026-04-04T10:00:00.000Z',
        },
        {
            userId: 'user-fifo',
            topic: 'arrays',
            difficulty: 'hard',
            joinedAt: '2026-04-04T10:00:01.000Z',
        },
    ];

    const joiningUser: QueueEntry = {
        userId: 'user-join',
        topic: 'trees',
        difficulty: 'medium',
        joinedAt: '2026-04-04T10:02:00.000Z',
    };

    const topicExpansionBoundaryIndex = pickBestWaitingUserIndex(
        waitingQueue,
        joiningUser,
        new Date('2026-04-04T10:00:15.000Z').getTime(),
    );
    assert.equal(topicExpansionBoundaryIndex, 0);

    const fifoJoiningUser: QueueEntry = {
        userId: 'user-join-fifo',
        topic: 'graphs',
        difficulty: 'medium',
        joinedAt: '2026-04-04T10:02:00.000Z',
    };
    const fifoBoundaryIndex = pickBestWaitingUserIndex(
        waitingQueue,
        fifoJoiningUser,
        new Date('2026-04-04T10:00:30.000Z').getTime(),
    );
    assert.equal(fifoBoundaryIndex, 0);
});

test('edge case: in-memory queue state is lost after reset (restart simulation)', async () => {
    // Why this matters: process restarts clear queue state because data is held in memory only.
    const token = createToken('user-restart');

    const queued = await request('POST', '/matching/join', {
        userId: 'user-restart',
        topic: 'strings',
        difficulty: 'easy',
    }, token);
    assert.equal(queued.status, 202);

    resetMatchingState();

    const statusAfterReset = await request('GET', '/matching/status/user-restart', undefined, token);
    assert.equal(statusAfterReset.status, 200);
    assert.deepEqual(statusAfterReset.json, {
        userId: 'user-restart',
        state: 'not_found',
    });
});

test('queued user times out after 1 minute and is removed from queue', () => {
    const joinedAtMs = new Date('2026-04-04T10:00:00.000Z').getTime();
    joinQueue(
        {
            userId: 'user-timeout',
            topic: 'graphs',
            difficulty: 'easy',
        },
        joinedAtMs,
    );

    const timedOutStatus = getQueueStatus('user-timeout', joinedAtMs + 60_000);
    assert.equal(timedOutStatus.state, 'timed_out');

    const queueAfterTimeout = listQueuedUsers(joinedAtMs + 60_000);
    assert.equal(queueAfterTimeout.length, 0);

    const statusAfterRemoval = getQueueStatus('user-timeout', joinedAtMs + 60_001);
    assert.equal(statusAfterRemoval.state, 'not_found');
});

test('expired queued users are never matched with new joiners', () => {
    const baseTimeMs = new Date('2026-04-04T11:00:00.000Z').getTime();

    const firstJoin = joinQueue(
        {
            userId: 'user-expired',
            topic: 'arrays',
            difficulty: 'medium',
        },
        baseTimeMs,
    );
    assert.equal(firstJoin.state, 'queued');

    const secondJoin = joinQueue(
        {
            userId: 'user-fresh',
            topic: 'arrays',
            difficulty: 'medium',
        },
        baseTimeMs + 60_000,
    );

    assert.equal(secondJoin.state, 'queued');
    const currentQueue = listQueuedUsers(baseTimeMs + 60_000);
    assert.equal(currentQueue.length, 1);
    assert.equal(currentQueue[0].userId, 'user-fresh');
});
