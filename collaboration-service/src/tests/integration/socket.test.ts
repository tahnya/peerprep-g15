// mock uuid and the service layer
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mocked-room-id') }));
jest.mock('../../services/collaboration-service');
jest.mock('../../services/question-service');
jest.mock('../../services/matching-service');
import axios from 'axios';
jest.mock('axios');

import { createServer } from 'http';
import Client from 'socket.io-client';
import * as Y from 'yjs';
import { createApp } from '../../app';
import { initSocket } from '../../socket';
import {
    getSession,
    voteLanguage,
    endSession,
    handleDisconnect,
    addMessageToSession,
    submitCode,
    persistYjsState,
} from '../../services/collaboration-service';
import { fetchQuestionById } from '../../services/question-service';
import { endMatchInMatchingService } from '../../services/matching-service';

const mockedGetSession = jest.mocked(getSession);
const mockedVoteLanguage = jest.mocked(voteLanguage);
const mockedEndSession = jest.mocked(endSession);
const mockedAddMessageToSession = jest.mocked(addMessageToSession);
const mockedSubmitCode = jest.mocked(submitCode);
const mockedFetchQuestionById = jest.mocked(fetchQuestionById);
const mockedPersistYjsState = jest.mocked(persistYjsState);
const mockedEndMatchInMatchingService = jest.mocked(endMatchInMatchingService);

mockedSubmitCode.mockRejectedValue(new Error('Execution failed'));
mockedPersistYjsState.mockResolvedValue(null as any);
mockedEndMatchInMatchingService.mockResolvedValue(undefined);

const mockQuestion = {
    questionId: 1,
    title: 'Two Sum',
    description: 'Find two numbers that add up to target',
    difficulty: 'Easy',
    starterCode: { python: 'def solution():\n    pass', javascript: 'function solution() {}' },
    supportedLanguages: ['python', 'javascript'],
};

const mockSession = (overrides = {}) => ({
    roomId: 'room1',
    userIds: ['user1', 'user2'],
    questionId: 'q1',
    status: 'active',
    code: '',
    language: 'python',
    languageVotes: new Map(),
    messages: [],
    yjsState: null,
    ...overrides,
});

let server: ReturnType<typeof createServer>;
let clientA: ReturnType<typeof Client>;
let clientB: ReturnType<typeof Client>;
let port: number;

beforeAll((done) => {
    const app = createApp();
    server = createServer(app);
    initSocket(server);
    server.listen(0, () => {
        port = (server.address() as any).port;
        done();
    });
});

afterAll((done) => {
    server.close(done);
});

beforeEach((done) => {
    jest.clearAllMocks();
    mockedPersistYjsState.mockResolvedValue(null as any);
    mockedEndMatchInMatchingService.mockResolvedValue(undefined);
    mockedFetchQuestionById.mockResolvedValue(mockQuestion as any);

    clientA = Client(`http://localhost:${port}`);
    clientB = Client(`http://localhost:${port}`);

    // wait for both to connect
    let connected = 0;
    const onConnect = () => {
        connected++;
        if (connected === 2) done();
    };
    clientA.on('connect', onConnect);
    clientB.on('connect', onConnect);
});

afterEach(() => {
    clientA.disconnect();
    clientB.disconnect();
});

// ─── join-room ───────────────────────────────────────────

describe('join-room', () => {
    it('should emit session-state with session and question to joining user', (done) => {
        mockedGetSession.mockResolvedValue(mockSession() as any);
        mockedFetchQuestionById.mockResolvedValue(mockQuestion as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        clientA.on('session-state', (data: any) => {
            expect(data.session.roomId).toBe('room1');
            expect(data.question).toBeDefined();
            expect(data.question.title).toBe('Two Sum');
            done();
        });
    });

    it('should emit session-state with null question if no questionId', (done) => {
        mockedGetSession.mockResolvedValue(mockSession({ questionId: null }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        clientA.on('session-state', (data: any) => {
            expect(data.session.roomId).toBe('room1');
            expect(data.question).toBeNull();
            done();
        });
    });

    it('should emit partner-info to the other user', (done) => {
        mockedGetSession.mockResolvedValue(mockSession() as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientB.emit('join-room', 'room1', 'user2', 'Bob');
        }, 100);

        clientA.on('partner-info', (data: any) => {
            if (data.username === 'Bob') {
                expect(data.userId).toBe('user2');
                done();
            }
        });
    });

    it('should emit user-joined when both users are in the room', (done) => {
        mockedGetSession.mockResolvedValue(mockSession() as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientB.emit('join-room', 'room1', 'user2', 'Bob');
        }, 100);

        clientA.on('user-joined', (data: any) => {
            expect(data.timeRemaining).toBe(30);
            done();
        });
    });

    it('should restore yjsState from DB and emit yjs-sync', (done) => {
        const ydoc = new Y.Doc();
        ydoc.getText('code').insert(0, 'restored code');
        const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
        ydoc.destroy();

        mockedGetSession.mockResolvedValue(mockSession({ yjsState }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        clientA.on('yjs-sync', (state: any) => {
            const receiverDoc = new Y.Doc();
            Y.applyUpdate(receiverDoc, new Uint8Array(state));
            expect(receiverDoc.getText('code').toString()).toBe('restored code');
            receiverDoc.destroy();
            done();
        });
    });
});

// ─── lock-in ───────────────────────────────────────────

describe('lock-in', () => {
    it('should emit session-started with language and yjsState when both users agree', (done) => {
        const ydoc = new Y.Doc();
        ydoc.getText('code').insert(0, 'def solution():\n    pass');
        const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
        ydoc.destroy();

        mockedVoteLanguage.mockResolvedValue(
            mockSession({ status: 'active', language: 'python', yjsState }) as any,
        );

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientA.emit('lock-in', 'room1', 'user1', 'python');

        clientA.on('session-started', (data: any) => {
            expect(data.language).toBe('python');
            expect(data.yjsState).toBeDefined();
            done();
        });
    });

    it('should emit language-mismatch when users disagree', (done) => {
        mockedVoteLanguage.mockResolvedValue(mockSession({ status: 'ended' }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientA.emit('lock-in', 'room1', 'user1', 'python');

        clientA.on('language-mismatch', () => {
            done();
        });
    });

    it('should emit user-locked-in when only one user voted', (done) => {
        mockedVoteLanguage.mockResolvedValue(mockSession({ status: 'pending' }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientA.emit('lock-in', 'room1', 'user1', 'python');

        clientA.on('user-locked-in', (data: any) => {
            expect(data.userId).toBe('user1');
            done();
        });
    });

    it('should emit lock-in-error if voteLanguage throws', (done) => {
        mockedVoteLanguage.mockRejectedValue(new Error('User has already locked in'));

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientA.emit('lock-in', 'room1', 'user1', 'python');
        }, 100);

        clientA.on('lock-in-error', (data: any) => {
            expect(data.message).toBe('User has already locked in');
            done();
        });
    });
});

// ─── yjs-update ───────────────────────────────────────────

describe('yjs-update', () => {
    it('should relay yjs-update to other user', (done) => {
        mockedGetSession.mockResolvedValue(mockSession({ status: 'active' }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientB.emit('join-room', 'room1', 'user2', 'Bob');

        setTimeout(() => {
            const ydoc = new Y.Doc();
            const ytext = ydoc.getText('code');

            let update: Uint8Array | null = null;
            ydoc.on('update', (u: Uint8Array) => {
                update = u;
            });

            ytext.insert(0, 'console.log("hello")');

            clientA.emit('yjs-update', 'room1', update);

            clientB.on('yjs-update', (received: any) => {
                try {
                    const receiverDoc = new Y.Doc();
                    receiverDoc.getText('code');
                    Y.applyUpdate(receiverDoc, new Uint8Array(received));
                    expect(receiverDoc.getText('code').toString()).toBe('console.log("hello")');
                    receiverDoc.destroy();
                    done();
                } catch (err) {
                    done(err);
                }
            });
        }, 100);
    }, 10000);

    it('should trigger debounced persist to DB', (done) => {
        mockedGetSession.mockResolvedValue(mockSession({ status: 'active' }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            const ydoc = new Y.Doc();
            const ytext = ydoc.getText('code');

            let update: Uint8Array | null = null;
            ydoc.on('update', (u: Uint8Array) => {
                update = u;
            });

            ytext.insert(0, 'some code');
            clientA.emit('yjs-update', 'room1', update);

            // debounce is 2s, so check after 2.5s
            setTimeout(() => {
                expect(mockedPersistYjsState).toHaveBeenCalledWith(
                    'room1',
                    expect.any(Buffer),
                    expect.any(String),
                );
                done();
            }, 2500);
        }, 100);
    }, 10000);
});

// ─── run-code ───────────────────────────────────────────

describe('run-code', () => {
    it('should emit code-result after execution', (done) => {
        mockedGetSession.mockResolvedValue(
            mockSession({
                status: 'active',
                userIds: ['user1', 'user2'],
                questionId: 'question1',
            }) as any,
        );

        mockedSubmitCode.mockResolvedValue({
            passed: true,
            results: [
                {
                    input: '1 2',
                    expected: '3',
                    actual: '3',
                    passed: true,
                    stderr: null,
                    status: 'Accepted',
                },
                {
                    input: '10 20',
                    expected: '30',
                    actual: '30',
                    passed: true,
                    stderr: null,
                    status: 'Accepted',
                },
            ],
        } as any);

        const mockTestCases = [
            { input: '1 2', expectedOutput: '3' },
            { input: '10 20', expectedOutput: '30' },
        ];

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        clientA.on('code-error', (err: any) => {
            done(new Error(`code-error received: ${JSON.stringify(err)}`));
        });

        setTimeout(() => {
            clientA.emit('run-code', 'room1', 'user1', 'some code', 'python', mockTestCases);
        }, 100);

        clientA.on('code-result', (result: any) => {
            try {
                expect(result).not.toBeNull();
                expect(result.passed).toBe(true);
                expect(result.results.length).toBe(2);
                expect(result.results[0].actual).toBe('3');
                expect(result.results[1].actual).toBe('30');
                done();
            } catch (err) {
                done(err);
            }
        });
    }, 10000);

    it('should emit code-error if execution fails', (done) => {
        mockedGetSession.mockResolvedValue(
            mockSession({ status: 'active', userIds: ['user1', 'user2'] }) as any,
        );
        mockedSubmitCode.mockRejectedValue(new Error('Execution failed'));

        const mockTestCases = [
            { input: '1 2', expectedOutput: '3' },
            { input: '10 20', expectedOutput: '30' },
        ];

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientA.emit('run-code', 'room1', 'user1', 'print("hello")', 'python', mockTestCases);
        }, 100);

        clientA.on('code-error', (err: any) => {
            expect(err.message).toBe('Execution failed');
            done();
        });
    }, 10000);

    it('should not run code if user is not in session', (done) => {
        mockedGetSession.mockResolvedValue(
            mockSession({ status: 'active', userIds: ['user1', 'user2'] }) as any,
        );

        clientA.emit('join-room', 'room1', 'user3', 'Intruder');

        setTimeout(() => {
            clientA.emit('run-code', 'room1', 'user3', 'print("hack")', 'python', []);
        }, 100);

        clientA.on('code-result', () => {
            done(new Error('should not receive code-result for unauthorized user'));
        });

        clientA.on('code-error', () => {
            done(new Error('should not receive code-error for unauthorized user'));
        });

        setTimeout(() => {
            expect(mockedSubmitCode).not.toHaveBeenCalled();
            done();
        }, 1000);
    }, 10000);
});

// ─── submit-code ───────────────────────────────────────────

describe('submit-code', () => {
    it('should emit submit-result after successful submission', (done) => {
        mockedGetSession.mockResolvedValue(
            mockSession({ status: 'active', userIds: ['user1', 'user2'] }) as any,
        );

        mockedSubmitCode.mockResolvedValue({
            passed: true,
            results: [
                {
                    input: '1 2',
                    expected: '3',
                    actual: '3',
                    passed: true,
                    stderr: null,
                    status: 'Accepted',
                },
            ],
        } as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientA.emit('submit-code', 'room1', 'user1', 'some code', 'python', [
                { input: '1 2', expectedOutput: '3' },
            ]);
        }, 100);

        clientA.on('submit-result', (result: any) => {
            try {
                expect(result.passed).toBe(true);
                expect(result.results.length).toBe(1);
                done();
            } catch (err) {
                done(err);
            }
        });
    }, 10000);

    it('should emit code-error if submission fails', (done) => {
        mockedGetSession.mockResolvedValue(
            mockSession({ status: 'active', userIds: ['user1', 'user2'] }) as any,
        );
        mockedSubmitCode.mockRejectedValue(new Error('Execution failed'));

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientA.emit('submit-code', 'room1', 'user1', 'bad code', 'python', [
                { input: '1 2', expectedOutput: '3' },
            ]);
        }, 100);

        clientA.on('code-error', (err: any) => {
            expect(err.message).toBe('Execution failed');
            done();
        });
    }, 10000);
});

// ─── leave-session ───────────────────────────────────────────

describe('leave-session', () => {
    it('should emit session-ended to both users', (done) => {
        mockedEndSession.mockResolvedValue(mockSession({ status: 'ended' }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientB.emit('join-room', 'room1', 'user2', 'Bob');

        setTimeout(() => {
            clientA.emit('leave-session', 'room1', 'user1');
        }, 100);

        clientB.on('session-ended', (data: any) => {
            expect(data.reason).toBe('left');
            done();
        });
    });

    it('should end match in matching service', (done) => {
        mockedEndSession.mockResolvedValue(mockSession({ status: 'ended' }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientA.emit('leave-session', 'room1', 'user1');
        }, 100);

        setTimeout(() => {
            expect(mockedEndMatchInMatchingService).toHaveBeenCalledWith('room1');
            done();
        }, 300);
    });

    it('should persist code before ending session', (done) => {
        mockedEndSession.mockResolvedValue(mockSession({ status: 'ended' }) as any);

        // First create some yjs state in the room
        mockedGetSession.mockResolvedValue(mockSession({ status: 'active' }) as any);
        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            const ydoc = new Y.Doc();
            const ytext = ydoc.getText('code');
            let update: Uint8Array | null = null;
            ydoc.on('update', (u: Uint8Array) => {
                update = u;
            });
            ytext.insert(0, 'final code');
            clientA.emit('yjs-update', 'room1', update);

            setTimeout(() => {
                clientA.emit('leave-session', 'room1', 'user1');

                setTimeout(() => {
                    expect(mockedPersistYjsState).toHaveBeenCalled();
                    done();
                }, 300);
            }, 100);
        }, 100);
    }, 10000);
});

// ─── send-message ───────────────────────────────────────────

describe('send-message', () => {
    it('should broadcast message to other user in the room', (done) => {
        mockedAddMessageToSession.mockResolvedValue(mockSession() as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientB.emit('join-room', 'room1', 'user2', 'Bob');

        setTimeout(() => {
            clientA.emit('send-message', {
                roomId: 'room1',
                senderId: 'user1',
                username: 'kiran',
                content: 'hello',
            });
        }, 100);

        clientB.on('receive-message', (data: any) => {
            expect(data.senderId).toBe('user1');
            expect(data.username).toBe('kiran');
            expect(data.content).toBe('hello');
            expect(data.timestamp).toBeDefined();
            done();
        });
    });

    it('should not send message back to the sender', (done) => {
        mockedAddMessageToSession.mockResolvedValue(mockSession() as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');
        clientB.emit('join-room', 'room1', 'user2', 'Bob');

        setTimeout(() => {
            clientA.emit('send-message', {
                roomId: 'room1',
                senderId: 'user1',
                username: 'kiran',
                content: 'hello',
            });
        }, 100);

        clientA.on('receive-message', () => {
            done(new Error('sender should not receive their own message'));
        });

        setTimeout(() => done(), 500);
    });

    it('should save the message to the database', (done) => {
        mockedAddMessageToSession.mockResolvedValue(mockSession() as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        setTimeout(() => {
            clientA.emit('send-message', {
                roomId: 'room1',
                senderId: 'user1',
                username: 'kiran',
                content: 'hello',
            });
        }, 100);

        setTimeout(() => {
            expect(mockedAddMessageToSession).toHaveBeenCalledWith('room1', {
                senderId: 'user1',
                username: 'kiran',
                content: 'hello',
            });
            done();
        }, 300);
    });
});

// ─── chat-history ───────────────────────────────────────────

describe('chat-history', () => {
    it('should send chat history when user joins room', (done) => {
        const messages = [
            { senderId: 'user1', username: 'kiran', content: 'hey', timestamp: new Date() },
            { senderId: 'user2', username: 'partner', content: 'sup', timestamp: new Date() },
        ];
        mockedGetSession.mockResolvedValue(mockSession({ messages }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        clientA.on('chat-history', (history: any) => {
            expect(history).toHaveLength(2);
            expect(history[0].content).toBe('hey');
            expect(history[1].content).toBe('sup');
            done();
        });
    });

    it('should not emit chat-history if no messages exist', (done) => {
        mockedGetSession.mockResolvedValue(mockSession({ messages: [] }) as any);

        clientA.emit('join-room', 'room1', 'user1', 'Alice');

        clientA.on('chat-history', () => {
            done(new Error('should not emit chat-history for empty messages'));
        });

        setTimeout(() => done(), 500);
    });
});
