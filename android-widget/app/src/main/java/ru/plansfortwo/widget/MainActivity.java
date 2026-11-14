package ru.plansfortwo.widget;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private LinearLayout body;
    private TextView status, opacityLabel, previewNote;
    private ImageView preview;
    private WallpaperSample sampleWallpaper;
    private SharedPreferences prefs;
    private Button bg1Button,bg2Button,textButton,iconButton,wallpaperButton;
    private Button[] tabs=new Button[3];
    private LinearLayout[] panels=new LinearLayout[3];
    private Spinner bgMode,direction,previewSize;
    private String previewColorKey;
    private int previewColorValue;
    private boolean ready=false, pickerDirty=false;
    private int wallpaperStyle=0;
    private static final int DARK=Color.rgb(18,23,39);
    private static final int[] ANGLES={0,90,180,270,45,135,225,315};

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        prefs=Api.prefs(this);
        LinearLayout screen=new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(DARK);
        ScrollView scroll=new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout scrollBody=new LinearLayout(this);
        scrollBody.setOrientation(LinearLayout.VERTICAL);
        scrollBody.setPadding(dp(18),dp(12),dp(18),dp(42));
        scroll.addView(scrollBody);
        LinearLayout fixed=new LinearLayout(this);
        fixed.setOrientation(LinearLayout.VERTICAL);
        fixed.setPadding(dp(18),dp(8),dp(18),0);
        screen.addView(fixed,new LinearLayout.LayoutParams(-1,-2));
        screen.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(screen);
        body=fixed;
        title("♥  Планы на двоих",24);
        section("Предпросмотр на рабочем столе");
        previewNote=note("");
        FrameLayout frame=new FrameLayout(this);
        sampleWallpaper=new WallpaperSample();
        frame.addView(sampleWallpaper,new FrameLayout.LayoutParams(-1,-1));
        preview=new ImageView(this);
        preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        preview.setAdjustViewBounds(false);
        preview.setPadding(dp(12),dp(16),dp(12),dp(16));
        frame.addView(preview,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout.LayoutParams fp=new LinearLayout.LayoutParams(-1,dp(200));
        fp.setMargins(0,dp(4),0,dp(6));
        body.addView(frame,fp);
        body=scrollBody;
        section("Подключение");
        status=note("");
        button("Привязать Telegram",v->connect());
        button("Проверить привязку и обновить",v->refresh(true));
        note("Размер для предпросмотра (высота × ширина)");
        String[] names=new String[WidgetCatalog.ALL.length];
        for(int i=0;i<names.length;i++)names[i]=WidgetCatalog.ALL[i].title();
        previewSize=spinner(names,7);
        previewSize.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            @Override public void onItemSelected(AdapterView<?> a,View v,int pos,long id){if(ready)redrawPreview();}
            @Override public void onNothingSelected(AdapterView<?> a){}
        });
        wallpaperButton=button("Сменить фон предпросмотра",v->{
            wallpaperStyle=(wallpaperStyle+1)%3;
            sampleWallpaper.invalidate();
        });

        section("Оформление");
        LinearLayout nav=new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        body.addView(nav,new LinearLayout.LayoutParams(-1,dp(53)));
        String[] navNames={"Фон","Текст / значки","Прозрачность"};
        for(int i=0;i<3;i++){
            final int index=i;
            Button tab=new Button(this);
            tab.setText(navNames[i]);
            tab.setAllCaps(false);tab.setTextSize(14);
            tab.setOnClickListener(v->showPanel(index));
            nav.addView(tab,new LinearLayout.LayoutParams(0,-1,1));
            tabs[i]=tab;
        }
        LinearLayout root=body;
        for(int i=0;i<3;i++){
            panels[i]=new LinearLayout(this);
            panels[i].setOrientation(LinearLayout.VERTICAL);
            root.addView(panels[i],new LinearLayout.LayoutParams(-1,-2));
        }
        body=panels[0];
        section("Цвет фона");
        note("Выбери сплошную заливку или градиент. Палитра открывается нажатием на цвет.");
        bgMode=spinner(new String[]{"Градиент","Сплошной цвет"},prefs.getBoolean("gradient",true)?0:1);
        bgMode.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            @Override public void onItemSelected(AdapterView<?> a,View v,int pos,long id){
                if(ready){save("gradient",pos==0);updateButtons();}
            }
            @Override public void onNothingSelected(AdapterView<?> a){}
        });
        bg1Button=button("Цвет №1",v->chooseColor("bg1","Первый / сплошной цвет"));
        bg2Button=button("Цвет №2",v->chooseColor("bg2","Второй цвет градиента"));
        button("🎲 Случайные цвета",v->randomColors());
        section("Направление градиента");
        direction=spinner(new String[]{
            "Слева направо →","Сверху вниз ↓","Справа налево ←","Снизу вверх ↑",
            "↘ По диагонали","↙ По диагонали","↖ По диагонали","↗ По диагонали"
        },directionIndex(prefs.getInt("direction",0)));
        direction.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            @Override public void onItemSelected(AdapterView<?> a,View v,int pos,long id){
                if(ready)save("direction",ANGLES[pos]);
            }
            @Override public void onNothingSelected(AdapterView<?> a){}
        });
        button("🎲 Случайное направление",v->{
            int index=new SecureRandom().nextInt(ANGLES.length);
            direction.setSelection(index);
            save("direction",ANGLES[index]);
        });

        body=panels[1];
        section("Текст и значки");
        note("Изменение цвета сразу показывается в предпросмотре над настройками.");
        textButton=button("Цвет текста",v->chooseColor("text","Цвет текста"));
        iconButton=button("Цвет значков",v->chooseColor("icon","Цвет значков"));

        body=panels[2];
        section("Прозрачность фона");
        note("Двигай ползунок и смотри, как сквозь виджет просвечивает фон рабочего стола. Текст остаётся непрозрачным.");
        opacityLabel=note("");
        SeekBar alpha=new SeekBar(this);
        alpha.setMax(100);
        alpha.setProgress(prefs.getInt("alpha",90));
        body.addView(alpha,new LinearLayout.LayoutParams(-1,dp(64)));
        alpha.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            @Override public void onProgressChanged(SeekBar bar,int value,boolean fromUser){
                opacityLabel.setText("Непрозрачность: "+value+"% · прозрачность: "+(100-value)+"%");
                if(fromUser){
                    prefs.edit().putInt("alpha",value).apply();
                    redrawPreview();
                }
            }
            @Override public void onStartTrackingTouch(SeekBar bar){}
            @Override public void onStopTrackingTouch(SeekBar bar){
                pickerDirty=true;
                CoupleWidget.redrawAll(MainActivity.this);
            }
        });
        opacityLabel.setText("Непрозрачность: "+alpha.getProgress()+"% · прозрачность: "+(100-alpha.getProgress())+"%");

        body=root;
        ready=true;
        showPanel(0);
        updateButtons();
        updateStatus();
        redrawPreview();
        // One UI 9 can use dynamic previews; all nine also have XML fallbacks.
        WidgetCatalog.updatePickerPreviews(this);
    }
    @Override protected void onResume(){
        super.onResume();
        if(ready)updateStatus();
    }
    @Override protected void onPause(){
        super.onPause();
        if(pickerDirty){WidgetCatalog.updatePickerPreviews(this);pickerDirty=false;}
    }
    private int dp(float px){return Math.round(px*getResources().getDisplayMetrics().density);}
    private void showPanel(int index){
        for(int i=0;i<panels.length;i++){
            panels[i].setVisibility(index==i?View.VISIBLE:View.GONE);
            tabs[i].setTextColor(Color.WHITE);
            tabs[i].setBackgroundTintList(ColorStateList.valueOf(i==index?0xFF925175:0xFF394365));
        }
    }
    private void section(String text){
        TextView label=label(text,18,0xFFFFB1CC);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.setMargins(0,dp(18),0,dp(8));
        body.addView(label,lp);
    }
    private void title(String text,int size){body.addView(label(text,size,Color.WHITE));}
    private TextView note(String text){
        TextView v=label(text,14,0xFFC6CFE4);
        v.setLineSpacing(dp(2),1);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);
        p.setMargins(0,dp(5),0,dp(8));
        body.addView(v,p);return v;
    }
    private TextView label(String s,int size,int color){
        TextView v=new TextView(this);v.setText(s);v.setTextSize(size);v.setTextColor(color);return v;
    }
    private Button button(String text,View.OnClickListener listener){
        Button b=new Button(this);
        b.setText(text);b.setAllCaps(false);b.setTextColor(Color.WHITE);
        b.setBackgroundTintList(ColorStateList.valueOf(0xFF394365));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(52));
        lp.setMargins(0,dp(4),0,dp(5));
        body.addView(b,lp);
        b.setOnClickListener(listener);
        return b;
    }
    private Spinner spinner(String[] labels,int selected){
        Spinner s=new Spinner(this);
        ArrayAdapter<String> adapter=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,labels){
            @Override public View getView(int pos,View convert,android.view.ViewGroup parent){
                TextView v=(TextView)super.getView(pos,convert,parent);
                v.setTextColor(Color.WHITE);v.setTextSize(16);return v;
            }
            @Override public View getDropDownView(int pos,View convert,android.view.ViewGroup parent){
                TextView v=(TextView)super.getDropDownView(pos,convert,parent);
                v.setTextColor(Color.BLACK);v.setTextSize(16);return v;
            }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        s.setAdapter(adapter);s.setSelection(selected);
        s.setBackgroundTintList(ColorStateList.valueOf(0xFFFFAFC8));
        body.addView(s,new LinearLayout.LayoutParams(-1,dp(50)));
        return s;
    }
    private int directionIndex(int value){
        for(int i=0;i<ANGLES.length;i++)if(ANGLES[i]==value)return i;
        return 0;
    }
    private void save(String key,boolean val){prefs.edit().putBoolean(key,val).apply();redraw();}
    private void save(String key,int val){prefs.edit().putInt(key,val).apply();redraw();}
    private JSONObject snapshot(){
        try {return new JSONObject(prefs.getString("snapshot","{}"));}catch(Exception e){return new JSONObject();}
    }
    private void redrawPreview(){
        if(!ready)return;
        JSONObject data=snapshot();
        boolean demo=data.optString("relationship_start").isEmpty();
        if(demo)data=WidgetCatalog.demo();
        previewNote.setText(demo?"Пример данных · прозрачность видна на фоне ниже":"Реальные данные пары · прозрачность видна на фоне ниже");
        int index=previewSize.getSelectedItemPosition();
        if(index<0||index>=WidgetCatalog.ALL.length)index=7;
        WidgetCatalog.Size s=WidgetCatalog.ALL[index];
        preview.setImageBitmap(WidgetArt.draw(this,prefs,data,s.width,s.height,s.mode,previewColorKey,previewColorValue));
    }
    private void redraw(){
        if(!ready)return;
        pickerDirty=true;
        redrawPreview();
        CoupleWidget.redrawAll(this);
    }
    private void updateColorButton(Button b,String key,String name){
        if(b==null)return;
        String hex=prefs.getString(key,defaults(key));
        b.setText(name+"  "+hex);
        int color;
        try{color=Color.parseColor(hex);}catch(Exception e){color=Color.WHITE;}
        GradientDrawable chip=new GradientDrawable();
        chip.setColor(color);chip.setCornerRadius(dp(5));chip.setSize(dp(20),dp(20));
        chip.setStroke(dp(1),0xFFB6BACE);
        b.setCompoundDrawablesWithIntrinsicBounds(chip,null,null,null);
        b.setCompoundDrawablePadding(dp(12));
    }
    private void updateButtons(){
        updateColorButton(bg1Button,"bg1","Первый / сплошной цвет");
        updateColorButton(bg2Button,"bg2","Второй цвет");
        updateColorButton(textButton,"text","Цвет текста");
        updateColorButton(iconButton,"icon","Цвет значков");
        boolean gradient=prefs.getBoolean("gradient",true);
        if(bg2Button!=null)bg2Button.setVisibility(gradient?View.VISIBLE:View.GONE);
        if(direction!=null)direction.setEnabled(gradient);
    }
    private void chooseColor(String key,String heading){
        int initial;
        try{initial=Color.parseColor(prefs.getString(key,defaults(key)));}catch(Exception e){initial=Color.WHITE;}
        LinearLayout content=new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16),dp(5),dp(16),dp(8));
        ColorPickerView picker=new ColorPickerView(this,initial);
        content.addView(picker,new LinearLayout.LayoutParams(-1,dp(290)));
        TextView chosen=label(String.format(Locale.ROOT,"#%06X",initial&0xFFFFFF),18,Color.BLACK);
        chosen.setGravity(Gravity.CENTER);
        chosen.setPadding(0,dp(12),0,dp(6));
        content.addView(chosen);
        picker.setOnColorChangeListener(color->{
            previewColorKey=key;
            previewColorValue=color;
            chosen.setText(String.format(Locale.ROOT,"#%06X",color&0xFFFFFF));
            redrawPreview();
        });
        AlertDialog dialog=new AlertDialog.Builder(this)
            .setTitle(heading)
            .setView(content)
            .setNegativeButton("Отмена",(d,w)->{})
            .setPositiveButton("Применить",(d,w)->{
                int value=picker.getColor();
                prefs.edit().putString(key,String.format(Locale.ROOT,"#%06X",value&0xFFFFFF)).apply();
                updateButtons();
                redraw();
            }).create();
        dialog.setOnDismissListener(d->{previewColorKey=null;redrawPreview();});
        dialog.show();
    }
    private String defaults(String key){
        if("bg1".equals(key))return "#683470";
        if("bg2".equals(key))return "#304F8D";
        return "icon".equals(key)?"#FF9ABA":"#FFFFFF";
    }
    private void randomColors(){
        SecureRandom r=new SecureRandom();
        prefs.edit().putString("bg1",String.format(Locale.ROOT,"#%06X",randomColor(r)))
            .putString("bg2",String.format(Locale.ROOT,"#%06X",randomColor(r)))
            .putBoolean("gradient",true).apply();
        bgMode.setSelection(0);
        updateButtons();
        redraw();
    }
    private int randomColor(SecureRandom r){
        return Color.rgb(40+r.nextInt(170),30+r.nextInt(150),70+r.nextInt(170))&0xFFFFFF;
    }
    private void updateStatus(){
        if(status==null)return;
        String token=prefs.getString("token","");
        String snapshot=prefs.getString("snapshot","");
        if(token.isEmpty()){status.setText("Не подключено. Для получения дат нужна привязка к боту.");return;}
        if(snapshot.isEmpty()){status.setText("Код создан. Запусти бота в Telegram, затем вернись и проверь привязку.");return;}
        long when=prefs.getLong("last_auto",0);
        String date=when==0?"неизвестно":new SimpleDateFormat("dd.MM.yyyy HH:mm",Locale.getDefault()).format(new Date(when));
        status.setText("Подключено. Данные обновлены: "+date);
    }
    private void connect(){
        if(CoupleWidget.telegramPackage(this)==null){toast("Не найден Telegram. Привязка через браузер отключена.");return;}
        String code=Api.randomHex(24),token=Api.randomHex(32);
        status.setText("Создаю защищённую привязку…");
        new Thread(()->{
            try{
                JSONObject response=Api.register(code,token);
                if(!"pending".equals(response.optString("status")))throw new Exception("Неверный ответ сервера");
                prefs.edit().putString("token",token).putString("code",code)
                    .remove("snapshot").remove("last_auto").apply();
                runOnUiThread(()->{
                    updateStatus();redraw();
                    Intent telegram=CoupleWidget.telegramIntent(this,"w_"+code);
                    if(telegram!=null)startActivity(telegram);else toast("Не удалось открыть Telegram");
                });
            }catch(Exception e){
                runOnUiThread(()->{status.setText("Ошибка привязки: "+e.getMessage());toast(e.getMessage());});
            }
        },"widget-register").start();
    }
    private void refresh(boolean force){
        if(force){
            if(prefs.getString("token","").isEmpty()){toast("Сначала подключи Telegram");return;}
            int wait=Api.reserveManual(this);
            if(wait>0){toast("Обновить снова можно через "+wait+" сек.");return;}
            if(wait<0){toast("Не удалось запустить обновление");return;}
        }
        status.setText("Проверяю подключение и данные…");
        new Thread(()->{
            try{
                Api.fetch(this,force);
                runOnUiThread(()->{updateStatus();redraw();toast("Данные обновлены");});
            }catch(Exception e){
                runOnUiThread(()->{status.setText(e.getMessage());toast(e.getMessage());});
            }
        },"widget-refresh").start();
    }
    private void toast(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}

    private final class WallpaperSample extends View {
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        WallpaperSample(){super(MainActivity.this);}
        @Override protected void onDraw(Canvas c){
            int w=getWidth(),h=getHeight();
            int[] palette;
            if(wallpaperStyle==1)palette=new int[]{0xFFF8D8BA,0xFFE4A9BA,0xFFB8D9F4};
            else if(wallpaperStyle==2)palette=new int[]{0xFF31BEB4,0xFF336A7B,0xFF24426D};
            else palette=new int[]{0xFF25234D,0xFF8A467A,0xFF263B69};
            paint.setShader(new LinearGradient(0,0,w,h,palette,null,Shader.TileMode.CLAMP));
            c.drawRect(0,0,w,h,paint);
            paint.setShader(null);
            paint.setColor(wallpaperStyle==1?0x44FFFFFF:0x3359E4D1);
            c.drawCircle(w*.18f,h*.08f,h*.64f,paint);
            paint.setColor(wallpaperStyle==1?0x33996C8B:0x44EC90C7);
            c.drawCircle(w*.94f,h*.96f,h*.54f,paint);
        }
    }
}
