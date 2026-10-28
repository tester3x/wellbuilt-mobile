const {applyDeviceOrientation}=require('../../../plugins/withDeviceOrientation');
const activity=`class MainActivity : ReactActivity() {
 override fun onCreate(savedInstanceState: Bundle?) {
  SplashScreenManager.registerOnActivity(this)
  super.onCreate(null)
 }
 override fun getMainComponentName(): String = "main"
}`;

test('orientation policy preserves startup hooks and reevaluates after fold/configuration changes',()=>{
 const result=applyDeviceOrientation(activity);
 expect(result).toContain('SplashScreenManager.registerOnActivity(this)');
 expect(result).toContain('super.onCreate(null)\n    applyWellBuiltOrientation()');
 expect(result).toContain('super.onConfigurationChanged(newConfig)\n    applyWellBuiltOrientation()');
 expect(result).toContain('resources.configuration.smallestScreenWidthDp < 600');
 expect(result).toContain('SCREEN_ORIENTATION_PORTRAIT');
 expect(result).toContain('SCREEN_ORIENTATION_UNSPECIFIED');
 expect(result).toContain('if (requestedOrientation != desired)');
 expect(result).toContain('override fun getMainComponentName(): String = "main"');
});
test('prebuild reapplication does not duplicate activity methods',()=>{
 const result=applyDeviceOrientation(activity);
 expect(applyDeviceOrientation(result)).toBe(result);
});
test('an unfamiliar activity lifecycle requires review instead of overwriting it',()=>{
 expect(()=>applyDeviceOrientation('class MainActivity {}')).toThrow('Review MainActivity lifecycle');
 expect(()=>applyDeviceOrientation(activity.replace('override fun getMainComponentName()', 'override fun onConfigurationChanged()'))).toThrow('Review MainActivity lifecycle');
});
