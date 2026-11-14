package ru.plansfortwo.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;
import org.json.JSONObject;
import java.time.LocalDate;

/** Shared size definitions for the launcher picker and the in-app preview. */
public final class WidgetCatalog {
    private WidgetCatalog() {}
    static final class Size {
        final int rows, cols, width, height, layout;
        final String mode;
        final Class<? extends CoupleWidget> provider;
        Size(int rows,int cols,int width,int height,String mode,int layout,Class<? extends CoupleWidget> provider){
            this.rows=rows;this.cols=cols;this.width=width;this.height=height;
            this.mode=mode;this.layout=layout;this.provider=provider;
        }
        String title(){return rows+"×"+cols;}
    }
    static final Size[] ALL={
        new Size(1,2,110,56,"mini",R.layout.widget_1,CoupleWidget.class),
        new Size(1,3,180,56,"row2",R.layout.widget_row2,Widget1x3.class),
        new Size(1,4,250,56,"row3",R.layout.widget_row3,Widget1x4.class),
        new Size(2,2,110,126,"vert2",R.layout.widget_vert2,Widget2x2.class),
        new Size(2,3,180,126,"vert3",R.layout.widget_vert3,Widget2x3.class),
        new Size(2,4,250,126,"vert3",R.layout.widget_vert3,Widget2x4.class),
        new Size(3,3,180,196,"big",R.layout.widget_big,Widget3x3.class),
        new Size(3,4,250,196,"big",R.layout.widget_big,Widget3x4.class),
        new Size(4,4,250,266,"big",R.layout.widget_big,Widget4x4.class)
    };
    static Size find(String className) {
        for(Size s:ALL)if(s.provider.getName().equals(className))return s;
        return ALL[0];
    }
    static JSONObject demo() {
        JSONObject result=new JSONObject();
        try{
            LocalDate today=LocalDate.now();
            result.put("relationship_start",today.minusDays(128).toString());
            result.put("meeting",new JSONObject().put("date",today.plusDays(4).toString()).put("title","Свидание"));
            result.put("event",new JSONObject().put("date",today.plusDays(11).toString()).put("title","Наша дата"));
        }catch(Exception ignored){}
        return result;
    }
    /** Android 15+ personalized previews. Static XML previewLayout is always available if throttled. */
    static void updatePickerPreviews(Context c) {
        if(Build.VERSION.SDK_INT<35)return;
        AppWidgetManager manager=AppWidgetManager.getInstance(c);
        SharedPreferences p=Api.prefs(c);
        JSONObject data;
        try {data=new JSONObject(p.getString("snapshot","{}"));}catch(Exception ex){data=new JSONObject();}
        if(data.optString("relationship_start").isEmpty())data=demo();
        for(Size s:ALL){
            try {
                RemoteViews view=new RemoteViews(c.getPackageName(),s.layout);
                // Keep the bitmap compact for RemoteViews/Binder and scale in the picker.
                int w=s.width,h=s.height;
                view.setImageViewBitmap(R.id.bg,WidgetArt.draw(c,p,data,w,h,s.mode));
                manager.setWidgetPreview(new ComponentName(c,s.provider),
                    AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN,view);
            } catch(Exception ignored) { /* XML previewLayout is the reliable fallback. */ }
        }
    }
}
