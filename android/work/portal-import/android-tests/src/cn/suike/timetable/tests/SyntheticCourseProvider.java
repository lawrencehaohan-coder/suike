package cn.suike.timetable.tests;
import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
import java.util.*;

/** Test APK only. Four fixed synthetic course files; no access to user documents. */
public final class SyntheticCourseProvider extends ContentProvider {
    private static final Set<String> NAMES=new HashSet<>(Arrays.asList("course.docx","course.xlsx","course.pdf","course.png"));
    @Override public boolean onCreate(){return true;}
    private String name(Uri uri)throws FileNotFoundException{
        String value=uri.getLastPathSegment();
        if(!"cn.suike.timetable.tests.documents".equals(uri.getAuthority())||!NAMES.contains(value))throw new FileNotFoundException("FIXTURE_ONLY");
        return value;
    }
    @Override public String getType(Uri uri){String n=uri.getLastPathSegment();return n!=null&&n.endsWith(".png")?"image/png":n!=null&&n.endsWith(".pdf")?"application/pdf":"application/octet-stream";}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
        MatrixCursor result=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME});
        try{result.addRow(new Object[]{name(uri)});}catch(Exception ignored){}return result;
    }
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String where,String[] args){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String where,String[] args){throw new UnsupportedOperationException();}
    private void draw(Canvas canvas){
        canvas.drawColor(Color.WHITE);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setColor(Color.BLACK);paint.setTextSize(88);
        paint.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));
        String[] lines={"物理实验课程安排","2026年10月19日","星期一 第三四节","实验楼203","请按时上课"};
        for(int i=0;i<lines.length;i++)canvas.drawText(lines[i],90,150+i*170,paint);
    }
    @Override public synchronized ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
        String name=name(uri);if(!"r".equals(mode))throw new FileNotFoundException("READ_ONLY");
        File output=new File(getContext().getCacheDir(),name);
        try{
            if(!output.exists()||name.endsWith(".docx")||name.endsWith(".xlsx")){
                try(OutputStream out=new FileOutputStream(output)){
                    if(name.endsWith(".png")){
                        Bitmap bitmap=Bitmap.createBitmap(2000,1050,Bitmap.Config.ARGB_8888);
                        try{draw(new Canvas(bitmap));bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}finally{bitmap.recycle();}
                    }else if(name.endsWith(".pdf")){
                        PdfDocument pdf=new PdfDocument();
                        try{PdfDocument.Page page=pdf.startPage(new PdfDocument.PageInfo.Builder(2000,1050,1).create());draw(page.getCanvas());pdf.finishPage(page);pdf.writeTo(out);}finally{pdf.close();}
                    }else{
                        try(InputStream in=getContext().getAssets().open(name)){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
                    }
                }
            }
            return ParcelFileDescriptor.open(output,ParcelFileDescriptor.MODE_READ_ONLY);
        }catch(Exception e){throw new FileNotFoundException("FIXTURE_FAILED");}
    }
}
