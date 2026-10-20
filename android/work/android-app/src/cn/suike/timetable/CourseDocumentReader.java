package cn.suike.timetable;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Xml;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.*;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Selected attachments only. No OCR, no network, no extracted text returned to the editor. */
public final class CourseDocumentReader {
    public interface Result { void completed(String text,String error,String attachment); }
    private static final AtomicBoolean BUSY=new AtomicBoolean();
    private static final ExecutorService WORKER=Executors.newSingleThreadExecutor(r->new Thread(r,"suike-documents"));
    private static final int MAX_FILE=24*1024*1024,MAX_XML=4*1024*1024,MAX_TEXT=120000,MAX_ATTACHMENT=24*1024*1024;
    private static final LinkedHashMap<String,JSONArray> ATTACHMENTS=new LinkedHashMap<>();
    public static synchronized JSONArray content(String id)throws Exception{
        if(id==null||id.isEmpty())return new JSONArray();
        JSONArray parts=ATTACHMENTS.get(id);
        if(parts==null)throw new IllegalStateException("ATTACHMENT_EXPIRED");
        return new JSONArray(parts.toString());
    }
    public static JSONArray imageContent(String id)throws Exception{
        JSONArray result=new JSONArray(),parts=content(id);
        for(int i=0;i<parts.length();i++)if("image_url".equals(parts.getJSONObject(i).optString("type")))result.put(parts.getJSONObject(i));
        return result;
    }
    public static synchronized void clearAttachments(){ATTACHMENTS.clear();}
    private static synchronized String keep(JSONArray parts)throws Exception{
        if(parts.length()==0)throw new Limit("附件没有可读取的内容，请检查文件。 ");
        if(parts.toString().length()>MAX_ATTACHMENT)throw new Limit("附件较大，请压缩图片或拆分文档后再试。 ");
        String id=UUID.randomUUID().toString();ATTACHMENTS.put(id,parts);
        while(ATTACHMENTS.size()>2)ATTACHMENTS.remove(ATTACHMENTS.keySet().iterator().next());
        return id;
    }
    private CourseDocumentReader(){}
    public static boolean read(Context context,Uri uri,String filename,Result callback){
        if(uri==null||!"content".equals(uri.getScheme())||!BUSY.compareAndSet(false,true))return false;
        Context app=context.getApplicationContext();String lower=filename==null?"":filename.toLowerCase(Locale.ROOT);
        String found;
        try{found=app.getContentResolver().getType(uri);}
        catch(RuntimeException error){BUSY.set(false);callback.completed("","文件没有读取权限，请重新选择。","");return true;}
        final String mime=found;
        final boolean imageInput=(mime!=null&&mime.startsWith("image/"))||lower.matches(".*\\.(png|jpe?g|gif|webp|bmp|heic|heif)$");
        WORKER.execute(()->{
            File temporary=null;String error="none",attachment="";
            try{
                temporary=File.createTempFile("suike-course-",".document",app.getCacheDir());
                try(InputStream in=app.getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(temporary)){
                    if(in==null)throw new IOException();byte[] buffer=new byte[8192];int total=0,n;
                    while((n=in.read(buffer))!=-1){total+=n;if(total>MAX_FILE)throw new Limit("文件超过 24 MB，请拆分后导入。");out.write(buffer,0,n);}
                }
                byte[] magic=new byte[4];try(InputStream in=new FileInputStream(temporary)){if(in.read(magic)!=4)throw new IOException();}
                JSONArray parts=new JSONArray();
                if(imageInput){imageFile(temporary,parts);}
                else if(magic[0]=='%'&&magic[1]=='P'&&magic[2]=='D'&&magic[3]=='F'){pdf(temporary,parts);}
                else if(magic[0]=='P'&&magic[1]=='K'){
                    try(ZipFile zip=new ZipFile(temporary)){
                        JSONObject document;
                        if(zip.getEntry("word/document.xml")!=null){document=word(zip);document.put("filename",filename);textPart(parts,document.toString());embeddedImages(zip,"word/media/",parts);}
                        else if(zip.getEntry("xl/workbook.xml")!=null){document=excel(zip);document.put("filename",filename);textPart(parts,document.toString());embeddedImages(zip,"xl/media/",parts);}
                        else throw new Limit("请使用 .xlsx、.docx、PDF 或图片。");
                    }
                }else throw new Limit("旧版 .xls / .doc 请另存为 .xlsx / .docx，或导出 PDF 后添加。");
                attachment=keep(parts);
            }catch(Limit e){error=e.getMessage();}
            catch(Exception|LinkageError|OutOfMemoryError e){error="附件未能读取，请检查文件是否完整或已加密。";}
            finally{if(temporary!=null)temporary.delete();BUSY.set(false);}
            callback.completed("",error,attachment);
        });return true;
    }
    private static class Limit extends IOException{Limit(String message){super(message);}}
    private static void textPart(JSONArray parts,String value)throws Exception{
        if(value.length()>1024*1024)throw new Limit("文档内容较多，请拆分后添加。");
        parts.put(new JSONObject().put("type","text").put("text",value));
    }
    private static XmlPullParser parser(byte[] bytes)throws Exception{
        XmlPullParser parser=Xml.newPullParser();
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES,true);
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL,false);
        parser.setInput(new ByteArrayInputStream(bytes),null);return parser;
    }
    private static byte[] xml(ZipFile zip,String name)throws Exception{
        ZipEntry entry=zip.getEntry(name);if(entry==null)return new byte[0];
        if(entry.getSize()>MAX_XML)throw new Limit("文档内容过多，请拆分后导入。");
        try(InputStream in=zip.getInputStream(entry);ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] block=new byte[4096];int n;
            while((n=in.read(block))!=-1){if(out.size()+n>MAX_XML)throw new Limit("文档内容过多，请拆分后导入。");out.write(block,0,n);}
            return out.toByteArray();
        }
    }
    private static void append(StringBuilder result,String text)throws Limit{
        result.append(text);if(result.length()>MAX_TEXT)throw new Limit("文件内容过多，请拆分后导入。");
    }
    private static List<String> shared(ZipFile zip)throws Exception{
        List<String> strings=new ArrayList<>();byte[] bytes=xml(zip,"xl/sharedStrings.xml");if(bytes.length==0)return strings;
        XmlPullParser p=parser(bytes);StringBuilder current=null;boolean inText=false;
        for(int e=p.getEventType();e!=XmlPullParser.END_DOCUMENT;e=p.next()){
            if(e==XmlPullParser.DOCDECL)throw new IOException();
            if(e==XmlPullParser.START_TAG){if("si".equals(p.getName()))current=new StringBuilder();if("t".equals(p.getName()))inText=true;}
            if(e==XmlPullParser.TEXT&&inText&&current!=null)append(current,p.getText());
            if(e==XmlPullParser.END_TAG){if("t".equals(p.getName()))inText=false;if("si".equals(p.getName())){strings.add(current==null?"":current.toString());if(strings.size()>50000)throw new Limit("Excel 内容过多，请拆分工作表。");current=null;}}
        }return strings;
    }
    private static List<String> styles(ZipFile zip)throws Exception{
        Map<String,String> formats=new HashMap<>();List<String> result=new ArrayList<>();byte[] bytes=xml(zip,"xl/styles.xml");if(bytes.length==0)return result;
        XmlPullParser p=parser(bytes);boolean cellXfs=false;
        for(int e=p.getEventType();e!=XmlPullParser.END_DOCUMENT;e=p.next()){
            if(e==XmlPullParser.DOCDECL)throw new IOException();
            if(e==XmlPullParser.START_TAG){
                if("numFmt".equals(p.getName()))formats.put(p.getAttributeValue(null,"numFmtId"),p.getAttributeValue(null,"formatCode"));
                if("cellXfs".equals(p.getName()))cellXfs=true;
                if(cellXfs&&"xf".equals(p.getName())){
                    String id=p.getAttributeValue(null,"numFmtId"),format=formats.get(id);int n=number(id,0);
                    if(format==null)format=n>=14&&n<=17?"yyyy-mm-dd":n>=18&&n<=21||n>=45&&n<=47?"hh:mm":n==22?"yyyy-mm-dd hh:mm":"";
                    result.add(format);if(result.size()>10000)throw new Limit("Excel 样式过多，请另存为精简表格。");
                }
            }else if(e==XmlPullParser.END_TAG&&"cellXfs".equals(p.getName()))cellXfs=false;
        }return result;
    }
    private static int number(String value,int fallback){try{return Integer.parseInt(value);}catch(Exception e){return fallback;}}
    private static String formatted(String value,int style,List<String> styles,boolean date1904){
        if(style<0||style>=styles.size())return value;
        String f=styles.get(style).replaceAll("\"[^\"]*\"","").replaceAll("\\[[^\\]]*\\]","").toLowerCase(Locale.ROOT);
        boolean date=f.matches(".*[yd].*"),time=f.matches(".*[hs].*");
        if(!date&&!time)return value;
        try{
            double serial=Double.parseDouble(value);if(!Double.isFinite(serial)||serial<0||serial>110000)return value;
            LocalDate day=LocalDate.of(date1904?1904:1899,date1904?1:12,date1904?1:30).plusDays((long)Math.floor(serial));
            long seconds=Math.round((serial-Math.floor(serial))*86400)%86400;
            String clock=String.format(Locale.ROOT,"%02d:%02d",seconds/3600,(seconds%3600)/60);
            return date?day.toString()+(time?" "+clock:""):clock;
        }catch(Exception e){return value;}
    }

    private static String attr(XmlPullParser p,String name){
        for(int i=0;i<p.getAttributeCount();i++)if(name.equals(p.getAttributeName(i)))return p.getAttributeValue(i);
        return "";
    }
    private static class Table {JSONArray rows=new JSONArray(),row;JSONObject cell;JSONArray blocks;int span;String merge;}
    private static JSONObject word(ZipFile zip)throws Exception{
        XmlPullParser p=parser(xml(zip,"word/document.xml"));JSONArray blocks=new JSONArray();Deque<Table> tables=new ArrayDeque<>();
        StringBuilder paragraph=null,budget=new StringBuilder();boolean inText=false;JSONArray references=null;int count=0;
        for(int e=p.getEventType();e!=XmlPullParser.END_DOCUMENT;e=p.next()){
            if(e==XmlPullParser.DOCDECL)throw new IOException();String tag=p.getName();
            if(e==XmlPullParser.START_TAG){
                if("tbl".equals(tag)){if(tables.size()>=8)throw new Limit("文档表格层级过多，请导出 PDF 后添加。");tables.push(new Table());}
                else if("tr".equals(tag)&&!tables.isEmpty())tables.peek().row=new JSONArray();
                else if("tc".equals(tag)&&!tables.isEmpty()){Table t=tables.peek();t.cell=new JSONObject();t.blocks=new JSONArray();t.span=1;t.merge="";}
                else if("gridSpan".equals(tag)&&!tables.isEmpty())tables.peek().span=number(attr(p,"val"),1);
                else if("vMerge".equals(tag)&&!tables.isEmpty())tables.peek().merge=attr(p,"val").isEmpty()?"continue":attr(p,"val");
                else if("p".equals(tag)){paragraph=new StringBuilder();references=new JSONArray();}
                else if("t".equals(tag))inText=true;
                else if("tab".equals(tag)&&paragraph!=null)append(paragraph,"\t");
                else if("br".equals(tag)&&paragraph!=null)append(paragraph,"\n");
                else if("blip".equals(tag)&&references!=null)references.put(attr(p,"embed"));
            }else if(e==XmlPullParser.TEXT&&inText&&paragraph!=null){append(paragraph,p.getText());append(budget,p.getText());}
            else if(e==XmlPullParser.END_TAG){
                if("t".equals(tag))inText=false;
                else if("p".equals(tag)&&paragraph!=null){
                    JSONObject block=new JSONObject().put("type","paragraph").put("text",paragraph.toString());
                    if(references.length()>0)block.put("images",references);
                    if(!tables.isEmpty()&&tables.peek().cell!=null)tables.peek().blocks.put(block);else blocks.put(block);
                    paragraph=null;references=null;if(++count>20000)throw new Limit("文档内容较多，请拆分后添加。");
                }else if("tc".equals(tag)&&!tables.isEmpty()){
                    Table t=tables.peek();if(t.row==null||t.cell==null)throw new IOException();
                    t.cell.put("blocks",t.blocks).put("columnSpan",t.span).put("verticalMerge",t.merge);t.row.put(t.cell);t.cell=null;
                }else if("tr".equals(tag)&&!tables.isEmpty()){Table t=tables.peek();if(t.row==null)throw new IOException();t.rows.put(t.row);t.row=null;}
                else if("tbl".equals(tag)){
                    if(tables.isEmpty())throw new IOException();Table t=tables.pop();JSONObject block=new JSONObject().put("type","table").put("rows",t.rows);
                    if(!tables.isEmpty()&&tables.peek().cell!=null)tables.peek().blocks.put(block);else blocks.put(block);
                }
            }
        }
        return new JSONObject().put("kind","word").put("blocks",blocks);
    }
    private static JSONObject excel(ZipFile zip)throws Exception{
        List<String> strings=shared(zip),style=styles(zip);Map<String,String> rels=new HashMap<>();
        byte[] relationships=xml(zip,"xl/_rels/workbook.xml.rels");
        if(relationships.length!=0){XmlPullParser r=parser(relationships);for(int e=r.getEventType();e!=XmlPullParser.END_DOCUMENT;e=r.next()){
            if(e==XmlPullParser.DOCDECL)throw new IOException();
            if(e==XmlPullParser.START_TAG&&"Relationship".equals(r.getName())&&!"External".equals(r.getAttributeValue(null,"TargetMode")))rels.put(r.getAttributeValue(null,"Id"),r.getAttributeValue(null,"Target"));
        }}
        XmlPullParser workbook=parser(xml(zip,"xl/workbook.xml"));LinkedHashMap<String,String> sheets=new LinkedHashMap<>();boolean date1904=false;
        for(int e=workbook.getEventType();e!=XmlPullParser.END_DOCUMENT;e=workbook.next()){
            if(e==XmlPullParser.DOCDECL)throw new IOException();
            if(e==XmlPullParser.START_TAG&&"workbookPr".equals(workbook.getName())){String v=workbook.getAttributeValue(null,"date1904");date1904="1".equals(v)||"true".equals(v);}
            if(e==XmlPullParser.START_TAG&&"sheet".equals(workbook.getName())){
                String target=rels.get(attr(workbook,"id"));if(target==null)throw new IOException();
                String path=target.startsWith("/")?target.substring(1):"xl/"+target;
                if(path.contains("..")||!path.startsWith("xl/worksheets/")||!path.endsWith(".xml"))throw new IOException();
                sheets.put(path,workbook.getAttributeValue(null,"name"));if(sheets.size()>20)throw new Limit("Excel 工作表较多，请单独保存课程工作表。");
            }
        }
        JSONArray result=new JSONArray();int count=0;StringBuilder budget=new StringBuilder();
        for(Map.Entry<String,String> entry:sheets.entrySet()){
            JSONArray cells=new JSONArray(),merges=new JSONArray(),columns=new JSONArray();JSONObject sheet=new JSONObject().put("name",entry.getValue()).put("cells",cells).put("mergedRanges",merges).put("columns",columns);
            result.put(sheet);XmlPullParser p=parser(xml(zip,entry.getKey()));String type=null,ref=null,capture="";int cellStyle=-1;StringBuilder value=null,formula=null;
            for(int e=p.getEventType();e!=XmlPullParser.END_DOCUMENT;e=p.next()){
                if(e==XmlPullParser.DOCDECL)throw new IOException();String tag=p.getName();
                if(e==XmlPullParser.START_TAG){
                    if("dimension".equals(tag))sheet.put("range",attr(p,"ref"));
                    if("col".equals(tag))columns.put(new JSONObject().put("from",attr(p,"min")).put("to",attr(p,"max")).put("width",attr(p,"width")));
                    if("c".equals(tag)){type=attr(p,"t");ref=attr(p,"r");cellStyle=number(attr(p,"s"),-1);value=new StringBuilder();formula=new StringBuilder();if(++count>20000)throw new Limit("Excel 单元格较多，请拆分后添加。");}
                    if("v".equals(tag)||"t".equals(tag)||"f".equals(tag))capture=tag;
                    if("mergeCell".equals(tag))merges.put(attr(p,"ref"));
                }else if(e==XmlPullParser.TEXT&&value!=null&&!capture.isEmpty()){
                    append("f".equals(capture)?formula:value,p.getText());append(budget,p.getText());
                }else if(e==XmlPullParser.END_TAG){
                    if("v".equals(tag)||"t".equals(tag)||"f".equals(tag))capture="";
                    if("c".equals(tag)&&value!=null){
                        String raw=value.toString(),v=raw;
                        if("s".equals(type)){int index=number(v,-1);if(index<0||index>=strings.size())throw new IOException();v=strings.get(index);}
                        else if(!"inlineStr".equals(type)&&!"str".equals(type))v=formatted(v,cellStyle,style,date1904);
                        JSONObject cell=new JSONObject().put("address",ref).put("value",v).put("raw",raw).put("type",type);
                        if(cellStyle>=0&&cellStyle<style.size())cell.put("format",style.get(cellStyle));
                        if(formula.length()>0)cell.put("formula",formula.toString());
                        cells.put(cell);value=null;
                    }
                }
            }
        }
        return new JSONObject().put("kind","excel").put("date1904",date1904).put("sheets",result);
    }
    private static String imageMime(byte[] data){
        if(data.length>=8&&data[0]==(byte)0x89&&data[1]=='P'&&data[2]=='N'&&data[3]=='G')return "image/png";
        if(data.length>=3&&data[0]==(byte)0xff&&data[1]==(byte)0xd8&&data[2]==(byte)0xff)return "image/jpeg";
        if(data.length>=6&&data[0]=='G'&&data[1]=='I'&&data[2]=='F')return "image/gif";
        if(data.length>=12&&data[0]=='R'&&data[1]=='I'&&data[2]=='F'&&data[3]=='F'&&data[8]=='W'&&data[9]=='E'&&data[10]=='B'&&data[11]=='P')return "image/webp";
        return "";
    }
    private static void imageBytes(byte[] bytes,JSONArray parts)throws Exception{
        String mime=imageMime(bytes);
        if(mime.isEmpty()){
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
            if(bounds.outWidth<1||bounds.outHeight<1||bounds.outWidth>16000||bounds.outHeight>16000)throw new IOException();
            BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>3500)options.inSampleSize*=2;
            Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new IOException();
            try{bitmapPart(bitmap,parts);}finally{bitmap.recycle();}return;
        }
        parts.put(new JSONObject().put("type","image_url").put("image_url",new JSONObject().put("url","data:"+mime+";base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP)).put("detail","original")));
    }
    private static void imageFile(File file,JSONArray parts)throws Exception{
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);imageBytes(out.toByteArray(),parts);
        }
    }
    private static void bitmapPart(Bitmap bitmap,JSONArray parts)throws Exception{
        Bitmap opaque=Bitmap.createBitmap(bitmap.getWidth(),bitmap.getHeight(),Bitmap.Config.RGB_565);ByteArrayOutputStream out=new ByteArrayOutputStream();
        try{Canvas canvas=new Canvas(opaque);canvas.drawColor(Color.WHITE);canvas.drawBitmap(bitmap,0,0,null);if(!opaque.compress(Bitmap.CompressFormat.JPEG,96,out))throw new IOException();}
        finally{opaque.recycle();}imageBytes(out.toByteArray(),parts);
    }
    private static void embeddedImages(ZipFile zip,String prefix,JSONArray parts)throws Exception{
        Enumeration<? extends ZipEntry> entries=zip.entries();int count=0;
        while(entries.hasMoreElements()){
            ZipEntry entry=entries.nextElement();String name=entry.getName().toLowerCase(Locale.ROOT);
            if(!name.startsWith(prefix)||!name.matches(".*\\.(png|jpe?g|gif|webp)$"))continue;
            if(++count>12)throw new Limit("文档图片较多，请拆分后添加。");
            textPart(parts,"文档中的图片："+entry.getName());imageBytes(xml(zip,entry.getName()),parts);
        }
    }
    private static void pdf(File file,JSONArray parts)throws Exception{
        try(ParcelFileDescriptor descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer renderer=new PdfRenderer(descriptor)){
            if(renderer.getPageCount()>12)throw new Limit("PDF 超过 12 页，请选出课程页面后再添加。");
            for(int i=0;i<renderer.getPageCount();i++)try(PdfRenderer.Page page=renderer.openPage(i)){
                double scale=Math.min(3000.0/Math.max(page.getWidth(),page.getHeight()),4);
                Bitmap bitmap=Bitmap.createBitmap(Math.max(1,(int)(page.getWidth()*scale)),Math.max(1,(int)(page.getHeight()*scale)),Bitmap.Config.ARGB_8888);
                try{new Canvas(bitmap).drawColor(Color.WHITE);page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);textPart(parts,"PDF 原页图像：第 "+(i+1)+" 页，共 "+renderer.getPageCount()+" 页。");bitmapPart(bitmap,parts);}
                finally{bitmap.recycle();}
            }
        }
    }
}
