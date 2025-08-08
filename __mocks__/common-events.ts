import { EventEmitter } from 'events';

// Minimal mock of appEvents for server logs during tests
class AppEventsMock extends EventEmitter {
  emit(event: string, ...args: any[]): boolean {
    // swallow to avoid noisy output in tests
    return super.emit(event, ...args);
  }
}

export const appEvents = new AppEventsMock();

