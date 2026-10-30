import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';

const source = readFileSync(join(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8');
const ast = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'captureTransitionStart') {
    callback = (node.initializer as ts.CallExpression).arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!callback) throw new Error('Swipe capture callback missing');

test('swipe captures the drawn departing level, independent of destination preload or later frames', () => {
  const levels = { Previous: {value:0.63}, Destination: {value:0.15} };
  let captured = 0;
  const action = runInNewContext(ts.transpileModule('const capture = ' + callback, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText + '\ncapture', {
    wells: ['Previous', 'Destination'], currentIndex: 0,
    wellLevels: { current: levels }, setEntryFraction: (value: number) => { captured = value; },
  });
  action();
  expect(captured).toBe(0.63);
  levels.Previous.value = 0.4; levels.Destination.value = 0.2;
  expect(captured).toBe(0.63); // The seed cannot follow a later card's updates.
  expect(source).toContain('onScrollBeginDrag={handlePagerDrag}');
  expect(source).toContain('entryFraction={entryFraction}');
});
