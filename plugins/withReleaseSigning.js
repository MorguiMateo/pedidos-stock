const { withAppBuildGradle } = require('expo/config-plugins');
module.exports = (config) => withAppBuildGradle(config, (config) => {
  const marker = '// pedidos-stock-release-signing';
  if (config.modResults.contents.includes(marker)) return config;
  // Never let a release silently inherit Expo's template debug signing key.
  config.modResults.contents = config.modResults.contents.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1// Production signing is configured below.');
  config.modResults.contents += `\n${marker}\ndef pedidosSigningNames = ["PEDIDOS_KEYSTORE_FILE", "PEDIDOS_KEYSTORE_PASSWORD", "PEDIDOS_KEY_ALIAS", "PEDIDOS_KEY_PASSWORD"]\ndef pedidosSigningReady = pedidosSigningNames.every { System.getenv(it) }\nandroid.buildTypes.release.signingConfig = null\nif (pedidosSigningReady) {\n  android.signingConfigs.create("pedidosRelease") {\n    storeFile file(System.getenv("PEDIDOS_KEYSTORE_FILE"))\n    storePassword System.getenv("PEDIDOS_KEYSTORE_PASSWORD")\n    keyAlias System.getenv("PEDIDOS_KEY_ALIAS")\n    keyPassword System.getenv("PEDIDOS_KEY_PASSWORD")\n  }\n  android.buildTypes.release.signingConfig = android.signingConfigs.pedidosRelease\n} else if (gradle.startParameter.taskNames.any { it.toLowerCase().contains("release") || it.toLowerCase() == "build" || it.toLowerCase() == "assemble" }) {\n  throw new GradleException("Missing production signing credentials. Run scripts/build-android.sh.")\n}\n`;
  return config;
});
