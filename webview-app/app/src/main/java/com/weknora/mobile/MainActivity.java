package com.weknora.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

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
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("file:///android_asset/web/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
