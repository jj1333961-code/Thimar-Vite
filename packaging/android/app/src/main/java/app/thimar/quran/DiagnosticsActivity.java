package app.thimar.quran;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** شاشة تشخيص: تعرض سجل الإقلاع كاملًا مع نسخه ومشاركته. */
public class DiagnosticsActivity extends Activity {
  private TextView output;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) (16 * getResources().getDisplayMetrics().density);
    layout.setPadding(pad, pad, pad, pad);
    layout.setBackgroundColor(0xFFFAF7F1);

    TextView title = new TextView(this);
    title.setText("تشخيص تشغيل ثمار");
    title.setTextSize(20);
    title.setTextColor(0xFF0F5F4E);
    layout.addView(title);

    output = new TextView(this);
    output.setTextSize(11);
    output.setTextIsSelectable(true);
    output.setTypeface(android.graphics.Typeface.MONOSPACE);
    output.setText(LaunchLog.read(this));

    ScrollView scroll = new ScrollView(this);
    scroll.addView(output);
    layout.addView(scroll, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

    LinearLayout actions = new LinearLayout(this);
    actions.setOrientation(LinearLayout.HORIZONTAL);

    Button refresh = new Button(this);
    refresh.setText("تحديث");
    refresh.setOnClickListener(v -> output.setText(LaunchLog.read(this)));
    actions.addView(refresh);

    Button copy = new Button(this);
    copy.setText("نسخ");
    copy.setOnClickListener(v -> {
      ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
      clipboard.setPrimaryClip(ClipData.newPlainText("thimar-log", LaunchLog.read(this)));
      Toast.makeText(this, "تم نسخ السجل", Toast.LENGTH_SHORT).show();
    });
    actions.addView(copy);

    Button share = new Button(this);
    share.setText("مشاركة");
    share.setOnClickListener(v -> {
      Intent intent = new Intent(Intent.ACTION_SEND);
      intent.setType("text/plain");
      intent.putExtra(Intent.EXTRA_SUBJECT, "سجل تشخيص ثمار");
      intent.putExtra(Intent.EXTRA_TEXT, LaunchLog.read(this));
      startActivity(Intent.createChooser(intent, "مشاركة السجل"));
    });
    actions.addView(share);

    Button clear = new Button(this);
    clear.setText("مسح");
    clear.setOnClickListener(v -> {
      LaunchLog.clear(this);
      output.setText(LaunchLog.read(this));
    });
    actions.addView(clear);

    layout.addView(actions);
    setContentView(layout);
  }
}
