import { describe, expect, test } from "vitest";
import { UniverseManager } from "../src/universe/universeManager.js";

describe("UniverseManager", () => {
  test("keeps core size within budget", () => {
    const manager = new UniverseManager({ coreMaxSymbols: 2 });
    manager.updateDiscoveredSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);

    expect(manager.getCoreSymbols()).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(manager.getWatchSymbols()).toEqual(["SOLUSDT"]);
  });

  test("promotes higher score symbol into core and demotes lower score", () => {
    const manager = new UniverseManager({ coreMaxSymbols: 2 });
    manager.updateDiscoveredSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);

    manager.updateScores({ BTCUSDT: 50, ETHUSDT: 40, SOLUSDT: 90 });

    expect(manager.getCoreSymbols()).toEqual(["SOLUSDT", "BTCUSDT"]);
    expect(manager.getWatchSymbols()).toEqual(["ETHUSDT"]);
  });

  test("drops removed symbols from both pools", () => {
    const manager = new UniverseManager({ coreMaxSymbols: 2 });
    manager.updateDiscoveredSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    manager.updateScores({ BTCUSDT: 30, ETHUSDT: 20, SOLUSDT: 10 });

    manager.updateDiscoveredSymbols(["BTCUSDT", "SOLUSDT"]);

    expect(manager.getCoreSymbols()).toEqual(["BTCUSDT", "SOLUSDT"]);
    expect(manager.getWatchSymbols()).toEqual([]);
  });
});
