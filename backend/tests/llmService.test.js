'use strict';

// Mock the Anthropic SDK before requiring llmService
jest.mock('@anthropic-ai/sdk', () => {
  // Canned JSON response from Claude
  const cannedResponse = JSON.stringify({
    sql: 'CREATE TABLE retail_orders_source (\n  `order_id` BIGINT\n) WITH (\n  \'connector\' = \'kafka\'\n);\n\nCREATE TABLE result_sink (\n  `order_id` BIGINT\n) WITH (\n  \'connector\' = \'kafka\'\n);\n\nINSERT INTO result_sink SELECT `order_id` FROM retail_orders_source;',
    outputSchema: [{ field: 'order_id', type: 'BIGINT' }],
    mockRows: [{ order_id: 1001 }, { order_id: 1002 }, { order_id: 1003 }],
    reasoning: 'Using retail.orders topic for order_id field',
  });

  const mockCreate = jest.fn().mockResolvedValue({
    content: [{ text: cannedResponse }],
  });

  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

// Mock sqlValidationService to control validation outcomes in tests
jest.mock('../src/services/sqlValidationService', () => ({
  validateAndClassify: jest.fn().mockReturnValue({
    status: 'green',
    syntaxErrors: [],
    catalogIssues: [],
  }),
}));

const Anthropic = require('@anthropic-ai/sdk');
const { validateAndClassify } = require('../src/services/sqlValidationService');
const {
  callClaude,
  generateFlinkSQL,
  generateWithSelfCorrection,
  buildCorrectionPrompt,
} = require('../src/services/llmService');

// Get the mockCreate function from the mocked Anthropic instance
const getMockCreate = () => {
  const instance = new Anthropic();
  return instance.messages.create;
};

beforeEach(() => {
  jest.clearAllMocks();

  // Reset Anthropic mock to return canned green response
  const cannedResponse = JSON.stringify({
    sql: 'CREATE TABLE retail_orders_source (`order_id` BIGINT) WITH (\'connector\'=\'kafka\');\nCREATE TABLE result_sink (`order_id` BIGINT) WITH (\'connector\'=\'kafka\');\nINSERT INTO result_sink SELECT `order_id` FROM retail_orders_source;',
    outputSchema: [{ field: 'order_id', type: 'BIGINT' }],
    mockRows: [{ order_id: 1001 }, { order_id: 1002 }],
    reasoning: 'Using retail.orders',
  });

  Anthropic.mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: cannedResponse }],
      }),
    },
  }));

  validateAndClassify.mockReturnValue({
    status: 'green',
    syntaxErrors: [],
    catalogIssues: [],
  });
});

describe('callClaude', () => {
  it('calls Anthropic messages.create with model claude-sonnet-4-6', async () => {
    const mockInstance = new Anthropic();
    const result = await callClaude('system prompt', [{ role: 'user', content: 'hello' }]);

    expect(mockInstance.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
      })
    );
  });

  it('calls with max_tokens of 4096', async () => {
    const mockInstance = new Anthropic();
    await callClaude('system prompt', [{ role: 'user', content: 'hello' }]);

    expect(mockInstance.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 4096,
      })
    );
  });

  it('calls with the provided system prompt', async () => {
    const mockInstance = new Anthropic();
    await callClaude('my system prompt', [{ role: 'user', content: 'hello' }]);

    expect(mockInstance.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'my system prompt',
      })
    );
  });

  it('calls with the provided messages array', async () => {
    const mockInstance = new Anthropic();
    const messages = [{ role: 'user', content: 'test query' }];
    await callClaude('system', messages);

    expect(mockInstance.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
      })
    );
  });

  it('returns the text content of the first content block', async () => {
    const expectedText = JSON.stringify({ sql: 'SELECT 1', outputSchema: [], mockRows: [], reasoning: 'test' });
    Anthropic.mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ text: expectedText }],
        }),
      },
    }));

    const result = await callClaude('system', [{ role: 'user', content: 'q' }]);
    expect(result).toBe(expectedText);
  });
});

describe('generateFlinkSQL', () => {
  const schemas = {
    'retail.orders': {
      fields: [{ name: 'order_id', type: 'long' }],
    },
  };

  it('parses JSON response from Claude into { sql, outputSchema, mockRows, reasoning }', async () => {
    const result = await generateFlinkSQL('show me all orders', schemas);

    expect(result).toHaveProperty('sql');
    expect(result).toHaveProperty('outputSchema');
    expect(result).toHaveProperty('mockRows');
    expect(result).toHaveProperty('reasoning');
  });

  it('handles malformed JSON response by extracting JSON from markdown code fences', async () => {
    const jsonContent = JSON.stringify({
      sql: 'SELECT 1',
      outputSchema: [{ field: 'order_id', type: 'BIGINT' }],
      mockRows: [{ order_id: 1 }],
      reasoning: 'test',
    });

    Anthropic.mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ text: `\`\`\`json\n${jsonContent}\n\`\`\`` }],
        }),
      },
    }));

    const result = await generateFlinkSQL('show me orders', schemas);

    expect(result.sql).toBe('SELECT 1');
    expect(result.outputSchema).toEqual([{ field: 'order_id', type: 'BIGINT' }]);
  });

  it('handles JSON wrapped in plain code fences (no language tag)', async () => {
    const jsonContent = JSON.stringify({
      sql: 'SELECT 2',
      outputSchema: [],
      mockRows: [],
      reasoning: 'fenced',
    });

    Anthropic.mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ text: `\`\`\`\n${jsonContent}\n\`\`\`` }],
        }),
      },
    }));

    const result = await generateFlinkSQL('count orders', schemas);
    expect(result.sql).toBe('SELECT 2');
  });

  it('builds messages array starting with user query when messageHistory is empty', async () => {
    const mockInstance = new Anthropic();
    await generateFlinkSQL('show me orders', schemas, []);

    const callArgs = mockInstance.messages.create.mock.calls[0][0];
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'show me orders' }]);
  });

  it('appends user query to existing messageHistory', async () => {
    const mockInstance = new Anthropic();
    const history = [
      { role: 'user', content: 'first query' },
      { role: 'assistant', content: '{"sql":"SELECT 1","outputSchema":[],"mockRows":[],"reasoning":"first"}' },
    ];

    await generateFlinkSQL('follow-up query', schemas, history);

    const callArgs = mockInstance.messages.create.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(3);
    expect(callArgs.messages[2]).toEqual({ role: 'user', content: 'follow-up query' });
  });

  it('returns rawResponse in the result', async () => {
    const result = await generateFlinkSQL('test query', schemas);
    expect(result).toHaveProperty('rawResponse');
    expect(typeof result.rawResponse).toBe('string');
  });
});

describe('generateWithSelfCorrection', () => {
  const schemas = { 'retail.orders': { fields: [{ name: 'order_id', type: 'long' }] } };

  it('returns result on first attempt when validation returns green', async () => {
    validateAndClassify.mockReturnValue({ status: 'green', syntaxErrors: [], catalogIssues: [] });

    const result = await generateWithSelfCorrection('show me orders', schemas);

    expect(result.validation.status).toBe('green');
    expect(result.validation.attempts).toBe(1);
  });

  it('returns result when validation returns yellow (green enough)', async () => {
    validateAndClassify.mockReturnValue({ status: 'yellow', syntaxErrors: [], catalogIssues: [], warnings: ['No WATERMARK'] });

    const result = await generateWithSelfCorrection('show me orders', schemas);

    expect(result.validation.status).toBe('yellow');
    expect(result.validation.attempts).toBe(1);
  });

  it('retries when validation returns red and eventually succeeds', async () => {
    // First call returns red, second returns green
    validateAndClassify
      .mockReturnValueOnce({ status: 'red', syntaxErrors: [{ message: 'Invalid syntax' }], catalogIssues: [] })
      .mockReturnValueOnce({ status: 'green', syntaxErrors: [], catalogIssues: [] });

    const result = await generateWithSelfCorrection('show me orders', schemas);

    expect(result.validation.status).toBe('green');
    expect(result.validation.attempts).toBe(2);
  });

  it('returns red status with attempts=3 after 3 failed retries', async () => {
    validateAndClassify.mockReturnValue({
      status: 'red',
      syntaxErrors: [{ message: 'Persistent error' }],
      catalogIssues: [],
    });

    const result = await generateWithSelfCorrection('show me orders', schemas, [], 3);

    expect(result.validation.status).toBe('red');
    expect(result.validation.attempts).toBe(3);
    expect(result.validation.errors).toBeDefined();
  });

  it('maintains conversation context across retries (messages array grows)', async () => {
    const mockCreate = jest.fn();
    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    const cannedResp = JSON.stringify({
      sql: 'SELECT 1',
      outputSchema: [],
      mockRows: [],
      reasoning: 'test',
    });

    mockCreate.mockResolvedValue({ content: [{ text: cannedResp }] });

    validateAndClassify
      .mockReturnValueOnce({ status: 'red', syntaxErrors: [{ message: 'Error 1' }], catalogIssues: [] })
      .mockReturnValueOnce({ status: 'green', syntaxErrors: [], catalogIssues: [] });

    await generateWithSelfCorrection('test query', schemas, [], 3);

    // Second call should have more messages than first call
    const firstCallMessages = mockCreate.mock.calls[0][0].messages;
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;

    expect(secondCallMessages.length).toBeGreaterThan(firstCallMessages.length);
  });

  it('includes previous SQL and errors in the correction message', async () => {
    const mockCreate = jest.fn();
    Anthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    const cannedResp = JSON.stringify({
      sql: 'BROKEN SQL',
      outputSchema: [],
      mockRows: [],
      reasoning: 'test',
    });

    mockCreate.mockResolvedValue({ content: [{ text: cannedResp }] });

    validateAndClassify
      .mockReturnValueOnce({ status: 'red', syntaxErrors: [{ message: 'syntax error here' }], catalogIssues: [] })
      .mockReturnValueOnce({ status: 'green', syntaxErrors: [], catalogIssues: [] });

    await generateWithSelfCorrection('test', schemas, [], 3);

    // The second call's messages should include a correction message referencing the error
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const correctionMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(correctionMsg.role).toBe('user');
    expect(correctionMsg.content).toContain('syntax error here');
  });

  it('supports conversational follow-up by accepting messageHistory parameter', async () => {
    validateAndClassify.mockReturnValue({ status: 'green', syntaxErrors: [], catalogIssues: [] });

    const history = [
      { role: 'user', content: 'show me orders' },
      { role: 'assistant', content: '{"sql":"SELECT 1","outputSchema":[],"mockRows":[],"reasoning":"first"}' },
    ];

    const result = await generateWithSelfCorrection('make it weekly', schemas, history);

    expect(result.validation.status).toBe('green');
  });
});

describe('buildCorrectionPrompt', () => {
  it('includes the original SQL in the correction prompt', () => {
    const sql = 'SELECT order_id FROM orders';
    const errors = [{ message: 'Unknown field: unknown_field' }];

    const prompt = buildCorrectionPrompt(sql, errors);

    expect(prompt).toContain(sql);
  });

  it('includes all error messages in the correction prompt', () => {
    const sql = 'SELECT x FROM y';
    const errors = [
      { message: 'Error 1' },
      { message: 'Error 2' },
    ];

    const prompt = buildCorrectionPrompt(sql, errors);

    expect(prompt).toContain('Error 1');
    expect(prompt).toContain('Error 2');
  });

  it('handles string errors (not just objects with message property)', () => {
    const prompt = buildCorrectionPrompt('SELECT 1', ['string error 1', 'string error 2']);

    expect(prompt).toContain('string error 1');
    expect(prompt).toContain('string error 2');
  });

  it('instructs Claude to fix ALL errors and return corrected JSON', () => {
    const prompt = buildCorrectionPrompt('SELECT 1', [{ message: 'err' }]);

    expect(prompt).toMatch(/fix/i);
    expect(prompt).toContain('JSON');
  });
});
