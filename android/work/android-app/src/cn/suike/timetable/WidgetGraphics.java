package cn.suike.timetable;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;

/** Same two rows of 4dp square pixels and neutral glass curves as the in-app controls. */
final class WidgetGraphics {
    static Bitmap progress(int width,float density,double ratio,boolean dark){
        float d=Math.min(2f,density);int w=Math.max(100,Math.min(800,Math.round(width*d))),h=Math.max(10,Math.round(10*d));
        Bitmap bitmap=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(bitmap);Paint paint=new Paint();paint.setAntiAlias(false);
        int columns=Math.max(16,Math.min(160,(int)Math.floor((width+2)/6.0))),filled=(int)Math.floor(Math.max(0,Math.min(1,ratio))*columns+1e-8);
        float size=4*d,step=columns>1?(w-size)/(columns-1):0;
        for(int column=0;column<columns;column++){
            paint.setColor(column<filled?(dark?Color.WHITE:Color.BLACK):(dark?0xff404044:0xffdcdcdc));
            for(int row=0;row<2;row++){float x=Math.round(column*step),y=Math.round(row*6*d);canvas.drawRect(x,y,x+size,y+size,paint);}
        }
        return bitmap;
    }
    static Bitmap glass(int width,int height,float density,boolean dark,int frost,boolean rimOnly){
        float d=Math.min(2f,density);int w=Math.max(100,Math.min(800,Math.round(width*d))),h=Math.max(100,Math.min(900,Math.round(height*d)));
        float sx=w/(float)width,sy=h/(float)height,radius=24*Math.min(sx,sy),f=frost/100f;
        Bitmap bitmap=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(bitmap);Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);RectF box=new RectF(1,1,w-1,h-1);
        if(!rimOnly){int tint=Math.round(255*(.55f+.37f*f));p.setColor(Color.argb(tint,dark?30:255,dark?30:255,dark?30:255));canvas.drawRoundRect(box,radius,radius,p);}
        p.setShader(new LinearGradient(0,0,0,h,new int[]{dark?0x30ffffff:0x70ffffff,0x00ffffff,dark?0x18000000:0x12000000},new float[]{0,.42f,1},Shader.TileMode.CLAMP));
        canvas.drawRoundRect(box,radius,radius,p);p.setShader(null);
        p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(Math.max(1,Math.min(sx,sy)));
        p.setShader(new LinearGradient(0,0,w,h,new int[]{dark?0x65ffffff:0xeeffffff,dark?0x15ffffff:0x38ffffff,dark?0x44ffffff:0xa6ffffff},new float[]{0,.6f,1},Shader.TileMode.CLAMP));
        canvas.drawRoundRect(box,radius,radius,p);
        return bitmap;
    }
}
