export interface IMonitoring {
    startTimer(name: string): {
      end: () => void;
    };
    // Alterar Error para unknown
    recordError(name: string, error: unknown): void;
    incrementCounter(name: string): void;
  }