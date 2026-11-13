package ru.plansfortwo.widget;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private LinearLayout body;
    private TextView status, opacityLabel;
    private ImageView preview;
    private SharedPreferences prefs;
    private Button bg1Button,bg2Button,textButton,iconButton;
    private Spinner bgMode,direction;
    private boolean ready = false;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        prefs=Api.prefs(this);
        ScrollView sc=new ScrollView(this);sc.setFillViewport(true);
        sc.setBackgroundColor(Color.rgb(18,23,39));
        body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(18),dp(24),dp(18),dp(44));
        sc.addView(body);setContentView(sc);
        title("♥  Планы на двоих",26);
        note("Android-виджет для пары. Выбери оформление, привяжи Telegram и размести виджет на главном экране.");
        section("Подключение");
        status=note("");
        button("Привязать Telegram",v->connect());
        button("Проверить привязку и обновить",v->refresh(true));
        note("Привязка подтверждается командой боту в установленном Telegram. Данные пары недоступны без подтверждения.");
        section("Предпросмотр");
        preview=new ImageView(this);
        LinearLayout.LayoutParams prev=new LinearLayout.LayoutParams(-1,dp(215));
        prev.setMargins(0,dp(8),0,dp(12));
        body.addView(preview,prev);
        section("Фон виджета");
        note("Выбери тип заливки и собственные цвета. Прозрачность применяется только к фону.");
        bgMode=spinner(new String[]{"Градиент","Сплошной цвет"},prefs.getBoolean("gradient",true)?0:1);
        bgMode.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            @Override public void onItemSelected(android.widget.AdapterView<?> p,View v,int index,long l){if(ready) save("gradient",index==0);}
            @Override public void onNothingSelected(android.widget.AdapterView<?> p){}
        });
        bg1Button=button("Первый цвет",v->chooseColor("bg1","Первый / сплошной цвет"));
        bg2Button=button("Второй цвет",v->chooseColor("bg2","Второй цвет градиента"));
        button("🎲 Случайные цвета градиента",v->randomColors());
        section("Направление градиента");
        direction=spinner(new String[]{"Слева направо →","Сверху вниз ↓","Справа налево ←","Снизу вверх ↑","↘ По диагонали","↙ По диагонали","↖ По диагонали","↗ По диагонали"},
            directionIndex(prefs.getInt("direction",0)));
        direction.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            @Override public void onItemSelected(android.widget.AdapterView<?> p,View v,int index,long l){if(ready) save("direction",angles[index]);}
            @Override public void onNothingSelected(android.widget.AdapterView<?> p){}
        });
        button("🎲 Случайное направление",v->{
            int i=new SecureRandom().nextInt(angles.length);
            direction.setSelection(i);save("direction",angles[i]);
        });
        section("Прозрачность");
        opacityLabel=note("");
        SeekBar alpha=new SeekBar(this);alpha.setMax(100);alpha.setProgress(prefs.getInt("alpha",90));body.addView(alpha);
        alpha.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            @Override public void onProgressChanged(SeekBar b,int value,boolean user){
                opacityLabel.setText("Непрозрачность: "+value+"% · прозрачность: "+(100-value)+"%");
                if(user)save("alpha",value);
            }
            @Override public void onStartTrackingTouch(SeekBar b){}
            @Override public void onStopTrackingTouch(SeekBar b){}
        });
        opacityLabel.setText("Непрозрачность: "+alpha.getProgress()+"% · прозрачность: "+(100-alpha.getProgress())+"%");
        section("Текст и значки");
        textButton=button("Цвет текста",v->chooseColor("text","Цвет текста"));
        iconButton=button("Цвет значков",v->chooseColor("icon","Цвет значков"));
        section("Обновление");
        note("Автоматическое получение данных: не чаще одного раза в 24 часа. Android может задерживать обновления при энергосбережении. Кнопка проверки выше запускает обновление вручную.");
        section("Размеры One UI 9");
        note("Добавь виджет «Планы на двоих» на рабочий стол и измени его размер: 1×2, 1×3, 1×4, 2×2, 2×3, 2×4, 3×3, 3×4 или 4×4 (высота × ширина). Содержимое перестраивается автоматически.");
        note("Нажатия на даты открывают только установленный Telegram, без браузера. Если Telegram не установлен, открываются настройки приложения.");
        ready=true;updateButtons();updateStatus();redraw();
    }
    private int dp(float v){return Math.round(v*getResources().getDisplayMetrics().density);}
    private void section(String t){
        TextView x=label(t,19,Color.rgb(255,174,196));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(20),0,dp(8));body.addView(x,p);
    }
    private TextView title(String s,int size){TextView v=label(s,size,Color.WHITE);body.addView(v);return v;}
    private TextView note(String s){
        TextView v=label(s,14,Color.rgb(198,207,228));v.setLineSpacing(dp(2),1f);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.setMargins(0,dp(5),0,dp(7));body.addView(v,lp);
        return v;
    }
    private TextView label(String s,int size,int color){
        TextView v=new TextView(this);v.setText(s);v.setTextSize(size);v.setTextColor(color);return v;
    }
    private Button button(String s,View.OnClickListener click){
        Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setTextColor(Color.WHITE);
        b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(57,67,101)));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(51));lp.setMargins(0,dp(5),0,dp(5));
        body.addView(b,lp);b.setOnClickListener(click);return b;
    }
    private Spinner spinner(String[] labels,int selected){
        Spinner s=new Spinner(this);
        ArrayAdapter<String> a=new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels);
        s.setAdapter(a);s.setSelection(selected);s.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(255,175,200)));
        body.addView(s,new LinearLayout.LayoutParams(-1,dp(54)));return s;
    }
    private static final int[] angles={0,90,180,270,45,135,225,315};
    private int directionIndex(int value){for(int i=0;i<angles.length;i++)if(angles[i]==value)return i;return 0;}
    private void save(String key,boolean val){prefs.edit().putBoolean(key,val).apply();redraw();}
    private void save(String key,int val){prefs.edit().putInt(key,val).apply();redraw();}
    private void redraw(){
        if(!ready)return;
        JSONObject d;try{d=new JSONObject(prefs.getString("snapshot","{}"));}catch(Exception e){d=new JSONObject();}
        preview.setImageBitmap(WidgetArt.draw(this,prefs,d,330,202,"vert3"));
        CoupleWidget.redrawAll(this);
    }
    private void updateButtons(){
        if(bg1Button==null)return;
        bg1Button.setText("Первый / сплошной цвет: "+prefs.getString("bg1","#683470"));
        bg2Button.setText("Второй цвет: "+prefs.getString("bg2","#304F8D"));
        textButton.setText("Цвет текста: "+prefs.getString("text","#FFFFFF"));
        iconButton.setText("Цвет значков: "+prefs.getString("icon","#FF9ABA"));
    }
    private void chooseColor(String key,String heading){
        EditText field=new EditText(this);
        field.setSingleLine(true);field.setText(prefs.getString(key,defaults(key)));
        field.setSelectAllOnFocus(true);
        LinearLayout container=new LinearLayout(this);container.setPadding(dp(22),dp(6),dp(22),0);container.addView(field);
        new AlertDialog.Builder(this).setTitle(heading).setMessage("Введи HEX-цвет в формате #RRGGBB")
            .setView(container).setNegativeButton("Отмена",null).setPositiveButton("Применить",(d,which)->{
                String v=field.getText().toString().trim();
                if(!v.matches("#[0-9a-fA-F]{6}")){toast("Нужен цвет формата #RRGGBB");return;}
                prefs.edit().putString(key,v.toUpperCase(Locale.ROOT)).apply();updateButtons();redraw();
            }).show();
    }
    private String defaults(String key){
        if(key.equals("bg1"))return "#683470";if(key.equals("bg2"))return "#304F8D";
        return key.equals("icon")?"#FF9ABA":"#FFFFFF";
    }
    private void randomColors(){
        SecureRandom r=new SecureRandom();
        prefs.edit().putString("bg1",String.format(Locale.ROOT,"#%06X",randomColor(r)))
            .putString("bg2",String.format(Locale.ROOT,"#%06X",randomColor(r))).putBoolean("gradient",true).apply();
        bgMode.setSelection(0);updateButtons();redraw();
    }
    private int randomColor(SecureRandom r){
        int red=40+r.nextInt(170),green=30+r.nextInt(150),blue=70+r.nextInt(170);
        return Color.rgb(red,green,Math.min(255,blue))&0xFFFFFF;
    }
    private void updateStatus(){
        String token=prefs.getString("token","");
        String snap=prefs.getString("snapshot","");
        if(token.isEmpty()){status.setText("Не подключено. Для получения дат нужна привязка к боту.");return;}
        if(snap.isEmpty()){status.setText("Код создан. Открой Telegram, нажми «Запустить», затем вернись и нажми «Проверить привязку».");return;}
        long when=prefs.getLong("last_auto",0);
        String d=when==0?"неизвестно":new SimpleDateFormat("dd.MM.yyyy HH:mm",Locale.getDefault()).format(new Date(when));
        status.setText("Подключено. Данные обновлены: "+d);
    }
    private void connect(){
        if(CoupleWidget.telegramPackage(this)==null){toast("Не найдено приложение Telegram. Привязка через браузер отключена.");return;}
        String code=Api.randomHex(24),token=Api.randomHex(32);
        status.setText("Создаю защищённую привязку…");
        new Thread(()->{
            try {
                JSONObject ans=Api.register(code,token);
                if(!"pending".equals(ans.optString("status")))throw new Exception("Неверный ответ сервера");
                prefs.edit().putString("token",token).putString("code",code).remove("snapshot").remove("last_auto").apply();
                runOnUiThread(()->{
                    updateStatus();redraw();
                    Intent telegram=CoupleWidget.telegramIntent(this,"w_"+code);
                    if(telegram!=null)startActivity(telegram);else toast("Не удалось открыть установленный Telegram");
                });
            }catch(Exception e){runOnUiThread(()->{status.setText("Ошибка привязки: "+e.getMessage());toast(e.getMessage());});}
        },"widget-register").start();
    }
    private void refresh(boolean force){
        status.setText("Проверяю подключение и данные…");
        new Thread(()->{
            try{Api.fetch(this,force);runOnUiThread(()->{updateStatus();redraw();toast("Данные виджета обновлены");});}
            catch(Exception e){runOnUiThread(()->{status.setText(e.getMessage());toast(e.getMessage());});}
        },"widget-refresh").start();
    }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
}
