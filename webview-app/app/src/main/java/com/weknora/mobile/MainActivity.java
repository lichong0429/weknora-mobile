package com.weknora.mobile;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    // 当前是否为深色（前端通过 JS 桥同步）
    private boolean isDark = false;
    // 下载专用单线程池：串行落盘，避免多个大文件同时占用带宽与存储写
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();

    // ---------------- 凭据加密存储用到的常量 ----------------
    // KeyStore 里保存的 AES 密钥别名。改名等价于「丢掉旧密文」——只在协议变更时升版本。
    private static final String CRED_KEY_ALIAS = "weknora_cred_v1";
    // 密文（Base64）落在这个私有 SharedPreferences 文件里；文件名只在设备上可见
    private static final String CRED_PREFS_NAME = "weknora_secure";
    private static final String CRED_PREF_KEY = "credentials";
    private static final String CRED_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String CRED_KEYSTORE_PROVIDER = "AndroidKeyStore";
    // GCM 标准 IV 长度；128 bit tag 是 AndroidKeyStore 普遍支持的最大值
    private static final int CRED_GCM_IV_BYTES = 12;
    private static final int CRED_GCM_TAG_BITS = 128;

    // 与前端约定的错误码，四个都是终态，前端据此决定 UI 文案
    private static final String CODE_EMPTY = "EMPTY";
    private static final String CODE_BAD_INPUT = "BAD_INPUT";
    private static final String CODE_DECRYPT_FAILED = "DECRYPT_FAILED";
    private static final String CODE_UNAVAILABLE = "UNAVAILABLE";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // 启动时按系统状态初始化明暗，避免启动瞬间状态栏颜色错误（前端随后会经 JS 桥覆盖）
        isDark = (getResources().getConfiguration().uiMode
            & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        applySystemBarStyle();

        // 注册文件选择器回调（必须早于 WebView 使用）
        fileChooserLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (filePathCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    String dataString = result.getData().getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
        );

        // Android 15+ (targetSdk 35+) 强制 edge-to-edge，内容会侵入状态栏/导航栏。
        // 给根布局应用系统栏 inset（含 IME 键盘高度），让 WebView 内容始终落在安全区内，
        // 且键盘弹出时输入框不被遮挡。
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root_layout), (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            int bottom = bars.bottom + (imeVisible ? ime.bottom : 0);
            v.setPadding(bars.left, bars.top, bars.right, bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        // 系统返回键（含 Android 13+ 手势返回）：必须用 OnBackPressedDispatcher 注册回调，
        // 直接重写 onBackPressed() 在 targetSdk 33+ 下不再被系统调用（手势返回直接退出 App 的根因）。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackPress();
            }
        });

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();

        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " WeKnoraMobile/1.0");
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // JS 桥：前端切换主题时同步到原生层（控制系统深色模式与状态栏图标颜色）
        webView.addJavascriptInterface(new Bridge(), "WeKnoraBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // 拦截锚点跳转（#），防止页面刷新或跳转到主页
                if (url.contains("#") && !url.contains("#/")) {
                    return true; // 阻止 WebView 处理纯锚点
                }

                // 处理 wiki: 协议链接（React Router 内部跳转）
                if (url.startsWith("wiki:")) {
                    // 让 WebView 内部处理，通过 JavaScript 桥接通知 React
                    view.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('wiki-link-click', { detail: { href: '" + url + "' } }));",
                        null
                    );
                    return true;
                }

                // 处理内部页面（file:// 或 React Router 路由）
                if (url.startsWith("file:///android_asset/") || url.startsWith("javascript:")) {
                    return false;
                }

                // 外部链接用系统浏览器打开
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }

                return false;
            }
        });

        // 必须重写 onShowFileChooser，否则页面里 <input type="file"> 点击无反应
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                try {
                    Intent intent = fileChooserParams.createIntent();
                    fileChooserLauncher.launch(intent);
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/web/index.html");
    }

    // 系统深色模式切换时（configChanges 含 uiMode，Activity 不重建），
    // 同步一次状态栏样式。前端 matchMedia 监听会自行联动，这里兜底原生层视觉。
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarStyle();
    }

    // 统一返回处理：优先让前端消费（关闭全屏/回上一页），前端返回 false 才退出应用
    private void handleBackPress() {
        if (webView != null) {
            webView.evaluateJavascript(
                "(typeof window.__wbOnBack === 'function') ? (window.__wbOnBack() === true ? 'true' : 'false') : 'false'",
                value -> {
                    String v = value == null ? "" : value.replace("\"", "").trim();
                    if ("true".equals(v)) return; // 前端已处理（关闭全屏/回上一页）
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                }
            );
        } else {
            finish();
        }
    }

    // 供前端调用：setTheme('system'|'light'|'dark', isDark)。
    // isDark 是前端解析后的实际明暗（system 档由前端根据 prefers-color-scheme 判定），
    // 原生据此设置状态栏/导航栏背景色与图标颜色。
    private class Bridge {
        @JavascriptInterface
        public void setTheme(String theme, boolean isDark) {
            runOnUiThread(() -> {
                boolean dark;
                if ("dark".equals(theme)) {
                    dark = true;
                } else if ("light".equals(theme)) {
                    dark = false;
                } else {
                    dark = isDark;
                }
                MainActivity.this.isDark = dark;
                applySystemBarStyle();
            });
        }

        // 供前端调用：download(method, url, bodyJson, fileName, apiKey, requestId)。
        //
        // 为什么下载必须放到原生：Android WebView 不支持 blob: 下载，也会忽略
        // <a download>，前端「fetch → blob → 下载」在 App 内必然失败。这里由原生
        // 直接发起请求并**流式写盘**，避免把整个 ZIP 读进内存（后端批量下载上限 512 MiB）。
        // 完成后通过 evaluateJavascript 回调 window.__weknoraDownload 通知前端。
        //
        // authHeaderName/authHeaderValue 取代原先写死的 apiKey：服务端现在同时支持
        // API Key（X-API-Key）与账号登录（Authorization: Bearer <JWT>），
        // 由前端按当前认证方式决定传哪个。两者互斥 —— 同时发送会让服务端按
        // API-key principal 鉴权，账号模式下表现为「登录成功却下载 401」。
        @JavascriptInterface
        public void download(String method, String url, String bodyJson,
                             String fileName, String authHeaderName, String authHeaderValue,
                             String requestId) {
            if (requestId == null || requestId.isEmpty()) return;
            final String safeName = sanitizeFileName(fileName);
            downloadExecutor.execute(() -> {
                boolean ok;
                String message;
                try {
                    message = performDownload(method, url, bodyJson, safeName,
                        authHeaderName, authHeaderValue);
                    ok = true;
                } catch (Exception e) {
                    ok = false;
                    message = e.getMessage() == null || e.getMessage().isEmpty()
                        ? "下载失败" : e.getMessage();
                }
                final boolean fOk = ok;
                final String fMessage = message;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this,
                        fOk ? "已保存到 " + fMessage : "下载失败：" + fMessage,
                        Toast.LENGTH_LONG).show();
                    notifyDownloadResult(requestId, fOk, fMessage);
                });
            });
        }

        // 供前端调用：downloadUpdate(url, fileName, requestId)。
        //
        // 为什么不复用上面的 download：那条在 Android 10+ 会把文件写进 MediaStore 的
        // 「下载/WeKnora」，而系统安装器读不了 MediaStore 的 content URI。更新包必须落在
        // 应用自己的目录里，安装时再由 FileProvider 授权出去。这里存到 <files>/update/。
        @JavascriptInterface
        public void downloadUpdate(String url, String fileName, String requestId) {
            if (requestId == null || requestId.isEmpty()) return;
            final String safeName = sanitizeFileName(fileName);
            downloadExecutor.execute(() -> {
                boolean ok;
                String message;
                try {
                    message = performUpdateDownload(url, safeName);
                    ok = true;
                } catch (Exception e) {
                    ok = false;
                    message = e.getMessage() == null || e.getMessage().isEmpty()
                        ? "下载失败" : e.getMessage();
                }
                final boolean fOk = ok;
                final String fMessage = message;
                runOnUiThread(() -> {
                    if (!fOk) {
                        Toast.makeText(MainActivity.this, "更新包下载失败：" + fMessage,
                            Toast.LENGTH_LONG).show();
                    }
                    notifyUpdateResult(requestId, fOk, fMessage);
                });
            });
        }

        // 供前端调用：installUpdate(fileName, requestId)。
        //
        // Android 不允许普通应用静默安装：这里只负责把系统安装界面调起来，
        // 最后一步「安装」必须由用户确认；Android 8+ 还需先授权「安装未知应用」，
        // 未授权时把用户直接送到对应的设置页。
        @JavascriptInterface
        public void installUpdate(String fileName, String requestId) {
            final String safeName = sanitizeFileName(fileName);
            runOnUiThread(() -> {
                File apk = new File(updateDir(), safeName);
                if (!apk.exists() || apk.length() == 0) {
                    notifyInstallResult(requestId, false, "安装包不存在，请重新下载");
                    return;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && !getPackageManager().canRequestPackageInstalls()) {
                    notifyInstallResult(requestId, false,
                        "请先允许本应用「安装未知应用」，授权后返回再点一次更新");
                    try {
                        startActivity(new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getPackageName())));
                    } catch (Exception ignored) {
                        // 少数定制系统没有该设置页，忽略即可（用户可去系统设置里手动开）
                    }
                    return;
                }
                try {
                    Uri uri = FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".fileprovider", apk);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    notifyInstallResult(requestId, true, "已打开安装界面");
                } catch (Exception e) {
                    notifyInstallResult(requestId, false,
                        e.getMessage() == null ? "无法启动安装界面" : e.getMessage());
                }
            });
        }

        // ---------------- 凭据加密存储（保存登录密码）----------------
        //
        // 供前端调用：saveCredentials(json)，入参 {"email":"…","password":"…","baseUrl":"…"}。
        //
        // 三个方法都是**同步返回 JSON 字符串**，且永远不抛异常 —— WebView 的 JS 桥
        // 一旦把 Java 异常抛回去，JS 侧拿到的是 "Error: Java exception was raised
        // during method call" 这种无信息量的字符串，UI 无法区分「没保存」和「密钥库坏了」。
        // 所以统一包成信封：
        //   成功 {"ok":true,"data":{"email":…,"password":…,"baseUrl":…}}
        //   失败 {"ok":false,"code":"EMPTY|BAD_INPUT|DECRYPT_FAILED|UNAVAILABLE","message":"可读说明"}
        //
        // 加密方案：AndroidKeyStore 里的 AES-256-GCM 密钥（别名 weknora_cred_v1，
        // 不可导出），密文格式 IV(12B) + ciphertext(+128bit tag)，整体 Base64 后存进
        // 私有 SharedPreferences（weknora_secure）。密钥由 GCM 自动随机生成 IV。
        // API 要求：KeyGenParameterSpec / GCMParameterSpec 均为 API 23+，本项目 minSdk 24，
        // 无需任何版本判断或 androidx.security 依赖（避免引入新依赖影响 CI 构建）。
        //
        // 安全边界（如实说明，不夸大）：
        //   能防：SharedPreferences 文件被 adb pull / 云备份（allowBackup=true）/ 同机
        //        其他应用读取；离线拿到密文也解不出明文（密钥不可导出，多数设备由
        //        TEE / StrongBox 硬件保护，卸载重装即失效）。
        //   不能防：root 设备；Frida / Xposed 注入本进程后直接读内存与明文参数；
        //        debuggable 包被 jdwp 附加调试；输入法 / 无障碍服务 / 录屏抓取输入框内容；
        //        用户主动点「显示密码」后被旁观或截屏。这些属于终端已被攻破的场景，
        //        任何本地存储方案都挡不住。
        @JavascriptInterface
        public String saveCredentials(String json) {
            if (json == null || json.trim().isEmpty()) {
                return envelopeError(CODE_BAD_INPUT, "缺少凭据参数");
            }
            String email;
            String password;
            String baseUrl;
            try {
                JSONObject in = new JSONObject(json);
                email = in.optString("email", "").trim();
                // 密码不 trim：前后空格可能是密码的一部分
                password = in.optString("password", "");
                baseUrl = in.optString("baseUrl", "").trim();
            } catch (Exception e) {
                return envelopeError(CODE_BAD_INPUT, "凭据参数不是合法 JSON");
            }
            if (email.isEmpty() || password.isEmpty() || baseUrl.isEmpty()) {
                return envelopeError(CODE_BAD_INPUT, "email / password / baseUrl 都不能为空");
            }

            JSONObject payload = new JSONObject();
            try {
                payload.put("email", email);
                payload.put("password", password);
                payload.put("baseUrl", baseUrl);
            } catch (Exception e) {
                return envelopeError(CODE_BAD_INPUT, "凭据序列化失败");
            }

            try {
                String cipherText = encryptCredential(payload.toString());
                boolean written = prefs()
                    .edit()
                    .putString(CRED_PREF_KEY, cipherText)
                    .commit();
                if (!written) {
                    return envelopeError(CODE_UNAVAILABLE, "写入本地存储失败，请检查存储空间");
                }
                return envelopeOk(payload);
            } catch (GeneralSecurityException e) {
                return envelopeError(CODE_UNAVAILABLE, "系统密钥库不可用：" + describeError(e));
            } catch (IOException e) {
                return envelopeError(CODE_UNAVAILABLE, "系统密钥库不可用：" + describeError(e));
            } catch (Exception e) {
                return envelopeError(CODE_UNAVAILABLE, "保存失败：" + describeError(e));
            }
        }

        // 供前端调用：loadCredentials()。无数据返回 EMPTY（「没保存过」不是错误）；
        // 密文与当前密钥不匹配（卸载重装 / 系统重置密钥 / 换机恢复备份）返回
        // DECRYPT_FAILED，并**主动删掉损坏的密文**，否则每次启动都会重复失败一次。
        @JavascriptInterface
        public String loadCredentials() {
            String stored;
            try {
                stored = prefs().getString(CRED_PREF_KEY, null);
            } catch (Exception e) {
                return envelopeError(CODE_UNAVAILABLE, "无法读取本地存储：" + describeError(e));
            }
            if (stored == null || stored.trim().isEmpty()) {
                return envelopeError(CODE_EMPTY, "尚未保存登录信息");
            }

            String plain;
            try {
                plain = decryptCredential(stored);
            } catch (AEADBadTagException e) {
                // GCM 校验失败：密钥换了或密文被改，这团数据已经永远解不开
                clearStoredCredential();
                return envelopeError(CODE_DECRYPT_FAILED,
                    "已保存的登录信息无法解密（可能重装过应用或系统重置了密钥），已清除，请重新输入");
            } catch (GeneralSecurityException e) {
                // 含 KeyPermanentlyInvalidatedException / UnrecoverableKeyException 等
                clearStoredCredential();
                return envelopeError(CODE_DECRYPT_FAILED,
                    "已保存的登录信息已失效（" + describeError(e) + "），已清除，请重新输入");
            } catch (IOException e) {
                return envelopeError(CODE_UNAVAILABLE, "系统密钥库不可用：" + describeError(e));
            } catch (Exception e) {
                clearStoredCredential();
                return envelopeError(CODE_DECRYPT_FAILED, "解密失败，已清除，请重新输入");
            }

            try {
                JSONObject data = new JSONObject(plain);
                String email = data.optString("email", "");
                String password = data.optString("password", "");
                String baseUrl = data.optString("baseUrl", "");
                if (email.isEmpty() || password.isEmpty() || baseUrl.isEmpty()) {
                    clearStoredCredential();
                    return envelopeError(CODE_DECRYPT_FAILED, "已保存的登录信息不完整，已清除");
                }
                JSONObject out = new JSONObject();
                out.put("email", email);
                out.put("password", password);
                out.put("baseUrl", baseUrl);
                return envelopeOk(out);
            } catch (Exception e) {
                clearStoredCredential();
                return envelopeError(CODE_DECRYPT_FAILED, "已保存的登录信息已损坏，已清除");
            }
        }

        // 供前端调用：clearCredentials()。同时删掉密文与密钥本身 ——
        // 用户点「不保存密码」后，不该在设备上留下任何可被后续利用的密钥材料。
        @JavascriptInterface
        public String clearCredentials() {
            try {
                clearStoredCredential();
                deleteCredentialKey();
                return envelopeOk(null);
            } catch (Exception e) {
                return envelopeError(CODE_UNAVAILABLE, "清除失败：" + describeError(e));
            }
        }
    }

    // ================= 凭据加密存储的实现细节 =================
    // 与上面 Bridge 里的三个 @JavascriptInterface 方法配套：Bridge 只负责
    // 参数校验与信封组装，真正的加解密 / 存储都在这里。

    // 私有 SharedPreferences（MODE_PRIVATE：仅本应用可读，其他应用即使同 uid 不同签名也读不到）
    private SharedPreferences prefs() {
        return getSharedPreferences(CRED_PREFS_NAME, Context.MODE_PRIVATE);
    }

    // 只删密文，保留密钥（解密失败时用：坏数据必须清掉，否则每次启动都白失败一次）
    private void clearStoredCredential() {
        try {
            prefs().edit().remove(CRED_PREF_KEY).commit();
        } catch (Exception ignored) {
            // 清理失败不影响返回给前端的结论（前端已按失败处理，下次仍会重试）
        }
    }

    // 删掉 KeyStore 里的密钥条目（用户主动「不保存密码」时用）
    private static void deleteCredentialKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance(CRED_KEYSTORE_PROVIDER);
            keyStore.load(null);
            if (keyStore.containsAlias(CRED_KEY_ALIAS)) {
                keyStore.deleteEntry(CRED_KEY_ALIAS);
            }
        } catch (Exception ignored) {
            // 密钥删不掉（极少数定制 ROM）：密文已在上面删掉，明文仍不外泄
        }
    }

    // 取已有密钥，没有就生成一把。KeyGenParameterSpec 需要 API 23+，minSdk 24 满足。
    // 参数含义：
    //   PURPOSE_ENCRYPT|DECRYPT —— 只做加解密，不能当签名密钥复用
    //   BLOCK_MODE_GCM + ENCRYPTION_PADDING_NONE —— GCM 是 AEAD，自带完整性校验，
    //     不需要（也不允许）额外填充
    //   setKeySize(256) —— AES-256，AndroidKeyStore 自 API 23 起支持
    //   setRandomizedEncryptionRequired(true) —— 强制每次加密由系统生成随机 IV，
    //     禁止调用方自选 IV（防 IV 复用导致 GCM 灾难性失效）
    // 密钥不可导出（getEncoded() 返回 null），多数设备由 TEE/StrongBox 托管。
    private static SecretKey getOrCreateCredentialKey() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(CRED_KEYSTORE_PROVIDER);
        keyStore.load(null);
        if (keyStore.containsAlias(CRED_KEY_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(CRED_KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
            // 别名存在但不是 SecretKey（历史遗留/被篡改）：删掉重建，避免永久不可用
            keyStore.deleteEntry(CRED_KEY_ALIAS);
        }
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, CRED_KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            CRED_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build();
        generator.init(spec);
        return generator.generateKey();
    }

    // 加密：返回 Base64( IV(12B) || ciphertext )，可直接存 SharedPreferences
    private static String encryptCredential(String plain) throws GeneralSecurityException, IOException {
        SecretKey key = getOrCreateCredentialKey();
        Cipher cipher = Cipher.getInstance(CRED_TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key); // 随机 IV 由 KeyStore 生成
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != CRED_GCM_IV_BYTES) {
            // setRandomizedEncryptionRequired(true) 下不该发生；防御性检查避免写出不可解的密文
            throw new GeneralSecurityException("生成的 IV 长度异常");
        }
        byte[] cipherText = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] blob = new byte[iv.length + cipherText.length];
        System.arraycopy(iv, 0, blob, 0, iv.length);
        System.arraycopy(cipherText, 0, blob, iv.length, cipherText.length);
        return Base64.encodeToString(blob, Base64.NO_WRAP);
    }

    // 解密：入参是 encryptCredential 产出的 Base64。
    // 密钥被系统丢弃（卸载重装 / 换机恢复备份 / 系统重置）时会抛出
    // AEADBadTagException 或 KeyPermanentlyInvalidatedException —— 调用方据此返回
    // DECRYPT_FAILED 并清掉密文。
    private static String decryptCredential(String base64) throws GeneralSecurityException, IOException {
        byte[] blob;
        try {
            blob = Base64.decode(base64, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            throw new GeneralSecurityException("密文不是合法 Base64");
        }
        if (blob.length <= CRED_GCM_IV_BYTES) {
            throw new GeneralSecurityException("密文长度异常");
        }
        KeyStore keyStore = KeyStore.getInstance(CRED_KEYSTORE_PROVIDER);
        keyStore.load(null);
        if (!keyStore.containsAlias(CRED_KEY_ALIAS)) {
            // 密钥随卸载一起消失，但 allowBackup=true 可能把密文恢复了回来
            throw new GeneralSecurityException("设备上已无对应密钥");
        }
        KeyStore.Entry entry = keyStore.getEntry(CRED_KEY_ALIAS, null);
        if (!(entry instanceof KeyStore.SecretKeyEntry)) {
            throw new GeneralSecurityException("密钥条目类型异常");
        }
        SecretKey key = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        Cipher cipher = Cipher.getInstance(CRED_TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key,
            new GCMParameterSpec(CRED_GCM_TAG_BITS, blob, 0, CRED_GCM_IV_BYTES));
        byte[] plain = cipher.doFinal(blob, CRED_GCM_IV_BYTES, blob.length - CRED_GCM_IV_BYTES);
        return new String(plain, StandardCharsets.UTF_8);
    }

    // 成功信封。data 为 null 时只返回 {"ok":true}（clear 用）。
    private static String envelopeOk(JSONObject data) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            if (data != null) out.put("data", data);
            return out.toString();
        } catch (Exception e) {
            // JSONObject 序列化异常几乎不可能，兜底成一个合法信封而不是抛给 JS
            return "{\"ok\":false,\"code\":\"UNAVAILABLE\",\"message\":\"结果序列化失败\"}";
        }
    }

    // 失败信封：code 必须是上面四个枚举之一，message 供 UI 直接展示
    private static String envelopeError(String code, String message) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("code", code == null ? CODE_UNAVAILABLE : code);
            if (message != null && !message.isEmpty()) out.put("message", message);
            return out.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"code\":\"UNAVAILABLE\"}";
        }
    }

    // 异常 → 可读说明（KeyStore 的异常 message 有时只有 "Invalid keystore format" 之类，
    // 但至少比空串有用；为空时退化到类名）
    private static String describeError(Throwable t) {
        if (t == null) return "未知错误";
        String msg = t.getMessage();
        if (msg == null || msg.trim().isEmpty()) return t.getClass().getSimpleName();
        return msg;
    }

    // 下载请求体：加鉴权头，POST 时写 JSON body，200 才落盘（错误响应不生成残缺文件）
    private String performDownload(String method, String url, String bodyJson,
                                   String fileName, String authHeaderName,
                                   String authHeaderValue) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(120000);
            conn.setInstanceFollowRedirects(true);
            // 只设置前端实际给出的那一个鉴权头（空名或空值都不设）——
            // 同时发送 X-API-Key 与 Authorization 会让服务端按 API-key principal 鉴权
            if (authHeaderName != null && !authHeaderName.isEmpty()
                    && authHeaderValue != null && !authHeaderValue.isEmpty()) {
                conn.setRequestProperty(authHeaderName, authHeaderValue);
            }
            conn.setRequestProperty("Accept", "*/*");

            if (bodyJson != null && !bodyJson.isEmpty()) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bodyJson.getBytes(StandardCharsets.UTF_8));
                }
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException(extractErrorMessage(conn, code));
            }

            String name = fileNameFromHeader(conn.getHeaderField("Content-Disposition"), fileName);
            String mime = conn.getContentType();
            if (mime != null) {
                int semi = mime.indexOf(';');
                if (semi > 0) mime = mime.substring(0, semi);
            }
            if (mime == null || mime.isEmpty()) mime = "application/octet-stream";

            try (InputStream in = conn.getInputStream()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    return saveViaMediaStore(in, name, mime);
                }
                return saveToAppDir(in, name);
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // Android 10+ 走 MediaStore，落到「下载/WeKnora」，无需任何存储权限
    private String saveViaMediaStore(InputStream in, String name, String mime) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/WeKnora");
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("无法创建下载文件，请检查存储空间");

        try {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("无法写入下载文件");
                copy(in, out);
            }
        } catch (IOException e) {
            try { getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            throw e;
        }

        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(uri, done, null, null);
        return Environment.DIRECTORY_DOWNLOADS + "/WeKnora/" + name;
    }

    // Android 9 及以下：无 Scoped Storage，落到应用专属目录（同样不需要权限），
    // 返回完整路径以便提示用户实际位置
    private String saveToAppDir(InputStream in, String name) throws IOException {
        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getFilesDir();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建下载目录");
        }
        File target = new File(dir, name);
        try (OutputStream out = new FileOutputStream(target)) {
            copy(in, out);
        }
        return target.getAbsolutePath();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        out.flush();
    }

    // 错误响应体是 JSON（{"error":{"message":"..."}}），尽量把后端的真实原因带回来
    private static String extractErrorMessage(HttpURLConnection conn, int code) {
        String fallback = "HTTP " + code;
        try (InputStream es = conn.getErrorStream()) {
            if (es == null) return fallback;
            byte[] buf = new byte[4096];
            int n = es.read(buf);
            if (n <= 0) return fallback;
            String text = new String(buf, 0, n, StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(text);
            if (json.has("error")) {
                JSONObject err = json.optJSONObject("error");
                if (err != null && err.optString("message", "").length() > 0) {
                    return err.optString("message");
                }
            }
            if (json.optString("message", "").length() > 0) return json.optString("message");
            return fallback;
        } catch (Exception ignored) {
            return fallback;
        }
    }

    // 优先使用服务端给的 Content-Disposition 文件名（支持 RFC 5987 的 filename*）
    private static String fileNameFromHeader(String header, String fallback) {
        if (header != null) {
            java.util.regex.Matcher star = java.util.regex.Pattern
                .compile("filename\\*=(?:UTF-8|utf-8)''([^;]+)").matcher(header);
            if (star.find()) {
                try {
                    return sanitizeFileName(java.net.URLDecoder.decode(star.group(1), "UTF-8"));
                } catch (Exception ignored) {}
            }
            java.util.regex.Matcher plain = java.util.regex.Pattern
                .compile("filename=\"?([^\";]+)\"?").matcher(header);
            if (plain.find()) return sanitizeFileName(plain.group(1));
        }
        return sanitizeFileName(fallback);
    }

    // 文件名消毒：去掉路径分隔符与控制字符，防止越权写盘
    private static String sanitizeFileName(String name) {
        if (name == null) return "download";
        StringBuilder sb = new StringBuilder();
        for (char c : name.toCharArray()) {
            if (c == '/' || c == '\\' || c < 0x20 || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') {
                sb.append('_');
            } else {
                sb.append(c);
            }
        }
        String cleaned = sb.toString().trim();
        if (cleaned.isEmpty()) return "download";
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }

    // 更新包目录：优先应用外部私有目录（无需任何存储权限），退化到内部目录。
    // FileProvider 的 external-files-path / files-path 已同时覆盖这两处（见 file_paths.xml）。
    private File updateDir() {
        File base = getExternalFilesDir(null);
        if (base == null) base = getFilesDir();
        File dir = new File(base, "update");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static final String UPDATE_UA = "WeKnoraMobile-Android";

    // 下载更新包到 updateDir()，返回绝对路径。
    // GitHub 的 releases/download 会 302 跳到 objects.githubusercontent.com（跨主机），
    // 因此这里**自己处理跳转**而不是依赖 setInstanceFollowRedirects，避免某些实现
    // 因跨主机/协议差异拒绝跟随；失败时删掉半截文件，避免留下装不上的残包。
    private String performUpdateDownload(String url, String fileName) throws IOException {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(60000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", UPDATE_UA);
            int code;
            try {
                code = conn.getResponseCode();
            } catch (IOException e) {
                conn.disconnect();
                throw e;
            }
            if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_SEE_OTHER || code == 307 || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) throw new IOException("跳转地址缺失");
                current = location.startsWith("http")
                    ? location
                    : new URL(new URL(current), location).toString();
                continue;
            }
            if (code != HttpURLConnection.HTTP_OK) {
                conn.disconnect();
                throw new IOException("服务器返回 HTTP " + code);
            }
            File target = new File(updateDir(), fileName);
            try {
                try (InputStream in = conn.getInputStream();
                     OutputStream out = new FileOutputStream(target)) {
                    copy(in, out);
                }
            } catch (IOException e) {
                if (target.exists() && !target.delete()) {
                    // 删不掉也继续抛，只是下次会覆盖写
                }
                throw e;
            } finally {
                conn.disconnect();
            }
            if (target.length() == 0) throw new IOException("下载内容为空");
            return target.getAbsolutePath();
        }
        throw new IOException("跳转次数过多，下载中止");
    }

    private void notifyUpdateResult(String requestId, boolean ok, String message) {
        if (webView == null) return;
        String js = "window.__weknoraUpdate && window.__weknoraUpdate("
            + jsString(requestId) + "," + (ok ? "true" : "false") + "," + jsString(message) + ")";
        webView.evaluateJavascript(js, null);
    }

    private void notifyInstallResult(String requestId, boolean ok, String message) {
        if (webView == null || requestId == null || requestId.isEmpty()) return;
        String js = "window.__weknoraInstall && window.__weknoraInstall("
            + jsString(requestId) + "," + (ok ? "true" : "false") + "," + jsString(message) + ")";
        webView.evaluateJavascript(js, null);
    }

    private void notifyDownloadResult(String requestId, boolean ok, String message) {
        if (webView == null) return;
        String js = "window.__weknoraDownload && window.__weknoraDownload("
            + jsString(requestId) + "," + (ok ? "true" : "false") + "," + jsString(message) + ")";
        webView.evaluateJavascript(js, null);
    }

    // 把任意字符串安全嵌入 JS 字面量（错误消息可能含引号/换行/路径）
    private static String jsString(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append("\"").toString();
    }

    // 根据当前明暗设置状态栏/导航栏背景色与图标颜色（深色→深背景+浅图标，浅色→浅背景+深图标）
    private void applySystemBarStyle() {
        int bgColor = isDark ? 0xFF121317 : 0xFFF6F7F9;
        // edge-to-edge 下状态栏/导航栏区域是 root_layout 的 padding 区，背景取自 root_layout
        findViewById(R.id.root_layout).setBackgroundColor(bgColor);
        getWindow().setStatusBarColor(bgColor);
        getWindow().setNavigationBarColor(bgColor);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(!isDark); // 浅色背景用深色图标
            controller.setAppearanceLightNavigationBars(!isDark);
        }
    }
}
