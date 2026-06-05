export const ENABLE_CORE_DEBUG_LOGS = process.env.ENABLE_CORE_DEBUG_LOGS === 'true';

export function logDebug(subsystem: string, module: string, message: string, metrics?: string): void {
  if (ENABLE_CORE_DEBUG_LOGS) {
    const timestamp = new Date().toISOString();
    const metricsStr = metrics ? ` | ${metrics}` : '';
    console.log(`[DEBUG][${timestamp}][${subsystem}::${module}] -> ${message}${metricsStr}`);
  }
}
