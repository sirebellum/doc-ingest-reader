import { logDebug } from '../logger';

describe('logger', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should not log if ENABLE_CORE_DEBUG_LOGS is false', () => {
    process.env.ENABLE_CORE_DEBUG_LOGS = 'false';
    const { logDebug: localLogDebug } = require('../logger');
    const spy = jest.spyOn(console, 'log').mockImplementation();
    localLogDebug('SYS', 'MOD', 'MSG');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should log if ENABLE_CORE_DEBUG_LOGS is true', () => {
    process.env.ENABLE_CORE_DEBUG_LOGS = 'true';
    const { logDebug: localLogDebug } = require('../logger');
    const spy = jest.spyOn(console, 'log').mockImplementation();
    localLogDebug('SYS', 'MOD', 'MSG', 'METRIC');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
