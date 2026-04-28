import { decodeQueryResult, decodeVarint, encodeVarint } from '../traceProcessorProtobuf';

describe('traceProcessorProtobuf', () => {
  describe('varint encoding and decoding', () => {
    it('round-trips values larger than 32 bits', () => {
      const values = [
        0,
        127,
        128,
        2_147_483_647,
        2_147_483_648,
        1_000_000_000_000,
      ];

      for (const value of values) {
        const encoded = encodeVarint(value);
        const [decoded, bytesRead] = decodeVarint(encoded, 0);

        expect(decoded).toBe(value);
        expect(bytesRead).toBe(encoded.length);
      }
    });

    it('rejects truncated varints', () => {
      expect(() => decodeVarint(Buffer.from([0x80]), 0)).toThrow('Truncated varint');
    });
  });

  describe('query result decoding', () => {
    it('decodes signed int64 cells', () => {
      const result = decodeQueryResult(Buffer.from([
        0x0a, 0x01, 0x78, // column_names: "x"
        0x1a, 0x11,       // batch, length 17
        0x0a, 0x01, 0x02, // cells: CELL_VARINT
        0x12, 0x0a,       // varint_cells, length 10
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, // -1 int64
        0x30, 0x01,       // is_last_batch: true
      ]));

      expect(result.columnNames).toEqual(['x']);
      expect(result.rows).toEqual([[-1]]);
    });
  });
});
