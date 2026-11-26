export declare function rangeKeys(keysByGlobal: string[], from: number, to: number): string[];

export declare function selectionAfterTap(input: {
  keysByGlobal: string[];
  globalOf: Map<string, number>;
  current: string[];
  tapped: string;
}): string[];
