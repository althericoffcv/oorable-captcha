import { StaticKeyProvider } from "../src/crypto/token.ts";
import { sealTile } from "../src/crypto/tile-token.ts";
import type { AssetProvider, TileLocation } from "../src/assets/asset-provider.ts";

/** Test secrets must satisfy the engine's 32-byte minimum, like real ones. */
export function secretOf(label: string): string {
  return `${label}-`.padEnd(48, "0123456789abcdef");
}

export function testKeys(label = "test-secret"): StaticKeyProvider {
  return new StaticKeyProvider({ k1: secretOf(label) }, "k1");
}

/** The callbacks buildMemePuzzleChallenge needs, wired the same way the engine wires them. */
export function memeDeps(assetProvider: AssetProvider, keys: StaticKeyProvider = testKeys()) {
  const expiresAt = Date.now() + 60_000;
  return {
    assetProvider,
    keys,
    mintTile: (location: TileLocation) => sealTile(location, expiresAt, keys),
    tileUrl: (token: string) => `/v1/assets/tile/${token}`,
  };
}
