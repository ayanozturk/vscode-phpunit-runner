import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDockerPathMappings } from './dockerPathMappings';

describe('resolveDockerPathMappings', () => {
  it('adds a workspace fallback when configured mappings do not cover it', () => {
    assert.deepEqual(
      resolveDockerPathMappings('/project/app', '/var/www/html', [{ from: '/shared', to: '/container/shared' }]),
      [
        { from: '/project/app', to: '/var/www/html' },
        { from: '/shared', to: '/container/shared' },
      ],
    );
  });

  it('keeps an explicit workspace mapping and sorts nested sources before parents', () => {
    assert.deepEqual(
      resolveDockerPathMappings('/project/app', '/var/www/html', [
        { from: '/project', to: '/container/project' },
        { from: '/project/app/vendor', to: '/container/vendor' },
      ]),
      [
        { from: '/project/app/vendor', to: '/container/vendor' },
        { from: '/project', to: '/container/project' },
      ],
    );
  });

  it('compares Windows drive paths case-insensitively and slash-normalized', () => {
    assert.deepEqual(
      resolveDockerPathMappings('C:\\Work\\App', '/var/www/html', [{ from: 'c:/work', to: '/container/work' }]),
      [{ from: 'c:/work', to: '/container/work' }],
    );
  });

  it('does not invent a fallback without a configured Docker workspace', () => {
    assert.deepEqual(resolveDockerPathMappings('/project', '', [{ from: '/custom', to: '/remote' }]), [
      { from: '/custom', to: '/remote' },
    ]);
  });
});
