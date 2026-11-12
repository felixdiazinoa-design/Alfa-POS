package com.clicpos.app;

import android.Manifest;
import android.app.ActivityManager;
import android.os.BatteryManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.PowerManager;
import android.os.Process;
import android.os.StatFs;
import android.provider.Settings;
import android.util.Log;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.clicpos.cardnet.CardNetEcrPlugin;
import com.clicpos.customerdisplay.AndroidCustomerDisplayBridge;
import com.clicpos.nativeprinter.AndroidPrinterBridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int BLUETOOTH_PERMISSION_REQUEST = 2001;
    private static final String TAG = "CLICPOS_MAIN";
    private boolean activityRecreated;
    private volatile boolean keyboardOverlayMode;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        boolean launchedFromHistory = getIntent() != null
                && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        activityRecreated = savedInstanceState != null || launchedFromHistory;
        Log.i(TAG, "Launch context activityRecreated=" + activityRecreated
                + " savedState=" + (savedInstanceState != null)
                + " launchedFromHistory=" + launchedFromHistory);
        if (BuildConfig.POS_DIAGNOSTICS) registerPlugin(PosDiagnosticSink.class);
        // Transporte TCP del canal ECR de CardNET (terminal Ethernet en el puerto 7060).
        registerPlugin(CardNetEcrPlugin.class);
        super.onCreate(savedInstanceState);
        enforcePosWindowPolicy();

        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        if (BuildConfig.POS_DIAGNOSTICS) webView.addJavascriptInterface(new PosNativeDiagnostics(this), "POSDiagnostics");
        WebSettings settings = webView.getSettings();

        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMixedContentMode(BuildConfig.ALLOW_CLEARTEXT_WEBVIEW
                ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                : WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new AndroidPrinterBridge(getApplicationContext(), webView), "AndroidPrinter");
        AndroidPrinterBridge.injectContractShim(webView);
        webView.addJavascriptInterface(
                new AndroidCustomerDisplayBridge(this),
                "AndroidCustomerDisplay"
        );
        webView.addJavascriptInterface(new AndroidAppBridge(), "ClicPOSAppBridge");
        installPrimaryDisplaySurfaceGuard(webView);
        AndroidCustomerDisplayBridge.injectContractShim(webView);
        webView.setInitialScale(0);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        installWebViewRenderCrashGuard();

        ensureBluetoothPermissions();
    }

    @Override
    public void onResume() {
        super.onResume();
        enforcePosWindowPolicy();
    }

    private void enforcePosWindowPolicy() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        int softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
                | (keyboardOverlayMode
                        ? WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
                        : WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setSoftInputMode(softInputMode);
    }

    private void installWebViewRenderCrashGuard() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getBridge() == null) {
            return;
        }

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                boolean didCrash = detail != null && detail.didCrash();
                int priority = detail != null ? detail.rendererPriorityAtExit() : -1;
                Log.e(TAG, "WebView renderer gone. handled=true didCrash=" + didCrash + " priority=" + priority);

                runOnUiThread(() -> {
                    try {
                        if (webView != null) {
                            webView.stopLoading();
                        }
                    } catch (Exception ignored) {
                        // The renderer is already gone; best effort only.
                    }
                    recreate();
                });

                return true;
            }
        });
    }

    private void installPrimaryDisplaySurfaceGuard(WebView webView) {
        if (getBridge() == null) {
            return;
        }

        AndroidCustomerDisplayBridge.recoverPrimarySurface(webView);
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView loadedWebView) {
                AndroidCustomerDisplayBridge.recoverPrimarySurface(loadedWebView);
                AndroidCustomerDisplayBridge.injectContractShim(loadedWebView);
            }
        });
    }

    private class AndroidAppBridge {
        @JavascriptInterface
        public void setKeyboardOverlayMode(boolean enabled) {
            keyboardOverlayMode = enabled;
            runOnUiThread(() -> enforcePosWindowPolicy());
        }

        @JavascriptInterface
        public void recordStartupStage(String stage, int elapsedMs) {
            if (stage == null || !stage.matches("[A-Z_]{1,40}")
                    || elapsedMs < 0 || elapsedMs > 300000) {
                return;
            }
            // This release trace deliberately excludes URLs, payloads and identity data.
            Log.i("CLICPOS_BOOT", "stage=" + stage + " elapsedMs=" + elapsedMs);
        }

        @JavascriptInterface
        public String getLaunchContext() {
            return activityRecreated ? "activity_recreated" : "fresh_start";
        }

        /**
         * Identificador estable del dispositivo físico (Settings.Secure.ANDROID_ID).
         * Sobrevive a desinstalación/reinstalación para el mismo par (dispositivo,
         * llave de firma, usuario): es lo que permite reconocer que "es la misma caja"
         * y re-vincular sin pasar por reautorización manual.
         */
        @JavascriptInterface
        public String getStableDeviceId() {
            try {
                String androidId = Settings.Secure.getString(
                        getContentResolver(), Settings.Secure.ANDROID_ID);
                return androidId == null ? "" : androidId;
            } catch (Exception error) {
                Log.w(TAG, "Stable device id unavailable", error);
                return "";
            }
        }

        @JavascriptInterface
        public String getDiagnosticDeviceContext() {
            try {
                JSONObject result = new JSONObject();
                result.put("manufacturer", Build.MANUFACTURER);
                result.put("model", Build.MODEL);
                result.put("androidVersion", Build.VERSION.RELEASE);
                result.put("androidApi", Build.VERSION.SDK_INT);
                result.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : JSONObject.NULL);
                result.put("cpuCores", Runtime.getRuntime().availableProcessors());

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    PackageInfo webViewPackage = WebView.getCurrentWebViewPackage();
                    if (webViewPackage != null) {
                        result.put("webViewPackage", webViewPackage.packageName);
                        result.put("webViewVersion", webViewPackage.versionName);
                    }
                }

                DisplayMetrics display = getResources().getDisplayMetrics();
                result.put("widthPx", display.widthPixels);
                result.put("heightPx", display.heightPixels);
                result.put("densityDpi", display.densityDpi);
                if (getBridge() != null && getBridge().getWebView() != null
                        && getBridge().getWebView().getDisplay() != null) {
                    result.put("refreshRateHz", getBridge().getWebView().getDisplay().getRefreshRate());
                }

                ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (manager != null) {
                    result.put("memoryClassMb", manager.getMemoryClass());
                    result.put("largeMemoryClassMb", manager.getLargeMemoryClass());
                    ActivityManager.MemoryInfo systemMemory = new ActivityManager.MemoryInfo();
                    manager.getMemoryInfo(systemMemory);
                    result.put("systemMemoryTotalBytes", systemMemory.totalMem);
                }
                return result.toString();
            } catch (Exception error) {
                Log.w(TAG, "Diagnostic device context unavailable", error);
                return "{}";
            }
        }

        @JavascriptInterface
        public String getDiagnosticPerformanceSnapshot() {
            try {
                JSONObject result = new JSONObject();
                Runtime runtime = Runtime.getRuntime();
                result.put("javaHeapUsedBytes", runtime.totalMemory() - runtime.freeMemory());
                result.put("javaHeapMaxBytes", runtime.maxMemory());
                result.put("nativeHeapAllocatedBytes", Debug.getNativeHeapAllocatedSize());
                result.put("processCpuTimeMs", Process.getElapsedCpuTime());

                Debug.MemoryInfo processMemory = new Debug.MemoryInfo();
                Debug.getMemoryInfo(processMemory);
                result.put("appPssKb", processMemory.getTotalPss());

                ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (manager != null) {
                    ActivityManager.MemoryInfo systemMemory = new ActivityManager.MemoryInfo();
                    manager.getMemoryInfo(systemMemory);
                    result.put("systemAvailableBytes", systemMemory.availMem);
                    result.put("systemLowMemory", systemMemory.lowMemory);
                }

                StatFs storage = new StatFs(getFilesDir().getAbsolutePath());
                result.put("appStorageAvailableBytes", storage.getAvailableBytes());
                result.put("appStorageTotalBytes", storage.getTotalBytes());

                BatteryManager battery = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
                if (battery != null) {
                    int capacity = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    if (capacity >= 0) result.put("batteryPercent", capacity);
                }

                PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (power != null) {
                    result.put("powerSaveMode", power.isPowerSaveMode());
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        result.put("thermalStatus", power.getCurrentThermalStatus());
                    }
                }
                return result.toString();
            } catch (Exception error) {
                Log.w(TAG, "Diagnostic performance snapshot unavailable", error);
                return "{}";
            }
        }

        @JavascriptInterface
        public void showSoftKeyboard() {
            runOnUiThread(() -> {
                if (getBridge() == null || getBridge().getWebView() == null) {
                    return;
                }

                WebView webView = getBridge().getWebView();
                webView.requestFocus(View.FOCUS_DOWN);
                webView.post(() -> {
                    InputMethodManager inputMethodManager =
                            (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (inputMethodManager != null) {
                        inputMethodManager.restartInput(webView);
                        inputMethodManager.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowInsetsController controller = webView.getWindowInsetsController();
                        if (controller != null) {
                            controller.show(WindowInsets.Type.ime());
                        }
                    }
                });
            });
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        finishAndRemoveTask();
                    } else {
                        finish();
                    }
                } catch (Exception error) {
                    Log.e(TAG, "Failed to exit app from androidBridge", error);
                    finish();
                }
            });
        }
    }

    private void ensureBluetoothPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return;
        }

        String[] requiredPermissions = new String[] {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
        };

        List<String> missingPermissions = new ArrayList<>();
        for (String permission : requiredPermissions) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                missingPermissions.add(permission);
            }
        }

        if (!missingPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(
                    this,
                    missingPermissions.toArray(new String[0]),
                    BLUETOOTH_PERMISSION_REQUEST
            );
        }
    }
}
