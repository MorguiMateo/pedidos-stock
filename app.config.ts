export default {
  expo: {
    name: 'KALAK logística', slug: 'pedidos-stock', version: '1.9.0', scheme: 'pedidosstock', icon: './assets/icon.png',
    orientation: 'default', userInterfaceStyle: 'light', backgroundColor: '#FAF7F0',
    android: { package: 'com.pedidosstock.app', versionCode: 12, adaptiveIcon: { backgroundColor: '#FAF7F0', foregroundImage: './assets/adaptive-icon.png' }, permissions: [], allowBackup: false, predictiveBackGestureEnabled: true },
    web: { bundler: 'metro', name: 'KALAK logística', shortName: 'KALAK logística', themeColor: '#FAF7F0' },
    plugins: ['expo-router', 'expo-sharing', ['expo-image-picker', { photosPermission: 'Permitir seleccionar una foto de tu mascota.', cameraPermission: false, microphonePermission: false }], './plugins/withReleaseSigning'],
    experiments: { typedRoutes: true },
  },
};
