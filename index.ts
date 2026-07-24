import { registerRootComponent } from 'expo';

// Install the JS crash guard before ANY app code runs, so a startup error is
// captured and shown rather than closing the app silently.
import { installCrashGuard } from './src/lib/crashGuard';
installCrashGuard();

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
