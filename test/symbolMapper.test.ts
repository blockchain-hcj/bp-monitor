import { describe, expect, it } from "vitest";
import { fromOkxInstId, toOkxInstId } from "../src/ingestor/symbolMapper.js";

describe("symbol mapper", () => {
  it("converts symbol to okx instrument", () => {
    expect(toOkxInstId("BTCUSDT")).toBe("BTC-USDT-SWAP");
  });

  it("converts okx instrument to symbol", () => {
    expect(fromOkxInstId("ETH-USDT-SWAP")).toBe("ETHUSDT");
  });
});
