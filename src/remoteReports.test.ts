import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderRemoteReportTransferCommand } from './remoteReports';

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
