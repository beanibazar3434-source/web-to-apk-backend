const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const WORK = '/tmp/builds', OUT = '/tmp/out';
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const jobs = {};
let queue = Promise.resolve(); // ekbar e ekta build

function writeProject(dir, c) {
  const w = (p, data) => {
    const f = path.join(dir, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };
  const pkg = c.package;
  const name = c.name.replace(/[<>&"'\\]/g, '');
  const orient = { portrait: 'portrait', landscape: 'landscape', any: 'unspecified' }[c.orientation] || 'portrait';

  let iconAttr = '';
  const m = /^data:image\/png;base64,(.+)$/.exec(c.icon || '');
  if (m) {
    w('app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', Buffer.from(m[1], 'base64'));
    iconAttr = 'android:icon="@mipmap/ic_launcher"';
  }

  w('settings.gradle',
`pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = 'app'
include ':app'
`);
  w('build.gradle', `plugins { id 'com.android.application' version '8.2.2' apply false }\n`);
  w('gradle.properties', 'org.gradle.jvmargs=-Xmx1536m\nandroid.useAndroidX=false\n');
  w('app/build.gradle',
`plugins { id 'com.android.application' }
android {
  namespace '${pkg}'
  compileSdk 34
  defaultConfig { applicationId '${pkg}'; minSdk 24; targetSdk 34; versionCode 1; versionName '1.0' }
}
`);
  w('app/src/main/AndroidManifest.xml',
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET"/>
  <application android:label="${name}" ${iconAttr}
    android:usesCleartextTraffic="true"
    android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <activity android:name=".MainActivity" android:exported="true"
      android:screenOrientation="${orient}"
      android:configChanges="orientation|screenSize|keyboardHidden">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
`);
  w('app/src/main/java/' + pkg.replace(/\./g, '/') + '/MainActivity.java',
`package ${pkg};
import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  WebView web;
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    ${c.fullscreen ? 'getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);' : ''}
    getWindow().setStatusBarColor(Color.parseColor("${c.statusBarColor}"));
    web = new WebView(this);
    setContentView(web);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient());
    web.loadUrl(${JSON.stringify(c.url)});
  }
  @Override public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}
`);
}

function build(id, c) {
  return new Promise((resolve, reject) => {
    const dir = path.join(WORK, id);
    writeProject(dir, c);
    execFile('gradle', ['assembleDebug', '--no-daemon', '-q'], {
      cwd: dir,
      env: { ...process.env, ANDROID_HOME: '/opt/android' },
      maxBuffer: 1 << 26,
      timeout: 15 * 60 * 1000
    }, (err, so, se) => {
      if (err) return reject(new Error(((se || err.message) + '').slice(-400)));
      fs.copyFileSync(path.join(dir, 'app/build/outputs/apk/debug/app-debug.apk'), path.join(OUT, id + '.apk'));
      fs.rmSync(dir, { recursive: true, force: true });
      resolve();
    });
  });
}

app.post('/api/build', (req, res) => {
  const c = req.body || {};
  if (!/^https?:\/\/[^\s"]+$/i.test(c.url || '')) return res.status(400).json({ error: 'Invalid URL' });
  if (!c.name || c.name.length > 30) return res.status(400).json({ error: 'Invalid name' });
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(c.package || '')) return res.status(400).json({ error: 'Invalid package' });
  if (!/^#[0-9a-f]{6}$/i.test(c.statusBarColor || '')) c.statusBarColor = '#2f5bff';

  const id = crypto.randomBytes(8).toString('hex');
  jobs[id] = { status: 'building' };
  queue = queue
    .then(() => build(id, c))
    .then(() => { jobs[id] = { status: 'done', downloadUrl: '/files/' + id + '.apk' }; })
    .catch(e => { jobs[id] = { status: 'failed', error: e.message }; });
  res.json({ id });
});

app.get('/api/status/:id', (req, res) => {
  res.json(jobs[req.params.id] || { status: 'failed', error: 'Job not found' });
});

app.get('/files/:f', (req, res) => {
  if (!/^[a-f0-9]+\.apk$/.test(req.params.f)) return res.sendStatus(404);
  const f = path.join(OUT, req.params.f);
  if (!fs.existsSync(f)) return res.sendStatus(404);
  res.type('application/vnd.android.package-archive').download(f, 'app.apk');
});

app.get('/', (_, res) => res.send('APK builder running'));
app.listen(process.env.PORT || 3000);
