import type { PathMapping } from './commandTemplate';

export type SourcePosition = {
  line: number;
  character: number;
};

export type SourceRange = {
  start: SourcePosition;
  end: SourcePosition;
};

export type TestMethod = {
  name: string;
  range: SourceRange;
  groups: string[];
  pestTestName?: string;
  pestDescribePath?: string[];
};

export type TestClass = {
  name: string;
  fullyQualifiedName: string;
  range: SourceRange;
  methods: TestMethod[];
  container?: boolean;
};

export type ParsedTestFile = {
  filePath: string;
  classes: TestClass[];
};

export type TestItemKind = 'file' | 'suite' | 'class' | 'method';

export type TestTarget = {
  kind: TestItemKind;
  filePath?: string;
  className?: string;
  methodName?: string;
  pestTestName?: string;
  group?: string;
  suiteName?: string;
};

export type RunnerConfig = {
  phpExecutable: string;
  phpunitCommand: string;
  configurationFile: string;
  workingDirectory: string;
  additionalArgs: string[];
  phpArgs: string[];
  command: string;
  paths: Record<string, string>;
  environment: Record<string, string>;
  saveBeforeTest: boolean;
  dockerEnable: boolean;
  dockerCommand: string;
  dockerContainer: string;
  dockerWorkspacePath: string;
  dockerExecArgs: string[];
  debuggerConfig: string;
  xdebugPort: number;
};

export type Invocation = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  shell?: boolean;
  mappings?: PathMapping[];
};

export type JUnitStatus = 'passed' | 'failed' | 'errored' | 'skipped';

export type JUnitTestCase = {
  name: string;
  className: string;
  timeSeconds: number;
  status: JUnitStatus;
  message: string;
  file?: string;
  line?: number;
};
