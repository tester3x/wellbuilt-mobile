const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the installed dependency's real gesture-to-value calculation.
const installed = fs.readFileSync('node_modules/@miblanchard/react-native-slider/lib/index.js', 'utf8');
const start = installed.indexOf('_getValue = (gestureState) => {') + '_getValue = '.length;
const end = installed.indexOf('\n    _getCurrentValue', start);
assert(start > 20 && end > start, 'Installed slider gesture contract changed');
const expression = installed.slice(start, end).trim().replace(/;$/, '').replace('(gestureState) => {', 'function (gestureState) {');
const original = vm.runInNewContext(`(${expression})`, { I18nManager: { isRTL: false } });
class InstalledSlider {
  constructor(props) {
    this.props = props;
    this.state = { containerSize: { width: 320 }, thumbSize: { width: 20 }, values: [8] };
    this._previousLeft = 8 / 18 * 300;
    this._getRawValues = values => values;
    this._getValue = original.bind(this);
  }
}
const output = ts.transpileModule(fs.readFileSync('components/LevelTimeSlider.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject, require: () => ({ Slider: InstalledSlider }) });
const props = { minimumValue: 0, maximumValue: 18, step: 0.01, vertical: false };
const slow = new exportsObject.LevelTimeSlider(props), normal = new InstalledSlider(props);
assert.equal(slow.props, props, 'Props, bounds and callbacks must pass through unchanged');
assert.equal(slow._getValue({ dx: 0, dy: 0 }), 8, 'No jump on touch/release without movement');
assert.equal(normal._getValue({ dx: 100, dy: 0 }), 14);
assert.equal(slow._getValue({ dx: 100, dy: 0 }), 10.1);
assert.equal(slow._getValue({ dx: -100, dy: 0 }), 5.9);
assert.equal(slow._getValue({ dx: 2000, dy: 0 }), 18);
assert.equal(slow._getValue({ dx: -2000, dy: 0 }), 0);
assert.equal(slow._getValue({ dx: 0, dy: 100 }), 8, 'Vertical motion must not alter this horizontal slider');
const page = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
assert(page.includes('LevelTimeSlider as Slider'), 'The actual level/time screen must use the adapter');
assert(page.includes('snappedValue = Math.round(value * 4) / 4'), 'Existing level snapping remains intact');
console.log('Level/time slider: reduced drag gain, stationary touch, direction, bounds, unchanged props and screen wiring passed.');
