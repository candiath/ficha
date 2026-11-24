import { describe, expect, it } from 'vitest';
import { blueGreenDisabled } from '../src/lib/deployMode';

describe('blueGreenDisabled', () => {
  it('is off when the variable is missing or blank', () => {
    expect(blueGreenDisabled({})).toBe(false);
    expect(blueGreenDisabled({ DEPLOY_NO_BLUE_GREEN: '' })).toBe(false);
    expect(blueGreenDisabled({ DEPLOY_NO_BLUE_GREEN: '  ' })).toBe(false);
  });

  it('is on for "always", and for any other value, so a typo still alerts', () => {
    expect(blueGreenDisabled({ DEPLOY_NO_BLUE_GREEN: 'always' })).toBe(true);
    expect(blueGreenDisabled({ DEPLOY_NO_BLUE_GREEN: 'alwyas' })).toBe(true);
  });
});
