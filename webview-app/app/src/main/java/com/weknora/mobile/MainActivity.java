package com.weknora.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    // 当前是否为深色（前端通过 JS 桥同步）
    private boolean isDark = false;

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
