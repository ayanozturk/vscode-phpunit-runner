import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executeRemoteReportTransfer, renderRemoteReportTransferCommand } from './remoteReports';
import type { ProcessRunOptions } from './processRunner';

describe('executeRemoteReportTransfer', () => {
  it('preserves process, environment, cancellation, and output options', async () => {
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as unknown as ProcessRunOptions['token'];
    const chunks: string[] = [];
    let captured: ProcessRunOptions | undefined;
    const expected = { output: 'transfer output', exitCode: 0 };

    const result = await executeRemoteReportTransfer(
      'scp remote.xml local.xml',
      '/workspace',
      { PHPUNIT_TRANSFER_TEST: 'configured' },
      token,
      (chunk) => chunks.push(chunk),
      async (options) => {
        captured = options;
        options.onOutput?.('transfer output');
        return expected;
      },
    );

    assert.deepEqual(result, expected);
    assert.equal(captured?.command, 'scp remote.xml local.xml');
    assert.equal(captured?.cwd, '/workspace');
    assert.equal(captured?.shell, true);
    assert.equal(captured?.token, token);
    assert.equal(captured?.env?.PHPUNIT_TRANSFER_TEST, 'configured');
    assert.equal(captured?.env?.PATH, process.env.PATH);
    assert.deepEqual(chunks, ['transfer output']);
  });
});

describe('remote report transfer command', () => {
  it('leaves an empty template disabled', () => {
    assert.equal(renderRemoteReportTransferCommand('  ', {
      workspaceFolder: '/workspace',
      remoteJunitReport: '/remote/junit.xml',
      localJunitReport: '/workspace/.phpunit-runner/junit.xml',
    }), undefined);
  });

  it('substitutes and shell-quotes JUnit and optional coverage paths', () => {
    const command = renderRemoteReportTransferCommand(
      'scp ${remoteJunitReport} ${localJunitReport} && scp ${remoteCoverageReport} ${localCoverageReport}',
      {
        workspaceFolder: '/workspace folder',
        remoteJunitReport: '/remote/reports/junit result.xml',
        localJunitReport: "/workspace folder/.phpunit-runner/junit's result.xml",
        remoteCoverageReport: '/remote/reports/clover.xml',
        localCoverageReport: '/workspace folder/.phpunit-runner/clover.xml',
      },
    );

    assert.equal(
      command,
      "scp '/remote/reports/junit result.xml' '/workspace folder/.phpunit-runner/junit'\\''s result.xml' && scp /remote/reports/clover.xml '/workspace folder/.phpunit-runner/clover.xml'",
    );
  });

  it('requires both JUnit report paths so the transfer can produce test results', () => {
    assert.throws(
      () => renderRemoteReportTransferCommand('scp ${remoteJunitReport} /tmp/junit.xml', {
        workspaceFolder: '/workspace',
        remoteJunitReport: '/remote/junit.xml',
        localJunitReport: '/workspace/.phpunit-runner/junit.xml',
      }),
      /must use \$\{remoteJunitReport\} and \$\{localJunitReport\}/,
    );
    assert.throws(
      () => renderRemoteReportTransferCommand('scp ${localJunitReport} /tmp/junit.xml', {
        workspaceFolder: '/workspace',
        remoteJunitReport: '/remote/junit.xml',
        localJunitReport: '/workspace/.phpunit-runner/junit.xml',
      }),
      /must use \$\{remoteJunitReport\} and \$\{localJunitReport\}/,
    );
  });

  it('rejects empty JUnit path values rather than rendering a transfer that cannot retrieve results', () => {
    assert.throws(
      () => renderRemoteReportTransferCommand('scp ${remoteJunitReport} ${localJunitReport}', {
        workspaceFolder: '/workspace',
        remoteJunitReport: '  ',
        localJunitReport: '/workspace/.phpunit-runner/junit.xml',
      }),
      /requires non-empty remote and local JUnit report paths/,
    );
    assert.throws(
      () => renderRemoteReportTransferCommand('scp ${remoteJunitReport} ${localJunitReport}', {
        workspaceFolder: '/workspace',
        remoteJunitReport: '/remote/junit.xml',
        localJunitReport: '',
      }),
      /requires non-empty remote and local JUnit report paths/,
    );
  });

  it('rejects unrecognized placeholders rather than executing an incomplete command', () => {
    assert.throws(
      () => renderRemoteReportTransferCommand('scp ${remoteJunitReport} ${localJunitReport} ${missing}', {
        workspaceFolder: '/workspace',
        remoteJunitReport: '/remote/junit.xml',
        localJunitReport: '/workspace/.phpunit-runner/junit.xml',
      }),
      /Unknown variable\(s\).*missing/,
    );
  });

  it('shell-quotes metacharacters and safely handles repeated placeholders', () => {
    const command = renderRemoteReportTransferCommand(
      'scp ${remoteJunitReport} ${localJunitReport} && printf %s ${workspaceFolder} ${workspaceFolder}',
      {
        workspaceFolder: '$(touch /tmp/should-not-run); project',
        remoteJunitReport: 'remote/$(rm -rf data).xml',
        localJunitReport: '/workspace/result.xml',
      },
    );

    assert.equal(
      command,
      "scp 'remote/$(rm -rf data).xml' /workspace/result.xml && printf %s '$(touch /tmp/should-not-run); project' '$(touch /tmp/should-not-run); project'",
    );
  });

  it('substitutes an unused optional coverage path as an empty shell argument', () => {
    const command = renderRemoteReportTransferCommand(
      'scp ${remoteJunitReport} ${localJunitReport} ${remoteCoverageReport} ${localCoverageReport}',
      {
        workspaceFolder: '/workspace',
        remoteJunitReport: '/remote/junit.xml',
        localJunitReport: '/workspace/junit.xml',
      },
    );

    assert.equal(command, "scp /remote/junit.xml /workspace/junit.xml '' ''");
  });

  it('does not treat placeholder-shaped text inside a path as another template variable', () => {
    const command = renderRemoteReportTransferCommand(
      'scp ${remoteJunitReport} ${localJunitReport}',
      {
        workspaceFolder: '/workspace',
        remoteJunitReport: '/remote/${localJunitReport}/junit.xml',
        localJunitReport: '/workspace/${remoteJunitReport}/junit.xml',
      },
    );

    assert.equal(
      command,
      "scp '/remote/${localJunitReport}/junit.xml' '/workspace/${remoteJunitReport}/junit.xml'",
    );
  });
});
