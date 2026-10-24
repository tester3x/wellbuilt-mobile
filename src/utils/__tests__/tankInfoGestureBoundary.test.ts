import fs from 'fs';
import path from 'path';
import ts from 'typescript';
test('information target is a sibling, never a child of the performance/long-press tank target', () => {
  const file = ts.createSourceFile('index.tsx', fs.readFileSync(path.resolve(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let badge: ts.JsxElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'testID'
        && attribute.initializer?.getText(file) === '"tank-info-button"')) badge = node;
    ts.forEachChild(node, visit);
  };
  visit(file); expect(badge).toBeDefined();
  let ancestor: ts.Node | undefined = badge!.parent;
  while (ancestor) {
    if (ts.isJsxElement(ancestor)) expect(ancestor.openingElement.tagName.getText(file)).not.toBe('Pressable');
    ancestor = ancestor.parent;
  }
  const siblings = badge!.parent.getText(file);
  expect(siblings).toContain('handleNormalTankTap()'); expect(siblings).toContain('handleTankLongPress()');
  const target = badge!.getText(file);
  expect(target).toContain('lastTankTapTimeRef.current = 0'); expect(target).toContain('setShowTankInfo(true)');
  expect(target).not.toContain('onTankDoubleTap'); expect(target).not.toContain('onLongPress');
});
