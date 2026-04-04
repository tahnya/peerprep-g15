import { randomUUID } from 'crypto';
import type { MatchRequest, MatchResult, QueueEntry, QueueStatus } from '../models/matching-model';

const queueByCriteria = new Map<string, QueueEntry[]>();
const matchByUserId = new Map<string, MatchResult>();

function createCriteriaKey(topic: string, difficulty: string) {
    return `${topic.trim().toLowerCase()}::${difficulty}`;
}

function findQueuedUser(userId: string) {
    for (const [criteriaKey, queue] of queueByCriteria.entries()) {
        const index = queue.findIndex((entry) => entry.userId === userId);
        if (index >= 0) {
            const [entry] = queue.splice(index, 1);
            if (queue.length === 0) {
                queueByCriteria.delete(criteriaKey);
            } else {
                queueByCriteria.set(criteriaKey, queue);
            }
            return entry;
        }
    }

    return null;
}

export function joinQueue(request: MatchRequest) {
    const criteriaKey = createCriteriaKey(request.topic, request.difficulty);
    const existingQueue = queueByCriteria.get(criteriaKey) ?? [];
    const entry: QueueEntry = {
        ...request,
        topic: request.topic.trim(),
        joinedAt: new Date().toISOString(),
    };

    const waitingUser = existingQueue.shift();
    if (waitingUser) {
        const match: MatchResult = {
            matchId: randomUUID(),
            userIds: [waitingUser.userId, entry.userId],
            topic: entry.topic,
            difficulty: entry.difficulty,
            createdAt: new Date().toISOString(),
        };

        matchByUserId.set(waitingUser.userId, match);
        matchByUserId.set(entry.userId, match);

        if (existingQueue.length > 0) {
            queueByCriteria.set(criteriaKey, existingQueue);
        } else {
            queueByCriteria.delete(criteriaKey);
        }

        return { state: 'matched' as const, match };
    }

    existingQueue.push(entry);
    queueByCriteria.set(criteriaKey, existingQueue);

    return { state: 'queued' as const, entry };
}

export function leaveQueue(userId: string) {
    const removed = findQueuedUser(userId);
    if (!removed) {
        return false;
    }

    return true;
}

export function getQueueStatus(userId: string): QueueStatus {
    const match = matchByUserId.get(userId);
    if (match) {
        return {
            userId,
            state: 'matched',
            match,
        };
    }

    for (const queue of queueByCriteria.values()) {
        const entry = queue.find((item) => item.userId === userId);
        if (entry) {
            return {
                userId,
                state: 'queued',
                entry,
            };
        }
    }

    return {
        userId,
        state: 'not_found',
    };
}

export function listQueuedUsers() {
    return Array.from(queueByCriteria.values()).flat();
}

export function resetMatchingState() {
    queueByCriteria.clear();
    matchByUserId.clear();
}
