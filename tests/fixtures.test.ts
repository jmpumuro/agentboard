import { it, expect } from 'vitest';
import { fixtures } from '../packages/contract/src/fixtures';
for (const [name, schema, value] of fixtures)
    it('contract fixture: ' + name, () => expect(() => schema.parse(value)).not.toThrow());
