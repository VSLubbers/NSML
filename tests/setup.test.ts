import { parseNSML } from '../src/index';  // Import from src

describe('NSML Parser Setup', () => {
  it('should return placeholder output', () => {
    const result = parseNSML('test input');
    expect(result).toEqual({ message: 'NSML Parser Placeholder' });
  });
});