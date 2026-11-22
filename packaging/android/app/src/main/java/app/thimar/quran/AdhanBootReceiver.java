package app.thimar.quran;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AdhanBootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String action = intent.getAction();
    if (Intent.ACTION_BOOT_COMPLETED.equals(action)
        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        || "android.intent.action.TIMEZONE_CHANGED".equals(action)
        || "android.intent.action.TIME_SET".equals(action)) {
      AdhanScheduler.scheduleAll(context);
    }
  }
}
