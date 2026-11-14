package ru.plansfortwo.widget;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.MotionEvent;
import android.view.View;

/** Touch-first HSV picker: saturation/brightness plane and hue strip. */
public final class ColorPickerView extends View {
    public interface OnColorChangeListener { void onColorChanged(int color); }
    private OnColorChangeListener listener;
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF square=new RectF(), hueBar=new RectF();
    private final float[] hsv=new float[3];
    private boolean draggingHue=false;
    private final float density;
    public ColorPickerView(Context context,int initial){
        super(context);
        density=getResources().getDisplayMetrics().density;
        Color.colorToHSV(initial,hsv);
        setContentDescription("Палитра: двигай пальцем для выбора оттенка, насыщенности и яркости");
    }
    public void setOnColorChangeListener(OnColorChangeListener l){listener=l;}
    public int getColor(){return Color.HSVToColor(hsv);}
    private float dp(float v){return v*density;}
    private float clamp(float v,float a,float b){return Math.max(a,Math.min(b,v));}
    @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){
        float p=dp(10);
        float barH=dp(24);
        float gap=dp(18);
        square.set(p,p,w-p,h-p-barH-gap);
        hueBar.set(p,square.bottom+gap,w-p,h-p);
    }
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);
        float radius=dp(8);
        int pureHue=Color.HSVToColor(new float[]{hsv[0],1,1});
        paint.setStyle(Paint.Style.FILL);
        paint.setShader(new LinearGradient(square.left,square.top,square.right,square.top,
            Color.WHITE,pureHue,Shader.TileMode.CLAMP));
        canvas.drawRoundRect(square,radius,radius,paint);
        paint.setShader(new LinearGradient(square.left,square.top,square.left,square.bottom,
            0x00000000,Color.BLACK,Shader.TileMode.CLAMP));
        canvas.drawRoundRect(square,radius,radius,paint);
        paint.setShader(new LinearGradient(hueBar.left,hueBar.top,hueBar.right,hueBar.top,
            new int[]{Color.RED,Color.YELLOW,Color.GREEN,Color.CYAN,Color.BLUE,Color.MAGENTA,Color.RED},
            null,Shader.TileMode.CLAMP));
        canvas.drawRoundRect(hueBar,dp(10),dp(10),paint);
        paint.setShader(null);
        float x=square.left+hsv[1]*square.width();
        float y=square.top+(1f-hsv[2])*square.height();
        paint.setColor(Color.BLACK);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(dp(3));
        canvas.drawCircle(x,y,dp(10),paint);
        paint.setColor(Color.WHITE);paint.setStrokeWidth(dp(2));
        canvas.drawCircle(x,y,dp(10),paint);
        float hx=hueBar.left+(hsv[0]/360f)*hueBar.width();
        paint.setColor(Color.BLACK);paint.setStrokeWidth(dp(3));
        canvas.drawCircle(hx,hueBar.centerY(),dp(13),paint);
        paint.setColor(Color.WHITE);paint.setStrokeWidth(dp(2));
        canvas.drawCircle(hx,hueBar.centerY(),dp(13),paint);
        paint.setStyle(Paint.Style.FILL);
    }
    @Override public boolean onTouchEvent(MotionEvent event){
        switch(event.getActionMasked()){
            case MotionEvent.ACTION_DOWN:
                draggingHue=event.getY()>=square.bottom+dp(7);
                getParent().requestDisallowInterceptTouchEvent(true);
            case MotionEvent.ACTION_MOVE:
                if(draggingHue){
                    hsv[0]=clamp((event.getX()-hueBar.left)/Math.max(1,hueBar.width()),0,1)*359.99f;
                }else{
                    hsv[1]=clamp((event.getX()-square.left)/Math.max(1,square.width()),0,1);
                    hsv[2]=1f-clamp((event.getY()-square.top)/Math.max(1,square.height()),0,1);
                }
                invalidate();
                if(listener!=null)listener.onColorChanged(getColor());
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                getParent().requestDisallowInterceptTouchEvent(false);
                performClick();
                return true;
        }
        return true;
    }
    @Override public boolean performClick(){super.performClick();return true;}
}
