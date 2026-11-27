package app.thimar.quran;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * نافذة الأذان الديناميكية: تُبنى كلها برمجيًا من نصوص وشعار وزخرفة،
 * بلا أي صورة ثابتة للصلاة، فتستحيل مشكلة «الصورة الفارغة».
 *
 * كل القيم (اسم الصلاة، الوقت، التاريخ الهجري والميلادي) تأتي من جدول
 * الصلاة ومن تاريخ الجهاز عبر {@link Data}. التصميم يتكيّف مع حجم الشاشة
 * وكثافتها والوضعين الطولي والعرضي واللغتين، ويُستخدم بنسختين:
 * كاملة لشاشة الصلاة، ومصغّرة للنافذة العائمة.
 */
public final class AdhanWindowView extends LinearLayout {
  public static final String LANG_AR = "ar";
  public static final String LANG_EN = "en";

  private static final int INK = Color.rgb(8, 18, 15);
  private static final int CREAM = Color.rgb(247, 241, 227);
  private static final int CREAM_SOFT = Color.argb(0xE0, 247, 241, 227);
  private static final int CREAM_MUTED = Color.argb(0xB0, 247, 241, 227);
  private static final int CREAM_FAINT = Color.argb(0x80, 247, 241, 227);
  private static final int GOLD = Color.rgb(231, 199, 132);
  private static final int STOP_RED = Color.rgb(159, 42, 42);

  /** أحداث الشاشة: الإغلاق والصوت، وفتح شاشة الصلاة من النافذة العائمة. */
  public interface Actions {
    void onClose();

    void onOpen();

    void onToggleAudio();

    void onStopAudio();

    void onVolume(float value);
  }

  /** بيانات الصلاة المعروضة — لا يُكتب فيها اسم أو وقت أو تاريخ ثابت. */
  public static final class Data {
    public String prayer = "fajr";
    public String name = "";
    public String time = "";
    public String lang = LANG_AR;
    public String theme = "light";
    public String city = "";
    public boolean sound = false;
  }

  /* ألوان النص تتغيّر مع الوضع الفاتح/الداكن، وتُضبط في rebuild. */
  private int textStrong = CREAM;
  private int textMuted = CREAM_MUTED;
  private int textFaint = CREAM_FAINT;
  private int textSoft = CREAM_SOFT;
  private int titleColor = GOLD;
  private int kickerColor = GOLD;
  private int headerColor = GOLD;
  private int logoSurface = Color.rgb(11, 26, 22);
  private boolean light;

  private Data data = new Data();
  private Actions actions;
  private boolean compact;
  private boolean paused;
  private int volume = 90;
  private String hint = "";

  private View dragHandle;
  private ImageButton toggleButton;
  private View controlsRow;
  private SeekBar volumeBar;
  private TextView hintView;

  public AdhanWindowView(Context context) {
    super(context);
    setOrientation(VERTICAL);
  }

  public void setActions(Actions actions) {
    this.actions = actions;
  }

  /** يعيد بناء النافذة بالبيانات الحالية (يُستدعى أيضًا بعد تدوير الشاشة). */
  public void bind(Data next, boolean compact) {
    this.data = next == null ? new Data() : next;
    this.compact = compact;
    rebuild();
  }

  public void setPaused(boolean paused) {
    this.paused = paused;
    if (toggleButton != null) {
      toggleButton.setImageResource(paused ? R.drawable.ic_adhan_play : R.drawable.ic_adhan_pause);
      toggleButton.setContentDescription(getContext().getString(
          paused ? R.string.adhan_resume : R.string.adhan_pause));
    }
  }

  public void setVolumeValue(int value) {
    this.volume = Math.max(0, Math.min(100, value));
    if (volumeBar != null) volumeBar.setProgress(this.volume);
  }

  public void setHint(String text) {
    this.hint = text == null ? "" : text;
    if (hintView != null) {
      hintView.setText(this.hint);
      hintView.setVisibility(this.hint.isEmpty() ? GONE : VISIBLE);
    }
  }

  /** مقبض السحب للنافذة العائمة (ترويسة البطاقة). */
  public View getDragHandle() {
    return dragHandle;
  }

  // ---------------------------------------------------------------- bind

  private void rebuild() {
    removeAllViews();
    setOrientation(VERTICAL);
    boolean english = LANG_EN.equalsIgnoreCase(data.lang);
    boolean landscape = !compact
        && getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
    int accent = accentColor(data.prayer, isFriday());
    int deep = deepColor(data.prayer, isFriday());
    light = lightTheme(getContext(), data.theme);

    if (light) {
      textStrong = Color.rgb(31, 58, 50);
      textMuted = Color.rgb(107, 97, 82);
      textFaint = Color.rgb(138, 125, 105);
      textSoft = Color.rgb(62, 56, 45);
      titleColor = blend(accent, Color.BLACK, 0.42f);
      kickerColor = blend(accent, Color.BLACK, 0.32f);
      headerColor = Color.rgb(15, 95, 78);
      logoSurface = Color.rgb(252, 249, 241);
      setBackground(panelBackground(titleColor,
          blend(accent, 0xFFFFFFFF, 0.86f), 0xFFFBF7EF));
    } else {
      textStrong = CREAM;
      textMuted = CREAM_MUTED;
      textFaint = CREAM_FAINT;
      textSoft = CREAM_SOFT;
      titleColor = accent;
      kickerColor = withAlpha(accent, 0xD9);
      headerColor = accent;
      logoSurface = Color.rgb(11, 26, 22);
      setBackground(panelBackground(accent, blend(deep, INK, 0.42f), INK));
    }
    setElevation(dp(compact ? 10 : 0));
    int pad = compact ? dp(14) : dp(18);
    setPadding(pad, dp(compact ? 12 : 16), pad, dp(compact ? 12 : 16));

    dragHandle = buildHeader(accent, english);
    addView(dragHandle, matchWrap());
    if (!compact) addView(buildOrnament(accent), centeredWrap(0, 8, 0, 2));

    LinearLayout body = new LinearLayout(getContext());
    body.setOrientation(landscape ? HORIZONTAL : VERTICAL);
    body.setGravity(landscape ? Gravity.CENTER_VERTICAL : Gravity.CENTER_HORIZONTAL);

    LinearLayout.LayoutParams identityParams = landscape
        ? new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 0.46f)
        : matchWrap();
    LinearLayout.LayoutParams metaParams = landscape
        ? new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 0.54f)
        : matchWrap();
    if (landscape) {
      identityParams.setMarginEnd(dp(18));
    } else {
      metaParams.topMargin = dp(compact ? 8 : 14);
    }

    body.addView(buildIdentity(accent, english), identityParams);
    body.addView(buildMeta(accent, english, landscape), metaParams);
    addView(body, matchWrap());

    if (!compact) {
      controlsRow = buildControls(accent);
      controlsRow.setVisibility(data.sound ? VISIBLE : GONE);
      addView(controlsRow, matchWrap());

      hintView = label(data.sound
          ? hint
          : (english ? "Tap close to return" : "اضغط زر الإغلاق للعودة"),
          compact ? 10 : 11, textFaint, false);
      hintView.setGravity(Gravity.CENTER);
      hintView.setPadding(0, dp(10), 0, 0);
      addView(hintView, matchWrap());
    }

    if (compact) {
      setOnClickListener(view -> {
        if (actions != null) actions.onOpen();
      });
      setContentDescription(english
          ? (displayName(data.prayer, true) + " prayer time — tap to open Thimar")
          : ("نافذة صلاة " + displayName(data.prayer, false) + " — اضغط لفتح ثمار"));
    }
    setPaused(paused);
  }

  private LinearLayout buildHeader(int accent, boolean english) {
    LinearLayout header = new LinearLayout(getContext());
    header.setOrientation(HORIZONTAL);
    header.setGravity(Gravity.CENTER_VERTICAL);

    ImageView logo = new ImageView(getContext());
    logo.setImageResource(R.mipmap.ic_launcher);
    logo.setContentDescription(getContext().getString(R.string.app_name));
    logo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    logo.setClipToOutline(true);
    GradientDrawable logoBackground = new GradientDrawable();
    logoBackground.setShape(GradientDrawable.OVAL);
    logoBackground.setColor(logoSurface);
    logoBackground.setStroke(dp(1), withAlpha(light ? headerColor : accent, 0x66));
    logo.setBackground(logoBackground);
    int logoSize = compact ? dp(30) : dp(42);
    header.addView(logo, new LinearLayout.LayoutParams(logoSize, logoSize));

    LinearLayout titles = new LinearLayout(getContext());
    titles.setOrientation(VERTICAL);
    titles.setPadding(dp(10), 0, 0, 0);
    TextView app = label(getContext().getString(R.string.app_name), compact ? 13 : 16, headerColor, true);
    TextView sub = label(english ? "Adhan — prayer time" : "أذان — وقت الصلاة",
        compact ? 9 : 11, textMuted, false);
    titles.addView(app, matchWrap());
    titles.addView(sub, matchWrap());
    header.addView(titles, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

    ImageButton close = new ImageButton(getContext());
    close.setImageResource(R.drawable.ic_adhan_close);
    close.setBackgroundResource(R.drawable.adhan_circle_button);
    close.setColorFilter(light ? headerColor : CREAM);
    close.setContentDescription(getContext().getString(R.string.adhan_close));
    int closeSize = compact ? dp(34) : dp(44);
    int closePad = compact ? dp(8) : dp(12);
    close.setPadding(closePad, closePad, closePad, closePad);
    close.setOnClickListener(view -> {
      if (actions != null) actions.onClose();
    });
    header.addView(close, new LinearLayout.LayoutParams(closeSize, closeSize));
    return header;
  }

  private View buildOrnament(int accent) {
    ImageView ornament = new ImageView(getContext());
    ornament.setImageResource(R.drawable.adhan_ornament);
    ornament.setColorFilter(light ? kickerColor : accent);
    ornament.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(150), dp(16));
    params.gravity = Gravity.CENTER_HORIZONTAL;
    ornament.setLayoutParams(params);
    return ornament;
  }

  private LinearLayout buildIdentity(int accent, boolean english) {
    LinearLayout block = new LinearLayout(getContext());
    block.setOrientation(VERTICAL);
    block.setGravity(Gravity.CENTER_HORIZONTAL);

    TextView takbir = label("الله أكبر", compact ? 14 : 20, withAlpha(titleColor, 0xEB), false);
    takbir.setTypeface(Typeface.create(Typeface.SERIF, Typeface.NORMAL));
    takbir.setGravity(Gravity.CENTER);
    block.addView(takbir, matchWrap());

    TextView title = label(displayName(data.prayer, false), compact ? 24 : 44, titleColor, true);
    title.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
    title.setGravity(Gravity.CENTER);
    title.setLineSpacing(0, 1.05f);
    if (!compact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      title.setAutoSizeTextTypeUniformWithConfiguration(28, 58, 2, TypedValue.COMPLEX_UNIT_SP);
    }
    block.addView(title, matchWrap());

    /* الاسم بالعربية والإنجليزية معًا في كل اللغات، كما هو مطلوب في نافذة الأذان. */
    TextView englishName = label(displayName(data.prayer, true), compact ? 11 : 15, textMuted, true);
    englishName.setGravity(Gravity.CENTER);
    englishName.setLetterSpacing(0.2f);
    englishName.setAllCaps(true);
    block.addView(englishName, matchWrap());

    TextView time = label(displayTime(), compact ? 30 : 72, textStrong, false);
    time.setGravity(Gravity.CENTER);
    time.setTextDirection(View.TEXT_DIRECTION_LTR);
    time.setLetterSpacing(0.04f);
    time.setFontFeatureSettings("tnum");
    time.setPadding(0, dp(compact ? 1 : 2), 0, 0);
    if (!compact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      time.setAutoSizeTextTypeUniformWithConfiguration(42, 92, 2, TypedValue.COMPLEX_UNIT_SP);
    }
    block.addView(time, matchWrap());

    TextView kicker = label(english ? "It is time for prayer" : "حان وقت الصلاة",
        compact ? 9 : 12, kickerColor, true);
    kicker.setGravity(Gravity.CENTER);
    kicker.setLetterSpacing(0.1f);
    kicker.setPadding(0, dp(2), 0, 0);
    block.addView(kicker, matchWrap());
    return block;
  }

  private LinearLayout buildMeta(int accent, boolean english, boolean landscape) {
    LinearLayout meta = new LinearLayout(getContext());
    meta.setOrientation(VERTICAL);
    meta.setGravity(Gravity.CENTER_HORIZONTAL);
    meta.setPadding(0, compact ? 0 : dp(10), 0, 0);

    String hijri = hijriDate(data.lang);
    if (!TextUtils.isEmpty(hijri)) {
      TextView hijriView = label(hijri, compact ? 11 : 15, withAlpha(titleColor, 0xEB), true);
      hijriView.setGravity(Gravity.CENTER);
      meta.addView(hijriView, matchWrap());
    }

    TextView gregorian = label(gregorianDate(data.lang), compact ? 9 : 12, textMuted, false);
    gregorian.setGravity(Gravity.CENTER);
    gregorian.setPadding(0, dp(2), 0, 0);
    meta.addView(gregorian, matchWrap());

    if (!TextUtils.isEmpty(data.city)) {
      TextView city = label(data.city, compact ? 9 : 11, textFaint, false);
      city.setGravity(Gravity.CENTER);
      meta.addView(city, matchWrap());
    }

    TextView greeting = label(greeting(data.prayer, english), compact ? 11 : 15, textSoft, false);
    greeting.setGravity(Gravity.CENTER);
    greeting.setLineSpacing(dp(3), 1f);
    greeting.setMaxLines(compact ? 2 : 4);
    greeting.setEllipsize(TextUtils.TruncateAt.END);
    greeting.setPadding(dp(4), dp(compact ? 5 : 10), dp(4), 0);
    meta.addView(greeting, matchWrap());
    return meta;
  }

  private LinearLayout buildControls(int accent) {
    LinearLayout row = new LinearLayout(getContext());
    row.setOrientation(HORIZONTAL);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(0, dp(14), 0, 0);

    toggleButton = new ImageButton(getContext());
    toggleButton.setImageResource(R.drawable.ic_adhan_pause);
    toggleButton.setBackgroundResource(R.drawable.adhan_gold_button);
    toggleButton.setColorFilter(INK);
    toggleButton.setPadding(dp(15), dp(15), dp(15), dp(15));
    toggleButton.setContentDescription(getContext().getString(R.string.adhan_pause));
    toggleButton.setOnClickListener(view -> {
      if (actions != null) actions.onToggleAudio();
    });
    int controlSize = dp(54);
    row.addView(toggleButton, new LinearLayout.LayoutParams(controlSize, controlSize));

    LinearLayout volumeColumn = new LinearLayout(getContext());
    volumeColumn.setOrientation(VERTICAL);
    volumeColumn.setPadding(dp(14), 0, dp(12), 0);
    TextView volumeLabel = label(getContext().getString(R.string.adhan_volume), 11, textMuted, false);
    volumeColumn.addView(volumeLabel, matchWrap());
    SeekBar bar = new SeekBar(getContext());
    volumeBar = bar;
    bar.setMax(100);
    bar.setProgress(volume);
    bar.setPadding(0, 0, 0, 0);
    bar.setProgressTintList(android.content.res.ColorStateList.valueOf(accent));
    bar.setThumbTintList(android.content.res.ColorStateList.valueOf(accent));
    bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override
      public void onProgressChanged(SeekBar seekBar, int value, boolean fromUser) {
        if (!fromUser) return;
        volume = value;
        if (actions != null) actions.onVolume(value / 100f);
      }

      @Override
      public void onStartTrackingTouch(SeekBar seekBar) {
      }

      @Override
      public void onStopTrackingTouch(SeekBar seekBar) {
      }
    });
    volumeColumn.addView(bar, matchWrap());
    row.addView(volumeColumn, new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

    Button stop = new Button(getContext());
    stop.setText(getContext().getString(R.string.adhan_stop));
    stop.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
    stop.setAllCaps(false);
    stop.setTextColor(CREAM);
    stop.setBackgroundTintList(android.content.res.ColorStateList.valueOf(STOP_RED));
    stop.setMinWidth(0);
    stop.setMinimumWidth(0);
    stop.setPadding(dp(16), 0, dp(16), 0);
    stop.setOnClickListener(view -> {
      if (actions != null) actions.onStopAudio();
    });
    row.addView(stop, new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, dp(46)));
    return row;
  }

  // ------------------------------------------------------------- styling

  private GradientDrawable panelBackground(int stroke, int startColor, int endColor) {
    GradientDrawable background = new GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        new int[] { startColor, endColor });
    background.setCornerRadius(dp(compact ? 20 : 26));
    background.setStroke(dp(1), withAlpha(stroke, compact ? 0x7A : 0x59));
    return background;
  }

  /** يحدد الوضع الفاتح من إعداد الثيم القادم من ثمار، أو من وضع ليل الجهاز. */
  public static boolean lightTheme(Context context, String theme) {
    if ("dark".equalsIgnoreCase(theme)) return false;
    if ("light".equalsIgnoreCase(theme) || "sepia".equalsIgnoreCase(theme)) return true;
    int mode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
    return mode != Configuration.UI_MODE_NIGHT_YES;
  }

  /** ألوان خلفية الشاشة الكاملة حسب الثيم والوقت. */
  public static int[] windowColors(String prayer, boolean friday, boolean light) {
    int accent = accentColor(prayer, friday);
    if (light) return new int[] { blend(accent, 0xFFFCF8EF, 0.8f), 0xFFFAF7F1 };
    return new int[] { deepColor(prayer, friday), 0xFF08120F };
  }

  private TextView label(String text, int sizeSp, int color, boolean bold) {
    TextView view = new TextView(getContext());
    view.setText(text == null ? "" : text);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
    view.setTextColor(color);
    view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
    view.setIncludeFontPadding(true);
    return view;
  }

  private LinearLayout.LayoutParams matchWrap() {
    return new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
  }

  private LinearLayout.LayoutParams centeredWrap(int start, int top, int end, int bottom) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
        LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
    params.gravity = Gravity.CENTER_HORIZONTAL;
    params.setMargins(dp(start), dp(top), dp(end), dp(bottom));
    return params;
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }

  private static int withAlpha(int color, int alpha) {
    return (color & 0x00FFFFFF) | ((alpha & 0xFF) << 24);
  }

  private static int blend(int from, int to, float ratio) {
    float clamped = Math.max(0f, Math.min(1f, ratio));
    int red = Math.round(Color.red(from) * (1f - clamped) + Color.red(to) * clamped);
    int green = Math.round(Color.green(from) * (1f - clamped) + Color.green(to) * clamped);
    int blue = Math.round(Color.blue(from) * (1f - clamped) + Color.blue(to) * clamped);
    return Color.rgb(red, green, blue);
  }

  // ---------------------------------------------------------------- data

  public static boolean isFriday() {
    return Calendar.getInstance().get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY;
  }

  public static String normalizePrayer(String prayer) {
    String key = prayer == null ? "" : prayer.trim().toLowerCase(Locale.US);
    if ("fajr".equals(key) || "dhuhr".equals(key) || "asr".equals(key)
        || "maghrib".equals(key) || "isha".equals(key)) {
      return key;
    }
    return "fajr";
  }

  /** اسم الصلاة: الجمعة تحل محل الظهر يوم الجمعة مع الحفاظ على الوقت نفسه. */
  public static String displayName(String prayer, boolean english) {
    String key = normalizePrayer(prayer);
    if ("dhuhr".equals(key) && isFriday()) {
      return english ? "Jumu'ah" : "الجمعة";
    }
    switch (key) {
      case "dhuhr":
        return english ? "Dhuhr" : "الظهر";
      case "asr":
        return english ? "Asr" : "العصر";
      case "maghrib":
        return english ? "Maghrib" : "المغرب";
      case "isha":
        return english ? "Isha" : "العشاء";
      default:
        return english ? "Fajr" : "الفجر";
    }
  }

  public static int accentColor(String prayer, boolean friday) {
    String key = normalizePrayer(prayer);
    if ("dhuhr".equals(key) && friday) return Color.rgb(168, 224, 184);
    switch (key) {
      case "dhuhr":
        return Color.rgb(143, 217, 192);
      case "asr":
        return Color.rgb(232, 183, 112);
      case "maghrib":
        return Color.rgb(232, 160, 122);
      case "isha":
        return Color.rgb(191, 182, 232);
      default:
        return GOLD;
    }
  }

  public static int deepColor(String prayer, boolean friday) {
    String key = normalizePrayer(prayer);
    if ("dhuhr".equals(key) && friday) return Color.rgb(11, 51, 39);
    switch (key) {
      case "dhuhr":
        return Color.rgb(14, 58, 46);
      case "asr":
        return Color.rgb(58, 42, 20);
      case "maghrib":
        return Color.rgb(58, 30, 34);
      case "isha":
        return Color.rgb(29, 27, 51);
      default:
        return Color.rgb(19, 34, 56);
    }
  }

  public static String greeting(String prayer, boolean english) {
    String key = normalizePrayer(prayer);
    if ("dhuhr".equals(key) && isFriday()) {
      return english
          ? "Blessed Friday — an hour of light and blessing, may your Jumu'ah be accepted"
          : "جمعة مباركة — ساعة نور وبركة، تقبّل الله جمعتكم";
    }
    switch (key) {
      case "dhuhr":
        return english
            ? "Pause the world for a moment — your prayer is a calm that reorders your day"
            : "توقّف عن الدنيا لحظة… لصلاتك سكينة تعيد ترتيب يومك";
      case "asr":
        return english
            ? "Guard the Asr prayer — the one who abandons it loses the reward of his deeds"
            : "حافظ على العصر… فهي صلاة من تركها حبط عمله";
      case "maghrib":
        return english
            ? "A moment of sunset — sins fade with the supplication of Maghrib"
            : "لحظة غروب… ذنوب تغيب مع دعاء المغرب";
      case "isha":
        return english
            ? "Close your day with Isha — and begin your night at peace"
            : "اختم يومك بالعشاء… وابدأ ليلك مطمئنًا";
      default:
        return english
            ? "Blessed are those who rise early — Fajr is the light that begins your day"
            : "بورك فيمن بكّر — صلاة الفجر نور يبدأ به يومك";
    }
  }

  private String displayTime() {
    String shown = data.time == null ? "" : data.time.trim();
    if (shown.isEmpty()) shown = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
    return shown;
  }

  /** تاريخ هجري (أم القرى) من تقويم المنصة — متاح من أندرويد 7، وإلا يُخفى السطر. */
  public static String hijriDate(String lang) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return "";
    try {
      android.icu.util.IslamicCalendar calendar = new android.icu.util.IslamicCalendar();
      calendar.setCalculationType(android.icu.util.IslamicCalendar.CalculationType.ISLAMIC_UMALQURA);
      calendar.setTimeInMillis(System.currentTimeMillis());
      String language = LANG_EN.equalsIgnoreCase(lang) ? "en" : "ar";
      android.icu.text.SimpleDateFormat format = new android.icu.text.SimpleDateFormat(
          "d MMMM yyyy", android.icu.util.ULocale.forLanguageTag(language));
      /* ضروري: SimpleDateFormat يستخدم التقويم الميلادي افتراضيًا، فنربطه بالهجري. */
      format.setCalendar(calendar);
      String suffix = LANG_EN.equalsIgnoreCase(lang) ? " AH" : " هـ";
      return format.format(calendar.getTime()) + suffix;
    } catch (Throwable error) {
      return "";
    }
  }

  /** التاريخ الميلادي من تاريخ الجهاز بلغة الواجهة. */
  public static String gregorianDate(String lang) {
    Locale locale = LANG_EN.equalsIgnoreCase(lang) ? Locale.UK : new Locale("ar");
    String pattern = LANG_EN.equalsIgnoreCase(lang) ? "EEEE, d MMMM yyyy" : "EEEE، d MMMM yyyy";
    try {
      return new SimpleDateFormat(pattern, locale).format(new Date());
    } catch (Exception error) {
      return "";
    }
  }
}
