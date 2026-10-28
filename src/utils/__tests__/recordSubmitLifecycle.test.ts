import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';

// Execute the actual screen handler so async configuration and early returns
// exercise its real lock/finally rather than a copy of the submit algorithm.
const source = readFileSync(join(__dirname, '../../../app/record.tsx'), 'utf8');
const ast = ts.createSourceFile('record.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSubmit') handler = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!handler) throw new Error('record submit handler missing');
const js = ts.transpileModule(`const submit = ${handler.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function screen() {
  const config = { inventoryGroupId: 'test-bank', equalization: 'verified-equalized', bblPerFoot: 40, tankHeight: 20 };
  const scope = {
    routeType: 'freshwater', wellName: 'Test bank', isEditMode: false,
    barrels: '80', level: '10', dateTime: new Date(),
    submitInFlightRef: { current: false },
    committedBarrelsRef: { current: '80' }, committedLevelRef: { current: '10' },
    wellDownTouchedRef: { current: false }, wellDownRef: { current: false },
    canonicalWellDownRef: { current: false },
    startSubmitTrace: jest.fn(() => ({ mark: jest.fn(), end: jest.fn() })),
    getWellConfig: jest.fn(async (): Promise<typeof config | null> => config),
    parseLevel: (value: string) => Number(value),
    resultingLevel: jest.fn(() => 12),
    queueFreshWaterDelivery: jest.fn(async () => ({})),
    flushFreshWaterDeliveries: jest.fn(async () => ({ sent: 1, pending: 0 })),
    router: { back: jest.fn() }, alert: { show: jest.fn() },
    setIsSending: jest.fn(), t: (key: string) => key,
    resolveWellDownForSubmit: jest.fn(() => ({ wellDown: false, wellDownIsAuthoritative: false })),
    getRecordLoadBlockReason: jest.fn(() => 'no_well'),
    console: { error: jest.fn() },
  };
  const submit = runInNewContext(js + '\nsubmit', scope) as () => Promise<void>;
  return { scope, submit };
}

test('two taps while freshwater config loads produce only one durable delivery', async () => {
  const { scope, submit } = screen();
  let release!: (value: any) => void;
  scope.getWellConfig.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = submit();
  expect(scope.submitInFlightRef.current).toBe(true);
  await submit();
  expect(scope.getWellConfig).toHaveBeenCalledTimes(1);
  release({ inventoryGroupId: 'test-bank', equalization: 'verified-equalized', bblPerFoot: 40, tankHeight: 20 });
  await first;
  expect(scope.queueFreshWaterDelivery).toHaveBeenCalledTimes(1);
  expect(scope.flushFreshWaterDeliveries).toHaveBeenCalledTimes(1);
  expect(scope.submitInFlightRef.current).toBe(false);
  expect(scope.setIsSending).toHaveBeenLastCalledWith(false);
});

test('configuration failure unlocks the same form for retry', async () => {
  const { scope, submit } = screen();
  scope.getWellConfig.mockRejectedValueOnce(new Error('configuration unavailable'));
  await submit();
  expect(scope.queueFreshWaterDelivery).not.toHaveBeenCalled();
  expect(scope.submitInFlightRef.current).toBe(false);
  expect(scope.setIsSending).toHaveBeenLastCalledWith(false);
  await submit();
  expect(scope.queueFreshWaterDelivery).toHaveBeenCalledTimes(1);
});

test('missing config and validation returns clear the guard without submitting', async () => {
  const { scope, submit } = screen();
  scope.getWellConfig.mockResolvedValueOnce(null);
  await submit();
  expect(scope.submitInFlightRef.current).toBe(false);
  scope.committedBarrelsRef.current = '999';
  await submit();
  expect(scope.submitInFlightRef.current).toBe(false);
  expect(scope.queueFreshWaterDelivery).not.toHaveBeenCalled();
});

test('production-water validation also unlocks without sending a delivery', async () => {
  const { scope, submit } = screen();
  scope.routeType = 'production';
  await submit();
  expect(scope.alert.show).toHaveBeenCalled();
  expect(scope.submitInFlightRef.current).toBe(false);
  expect(scope.queueFreshWaterDelivery).not.toHaveBeenCalled();
});
