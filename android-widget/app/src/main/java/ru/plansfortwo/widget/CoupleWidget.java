package ru.plansfortwo.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

public class CoupleWidget extends AppWidgetProvider {
    static final String BOT = "PlansForTwoBot";
    private static final String ACTION_REFRESH = "ru.plansfortwo.widget.REFRESH_NOW";
    static final String ACTION_PIN_SUCCEEDED = "ru.plansfortwo.widget.PIN_SUCCEEDED";

    @Override public void onReceive(Context context, Intent intent) {
        if(intent!=null && ACTION_PIN_SUCCEEDED.equals(intent.getAction())) {
            int widgetId=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if(widgetId!=AppWidgetManager.INVALID_APPWIDGET_ID) {
                AppWidgetManager manager=AppWidgetManager.getInstance(context);
                android.appwidget.AppWidgetProviderInfo info=manager.getAppWidgetInfo(widgetId);
                if(info!=null && context.getPackageName().equals(info.provider.getPackageName())) {
                    try { render(context,manager,widgetId); }
                    catch(RuntimeException ex) {
                        android.util.Log.e("PlansForTwoWidget","Pinned widget rendering error",ex);
                    }
                }
            }
            // Some launchers deliver the pin callback before the widget host is ready.
            // Independently repaint all widgets after the host finishes placement.
            WidgetSyncJob.scheduleInitialRefresh(context);
            return;
        }
        if(intent!=null && ACTION_REFRESH.equals(intent.getAction())) {
            Context c=context.getApplicationContext();
            if(Api.prefs(c).getString("token","").isEmpty()) {
                Toast.makeText(c,"Сначала подключи Telegram",Toast.LENGTH_SHORT).show();
                return;
            }
            int wait=Api.reserveManual(c);
            if(wait>0) {
                Toast.makeText(c,"Обновить снова можно через "+wait+" сек.",Toast.LENGTH_SHORT).show();
                return;
            }
            if(wait<0 || !WidgetSyncJob.requestManual(c)) {
                if(wait==0)Api.undoManualReservation(c);
                Toast.makeText(c,"Не удалось запустить обновление",Toast.LENGTH_SHORT).show();
                return;
            }
            Toast.makeText(c,"Обновление запрошено",Toast.LENGTH_SHORT).show();
            return;
        }
        super.onReceive(context,intent);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            try { render(context,manager,id); }
            catch(RuntimeException e) { android.util.Log.e("PlansForTwoWidget","Initial draw failed for "+id,e); }
        }
        WidgetSyncJob.schedule(context);
        WidgetSyncJob.scheduleInitialRefresh(context);
    }
    @Override public void onEnabled(Context c) {
        super.onEnabled(c);
        WidgetSyncJob.schedule(c);
        WidgetSyncJob.scheduleInitialRefresh(c);
    }
    @Override public void onDisabled(Context c) {
        super.onDisabled(c);
        if(!hasWidgets(c))WidgetSyncJob.cancel(c);
    }
    @Override public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle opts) {
        super.onAppWidgetOptionsChanged(c,m,id,opts);
        try { render(c,m,id); }
        catch(RuntimeException e){android.util.Log.e("PlansForTwoWidget","Resize draw failed for "+id,e);}
    }
    static boolean hasWidgets(Context c) {
        AppWidgetManager m=AppWidgetManager.getInstance(c);
        for(WidgetCatalog.Size s:WidgetCatalog.ALL)
            if(m.getAppWidgetIds(new ComponentName(c,s.provider)).length>0)return true;
        return false;
    }
    static void redrawAll(Context c) {
        AppWidgetManager m=AppWidgetManager.getInstance(c);
        for(WidgetCatalog.Size s:WidgetCatalog.ALL)
            for(int id:m.getAppWidgetIds(new ComponentName(c,s.provider))) {
                try { render(c,m,id); }
                catch(RuntimeException e){android.util.Log.e("PlansForTwoWidget","Repaint failed for "+id,e);}
            }
    }
    static String telegramPackage(Context c) {
        PackageManager pm = c.getPackageManager();
        for (String s : new String[]{"org.telegram.messenger","org.telegram.messenger.web"}) {
            try { pm.getPackageInfo(s,0); return s; } catch (PackageManager.NameNotFoundException ignored) {}
        }
        return null;
    }
    static Intent telegramIntent(Context c, String start) {
        String pkg = telegramPackage(c);
        if (pkg == null) return null;
        Uri.Builder u = Uri.parse("tg://resolve").buildUpon().appendQueryParameter("domain", BOT);
        if (start != null && !start.isEmpty()) u.appendQueryParameter("start",start);
        Intent i = new Intent(Intent.ACTION_VIEW,u.build()).setPackage(pkg);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i.resolveActivity(c.getPackageManager()) == null ? null : i;
    }
    static PendingIntent activity(Context c, int code, Intent i) {
        return PendingIntent.getActivity(c,code,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void render(Context c, AppWidgetManager manager, int id) {
        SharedPreferences p=Api.prefs(c);
        android.appwidget.AppWidgetProviderInfo info=manager.getAppWidgetInfo(id);
        // One UI may assign an ID before its metadata becomes available.
        // The one-shot initial refresh will retry after placement.
        if(info==null){
            android.util.Log.w("PlansForTwoWidget","Widget metadata not ready: "+id);
            return;
        }
        Bundle opts=manager.getAppWidgetOptions(id);
        if(opts==null)opts=Bundle.EMPTY;
        WidgetCatalog.Size size=WidgetCatalog.find(info.provider.getClassName());
        int width=opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,size.width);
        int height=opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,size.height);
        if(width<=0)width=size.width;
        if(height<=0)height=size.height;
        width=Math.max(110,Math.min(440,width));
        height=Math.max(48,Math.min(440,height));
        int cols=width<=160?2:width<=245?3:4;
        int rows=height<=100?1:height<=175?2:height<=255?3:4;
        // One widget provider, adapt content immediately when One UI resizes it.
        String mode; int layout;
        if(rows==1 && cols==2){mode="mini";layout=R.layout.widget_1;}
        else if(rows==1 && cols==3){mode="row2";layout=R.layout.widget_row2;}
        else if(rows==1){mode="row3";layout=R.layout.widget_row3;}
        else if(rows==2 && cols==2){mode="vert2";layout=R.layout.widget_vert2;}
        else if(rows>=3 && cols>=3){mode="big";layout=R.layout.widget_big;}
        else {mode="vert3";layout=R.layout.widget_vert3;}
        JSONObject data;
        try {data=new JSONObject(p.getString("snapshot","{}"));}catch(Exception e){data=new JSONObject();}
        Bitmap bmp=WidgetArt.draw(c,p,data,width,height,mode);
        RemoteViews rv=new RemoteViews(c.getPackageName(),layout);
        rv.setImageViewBitmap(R.id.bg,bmp);
        rv.setViewVisibility(R.id.loading,View.GONE);
        PendingIntent main=activity(c,10000+id,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Intent deep=telegramIntent(c,null);
        PendingIntent telegram=deep==null?main:activity(c,20000+id,deep);
        rv.setOnClickPendingIntent(R.id.tap0,main);
        if(mode.equals("row2")||mode.equals("vert2")){
            rv.setOnClickPendingIntent(R.id.tap1,telegram);
        } else if(mode.equals("row3")||mode.equals("vert3")||mode.equals("big")){
            rv.setOnClickPendingIntent(R.id.tap1,telegram);
            rv.setOnClickPendingIntent(R.id.tap2,telegram);
        }
        Intent refreshIntent=new Intent(c,CoupleWidget.class).setAction(ACTION_REFRESH);
        PendingIntent refresh=PendingIntent.getBroadcast(c,30000+id,refreshIntent,
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.refreshHit,refresh);
        manager.updateAppWidget(id,rv);
    }
}

final class WidgetArt {
    private WidgetArt(){}
    static int color(SharedPreferences p,String name,int fallback) {
        try {return Color.parseColor(p.getString(name,String.format("#%06X",fallback & 0xFFFFFF)));}catch(Exception e){return fallback;}
    }
    static LocalDate today(JSONObject d){
        try {return LocalDate.now(ZoneId.of(d.optString("timezone","Europe/Moscow")));}catch(Exception e){return LocalDate.now();}
    }
    static String shortDate(JSONObject e) {
        if(e==null) return "Нет даты";
        try {return LocalDate.parse(e.optString("date")).format(DateTimeFormatter.ofPattern("d MMM",new Locale("ru")));}catch(Exception ex){return "Нет даты";}
    }
    static String daysLeft(JSONObject e,LocalDate now) {
        if(e==null) return "Не запланировано";
        try {
            long days=ChronoUnit.DAYS.between(now,LocalDate.parse(e.getString("date")));
            if(days==0)return "Сегодня";
            if(days==1)return "Завтра";
            if(days<0)return "Дата прошла";
            return "через "+days+" дн.";
        }catch(Exception ex){return "Нет данных";}
    }
    static String together(JSONObject d,LocalDate now) {
        try {
            LocalDate start=LocalDate.parse(d.optString("relationship_start"));
            long n=ChronoUnit.DAYS.between(start,now);
            return n<0?"—":n+" дней";
        }catch(Exception ex){return "— дней";}
    }
    static Paint paint(int col,float size,boolean bold) {
        Paint p=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
        p.setColor(col);p.setTextSize(size);
        p.setTypeface(Typeface.create("sans-serif",bold?Typeface.BOLD:Typeface.NORMAL));return p;
    }
    static String ellipsize(String s,Paint p,float max) {
        if(s==null)return ""; if(p.measureText(s)<=max)return s;
        while(s.length()>1 && p.measureText(s+"…")>max) s=s.substring(0,s.length()-1);
        return s+"…";
    }
    static void centered(Canvas c,String s,int col,float size,boolean bold,float x,float baseline,float max) {
        Paint p=paint(col,size,bold);p.setTextAlign(Paint.Align.CENTER);c.drawText(ellipsize(s,p,max),x,baseline,p);
    }
    static void left(Canvas c,String s,int col,float size,boolean bold,float x,float baseline,float max) {
        Paint p=paint(col,size,bold);c.drawText(ellipsize(s,p,max),x,baseline,p);
    }
    static void divider(Canvas c,float x1,float y1,float x2,float y2,int col){
        Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setColor(col);p.setStrokeWidth(1);c.drawLine(x1,y1,x2,y2,p);
    }
    static Bitmap draw(Context ctx,SharedPreferences p,JSONObject data,int wdp,int hdp,String mode) {
        return draw(ctx,p,data,wdp,hdp,mode,null,0);
    }
    static Bitmap draw(Context ctx,SharedPreferences p,JSONObject data,int wdp,int hdp,String mode,String overrideKey,int overrideColor) {
        DisplayMetrics metrics=ctx.getResources().getDisplayMetrics(); float den=metrics.density;
        int wpx=Math.min(1152,Math.max(1,Math.round(wdp*den))),hpx=Math.min(1152,Math.max(1,Math.round(hdp*den)));
        Bitmap bmp=Bitmap.createBitmap(wpx,hpx,Bitmap.Config.ARGB_8888);
        Canvas c=new Canvas(bmp); c.scale(wpx/(float)wdp,hpx/(float)hdp);
        int bg1=color(p,"bg1",Color.rgb(104,52,112));
        int bg2=color(p,"bg2",Color.rgb(48,79,141));
        int text=color(p,"text",Color.WHITE);
        int icon=color(p,"icon",Color.rgb(255,154,186));
        if("bg1".equals(overrideKey))bg1=overrideColor;
        if("bg2".equals(overrideKey))bg2=overrideColor;
        if("text".equals(overrideKey))text=overrideColor;
        if("icon".equals(overrideKey))icon=overrideColor;
        int alpha=Math.max(0,Math.min(100,p.getInt("alpha",90)));
        int a=Math.round(alpha*2.55f);
        Paint back=new Paint(Paint.ANTI_ALIAS_FLAG);
        back.setAlpha(a);
        if(p.getBoolean("gradient",true)){
            double radians=Math.toRadians(p.getInt("direction",0));
            float dx=(float)Math.cos(radians),dy=(float)Math.sin(radians);
            float x=wdp/2f,y=hdp/2f,scale=Math.max(wdp,hdp)/2f;
            back.setShader(new LinearGradient(x-dx*scale,y-dy*scale,x+dx*scale,y+dy*scale,bg1,bg2,Shader.TileMode.CLAMP));
        }else {back.setColor(bg1);back.setAlpha(a);}
        c.drawRoundRect(new RectF(0,0,wdp,hdp),Math.min(22,hdp/4f),Math.min(22,hdp/4f),back);
        Paint edge=new Paint(Paint.ANTI_ALIAS_FLAG); edge.setStyle(Paint.Style.STROKE);
        edge.setStrokeWidth(1); edge.setColor(Color.argb(Math.round(a*.26f),255,255,255));
        c.drawRoundRect(new RectF(1,1,wdp-1,hdp-1),Math.min(22,hdp/4f),Math.min(22,hdp/4f),edge);
        LocalDate now=today(data);
        String days=together(data,now);
        JSONObject date=data.optJSONObject("meeting"),event=data.optJSONObject("event");
        float mid=wdp/2f;
        String d1=shortDate(date), d2=shortDate(event);
        String left1=daysLeft(date,now),left2=daysLeft(event,now);
        if("mini".equals(mode)){
            centered(c,"♥",icon,23,true,wdp*.18f,hdp*.63f,wdp*.25f);
            centered(c,"Мы вместе",text,Math.min(12,hdp*.19f),false,wdp*.62f,hdp*.41f,wdp*.7f);
            centered(c,days,text,Math.min(21,hdp*.36f),true,wdp*.62f,hdp*.78f,wdp*.7f);
        }else if("row2".equals(mode)||"row3".equals(mode)){
            int parts="row2".equals(mode)?2:3;
            float pw=wdp/(float)parts;
            for(int i=1;i<parts;i++)divider(c,pw*i,8,pw*i,hdp-8,Color.argb(95,255,255,255));
            centered(c,"♥",icon,Math.min(17,hdp*.30f),true,pw/2,hdp*.32f,pw-8);
            centered(c,days,text,Math.min(20,hdp*.31f),true,pw/2,hdp*.74f,pw-7);
            centered(c,"Свидание",text,Math.min(11,hdp*.19f),false,pw*1.5f,hdp*.32f,pw-8);
            centered(c,date==null?"—":d1,text,Math.min(18,hdp*.30f),true,pw*1.5f,hdp*.73f,pw-7);
            if(parts==3){
                centered(c,"Событие",text,Math.min(11,hdp*.19f),false,pw*2.5f,hdp*.32f,pw-8);
                centered(c,event==null?"—":d2,text,Math.min(18,hdp*.30f),true,pw*2.5f,hdp*.73f,pw-7);
            }
        }else if("vert2".equals(mode)){
            centered(c,"♥ "+days, text,24,true,mid,hdp*.35f,wdp-20);
            divider(c,14,hdp*.55f,wdp-14,hdp*.55f,Color.argb(80,255,255,255));
            centered(c,"Свидание • "+(date==null?"нет":d1),text,15,true,mid,hdp*.81f,wdp-20);
        }else if("vert3".equals(mode)){
            left(c,"♥",icon,25,true,17,Math.max(32,hdp*.24f),40);
            left(c,days,text,Math.min(24,hdp*.17f),true,52,Math.max(32,hdp*.24f),wdp-62);
            divider(c,13,hdp*.34f,wdp-13,hdp*.34f,Color.argb(75,255,255,255));
            left(c,"▣  Свидание",icon,Math.min(16,hdp*.115f),true,17,hdp*.53f,wdp-34);
            left(c,(date==null?"Не запланировано":d1+" · "+left1),text,Math.min(15,hdp*.10f),true,18,hdp*.68f,wdp-34);
            divider(c,13,hdp*.70f,wdp-13,hdp*.70f,Color.argb(75,255,255,255));
            left(c,"✦  "+(event==null?"Важное событие":event.optString("title","Событие")),icon,Math.min(15,hdp*.095f),true,17,hdp*.82f,wdp-34);
            left(c,(event==null?"Не запланировано":d2+" · "+left2),text,Math.min(15,hdp*.09f),true,18,hdp*.94f,wdp-34);
        }else if("big".equals(mode)){
            centered(c,"♥",icon,Math.min(35,hdp*.16f),true,mid,hdp*.20f,wdp*.8f);
            centered(c,"Мы вместе",text,Math.min(16,hdp*.075f),false,mid,hdp*.32f,wdp*.8f);
            centered(c,days,text,Math.min(30,hdp*.13f),true,mid,hdp*.47f,wdp*.9f);
            divider(c,wdp/2f,hdp*.56f,wdp/2f,hdp*.93f,Color.argb(80,255,255,255));
            centered(c,"▣ Свидание",icon,Math.min(15,hdp*.06f),true,wdp*.25f,hdp*.68f,wdp*.47f);
            centered(c,date==null?"—":d1,text,Math.min(21,hdp*.095f),true,wdp*.25f,hdp*.79f,wdp*.47f);
            centered(c,left1,text,Math.min(12,hdp*.055f),false,wdp*.25f,hdp*.88f,wdp*.47f);
            centered(c,"✦ Событие",icon,Math.min(15,hdp*.06f),true,wdp*.75f,hdp*.68f,wdp*.47f);
            centered(c,event==null?"—":d2,text,Math.min(21,hdp*.095f),true,wdp*.75f,hdp*.79f,wdp*.47f);
            centered(c,left2,text,Math.min(12,hdp*.055f),false,wdp*.75f,hdp*.88f,wdp*.47f);
        }
        drawRefreshBadge(c,wdp,hdp);
        return bmp;
    }
    /** Corner indicator; its 34dp touch target is provided in each widget layout. */
    private static void drawRefreshBadge(Canvas c,float width,float height){
        float radius=9f,cx=width-17f,cy=height-17f;
        Paint back=new Paint(Paint.ANTI_ALIAS_FLAG);
        back.setColor(Color.argb(220,42,43,67));
        c.drawCircle(cx,cy,radius+3f,back);
        Paint line=new Paint(Paint.ANTI_ALIAS_FLAG);
        line.setColor(Color.WHITE);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(1.7f);
        RectF oval=new RectF(cx-radius*.58f,cy-radius*.58f,cx+radius*.58f,cy+radius*.58f);
        c.drawArc(oval,40f,285f,false,line);
        line.setStyle(Paint.Style.FILL);
        android.graphics.Path arrow=new android.graphics.Path();
        arrow.moveTo(cx+radius*.44f,cy+radius*.25f);
        arrow.lineTo(cx+radius*.94f,cy+radius*.32f);
        arrow.lineTo(cx+radius*.75f,cy-radius*.24f);
        arrow.close();
        c.drawPath(arrow,line);
    }
}
