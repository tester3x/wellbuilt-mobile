const {withMainActivity} = require('@expo/config-plugins');

const marker='// WellBuilt device orientation policy';
function applyDeviceOrientation(contents) {
  if(contents.includes(marker)) return contents;
  if(!contents.includes('super.onCreate(null)') || contents.includes('override fun onConfigurationChanged(')) {
    throw new Error('Review MainActivity lifecycle before applying WellBuilt orientation policy');
  }
  const methods=`
  ${marker}
  private fun applyWellBuiltOrientation() {
    val desired = if (resources.configuration.smallestScreenWidthDp < 600) {
      android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    } else {
      android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    if (requestedOrientation != desired) requestedOrientation = desired
  }

  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    super.onConfigurationChanged(newConfig)
    applyWellBuiltOrientation()
  }
`;
  const initialized=contents.replace('super.onCreate(null)','super.onCreate(null)\n    applyWellBuiltOrientation()');
  const closing=initialized.lastIndexOf('}');
  if(closing<0) throw new Error('MainActivity class closing brace not found');
  return initialized.slice(0,closing)+methods+initialized.slice(closing);
}

module.exports=config=>withMainActivity(config,result=>{
  if(result.modResults.language!=='kt') throw new Error('WellBuilt orientation policy requires Kotlin MainActivity');
  result.modResults.contents=applyDeviceOrientation(result.modResults.contents);
  return result;
});
module.exports.applyDeviceOrientation=applyDeviceOrientation;
