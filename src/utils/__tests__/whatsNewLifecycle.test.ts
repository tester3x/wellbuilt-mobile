import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';
import type { ChangelogEntry } from '../../config/changelog';

function extract(relativePath: string, name: string) {
  const text = readFileSync(join(__dirname, '../../..', relativePath), 'utf8');
  const ast = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found) throw new Error(`Missing ${name}`);
  const expression = ts.isFunctionDeclaration(found) ? `(${found.getText(ast)})` : found.getText(ast);
  return { text, expression };
}

const hashSource = extract('hooks/use-whats-new.ts', 'hashChangelog');
const hash = runInNewContext(ts.transpileModule(`const hash = ${hashSource.expression}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText + '\nhash') as (entry: ChangelogEntry | null) => string;

const entry: ChangelogEntry = {
  version: 'test', date: '2026-10-27', title: 'Test release',
  changes: [{ type: 'fixed', audience: 'all', descriptionKey: 'originalFix' }],
};

test('changing a localized changelog key invalidates a previously dismissed hash', () => {
  const next = { ...entry, changes: [{ ...entry.changes[0], descriptionKey: 'differentFix' }] };
  expect(hash(next)).not.toBe(hash(entry));
  expect(hash(JSON.parse(JSON.stringify(entry)))).toBe(hash(entry));
  expect(hash(null)).toBe('');
});

test.each([false, true])('Android Back dismisses with the checkbox value %s, never its event', checked => {
  const { text, expression } = extract('components/WhatsNewModal.tsx', 'handleDismiss');
  const onDismiss = jest.fn(), setDontShowAgain = jest.fn();
  const close = runInNewContext(ts.transpileModule(`const close = ${expression}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText + '\nclose', { dontShowAgain: checked, onDismiss, setDontShowAgain }) as (event: unknown) => void;
  close({ nativeEvent: {} });
  expect(onDismiss).toHaveBeenCalledWith(checked);
  expect(setDontShowAgain).toHaveBeenCalledWith(false);
  expect(text).toContain('onRequestClose={handleDismiss}');
  expect(text).toContain('onPress={handleDismiss}');
});
