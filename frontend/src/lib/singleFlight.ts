export interface SingleFlight {
  readonly inFlight: boolean;
  run<T>(operation: () => Promise<T>): Promise<T | undefined>;
}

export function createSingleFlight(): SingleFlight {
  let inFlight = false;

  return {
    get inFlight() {
      return inFlight;
    },
    async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (inFlight) return undefined;

      inFlight = true;
      try {
        return await operation();
      } finally {
        inFlight = false;
      }
    },
  };
}
