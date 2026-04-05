import { randomUUID } from 'crypto';
import type { MatchRequest, MatchResult, QueueEntry, QueueStatus } from '../models/matching-model';

const queueByCriteria = new Map<string, QueueEntry[]>();
const matchByUserId = new Map<string, MatchResult>();

// Matching policy: t = 0 exact match, t = 15s topic-only expansion,
// t = 30s FIFO fallback expansion, t = 60s give up and timeout.
// Within each stage, longest-waiting eligible user is selected for fairness.
const TOPIC_EXPANSION_WAIT_MS = 15_000;
const FIFO_EXPANSION_WAIT_MS = 30_000;
const QUEUE_TIMEOUT_MS = 60_000;

// Normalizes topic+difficulty into a stable bucket key for queue grouping.
function createCriteriaKey(topic: string, difficulty: string) {
    return `${topic.trim().toLowerCase()}::${difficulty}`;
}

// Returns how long a queued user has waited in milliseconds.
function getWaitedMs(entry: QueueEntry, nowMs: number) {
    return Math.max(0, nowMs - new Date(entry.joinedAt).getTime());
}

// Determines if a queued user has exceeded the maximum wait time and should be timed out.
function isTimedOut(entry: QueueEntry, nowMs: number) {
    return getWaitedMs(entry, nowMs) >= QUEUE_TIMEOUT_MS;
}

// Removes timed-out users from all queues so they are never considered for matching.
function purgeTimedOutEntries(nowMs: number) {
    for (const [criteriaKey, queue] of queueByCriteria.entries()) {
        const activeQueue = queue.filter((entry) => !isTimedOut(entry, nowMs));
        if (activeQueue.length === 0) {
            queueByCriteria.delete(criteriaKey);
            continue;
        }

        queueByCriteria.set(criteriaKey, activeQueue);
    }
}

// Assigns candidate stage: 0 exact match, 1 topic-only after wait, 2 FIFO fallback after longer wait.
function getMatchStage(joiningUser: QueueEntry, candidate: QueueEntry, nowMs: number) {
    const sameTopic =
        candidate.topic.trim().toLowerCase() === joiningUser.topic.trim().toLowerCase();
    const sameDifficulty = candidate.difficulty === joiningUser.difficulty;

    if (sameTopic && sameDifficulty) {
        return 0;
    }

    const waitedMs = getWaitedMs(candidate, nowMs);
    if (sameTopic && waitedMs >= TOPIC_EXPANSION_WAIT_MS) {
        return 1;
    }

    if (waitedMs >= FIFO_EXPANSION_WAIT_MS) {
        return 2;
    }

    return null;
}

// Selects best waiting user within one queue by stage priority then FIFO by joined time.
export function pickBestWaitingUserIndex(
    queue: QueueEntry[],
    joiningUser: QueueEntry,
    nowMs = Date.now(),
) {
    if (queue.length === 0) return -1;

    let bestIndex = -1;
    let bestStage: number | null = null;
    let bestJoinedAt = Number.POSITIVE_INFINITY;

    for (let index = 0; index < queue.length; index += 1) {
        const candidate = queue[index];
        const stage = getMatchStage(joiningUser, candidate, nowMs);
        if (stage === null) continue;

        const joinedAtMs = new Date(candidate.joinedAt).getTime();
        if (
            bestStage === null ||
            stage < bestStage ||
            (stage === bestStage && joinedAtMs < bestJoinedAt)
        ) {
            bestIndex = index;
            bestStage = stage;
            bestJoinedAt = joinedAtMs;
        }
    }

    return bestIndex;
}

// Removes a specific user from whichever criteria queue they are currently waiting in.
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

// Finds and removes the best eligible waiting user across all queues.
function findBestWaitingCandidate(joiningUser: QueueEntry, nowMs: number) {
    let selectedCriteriaKey: string | null = null;
    let selectedIndex = -1;
    let selectedStage: number | null = null;
    let selectedJoinedAt = Number.POSITIVE_INFINITY;

    for (const [criteriaKey, queue] of queueByCriteria.entries()) {
        for (let index = 0; index < queue.length; index += 1) {
            const candidate = queue[index];
            const stage = getMatchStage(joiningUser, candidate, nowMs);
            if (stage === null) continue;

            const joinedAtMs = new Date(candidate.joinedAt).getTime();
            if (
                selectedStage === null ||
                stage < selectedStage ||
                (stage === selectedStage && joinedAtMs < selectedJoinedAt)
            ) {
                selectedCriteriaKey = criteriaKey;
                selectedIndex = index;
                selectedStage = stage;
                selectedJoinedAt = joinedAtMs;
            }
        }
    }

    if (selectedCriteriaKey === null || selectedIndex < 0) {
        return undefined;
    }

    const queue = queueByCriteria.get(selectedCriteriaKey);
    if (!queue) return undefined;

    const [selected] = queue.splice(selectedIndex, 1);
    if (queue.length === 0) {
        queueByCriteria.delete(selectedCriteriaKey);
    } else {
        queueByCriteria.set(selectedCriteriaKey, queue);
    }

    return selected;
}

// Attempts to match immediately from staged policy; otherwise enqueues the user.
export function joinQueue(request: MatchRequest, nowMs = Date.now()) {
    purgeTimedOutEntries(nowMs);

    const criteriaKey = createCriteriaKey(request.topic, request.difficulty);
    const existingQueue = queueByCriteria.get(criteriaKey) ?? [];
    const entry: QueueEntry = {
        ...request,
        topic: request.topic.trim(),
        joinedAt: new Date(nowMs).toISOString(),
    };

    const waitingUser = findBestWaitingCandidate(entry, nowMs);
    if (waitingUser) {
        const match: MatchResult = {
            matchId: randomUUID(),
            userIds: [waitingUser.userId, entry.userId],
            topic: entry.topic,
            difficulty: entry.difficulty,
            createdAt: new Date(nowMs).toISOString(),
        };

        matchByUserId.set(waitingUser.userId, match);
        matchByUserId.set(entry.userId, match);

        return { state: 'matched' as const, match };
    }

    existingQueue.push(entry);
    queueByCriteria.set(criteriaKey, existingQueue);

    return { state: 'queued' as const, entry };
}

// Removes a user from queue and reports whether anything was removed.
export function leaveQueue(userId: string) {
    const removed = findQueuedUser(userId);
    if (!removed) {
        return false;
    }

    return true;
}

// Returns matched/queued/not_found state for a given user.
export function getQueueStatus(userId: string, nowMs = Date.now()): QueueStatus {
    const match = matchByUserId.get(userId);
    if (match) {
        return {
            userId,
            state: 'matched',
            match,
        };
    }

    for (const [criteriaKey, queue] of queueByCriteria.entries()) {
        const index = queue.findIndex((item) => item.userId === userId);
        if (index >= 0) {
            const entry = queue[index];
            if (isTimedOut(entry, nowMs)) {
                queue.splice(index, 1);
                if (queue.length === 0) {
                    queueByCriteria.delete(criteriaKey);
                } else {
                    queueByCriteria.set(criteriaKey, queue);
                }

                return {
                    userId,
                    state: 'timed_out',
                };
            }

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

// Flattens all criteria buckets into a single queue snapshot for debugging/admin views.
export function listQueuedUsers(nowMs = Date.now()) {
    purgeTimedOutEntries(nowMs);
    return Array.from(queueByCriteria.values()).flat();
}

// Clears in-memory state for deterministic tests and local resets.
export function resetMatchingState() {
    queueByCriteria.clear();
    matchByUserId.clear();
}
