import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';
import {wellContentWidth,foldPanelFit,FOLD_PANEL_WIDTH,FOLD_BODY_HEIGHT,usesFoldPanel} from '../wellContentFrame';

test('Fold cover, centered unfolded view and both landscape columns share one phone frame',()=>{
  expect([412,750,416,416].map(width=>wellContentWidth(width,true))).toEqual([412,412,412,412]);
  expect(wellContentWidth(360,true)).toBe(360);
});

test('the confirmed tablet layout and ordinary phone widths remain unchanged',()=>{
  for(const width of [360,411,876,700])expect(wellContentWidth(width,false)).toBe(width);
});

test('the same phone frame produces identical text and slider dimensions in each Fold posture',()=>{
  const file=path.resolve(__dirname,'../../../app/(tabs)/index.tsx');
  const source=fs.readFileSync(file,'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='portraitStyles')!;
  const styles=runInNewContext(ts.transpileModule(fn.getText(ast)+';portraitStyles',{
    compilerOptions:{target:ts.ScriptTarget.ES2020},
  }).outputText,{baseWellStyles:{},TANK_HEIGHT:400,INTERIOR_TOP:56,INTERIOR_RIGHT:104});
  const cover=styles(412,412*2.2);
  for(const column of [750,416]) {
    const width=wellContentWidth(column,true);
    const open=styles(width,width*2.2);
    for(const key of ['statLeft','statRight','sliderRow','sliderValue','unlockHint','wellName','operatorName'])expect(open[key]).toEqual(cover[key]);
    expect(open.sliderRow.width).toBe('100%');
  }
  expect(source).toContain('const styles=useMemo(()=>foldablePhoneLayout ? {');
  expect(source).toContain('...portraitStyles(contentWidth,contentWidth*2.2,sceneScale)');
  expect(source).toContain('fittedFold ? portraitTankHeight/TANK_HEIGHT');
  expect(source).toContain('fittedFold ? {height:portraitTankHeight,flexGrow:0,flexShrink:0}');
});

test('Fold detection uses stable hardware capability rather than the current window or a Samsung model name',()=>{
  const native=fs.readFileSync(path.resolve(__dirname,'../../../modules/wellbuilt-platform/android/src/main/java/expo/modules/wbplatform/WellbuiltPlatformModule.kt'),'utf8');
  expect(native).toContain('Constant("isFoldable") { context().packageManager.hasSystemFeature("android.hardware.sensor.hinge_angle") }');
});

test.each([[412,800,false],[750,650,false],[416,570,true],[416,630,true]] as const)('whole Fold panel fits %s x %s with one scale', (width,height,wide)=>{
 const fit=foldPanelFit(width,height,wide);
 expect(fit.width*fit.scale).toBeLessThanOrEqual(width);
 expect(fit.height*fit.scale).toBeLessThanOrEqual(height);
 const tank=FOLD_PANEL_WIDTH*.70*1.2, text=FOLD_PANEL_WIDTH*2.2*.018;
 expect((tank*fit.scale)/(text*fit.scale)).toBeCloseTo(tank/text);
 expect(fit.height).toBe(wide?FOLD_BODY_HEIGHT+80:FOLD_BODY_HEIGHT);
});
test('invalid/exhausted geometry never paints an overflowing panel',()=>{
 expect(foldPanelFit(412,0,true).scale).toBe(0);
 expect(foldPanelFit(NaN,800,true).scale).toBe(0);
});

test('only unfolded Fold panels use uniform fitting; cover, phone and tablet keep their existing layout',()=>{
 expect(usesFoldPanel(412,false,true)).toBe(false);
 expect(usesFoldPanel(750,false,true)).toBe(true);
 expect(usesFoldPanel(416,true,true)).toBe(true);
 expect(usesFoldPanel(700,true,false)).toBe(false);
});
