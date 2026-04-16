'use strict';

jest.mock('axios');

const axios = require('axios');
const {
  getTopicSchema,
  getAllSubjects,
  getAllSchemas
} = require('../src/services/schemaRegistryService');

const SAMPLE_AVRO_SCHEMA = {
  type: 'record',
  name: 'Order',
  namespace: 'com.example',
  fields: [
    { name: 'order_id', type: 'long' },
    { name: 'status', type: 'string' }
  ]
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getTopicSchema
// ---------------------------------------------------------------------------
describe('getTopicSchema', () => {
  it('returns parsed Avro schema for a valid topic', async () => {
    axios.get.mockResolvedValue({
      data: { schema: JSON.stringify(SAMPLE_AVRO_SCHEMA) }
    });

    const result = await getTopicSchema('retail.orders');
    expect(result).toEqual(SAMPLE_AVRO_SCHEMA);
    // Should request the -value subject
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('retail.orders-value')
    );
  });

  it('throws an error when schema returns 404', async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    await expect(getTopicSchema('nonexistent')).rejects.toThrow('not found');
  });

  it('throws an error on non-404 network error', async () => {
    axios.get.mockRejectedValue(new Error('Network error'));
    await expect(getTopicSchema('retail.orders')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getAllSubjects
// ---------------------------------------------------------------------------
describe('getAllSubjects', () => {
  it('filters to -value subjects and strips the -value suffix', async () => {
    axios.get.mockResolvedValue({
      data: [
        'retail.orders-value',
        'retail.orders-key',
        'retail.products-value',
        'internal-key',
        'retail.returns-value'
      ]
    });

    const topics = await getAllSubjects();
    expect(topics).toEqual(['retail.orders', 'retail.products', 'retail.returns']);
    // Should call /subjects endpoint
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/subjects'));
  });

  it('returns empty array when no -value subjects exist', async () => {
    axios.get.mockResolvedValue({ data: ['topic-key', 'other-key'] });
    const topics = await getAllSubjects();
    expect(topics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAllSchemas
// ---------------------------------------------------------------------------
describe('getAllSchemas', () => {
  it('returns null for topics with missing schemas (404 response)', async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });

    const result = await getAllSchemas(['missing-topic']);
    expect(result['missing-topic']).toBeNull();
  });

  it('calls getTopicSchema in parallel for each provided topic', async () => {
    axios.get.mockResolvedValue({
      data: { schema: JSON.stringify(SAMPLE_AVRO_SCHEMA) }
    });

    const result = await getAllSchemas(['retail.orders', 'retail.products']);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(result['retail.orders']).toEqual(SAMPLE_AVRO_SCHEMA);
    expect(result['retail.products']).toEqual(SAMPLE_AVRO_SCHEMA);
  });

  it('discovers topics via getAllSubjects when no topics argument provided', async () => {
    // First call: /subjects endpoint
    axios.get
      .mockResolvedValueOnce({
        data: ['retail.orders-value', 'retail.products-value']
      })
      // Subsequent calls: schema fetches
      .mockResolvedValue({
        data: { schema: JSON.stringify(SAMPLE_AVRO_SCHEMA) }
      });

    const result = await getAllSchemas();
    // Should have called /subjects first, then two schema fetches
    expect(axios.get).toHaveBeenCalledTimes(3);
    expect(Object.keys(result)).toContain('retail.orders');
    expect(Object.keys(result)).toContain('retail.products');
  });

  it('returns partial results when some topics fail and others succeed', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { schema: JSON.stringify(SAMPLE_AVRO_SCHEMA) } })
      .mockRejectedValueOnce({ response: { status: 404 } });

    const result = await getAllSchemas(['retail.orders', 'missing-topic']);
    expect(result['retail.orders']).toEqual(SAMPLE_AVRO_SCHEMA);
    expect(result['missing-topic']).toBeNull();
  });
});
