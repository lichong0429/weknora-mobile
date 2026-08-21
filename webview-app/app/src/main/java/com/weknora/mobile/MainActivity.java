package com.weknora.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

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

    @Override
    public void onBackPressed() {
        // 优先让前端处理返回（如关闭全屏预览/弹层）：前端注册 window.__wbOnBack
        // 返回 true 表示已消费本次返回；否则走 WebView 历史；再退则退出应用。
        if (webView != null) {
            webView.evaluateJavascript(
                "(typeof window.__wbOnBack === 'function') ? (window.__wbOnBack() === true ? 'true' : 'false') : 'false'",
                value -> {
                    String v = value == null ? "" : value.replace("\"", "").trim();
                    if ("true".equals(v)) return; // 前端已处理（如关闭全屏）
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                }
            );
        } else {
            super.onBackPressed();
        }
    }
}
