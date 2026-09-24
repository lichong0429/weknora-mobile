package com.weknora.mobile;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    // 当前是否为深色（前端通过 JS 桥同步）
    private boolean isDark = false;
    // 下载专用单线程池：串行落盘，避免多个大文件同时占用带宽与存储写
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();

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
        @JavascriptInterface
        public void download(String method, String url, String bodyJson,
                             String fileName, String apiKey, String requestId) {
            if (requestId == null || requestId.isEmpty()) return;
            final String safeName = sanitizeFileName(fileName);
            downloadExecutor.execute(() -> {
                boolean ok;
                String message;
                try {
                    message = performDownload(method, url, bodyJson, safeName, apiKey);
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
    }

    // 下载请求体：加鉴权头，POST 时写 JSON body，200 才落盘（错误响应不生成残缺文件）
    private String performDownload(String method, String url, String bodyJson,
                                   String fileName, String apiKey) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(120000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("X-API-Key", apiKey == null ? "" : apiKey);
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
