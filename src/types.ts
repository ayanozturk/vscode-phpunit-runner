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
};

export type TestClass = {
  name: string;
  fullyQualifiedName: string;
  range: SourceRange;
  methods: TestMethod[];
};

export type ParsedTestFile = {
  filePath: string;
  classes: TestClass[];
};

export type TestItemKind = 'file' | 'class' | 'method';

export type TestTarget = {
  kind: TestItemKind;
  filePath: string;
  className?: string;
  methodName?: string;
};

export type RunnerConfig = {
  phpExecutable: string;
  phpunitCommand: string;
  configurationFile: string;
  workingDirectory: string;
  additionalArgs: string[];
  dockerEnable: boolean;
  dockerCommand: string;
  dockerContainer: string;
  dockerWorkspacePath: string;
  dockerExecArgs: string[];
};

export type Invocation = {
  command: string;
  args: string[];
  cwd: string;
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
