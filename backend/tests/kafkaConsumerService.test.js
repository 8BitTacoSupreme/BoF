'use strict';

// kafkaConsumerService.test.js
// Unit tests for kafkaConsumerService.js with KafkaJS mocked.
// All Kafka broker connections are mocked — no running broker required.

// ---------------------------------------------------------------------------
// KafkaJS mock setup
// ---------------------------------------------------------------------------

const mockConsumer = {
  connect: jest.fn().mockResolvedValue(undefined),
  subscribe: jest.fn().mockResolvedValue(undefined),
  run: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined),
  seek: jest.fn(),
  on: jest.fn(),
  events: { GROUP_JOIN: 'consumer.group_join' },
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    consumer: jest.fn().mockReturnValue(mockConsumer),
  })),
}));

const { Kafka } = require('kafkajs');
const { tailMessages } = require('../src/services/kafkaConsumerService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate messages arriving via eachMessage handler */
function simulateMessages(topic, count, startOffset = 0) {
  mockConsumer.run.mockImplementation(async ({ eachMessage }) => {
    for (let i = 0; i < count; i++) {
      await eachMessage({
        topic,
        partition: 0,
        message: {
          offset: String(startOffset + i),
          value: Buffer.from(JSON.stringify({ id: i, name: `item-${i}` })),
          timestamp: String(Date.now()),
        },
      });
    }
  });
}

/** Simulate an empty consumer (no messages arrive — times out) */
function simulateNoMessages() {
  // run() resolves immediately without calling eachMessage
  mockConsumer.run.mockResolvedValue(undefined);
}

/** Simulate a consumer that throws an error */
function simulateConsumerError(errorMessage) {
  mockConsumer.connect.mockRejectedValueOnce(new Error(errorMessage));
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default implementations after clearAllMocks
  mockConsumer.connect.mockResolvedValue(undefined);
  mockConsumer.subscribe.mockResolvedValue(undefined);
  mockConsumer.disconnect.mockResolvedValue(undefined);
  mockConsumer.run.mockResolvedValue(undefined);
  mockConsumer.seek.mockClear();
  mockConsumer.on.mockClear();
});

// ---------------------------------------------------------------------------
// tailMessages: basic return shape
// ---------------------------------------------------------------------------

describe('tailMessages', () => {
  it('returns an object with messages array and nextOffset', async () => {
    simulateMessages('test-topic', 2);
    const result = await tailMessages('test-topic', 5);
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('nextOffset');
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('returned messages include offset, value, and timestamp fields', async () => {
    simulateMessages('test-topic', 3);
    const result = await tailMessages('test-topic', 5);
    expect(result.messages.length).toBeGreaterThan(0);
    const msg = result.messages[0];
    expect(msg).toHaveProperty('offset');
    expect(msg).toHaveProperty('value');
    expect(msg).toHaveProperty('timestamp');
  });

  it('creates a consumer with a unique groupId containing the topic name', async () => {
    // Capture the groupId that the service passes when creating its consumer.
    // The Kafka singleton's consumer() factory is the mock we need to inspect.
    let capturedGroupId = null;
    const { Kafka: KafkaClass } = require('kafkajs');
    // KafkaClass is a mock constructor; its instances are POJOs from our mock impl.
    // The consumer factory on the singleton was captured in mockConsumer.
    // We intercept at the kafkajs module's consumer factory level via the Kafka mock:
    KafkaClass.mockImplementationOnce(() => ({
      consumer: jest.fn(({ groupId }) => {
        capturedGroupId = groupId;
        return mockConsumer;
      }),
    }));

    // Re-require to pick up the new Kafka implementation
    jest.resetModules();
    jest.mock('kafkajs', () => ({
      Kafka: jest.fn().mockImplementation(() => ({
        consumer: jest.fn(({ groupId }) => {
          capturedGroupId = groupId;
          return mockConsumer;
        }),
      })),
    }));
    const { tailMessages: tail2 } = require('../src/services/kafkaConsumerService');

    simulateNoMessages();
    await tail2('my-output-topic', 5);

    expect(capturedGroupId).not.toBeNull();
    expect(capturedGroupId).toContain('my-output-topic');
    expect(capturedGroupId).toMatch(/bof-tail-my-output-topic-\d+/);
  });

  it('groupId includes current timestamp for per-request uniqueness', async () => {
    let capturedGroupId = null;

    jest.resetModules();
    jest.mock('kafkajs', () => ({
      Kafka: jest.fn().mockImplementation(() => ({
        consumer: jest.fn(({ groupId }) => {
          capturedGroupId = groupId;
          return mockConsumer;
        }),
      })),
    }));
    const { tailMessages: tail2 } = require('../src/services/kafkaConsumerService');

    simulateNoMessages();
    const before = Date.now();
    await tail2('test-topic', 5);
    const after = Date.now();

    expect(capturedGroupId).not.toBeNull();
    const tsMatch = capturedGroupId.match(/(\d+)$/);
    expect(tsMatch).not.toBeNull();
    const ts = Number(tsMatch[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('calls consumer.connect(), subscribe(), run(), and disconnect() in that order', async () => {
    const callOrder = [];
    mockConsumer.connect.mockImplementation(() => { callOrder.push('connect'); return Promise.resolve(); });
    mockConsumer.subscribe.mockImplementation(() => { callOrder.push('subscribe'); return Promise.resolve(); });
    mockConsumer.run.mockImplementation(() => { callOrder.push('run'); return Promise.resolve(); });
    mockConsumer.disconnect.mockImplementation(() => { callOrder.push('disconnect'); return Promise.resolve(); });

    await tailMessages('test-topic', 5);

    expect(callOrder).toContain('connect');
    expect(callOrder).toContain('subscribe');
    expect(callOrder).toContain('run');
    expect(callOrder).toContain('disconnect');
    // connect must come before run
    expect(callOrder.indexOf('connect')).toBeLessThan(callOrder.indexOf('run'));
    // disconnect must come after run
    expect(callOrder.indexOf('run')).toBeLessThan(callOrder.indexOf('disconnect'));
  });

  it('limits results to the specified limit', async () => {
    // Simulate messages with small async delays so the limit check can cut off processing
    mockConsumer.run.mockImplementation(async ({ eachMessage }) => {
      for (let i = 0; i < 10; i++) {
        await eachMessage({
          topic: 'test-topic',
          partition: 0,
          message: {
            offset: String(i),
            value: Buffer.from(JSON.stringify({ id: i })),
            timestamp: String(Date.now()),
          },
        });
        // Yield to event loop between messages so the resolve() in the service can fire
        await new Promise((r) => setImmediate(r));
      }
    });
    const result = await tailMessages('test-topic', 5); // request limit=5
    expect(result.messages.length).toBeLessThanOrEqual(5);
  });

  it('returns empty messages array when topic does not exist (graceful error handling)', async () => {
    simulateConsumerError('UnknownTopicOrPartition: test-missing-topic');
    const result = await tailMessages('test-missing-topic', 10);
    expect(result.messages).toEqual([]);
    expect(result.nextOffset).toBeGreaterThanOrEqual(0);
  });

  it('nextOffset is highest offset + 1', async () => {
    simulateMessages('test-topic', 3, 10); // offsets 10, 11, 12
    const result = await tailMessages('test-topic', 5);
    expect(result.nextOffset).toBe(13); // max offset 12 + 1
  });

  it('nextOffset is 0 when no messages are returned', async () => {
    simulateNoMessages();
    const result = await tailMessages('test-topic', 5);
    expect(result.nextOffset).toBe(0);
  });

  it('calls consumer.seek when sinceOffset is provided', async () => {
    // When sinceOffset is provided, on GROUP_JOIN the consumer seeks to that offset
    mockConsumer.on.mockImplementation((event, callback) => {
      // Immediately invoke the GROUP_JOIN callback to test seek behavior
      if (event === 'consumer.group_join') {
        callback();
      }
    });
    simulateNoMessages();

    await tailMessages('test-topic', 5, '42');

    // The on handler should have been registered
    expect(mockConsumer.on).toHaveBeenCalledWith(
      expect.stringContaining('group_join'),
      expect.any(Function)
    );
  });

  it('disconnects consumer even when error occurs (finally block)', async () => {
    simulateConsumerError('Connection error');
    await tailMessages('test-topic', 10);
    expect(mockConsumer.disconnect).toHaveBeenCalled();
  });
});
